
const $ = (id) => document.getElementById(id);
const typeButtons = document.querySelectorAll(".type-button");
const panels = { file: $("filePanel"), text: $("textPanel"), code: $("codePanel") };

let activeType = "file";
let selectedFile = null;

typeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeType = button.dataset.type;
    typeButtons.forEach((b) => b.classList.toggle("active", b === button));
    Object.entries(panels).forEach(([name, panel]) => panel.classList.toggle("active", name === activeType));
    $("resultsSection").classList.add("hidden");
    showStatus(activeType === "file" ? (selectedFile ? "File ready for analysis." : "Select a file to begin.") : `Paste ${activeType} to begin.`);
  });
});

$("fileInput").addEventListener("change", () => {
  const file = $("fileInput").files[0];
  if (file) selectFile(file);
});

function selectFile(file) {
  if (file.size > 20 * 1024 * 1024) {
    showStatus("The maximum file size is 20 MB.", "error");
    return;
  }
  selectedFile = file;
  $("fileName").textContent = file.name;
  $("fileSize").textContent = formatFileSize(file.size);
  $("fileType").textContent = getFileLabel(file);
  $("dropZone").classList.add("hidden");
  $("filePreview").classList.remove("hidden");
  showStatus("File ready for analysis.", "success");
}

$("removeFile").addEventListener("click", () => {
  selectedFile = null;
  $("fileInput").value = "";
  $("filePreview").classList.add("hidden");
  $("dropZone").classList.remove("hidden");
  $("resultsSection").classList.add("hidden");
  showStatus("Select a file to begin.");
});

["dragenter", "dragover"].forEach((name) => {
  $("dropZone").addEventListener(name, (event) => {
    event.preventDefault();
    $("dropZone").classList.add("dragging");
  });
});

["dragleave", "drop"].forEach((name) => {
  $("dropZone").addEventListener(name, (event) => {
    event.preventDefault();
    $("dropZone").classList.remove("dragging");
  });
});

$("dropZone").addEventListener("drop", (event) => {
  const file = event.dataTransfer.files[0];
  if (file) selectFile(file);
});

$("analyzeButton").addEventListener("click", async () => {
  if (!validateInput()) return;
  const button = $("analyzeButton");
  button.disabled = true;
  button.textContent = "Analyzing...";
  $("resultsSection").classList.add("hidden");

  showStatus("Reading content...");
  await wait(600);
  showStatus("Generating analysis report...");
  await wait(800);

  const report = activeType === "text"
    ? textReport()
    : activeType === "code"
      ? codeReport()
      : fileReport();

  renderReport(report);
  $("resultsSection").classList.remove("hidden");
  showStatus("Analysis completed.", "success");
  button.disabled = false;
  button.textContent = "Analyze";
});

function validateInput() {
  if (activeType === "file" && !selectedFile) return fail("Select a file first.");
  if (activeType === "text" && !$("textInput").value.trim()) return fail("Paste some text first.");
  if (activeType === "code" && !$("codeInput").value.trim()) return fail("Paste some code first.");
  return true;
}

function fail(message) {
  showStatus(message, "error");
  return false;
}

function textReport() {
  const text = $("textInput").value.trim();
  const words = text.split(/\s+/).filter(Boolean);
  return {
    score: 84,
    cards: [
      card("CONTENT TYPE", "Written Text", "Plain text detected."),
      card("WORD COUNT", words.length, "Total words in the text."),
      card("LANGUAGE", /[çğıöşü]/i.test(text) ? "Turkish" : "English / Other", "Estimated language."),
      card("TONE", text.includes("!") ? "Expressive" : "Neutral", "Basic tone estimate."),
      card("READABILITY", words.length > 120 ? "Detailed" : "Clear", "Basic readability estimate."),
      card("READING TIME", `${Math.max(1, Math.ceil(words.length / 200))} min`, "Estimated reading time.")
    ]
  };
}

function codeReport() {
  const code = $("codeInput").value.trim();
  const language = detectCodeLanguage(code);
  const lines = code.split("\n").filter((line) => line.trim()).length;
  return {
    score: 88,
    cards: [
      card("LANGUAGE", language, "Detected from syntax."),
      card("CODE LINES", lines, "Empty lines excluded."),
      card("COMPLEXITY", estimateComplexity(code), "Estimated from control structures."),
      card("SECURITY RISK", /eval\(|innerHTML\s*=|document\.write/.test(code) ? "Review Required" : "Low", "Basic pattern check."),
      card("STRUCTURE", /class\s+\w+/.test(code) ? "Modular" : "Functional", "Estimated code structure."),
      card("CODE QUALITY", "Good", "Demo result for interface testing.")
    ]
  };
}

function fileReport() {
  const ext = selectedFile.name.split(".").pop().toUpperCase();
  return {
    score: 86,
    cards: [
      card("FILE TYPE", getFileLabel(selectedFile), selectedFile.type || "Unknown MIME type"),
      card("FILE SIZE", formatFileSize(selectedFile.size), "Uploaded file size."),
      card("FORMAT", ext, "Detected from file name."),
      card("QUALITY", "Good", "Demo result."),
      card("AI PROBABILITY", "32%", "Demonstration only."),
      card("ANALYSIS MODE", selectedFile.type.startsWith("image/") ? "Visual" : "General", "Selected automatically.")
    ]
  };
}

function card(label, value, description) {
  return { label, value: String(value), description };
}

function renderReport(report) {
  $("overallScore").textContent = `${report.score}/100`;
  $("resultGrid").innerHTML = "";
  report.cards.forEach((item) => {
    const article = document.createElement("article");
    article.className = "result-card";
    article.innerHTML = `<span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong><p>${escapeHtml(item.description)}</p>`;
    $("resultGrid").appendChild(article);
  });
}

function detectCodeLanguage(code) {
  if (/<!DOCTYPE html>|<html|<div/i.test(code)) return "HTML";
  if (/\bconst\b|\blet\b|=>|console\.log/.test(code)) return "JavaScript";
  if (/\bdef\b|\bprint\(/.test(code)) return "Python";
  if (/#include\s*<|std::/.test(code)) return "C++";
  if (/public class|System\.out\.println/.test(code)) return "Java";
  if (/using System|Console\.WriteLine/.test(code)) return "C#";
  if (/<\?php|\becho\b/.test(code)) return "PHP";
  if (/display:\s*(flex|grid)|body\s*\{/.test(code)) return "CSS";
  return "Unknown";
}

function estimateComplexity(code) {
  const count = (code.match(/\b(if|else|for|while|switch|case|catch|function|class)\b/g) || []).length;
  return count > 20 ? "High" : count > 7 ? "Medium" : "Low";
}

function getFileLabel(file) {
  if (file.type.startsWith("image/")) return "PHOTO";
  if (file.type === "application/pdf") return "PDF";
  return "FILE";
}

function formatFileSize(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function showStatus(message, type = "") {
  $("statusMessage").textContent = message;
  $("statusMessage").className = `status-message${type ? ` ${type}` : ""}`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[char]));
}

document.addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.key === "Enter") $("analyzeButton").click();
});
