require("dotenv").config();

const express = require("express");
const path = require("path");
const multer = require("multer");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 3000;

const MODEL =
  process.env.OPENROUTER_MODEL ||
  process.env.OPENAI_MODEL ||
  "openai/gpt-5-mini";

const OPENROUTER_SITE_URL =
  process.env.OPENROUTER_SITE_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  "https://analyze.ffgok.com";

const client = process.env.OPENROUTER_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": OPENROUTER_SITE_URL,
        "X-OpenRouter-Title": "Analyze"
      }
    })
  : null;

app.disable("x-powered-by");

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
  })
);

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  "/api",
  rateLimit({
    windowMs: 60_000,
    max: Number(process.env.RATE_LIMIT_PER_MINUTE || 20),
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: "Too many requests. Please wait a minute and try again."
    }
  })
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024,
    files: 3
  }
});

const textExtensions = new Set([
  "txt", "md", "js", "mjs", "cjs", "html", "css", "json",
  "py", "java", "cpp", "c", "cs", "php", "ts", "tsx", "jsx"
]);

const allowedExtensions = new Set([
  "pdf",
  ...textExtensions
]);

function extensionOf(filename) {
  const name = String(filename || "");
  return name.includes(".") ? name.split(".").pop().toLowerCase() : "";
}

function isAllowed(file) {
  if (String(file.mimetype || "").startsWith("image/")) {
    return true;
  }

  return allowedExtensions.has(extensionOf(file.originalname));
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    provider: "OpenRouter",
    aiConfigured: Boolean(client),
    model: MODEL
  });
});

app.post(
  "/api/analyze",
  upload.array("files", 3),
  async (req, res) => {
    try {
      if (!client) {
        return res.status(503).json({
          error:
            "OPENROUTER_API_KEY is missing. Add it in Render → Environment, then redeploy."
        });
      }

      const mode = ["file", "text", "code"].includes(req.body.mode)
        ? req.body.mode
        : "file";

      const content = String(req.body.content || "").slice(0, 50_000);
      const files = Array.isArray(req.files) ? req.files : [];

      if (mode === "file" && !files.length) {
        return res.status(400).json({ error: "No files received." });
      }

      if (mode !== "file" && !content.trim()) {
        return res.status(400).json({
          error: "No text or code received."
        });
      }

      for (const file of files) {
        if (!isAllowed(file)) {
          return res.status(415).json({
            error: `Unsupported file type: ${file.originalname}`
          });
        }
      }

      const instruction = `
You are Analyze, a careful multimodal analysis engine.

Analyze the supplied ${mode} content and return ONLY valid JSON.
Do not wrap the JSON in Markdown.

Use this exact shape:
{
  "title": "string",
  "summary": "string",
  "overallScore": 0,
  "metrics": [
    {
      "label": "string",
      "value": "string",
      "description": "string",
      "score": 0
    }
  ],
  "findings": ["string"],
  "recommendations": ["string"]
}

Rules:
- Return 8 to 14 useful metrics.
- overallScore must be an integer from 0 to 100.
- overallScore means clarity, quality and usefulness; it does not prove truth or authenticity.
- For images, discuss visible content, composition, lighting, quality, colors and readable text.
- Never invent hidden metadata, camera model, location, author, editing history or authenticity.
- Any AI-generation probability must be described as uncertain and non-definitive.
- For code, discuss likely language, purpose, correctness, maintainability, performance and security concerns.
- Do not claim a complete security audit.
- For text and PDFs, summarize, identify topics, tone, structure, readability, key details and possible inconsistencies.
- Keep findings practical and concise.
`.trim();

      const messageContent = [
        {
          type: "text",
          text: instruction
        }
      ];

      if (mode === "text") {
        messageContent.push({
          type: "text",
          text: `TEXT TO ANALYZE:\n\n${content}`
        });
      }

      if (mode === "code") {
        messageContent.push({
          type: "text",
          text: `CODE TO ANALYZE:\n\n${content}`
        });
      }

      for (const file of files) {
        const extension = extensionOf(file.originalname);
        const base64 = file.buffer.toString("base64");

        messageContent.push({
          type: "text",
          text: `Attached file: ${file.originalname} (${file.mimetype || "unknown type"}, ${file.size} bytes)`
        });

        if (String(file.mimetype || "").startsWith("image/")) {
          messageContent.push({
            type: "image_url",
            image_url: {
              url: `data:${file.mimetype};base64,${base64}`
            }
          });
          continue;
        }

        if (extension === "pdf") {
          messageContent.push({
            type: "file",
            file: {
              filename: file.originalname,
              file_data: `data:application/pdf;base64,${base64}`
            }
          });
          continue;
        }

        if (textExtensions.has(extension)) {
          messageContent.push({
            type: "text",
            text:
              `FILE ${file.originalname}:\n\n` +
              file.buffer.toString("utf8").slice(0, 50_000)
          });
        }
      }

      const completion = await client.chat.completions.create({
        model: MODEL,
        messages: [
          {
            role: "user",
            content: messageContent
          }
        ],
        response_format: {
          type: "json_object"
        },
        temperature: 0.2,
        max_tokens: 3000
      });

      const output =
        completion.choices?.[0]?.message?.content;

      if (!output) {
        throw new Error("OpenRouter returned an empty response.");
      }

      const report = parseJson(output);
      validateReport(report);

      res.json({
        ...report,
        provider: "OpenRouter",
        model: MODEL
      });
    } catch (error) {
      console.error("Analyze API error:", error);

      if (error instanceof multer.MulterError) {
        return res.status(400).json({
          error:
            error.code === "LIMIT_FILE_SIZE"
              ? "A file is larger than 15 MB."
              : error.message
        });
      }

      if (error?.status === 401) {
        return res.status(401).json({
          error: "The OpenRouter API key is invalid."
        });
      }

      if (error?.status === 402) {
        return res.status(402).json({
          error: "Your OpenRouter balance is insufficient."
        });
      }

      if (error?.status === 429) {
        return res.status(429).json({
          error: "OpenRouter rate limit reached. Please try again shortly."
        });
      }

      res.status(500).json({
        error:
          error?.message ||
          "Analysis failed. Check the Render logs and OpenRouter configuration."
      });
    }
  }
);

function parseJson(text) {
  const cleaned = String(text || "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");

    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }

    throw new Error("The model returned invalid JSON.");
  }
}

function validateReport(report) {
  if (
    !report ||
    typeof report !== "object" ||
    !Array.isArray(report.metrics)
  ) {
    throw new Error("The model returned an invalid report.");
  }

  report.overallScore = Math.max(
    0,
    Math.min(100, Math.round(Number(report.overallScore) || 0))
  );

  report.title = String(
    report.title || "Analysis Results"
  ).slice(0, 150);

  report.summary = String(
    report.summary || ""
  ).slice(0, 3000);

  report.findings = Array.isArray(report.findings)
    ? report.findings.map(String).slice(0, 12)
    : [];

  report.recommendations = Array.isArray(
    report.recommendations
  )
    ? report.recommendations.map(String).slice(0, 12)
    : [];

  report.metrics = report.metrics
    .slice(0, 16)
    .map((metric) => ({
      label: String(metric?.label || "Metric").slice(0, 80),
      value: String(metric?.value ?? "—").slice(0, 250),
      description: String(
        metric?.description || ""
      ).slice(0, 1000),
      score:
        typeof metric?.score === "number"
          ? Math.max(
              0,
              Math.min(100, Math.round(metric.score))
            )
          : null
    }));
}

app.use((error, _req, res, _next) => {
  console.error("Unexpected server error:", error);

  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      error:
        error.code === "LIMIT_FILE_SIZE"
          ? "A file is larger than 15 MB."
          : error.message
    });
  }

  res.status(500).json({
    error: "Unexpected server error."
  });
});

// Express 4-compatible SPA fallback.
// This must remain after all API routes and middleware.
app.get("*", (_req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Analyze V2.1 running on port ${PORT}`
  );
  console.log(
    client
      ? `OpenRouter ready · ${MODEL}`
      : "OPENROUTER_API_KEY is missing."
  );
});
