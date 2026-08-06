const $ = (id) => document.getElementById(id);

const state = {
  mode: "file",
  files: [],
  report: null,
  busy: false,
  fileMetadata: []
};

const HISTORY_KEY = "analyze_v22_history";
const HISTORY_LIMIT = 20;

document.querySelectorAll(".mode-button").forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.mode));
});

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll(".mode-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });

  ["file", "text", "code"].forEach((name) => {
    $(`${name}Panel`).classList.toggle("active", name === mode);
  });

  $("resultsSection").classList.add("hidden");
  showStatus(mode === "file" ? "Select files to begin." : `Paste ${mode} to begin.`);
}

$("languageSelect").addEventListener("change", () => {
  $("otherLanguageWrap").classList.toggle(
    "hidden",
    $("languageSelect").value !== "Other"
  );
});

$("historyToggle").addEventListener("click", () => {
  $("historyPanel").classList.toggle("hidden");
  renderHistory();
});

$("clearHistory").addEventListener("click", () => {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
});

$("fileInput").addEventListener("change", async (event) => {
  await addFiles([...event.target.files]);
  event.target.value = "";
});

["dragenter", "dragover"].forEach((eventName) => {
  $("dropZone").addEventListener(eventName, (event) => {
    event.preventDefault();
    $("dropZone").classList.add("dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  $("dropZone").addEventListener(eventName, (event) => {
    event.preventDefault();
    $("dropZone").classList.remove("dragging");
  });
});

$("dropZone").addEventListener("drop", async (event) => {
  await addFiles([...event.dataTransfer.files]);
});

async function addFiles(incoming) {
  const validFiles = incoming.filter((file) => {
    if (file.size > 15 * 1024 * 1024) {
      showStatus(`${file.name} is larger than 15 MB.`, "error");
      return false;
    }
    return true;
  });

  const available = Math.max(0, 3 - state.files.length);
  const accepted = validFiles.slice(0, available);

  if (validFiles.length > available) {
    showStatus("You can analyze a maximum of 3 files.", "error");
  }

  for (const file of accepted) {
    state.files.push(file);
    state.fileMetadata.push(await collectClientFileMetadata(file));
  }

  renderFiles();

  if (state.files.length) {
    showStatus(`${state.files.length} file(s) ready.`, "success");
  }
}

async function collectClientFileMetadata(file) {
  const base = {
    lastModified: file.lastModified
      ? new Date(file.lastModified).toLocaleString()
      : "Unknown"
  };

  if (!String(file.type).startsWith("image/")) return base;

  try {
    const bitmap = await createImageBitmap(file);
    const width = bitmap.width;
    const height = bitmap.height;
    const gcdValue = gcd(width, height);

    const canvas = document.createElement("canvas");
    const sampleSize = 96;
    canvas.width = sampleSize;
    canvas.height = sampleSize;

    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0, sampleSize, sampleSize);
    const imageData = context.getImageData(0, 0, sampleSize, sampleSize).data;
    bitmap.close();

    const dominantColors = extractDominantColors(imageData, 5);

    return {
      ...base,
      resolution: `${width} × ${height} px`,
      aspectRatio: `${Math.round(width / gcdValue)}:${Math.round(height / gcdValue)}`,
      colorMode: file.type === "image/png" ? "RGBA / RGB" : "RGB",
      dominantColors
    };
  } catch {
    return base;
  }
}

function extractDominantColors(data, limit) {
  const buckets = new Map();

  for (let index = 0; index < data.length; index += 16) {
    const alpha = data[index + 3];
    if (alpha < 100) continue;

    const r = Math.round(data[index] / 32) * 32;
    const g = Math.round(data[index + 1] / 32) * 32;
    const b = Math.round(data[index + 2] / 32) * 32;
    const key = `${Math.min(r,255)},${Math.min(g,255)},${Math.min(b,255)}`;

    buckets.set(key, (buckets.get(key) || 0) + 1);
  }

  return [...buckets.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value]) => {
      const [r, g, b] = value.split(",").map(Number);
      return rgbToHex(r, g, b);
    });
}

function rgbToHex(r, g, b) {
  return `#${[r,g,b]
    .map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0"))
    .join("")}`.toUpperCase();
}

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const temp = y;
    y = x % y;
    x = temp;
  }
  return x || 1;
}

function renderFiles() {
  const list = $("fileList");
  list.innerHTML = "";

  if (!state.files.length) {
    list.classList.add("hidden");
    $("dropZone").classList.remove("hidden");
    return;
  }

  $("dropZone").classList.add("hidden");
  list.classList.remove("hidden");

  state.files.forEach((file, index) => {
    const item = document.createElement("div");
    item.className = "file-item";
    item.style.animationDelay = `${index * 70}ms`;

    const icon = document.createElement("div");
    icon.className = "file-icon";
    icon.textContent = fileLabel(file);

    const info = document.createElement("div");
    info.className = "file-info";

    const name = document.createElement("strong");
    name.textContent = file.name;

    const meta = document.createElement("small");
    meta.textContent = `${formatBytes(file.size)} · ${file.type || "Unknown type"}`;

    const remove = document.createElement("button");
    remove.className = "remove-file";
    remove.type = "button";
    remove.textContent = "Remove";

    remove.addEventListener("click", () => {
      state.files.splice(index, 1);
      state.fileMetadata.splice(index, 1);
      renderFiles();
      showStatus(
        state.files.length
          ? `${state.files.length} file(s) ready.`
          : "Select files to begin."
      );
    });

    info.append(name, meta);
    item.append(icon, info, remove);
    list.append(item);
  });
}

$("textInput").addEventListener("input", () => {
  $("textCounter").textContent =
    `${$("textInput").value.length.toLocaleString()} / 50,000`;
});

$("codeInput").addEventListener("input", () => {
  $("codeCounter").textContent =
    `${$("codeInput").value.length.toLocaleString()} / 50,000`;
});

$("analyzeButton").addEventListener("click", analyze);

async function analyze() {
  if (state.busy || !validateInput()) return;

  setBusy(true);
  startProgress();

  try {
    const formData = new FormData();
    formData.append("mode", state.mode);
    formData.append("language", selectedLanguage());
    formData.append("fileMetadata", JSON.stringify(state.fileMetadata));

    if (state.mode === "file") {
      state.files.forEach((file) => formData.append("files", file));
    } else {
      formData.append(
        "content",
        state.mode === "text" ? $("textInput").value : $("codeInput").value
      );
    }

    const response = await fetch("/api/analyze", {
      method: "POST",
      body: formData
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || `Analysis failed (${response.status}).`);
    }

    completeProgress();
    state.report = payload;
    renderReport(payload);
    saveHistory(payload);
    showStatus("Analysis completed.", "success");
  } catch (error) {
    stopProgress();
    showStatus(error.message || "Analysis failed.", "error");
  } finally {
    setBusy(false);
  }
}

function selectedLanguage() {
  if ($("languageSelect").value !== "Other") {
    return $("languageSelect").value;
  }

  return $("otherLanguageInput").value.trim() || "English";
}

function validateInput() {
  if (state.mode === "file" && !state.files.length) {
    showStatus("Choose at least one file.", "error");
    return false;
  }

  const content =
    state.mode === "text"
      ? $("textInput").value.trim()
      : $("codeInput").value.trim();

  if (state.mode !== "file" && !content) {
    showStatus(`Paste some ${state.mode} first.`, "error");
    return false;
  }

  return true;
}

function setBusy(busy) {
  state.busy = busy;
  $("analyzeButton").disabled = busy;
  $("spinner").classList.toggle("hidden", !busy);
  $("analyzeButtonText").textContent = busy ? "Analyzing…" : "Analyze";
}

let progressTimer;

function startProgress() {
  clearInterval(progressTimer);
  $("progressCard").classList.remove("hidden");
  $("resultsSection").classList.add("hidden");

  let value = 5;
  updateProgress(value);

  progressTimer = setInterval(() => {
    const increment = value < 35 ? 7 : value < 70 ? 4 : 1;
    value = Math.min(92, value + increment);
    updateProgress(value);
  }, 340);
}

function updateProgress(value) {
  $("progressBar").style.width = `${value}%`;
  $("progressPercent").textContent = `${value}%`;
  $("progressLabel").textContent =
    value < 28
      ? "Reading content…"
      : value < 58
        ? "Understanding structure…"
        : value < 82
          ? "Evaluating quality and risks…"
          : "Preparing report…";
}

function completeProgress() {
  clearInterval(progressTimer);
  updateProgress(100);
  setTimeout(() => $("progressCard").classList.add("hidden"), 500);
}

function stopProgress() {
  clearInterval(progressTimer);
  $("progressCard").classList.add("hidden");
}

function renderReport(report) {
  $("speedBadge").textContent = `⚡ ${Number(report.analysisSpeed || 0).toFixed(1)} seconds`;
  $("modelBadge").textContent = friendlyModelName(report.model);
  $("providerBadge").textContent = report.provider || "OpenRouter";
  $("languageBadge").textContent = report.reportLanguage || "English";

  renderFileInformation(report.fileInformation || []);

  $("reportTitle").textContent = report.title || "Analysis Results";
  $("reportSummary").textContent = report.summary || "";

  const score = clampScore(report.overallScore);
  $("overallScore").textContent = String(score);
  $("scoreRing").style.setProperty("--score", score);

  renderProbability(report.aiProbability || {});

  const grid = $("resultGrid");
  grid.innerHTML = "";

  (report.metrics || []).forEach((metric, index) => {
    const card = document.createElement("article");
    card.className = "result-card";
    card.style.animationDelay = `${index * 65}ms`;

    const label = document.createElement("span");
    label.textContent = metric.label || "METRIC";

    const value = document.createElement("h3");
    value.textContent = metric.value ?? "—";

    const description = document.createElement("p");
    description.textContent = metric.description || "";

    card.append(label, value, description);

    if (typeof metric.score === "number") {
      const track = document.createElement("div");
      track.className = "metric-score";
      const fill = document.createElement("div");
      fill.style.width = `${clampScore(metric.score)}%`;
      track.append(fill);
      card.append(track);
    }

    grid.append(card);
  });

  renderList("findingsList", report.findings);
  renderList("recommendationsList", report.recommendations);

  $("resultsSection").classList.remove("hidden");

  setTimeout(() => {
    $("resultsSection").scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }, 180);
}

function renderFileInformation(files) {
  const grid = $("fileInfoGrid");
  grid.innerHTML = "";

  files.forEach((file) => {
    const card = document.createElement("article");
    card.className = "file-info-card";

    const title = document.createElement("h3");
    title.textContent = file.filename || "Uploaded content";
    card.append(title);

    const pairs = document.createElement("div");
    pairs.className = "info-pairs";

    Object.entries(file).forEach(([key, value]) => {
      if (key === "filename" || key === "dominantColors") return;
      if (value === undefined || value === null || value === "") return;

      const pair = document.createElement("div");
      pair.className = "info-pair";

      const label = document.createElement("span");
      label.textContent = prettifyKey(key);

      const strong = document.createElement("strong");
      strong.textContent =
        key === "bytes"
          ? `${Number(value).toLocaleString()} bytes`
          : String(value);

      pair.append(label, strong);
      pairs.append(pair);
    });

    card.append(pairs);

    if (Array.isArray(file.dominantColors) && file.dominantColors.length) {
      const colorRow = document.createElement("div");
      colorRow.className = "color-row";

      file.dominantColors.forEach((color) => {
        const chip = document.createElement("div");
        chip.className = "color-chip";

        const dot = document.createElement("span");
        dot.className = "color-dot";
        dot.style.background = color;

        const text = document.createElement("span");
        text.textContent = color;

        chip.append(dot, text);
        colorRow.append(chip);
      });

      card.append(colorRow);
    }

    grid.append(card);
  });
}

function renderProbability(probability) {
  const values = [
    ["Human Designed", probability.humanDesigned],
    ["AI Assisted", probability.aiAssisted],
    ["Fully AI", probability.fullyAI]
  ];

  const grid = $("probabilityGrid");
  grid.innerHTML = "";

  values.forEach(([labelText, value]) => {
    const score = clampScore(value);
    const card = document.createElement("article");
    card.className = "probability-card";

    const label = document.createElement("span");
    label.textContent = labelText;

    const strong = document.createElement("strong");
    strong.textContent = `${score}%`;

    const track = document.createElement("div");
    track.className = "probability-track";

    const fill = document.createElement("div");
    fill.style.width = `${score}%`;

    track.append(fill);
    card.append(label, strong, track);
    grid.append(card);
  });

  $("probabilityNote").textContent =
    probability.explanation ||
    "This is an uncertain estimate and cannot prove whether content was created by AI.";
}

function renderList(id, values) {
  const list = $(id);
  list.innerHTML = "";

  const safeValues =
    Array.isArray(values) && values.length
      ? values
      : ["No item returned."];

  safeValues.forEach((value) => {
    const item = document.createElement("li");
    item.textContent = value;
    list.append(item);
  });
}

function friendlyModelName(model) {
  const value = String(model || "");
  if (value.includes("gpt-5-mini")) return "GPT-5 Mini";
  if (value.includes("gpt-5")) return "GPT-5";
  return value.split("/").pop() || "AI Model";
}

function prettifyKey(key) {
  return String(key)
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (character) => character.toUpperCase());
}

function saveHistory(report) {
  const history = getHistory();
  const title =
    report.fileInformation?.[0]?.filename ||
    report.title ||
    "Analysis";

  history.unshift({
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    title,
    date: new Date().toLocaleString(),
    score: clampScore(report.overallScore),
    model: friendlyModelName(report.model),
    speed: Number(report.analysisSpeed || 0).toFixed(1),
    report
  });

  localStorage.setItem(
    HISTORY_KEY,
    JSON.stringify(history.slice(0, HISTORY_LIMIT))
  );

  renderHistory();
}

function getHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function renderHistory() {
  const list = $("historyList");
  list.innerHTML = "";

  const history = getHistory();

  if (!history.length) {
    const empty = document.createElement("p");
    empty.className = "probability-note";
    empty.textContent = "No saved analysis yet.";
    list.append(empty);
    return;
  }

  history.forEach((entry) => {
    const button = document.createElement("button");
    button.className = "history-item";
    button.type = "button";

    const title = document.createElement("strong");
    title.textContent = entry.title;

    const meta = document.createElement("small");
    meta.textContent =
      `${entry.date} · ${entry.score}/100 · ${entry.model} · ${entry.speed}s`;

    button.append(title, meta);

    button.addEventListener("click", () => {
      state.report = entry.report;
      renderReport(entry.report);
      $("historyPanel").classList.add("hidden");
    });

    list.append(button);
  });
}

$("downloadJson").addEventListener("click", () => {
  if (!state.report) return;
  downloadBlob(
    JSON.stringify(state.report, null, 2),
    "analyze-report.json",
    "application/json"
  );
});

$("downloadMarkdown").addEventListener("click", () => {
  if (!state.report) return;
  downloadBlob(
    reportToMarkdown(state.report),
    "analyze-report.md",
    "text/markdown"
  );
});

$("downloadTxt").addEventListener("click", () => {
  if (!state.report) return;
  downloadBlob(
    reportToPlainText(state.report),
    "analyze-report.txt",
    "text/plain"
  );
});

$("downloadCsv").addEventListener("click", () => {
  if (!state.report) return;
  downloadBlob(
    reportToCsv(state.report),
    "analyze-report.csv",
    "text/csv"
  );
});

$("downloadDocx").addEventListener("click", async () => {
  if (!state.report) return;

  try {
    const response = await fetch("/api/export/docx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ report: state.report })
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "DOCX export failed.");
    }

    const blob = await response.blob();
    downloadBlobObject(blob, "analyze-report.docx");
  } catch (error) {
    showStatus(error.message || "DOCX export failed.", "error");
  }
});

$("printReport").addEventListener("click", () => window.print());

$("newAnalysis").addEventListener("click", () => {
  state.report = null;
  $("resultsSection").classList.add("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
});

function reportToMarkdown(report) {
  const lines = [
    `# ${report.title || "Analyze Report"}`,
    "",
    `**Score:** ${clampScore(report.overallScore)}/100`,
    `**Model:** ${friendlyModelName(report.model)}`,
    `**Provider:** ${report.provider || "OpenRouter"}`,
    `**Analysis speed:** ${Number(report.analysisSpeed || 0).toFixed(1)} seconds`,
    "",
    "## File Information",
    ""
  ];

  (report.fileInformation || []).forEach((file) => {
    lines.push(`### ${file.filename || "File"}`, "");
    Object.entries(file).forEach(([key, value]) => {
      if (key === "filename") return;
      lines.push(`- **${prettifyKey(key)}:** ${Array.isArray(value) ? value.join(", ") : value}`);
    });
    lines.push("");
  });

  lines.push("## AI Summary", "", report.summary || "", "");
  lines.push("## Metrics", "");

  (report.metrics || []).forEach((metric) => {
    lines.push(
      `### ${metric.label || "Metric"}`,
      "",
      `**${metric.value ?? "—"}**`,
      "",
      metric.description || "",
      ""
    );
  });

  lines.push("## Findings", "");
  (report.findings || []).forEach((item) => lines.push(`- ${item}`));

  lines.push("", "## Recommendations", "");
  (report.recommendations || []).forEach((item) => lines.push(`- ${item}`));

  return lines.join("\n");
}

function reportToPlainText(report) {
  return reportToMarkdown(report)
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*/g, "")
    .replace(/^- /gm, "• ");
}

function reportToCsv(report) {
  const rows = [["Section", "Label", "Value", "Description"]];

  (report.fileInformation || []).forEach((file) => {
    Object.entries(file).forEach(([key, value]) => {
      rows.push([
        "File Information",
        `${file.filename || "File"} - ${prettifyKey(key)}`,
        Array.isArray(value) ? value.join(" | ") : String(value),
        ""
      ]);
    });
  });

  rows.push(["AI Summary", "Summary", report.summary || "", ""]);
  rows.push(["Score", "Overall Score", clampScore(report.overallScore), ""]);

  (report.metrics || []).forEach((metric) => {
    rows.push([
      "Metrics",
      metric.label || "Metric",
      metric.value ?? "—",
      metric.description || ""
    ]);
  });

  (report.findings || []).forEach((item) => {
    rows.push(["Findings", "Finding", item, ""]);
  });

  (report.recommendations || []).forEach((item) => {
    rows.push(["Recommendations", "Recommendation", item, ""]);
  });

  return rows
    .map((row) =>
      row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")
    )
    .join("\n");
}

function downloadBlob(content, filename, type) {
  downloadBlobObject(new Blob([content], { type }), filename);
}

function downloadBlobObject(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function checkHealth() {
  try {
    const response = await fetch("/health");
    const data = await response.json();

    $("systemStatus").classList.toggle("offline", !data.aiConfigured);
    $("systemStatusText").textContent =
      data.aiConfigured ? "Analyze Ready" : "API key missing";
  } catch {
    $("systemStatus").classList.add("offline");
    $("systemStatusText").textContent = "Offline";
  }
}

function showStatus(message, type = "") {
  $("statusMessage").textContent = message;
  $("statusMessage").className =
    `status-message${type ? ` ${type}` : ""}`;
}

function fileLabel(file) {
  if (String(file.type).startsWith("image/")) return "IMG";
  if (file.type === "application/pdf") return "PDF";
  const extension = file.name.includes(".")
    ? file.name.split(".").pop().toUpperCase()
    : "FILE";
  return extension.slice(0, 4);
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

function clampScore(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(0, Math.min(100, Math.round(number)))
    : 0;
}

document.addEventListener("mousemove", (event) => {
  const x = (event.clientX / window.innerWidth - 0.5) * 22;
  const y = (event.clientY / window.innerHeight - 0.5) * 22;

  document.querySelector(".ambient-left").style.transform =
    `translate(${x}px, ${y}px)`;

  document.querySelector(".ambient-right").style.transform =
    `translate(${-x}px, ${-y}px)`;
});

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    analyze();
  }
});

renderHistory();
checkHealth();
