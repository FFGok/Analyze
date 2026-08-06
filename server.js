require("dotenv").config();

const express = require("express");
const path = require("path");
const multer = require("multer");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const OpenAI = require("openai");
const pdfParse = require("pdf-parse");
const { Document, Packer, Paragraph, HeadingLevel, TextRun } = require("docx");

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

app.use(express.json({ limit: "2mb" }));
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

const allowedExtensions = new Set(["pdf", ...textExtensions]);

function extensionOf(filename) {
  const name = String(filename || "");
  return name.includes(".") ? name.split(".").pop().toLowerCase() : "";
}

function isAllowed(file) {
  if (String(file.mimetype || "").startsWith("image/")) return true;
  return allowedExtensions.has(extensionOf(file.originalname));
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024))
  );
  return `${(bytes / 1024 ** index).toFixed(index ? 2 : 0)} ${units[index]}`;
}

function countComments(text, extension) {
  const source = String(text || "");
  const singleLine = (source.match(/^\s*(\/\/|#|--)/gm) || []).length;
  const block = (source.match(/\/\*[\s\S]*?\*\//g) || []).length;
  const html = extension === "html"
    ? (source.match(/<!--[\s\S]*?-->/g) || []).length
    : 0;
  return singleLine + block + html;
}

async function buildFileInformation(files, clientMetadata = []) {
  const result = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const extension = extensionOf(file.originalname);
    const clientInfo = clientMetadata[index] || {};

    const base = {
      filename: file.originalname,
      fileType: String(file.mimetype || "").startsWith("image/")
        ? "Image"
        : extension === "pdf"
          ? "PDF Document"
          : textExtensions.has(extension)
            ? "Text / Code File"
            : "File",
      format: extension ? extension.toUpperCase() : "Unknown",
      fileSize: formatBytes(file.size),
      bytes: file.size,
      mimeType: file.mimetype || "application/octet-stream",
      lastModified: clientInfo.lastModified || "Unknown"
    };

    if (String(file.mimetype || "").startsWith("image/")) {
      result.push({
        ...base,
        resolution: clientInfo.resolution || "Unknown",
        aspectRatio: clientInfo.aspectRatio || "Unknown",
        colorMode: clientInfo.colorMode || "Unknown",
        dominantColors: Array.isArray(clientInfo.dominantColors)
          ? clientInfo.dominantColors.slice(0, 6)
          : []
      });
      continue;
    }

    if (extension === "pdf") {
      try {
        const parsed = await pdfParse(file.buffer);
        const text = String(parsed.text || "");
        const words = text.trim() ? text.trim().split(/\s+/).length : 0;
        const pdfVersionMatch = file.buffer
          .subarray(0, 32)
          .toString("latin1")
          .match(/%PDF-(\d\.\d)/);

        result.push({
          ...base,
          pages: parsed.numpages || "Unknown",
          wordCount: words,
          pdfVersion: pdfVersionMatch ? pdfVersionMatch[1] : "Unknown",
          language: clientInfo.language || "Unknown",
          created: parsed.info?.CreationDate || "Unknown",
          modified: parsed.info?.ModDate || clientInfo.lastModified || "Unknown"
        });
      } catch (error) {
        console.error("PDF metadata error:", error);
        result.push({
          ...base,
          pages: "Unknown",
          wordCount: "Unknown",
          pdfVersion: "Unknown",
          language: "Unknown",
          created: "Unknown",
          modified: clientInfo.lastModified || "Unknown"
        });
      }
      continue;
    }

    const content = file.buffer.toString("utf8");
    const lines = content.split(/\r?\n/).length;
    const characters = content.length;
    const words = content.trim() ? content.trim().split(/\s+/).length : 0;

    result.push({
      ...base,
      lines,
      characters,
      words,
      comments: countComments(content, extension),
      encoding: "UTF-8"
    });
  }

  return result;
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    aiConfigured: Boolean(client),
    model: MODEL,
    provider: "OpenRouter"
  });
});

app.post("/api/analyze", upload.array("files", 3), async (req, res) => {
  const startedAt = Date.now();

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
    const reportLanguage = String(req.body.language || "English").slice(0, 60);

    let clientMetadata = [];
    try {
      clientMetadata = JSON.parse(req.body.fileMetadata || "[]");
      if (!Array.isArray(clientMetadata)) clientMetadata = [];
    } catch {
      clientMetadata = [];
    }

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

    const fileInformation =
      mode === "file"
        ? await buildFileInformation(files, clientMetadata)
        : [{
            filename: mode === "code" ? "Pasted code" : "Pasted text",
            fileType: mode === "code" ? "Code" : "Text",
            format: mode === "code" ? "Source Code" : "Plain Text",
            fileSize: formatBytes(Buffer.byteLength(content, "utf8")),
            bytes: Buffer.byteLength(content, "utf8"),
            lines: content.split(/\r?\n/).length,
            characters: content.length,
            words: content.trim() ? content.trim().split(/\s+/).length : 0,
            comments: mode === "code" ? countComments(content, "") : 0,
            encoding: "UTF-8"
          }];

    const instruction = `
You are Analyze, a careful multimodal analysis engine.

Return the report language in: ${reportLanguage}

Analyze the supplied ${mode} content and return ONLY valid JSON.
Do not wrap the JSON in Markdown.

Use this exact JSON shape:
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
  "recommendations": ["string"],
  "aiProbability": {
    "humanDesigned": 0,
    "aiAssisted": 0,
    "fullyAI": 0,
    "explanation": "string",
    "uncertain": true
  }
}

Rules:
- Return 8 to 14 useful metrics.
- overallScore must be an integer from 0 to 100.
- overallScore means clarity, quality and usefulness; it does not prove truth or authenticity.
- AI probability values are visual/textual estimates only and are never definitive.
- The three AI probability values do not need to sum to 100 because they represent independent confidence signals.
- For images, discuss visible content, composition, lighting, quality, colors and readable text.
- Never invent hidden metadata, exact camera model, exact location, author, editing history or authenticity.
- For code, discuss likely language, purpose, correctness, maintainability, performance and security concerns.
- Do not claim a complete security audit.
- For text and PDFs, summarize, identify topics, tone, structure, readability, key details and possible inconsistencies.
- Keep findings practical and concise.
`.trim();

    const messageContent = [{ type: "text", text: instruction }];

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
      messages: [{ role: "user", content: messageContent }],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 3500
    });

    const output = completion.choices?.[0]?.message?.content;
    if (!output) throw new Error("OpenRouter returned an empty response.");

    const report = parseJson(output);
    validateReport(report);

    const durationSeconds = Number(
      ((Date.now() - startedAt) / 1000).toFixed(1)
    );

    res.json({
      ...report,
      fileInformation,
      analysisSpeed: durationSeconds,
      provider: "OpenRouter",
      model: MODEL,
      reportLanguage
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
});

app.post("/api/export/docx", async (req, res) => {
  try {
    const report = req.body?.report;
    if (!report || typeof report !== "object") {
      return res.status(400).json({ error: "Report data is required." });
    }

    const sections = [];

    sections.push(
      new Paragraph({
        text: report.title || "Analyze Report",
        heading: HeadingLevel.TITLE
      })
    );

    sections.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `Score: ${report.overallScore ?? 0}/100`,
            bold: true
          }),
          new TextRun({
            text: ` · ${report.provider || "OpenRouter"} · ${report.model || ""}`
          })
        ]
      })
    );

    if (report.summary) {
      sections.push(
        new Paragraph({
          text: "AI Summary",
          heading: HeadingLevel.HEADING_1
        }),
        new Paragraph(report.summary)
      );
    }

    sections.push(
      new Paragraph({
        text: "File Information",
        heading: HeadingLevel.HEADING_1
      })
    );

    for (const file of report.fileInformation || []) {
      sections.push(
        new Paragraph({
          text: file.filename || "File",
          heading: HeadingLevel.HEADING_2
        })
      );

      for (const [key, value] of Object.entries(file)) {
        if (key === "filename" || Array.isArray(value)) continue;
        sections.push(
          new Paragraph({
            children: [
              new TextRun({ text: `${key}: `, bold: true }),
              new TextRun(String(value))
            ]
          })
        );
      }

      if (Array.isArray(file.dominantColors) && file.dominantColors.length) {
        sections.push(
          new Paragraph({
            children: [
              new TextRun({ text: "dominantColors: ", bold: true }),
              new TextRun(file.dominantColors.join(", "))
            ]
          })
        );
      }
    }

    sections.push(
      new Paragraph({
        text: "Metrics",
        heading: HeadingLevel.HEADING_1
      })
    );

    for (const metric of report.metrics || []) {
      sections.push(
        new Paragraph({
          text: `${metric.label || "Metric"} — ${metric.value ?? "—"}`,
          heading: HeadingLevel.HEADING_2
        }),
        new Paragraph(metric.description || "")
      );
    }

    sections.push(
      new Paragraph({
        text: "Findings",
        heading: HeadingLevel.HEADING_1
      })
    );

    for (const item of report.findings || []) {
      sections.push(new Paragraph({ text: item, bullet: { level: 0 } }));
    }

    sections.push(
      new Paragraph({
        text: "Recommendations",
        heading: HeadingLevel.HEADING_1
      })
    );

    for (const item of report.recommendations || []) {
      sections.push(new Paragraph({ text: item, bullet: { level: 0 } }));
    }

    const doc = new Document({
      sections: [{ properties: {}, children: sections }]
    });

    const buffer = await Packer.toBuffer(doc);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="analyze-report.docx"'
    );
    res.send(buffer);
  } catch (error) {
    console.error("DOCX export error:", error);
    res.status(500).json({ error: "DOCX export failed." });
  }
});

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

function clampScore(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(0, Math.min(100, Math.round(number)))
    : 0;
}

function validateReport(report) {
  if (!report || typeof report !== "object" || !Array.isArray(report.metrics)) {
    throw new Error("The model returned an invalid report.");
  }

  report.overallScore = clampScore(report.overallScore);
  report.title = String(report.title || "Analysis Results").slice(0, 150);
  report.summary = String(report.summary || "").slice(0, 3000);

  report.findings = Array.isArray(report.findings)
    ? report.findings.map(String).slice(0, 12)
    : [];

  report.recommendations = Array.isArray(report.recommendations)
    ? report.recommendations.map(String).slice(0, 12)
    : [];

  report.metrics = report.metrics.slice(0, 16).map((metric) => ({
    label: String(metric?.label || "Metric").slice(0, 80),
    value: String(metric?.value ?? "—").slice(0, 250),
    description: String(metric?.description || "").slice(0, 1000),
    score:
      typeof metric?.score === "number"
        ? clampScore(metric.score)
        : null
  }));

  const ai = report.aiProbability || {};
  report.aiProbability = {
    humanDesigned: clampScore(ai.humanDesigned),
    aiAssisted: clampScore(ai.aiAssisted),
    fullyAI: clampScore(ai.fullyAI),
    explanation: String(ai.explanation || "").slice(0, 1200),
    uncertain: true
  };
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

  res.status(500).json({ error: "Unexpected server error." });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Analyze V2.2 running on port ${PORT}`);
  console.log(client ? `Analyze Ready · ${MODEL}` : "OPENROUTER_API_KEY is missing.");
});
