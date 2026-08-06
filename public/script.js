const $ = (id) => document.getElementById(id);

const state = {
  mode: "file",
  files: [],
  report: null,
  busy: false
};

document
  .querySelectorAll(".mode-button")
  .forEach((button) => {
    button.addEventListener("click", () => {
      setMode(button.dataset.mode);
    });
  });

function setMode(mode) {
  state.mode = mode;

  document
    .querySelectorAll(".mode-button")
    .forEach((button) => {
      button.classList.toggle(
        "active",
        button.dataset.mode === mode
      );
    });

  ["file", "text", "code"].forEach((name) => {
    $(`${name}Panel`).classList.toggle(
      "active",
      name === mode
    );
  });

  $("resultsSection").classList.add("hidden");

  showStatus(
    mode === "file"
      ? "Select files to begin."
      : `Paste ${mode} to begin.`
  );
}

$("fileInput").addEventListener(
  "change",
  (event) => {
    addFiles([...event.target.files]);
    event.target.value = "";
  }
);

["dragenter", "dragover"].forEach(
  (eventName) => {
    $("dropZone").addEventListener(
      eventName,
      (event) => {
        event.preventDefault();
        $("dropZone").classList.add("dragging");
      }
    );
  }
);

["dragleave", "drop"].forEach(
  (eventName) => {
    $("dropZone").addEventListener(
      eventName,
      (event) => {
        event.preventDefault();
        $("dropZone").classList.remove(
          "dragging"
        );
      }
    );
  }
);

$("dropZone").addEventListener(
  "drop",
  (event) => {
    addFiles([...event.dataTransfer.files]);
  }
);

function addFiles(incoming) {
  const validFiles = incoming.filter((file) => {
    if (file.size > 15 * 1024 * 1024) {
      showStatus(
        `${file.name} is larger than 15 MB.`,
        "error"
      );
      return false;
    }

    return true;
  });

  const combined = [
    ...state.files,
    ...validFiles
  ].slice(0, 3);

  if (
    state.files.length +
      validFiles.length >
    3
  ) {
    showStatus(
      "You can analyze a maximum of 3 files.",
      "error"
    );
  }

  state.files = combined;
  renderFiles();

  if (state.files.length) {
    showStatus(
      `${state.files.length} file(s) ready.`,
      "success"
    );
  }
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
    const item =
      document.createElement("div");

    item.className = "file-item";
    item.style.animationDelay =
      `${index * 70}ms`;

    const icon =
      document.createElement("div");

    icon.className = "file-icon";
    icon.textContent = fileLabel(file);

    const info =
      document.createElement("div");

    info.className = "file-info";

    const name =
      document.createElement("strong");

    name.textContent = file.name;

    const meta =
      document.createElement("small");

    meta.textContent =
      `${formatBytes(file.size)} · ` +
      `${file.type || "Unknown type"}`;

    const remove =
      document.createElement("button");

    remove.className = "remove-file";
    remove.type = "button";
    remove.textContent = "Remove";

    remove.addEventListener("click", () => {
      state.files.splice(index, 1);
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

$("textInput").addEventListener(
  "input",
  () => {
    $("textCounter").textContent =
      `${$("textInput").value.length.toLocaleString()} / 50,000`;
  }
);

$("codeInput").addEventListener(
  "input",
  () => {
    $("codeCounter").textContent =
      `${$("codeInput").value.length.toLocaleString()} / 50,000`;
  }
);

$("analyzeButton").addEventListener(
  "click",
  analyze
);

async function analyze() {
  if (state.busy || !validateInput()) {
    return;
  }

  setBusy(true);
  startProgress();

  try {
    const formData = new FormData();

    formData.append("mode", state.mode);

    if (state.mode === "file") {
      state.files.forEach((file) => {
        formData.append("files", file);
      });
    } else {
      formData.append(
        "content",
        state.mode === "text"
          ? $("textInput").value
          : $("codeInput").value
      );
    }

    const response = await fetch(
      "/api/analyze",
      {
        method: "POST",
        body: formData
      }
    );

    const payload = await response
      .json()
      .catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        payload.error ||
          `Analysis failed (${response.status}).`
      );
    }

    completeProgress();
    state.report = payload;
    renderReport(payload);

    showStatus(
      "Analysis completed.",
      "success"
    );
  } catch (error) {
    stopProgress();

    showStatus(
      error.message || "Analysis failed.",
      "error"
    );
  } finally {
    setBusy(false);
  }
}

function validateInput() {
  if (
    state.mode === "file" &&
    !state.files.length
  ) {
    showStatus(
      "Choose at least one file.",
      "error"
    );
    return false;
  }

  const content =
    state.mode === "text"
      ? $("textInput").value.trim()
      : $("codeInput").value.trim();

  if (
    state.mode !== "file" &&
    !content
  ) {
    showStatus(
      `Paste some ${state.mode} first.`,
      "error"
    );
    return false;
  }

  return true;
}

function setBusy(busy) {
  state.busy = busy;

  $("analyzeButton").disabled = busy;
  $("spinner").classList.toggle(
    "hidden",
    !busy
  );

  $("analyzeButtonText").textContent =
    busy ? "Analyzing…" : "Analyze";
}

let progressTimer;

function startProgress() {
  clearInterval(progressTimer);

  $("progressCard").classList.remove(
    "hidden"
  );

  $("resultsSection").classList.add(
    "hidden"
  );

  let value = 5;
  updateProgress(value);

  progressTimer = setInterval(() => {
    const increment =
      value < 35
        ? 7
        : value < 70
          ? 4
          : 1;

    value = Math.min(
      92,
      value + increment
    );

    updateProgress(value);
  }, 340);
}

function updateProgress(value) {
  $("progressBar").style.width =
    `${value}%`;

  $("progressPercent").textContent =
    `${value}%`;

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

  setTimeout(() => {
    $("progressCard").classList.add(
      "hidden"
    );
  }, 500);
}

function stopProgress() {
  clearInterval(progressTimer);

  $("progressCard").classList.add(
    "hidden"
  );
}

function renderReport(report) {
  $("reportTitle").textContent =
    report.title || "Analysis Results";

  $("reportSummary").textContent =
    report.summary || "";

  const score = clampScore(
    report.overallScore
  );

  $("overallScore").textContent =
    String(score);

  $("scoreRing").style.setProperty(
    "--score",
    score
  );

  $("modelMeta").textContent =
    `${report.provider || "OpenRouter"} · ` +
    `${report.model || "Configured model"}`;

  const grid = $("resultGrid");
  grid.innerHTML = "";

  const metrics = Array.isArray(
    report.metrics
  )
    ? report.metrics
    : [];

  metrics.forEach((metric, index) => {
    const card =
      document.createElement("article");

    card.className = "result-card";
    card.style.animationDelay =
      `${index * 65}ms`;

    const label =
      document.createElement("span");

    label.textContent =
      metric.label || "METRIC";

    const value =
      document.createElement("h3");

    value.textContent =
      metric.value ?? "—";

    const description =
      document.createElement("p");

    description.textContent =
      metric.description || "";

    card.append(
      label,
      value,
      description
    );

    if (
      typeof metric.score === "number"
    ) {
      const track =
        document.createElement("div");

      track.className = "metric-score";

      const fill =
        document.createElement("div");

      fill.style.width =
        `${clampScore(metric.score)}%`;

      track.append(fill);
      card.append(track);
    }

    grid.append(card);
  });

  renderList(
    "findingsList",
    report.findings
  );

  renderList(
    "recommendationsList",
    report.recommendations
  );

  $("resultsSection").classList.remove(
    "hidden"
  );

  setTimeout(() => {
    $("resultsSection").scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }, 180);
}

function renderList(id, values) {
  const list = $(id);
  list.innerHTML = "";

  const safeValues =
    Array.isArray(values) && values.length
      ? values
      : ["No item returned."];

  safeValues.forEach((value) => {
    const item =
      document.createElement("li");

    item.textContent = value;
    list.append(item);
  });
}

$("downloadJson").addEventListener(
  "click",
  () => {
    if (!state.report) {
      return;
    }

    downloadBlob(
      JSON.stringify(
        state.report,
        null,
        2
      ),
      "analyze-report.json",
      "application/json"
    );
  }
);

$("downloadMarkdown").addEventListener(
  "click",
  () => {
    if (!state.report) {
      return;
    }

    downloadBlob(
      reportToMarkdown(state.report),
      "analyze-report.md",
      "text/markdown"
    );
  }
);

$("printReport").addEventListener(
  "click",
  () => {
    window.print();
  }
);

$("newAnalysis").addEventListener(
  "click",
  () => {
    state.report = null;

    $("resultsSection").classList.add(
      "hidden"
    );

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }
);

function reportToMarkdown(report) {
  const lines = [
    `# ${report.title || "Analyze Report"}`,
    "",
    `**Score:** ${clampScore(report.overallScore)}/100`,
    "",
    report.summary || "",
    "",
    "## Metrics",
    ""
  ];

  (report.metrics || []).forEach(
    (metric) => {
      lines.push(
        `### ${metric.label || "Metric"}`,
        "",
        `**${metric.value ?? "—"}**`,
        "",
        metric.description || "",
        ""
      );
    }
  );

  lines.push(
    "## Findings",
    ""
  );

  (report.findings || []).forEach(
    (item) => {
      lines.push(`- ${item}`);
    }
  );

  lines.push(
    "",
    "## Recommendations",
    ""
  );

  (report.recommendations || []).forEach(
    (item) => {
      lines.push(`- ${item}`);
    }
  );

  return lines.join("\n");
}

function downloadBlob(
  content,
  filename,
  type
) {
  const url = URL.createObjectURL(
    new Blob([content], { type })
  );

  const link =
    document.createElement("a");

  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}

async function checkHealth() {
  try {
    const response =
      await fetch("/health");

    const data =
      await response.json();

    $("systemStatus").classList.toggle(
      "offline",
      !data.aiConfigured
    );

    $("systemStatusText").textContent =
      data.aiConfigured
        ? "OpenRouter ready"
        : "API key missing";
  } catch {
    $("systemStatus").classList.add(
      "offline"
    );

    $("systemStatusText").textContent =
      "Offline";
  }
}

function showStatus(
  message,
  type = ""
) {
  $("statusMessage").textContent =
    message;

  $("statusMessage").className =
    `status-message${type ? ` ${type}` : ""}`;
}

function fileLabel(file) {
  if (
    String(file.type).startsWith(
      "image/"
    )
  ) {
    return "IMG";
  }

  if (
    file.type === "application/pdf"
  ) {
    return "PDF";
  }

  const extension =
    file.name.includes(".")
      ? file.name
          .split(".")
          .pop()
          .toUpperCase()
      : "FILE";

  return extension.slice(0, 4);
}

function formatBytes(bytes) {
  if (!bytes) {
    return "0 B";
  }

  const units = [
    "B",
    "KB",
    "MB",
    "GB"
  ];

  const index = Math.min(
    units.length - 1,
    Math.floor(
      Math.log(bytes) /
      Math.log(1024)
    )
  );

  return (
    (
      bytes /
      1024 ** index
    ).toFixed(index ? 1 : 0) +
    ` ${units[index]}`
  );
}

function clampScore(value) {
  const number = Number(value);

  return Number.isFinite(number)
    ? Math.max(
        0,
        Math.min(
          100,
          Math.round(number)
        )
      )
    : 0;
}

document.addEventListener(
  "mousemove",
  (event) => {
    const x =
      (
        event.clientX /
        window.innerWidth -
        0.5
      ) * 22;

    const y =
      (
        event.clientY /
        window.innerHeight -
        0.5
      ) * 22;

    document
      .querySelector(".ambient-left")
      .style.transform =
        `translate(${x}px, ${y}px)`;

    document
      .querySelector(".ambient-right")
      .style.transform =
        `translate(${-x}px, ${-y}px)`;
  }
);

document.addEventListener(
  "keydown",
  (event) => {
    if (
      (event.ctrlKey || event.metaKey) &&
      event.key === "Enter"
    ) {
      analyze();
    }
  }
);

checkHealth();
