const SESSION_HISTORY_KEY = "scanner-history-session";
const HISTORY_INTERVAL_MS = 120000;
const MAX_LOG_LINES = 12;
const MAX_HISTORY_ROWS = 30;
const TRACKER_ORDER = [
  { key: "crystals", label: "Crystals", shortLabel: "Crystals" },
  { key: "speedPotions", label: "Speed Potions", shortLabel: "Potions" },
  { key: "arcanes", label: "Arcanes", shortLabel: "Arcanes" }
];

const logOutput = document.getElementById("logOutput");
const historyOutput = document.getElementById("historyOutput");
const pollIntervalInput = document.getElementById("pollIntervalInput");
const trackerCards = document.getElementById("trackerCards");
const trackerButtons = document.getElementById("trackerButtons");
const regionList = document.getElementById("regionList");
const scannerState = document.getElementById("scannerState");
const panelScannerState = document.getElementById("panelScannerState");
const clockValue = document.getElementById("clockValue");
const sessionCount = document.getElementById("sessionCount");
const hotkeyBadge = document.getElementById("hotkeyBadge");
const scanPillTitle = document.getElementById("scanPillTitle");
const toggleScannerButton = document.getElementById("toggleScannerButton");
const toggleScannerSecondaryButton = document.getElementById("toggleScannerSecondaryButton");
const autoDetectButton = document.getElementById("autoDetectButton");
const resetSessionButton = document.getElementById("resetSessionButton");
const gearButton = document.getElementById("gearButton");
const openSettingsButton = document.getElementById("openSettingsButton");
const minimizeWindowButton = document.getElementById("minimizeWindowButton");
const closeWindowButton = document.getElementById("closeWindowButton");
const settingsModal = document.getElementById("settingsModal");
const closeSettingsButton = document.getElementById("closeSettingsButton");
const saveSettingsButton = document.getElementById("saveSettingsButton");
const hotkeySelect = document.getElementById("hotkeySelect");
const opacitySlider = document.getElementById("opacitySlider");
const opacityValue = document.getElementById("opacityValue");

const trackerState = Object.fromEntries(
  TRACKER_ORDER.map((tracker) => [
    tracker.key,
    {
      ...tracker,
      region: null,
      currentValue: null,
      delta: 0,
      sessionGain: 0,
      gainSinceSnapshot: 0
    }
  ])
);

let scannerEnabled = true;
let currentHotkey = "F8";
let historyRows = [];
let historyIntervalId;
let autoDetectAttempted = false;

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }

  const numeric = Number(value);
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(2).replace(/\.?0+$/, "");
}

function deltaClass(delta) {
  if (delta > 0) {
    return "delta-up";
  }
  if (delta < 0) {
    return "delta-down";
  }
  return "delta-flat";
}

function titleCase(value) {
  return String(value).replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function appendLog(text) {
  const timestamp = new Date().toLocaleTimeString();
  const nextLines = [`[${timestamp}] ${text}`, ...logOutput.textContent.split("\n").filter(Boolean)].slice(0, MAX_LOG_LINES);
  logOutput.textContent = nextLines.join("\n");
}

function formatRegion(region) {
  if (!region) {
    return "No area selected";
  }

  return `x:${region.x} y:${region.y} w:${region.width} h:${region.height}`;
}

function loadHistory() {
  try {
    historyRows = JSON.parse(sessionStorage.getItem(SESSION_HISTORY_KEY) || "[]");
  } catch (_error) {
    historyRows = [];
  }
}

function persistHistory() {
  sessionStorage.setItem(SESSION_HISTORY_KEY, JSON.stringify(historyRows));
}

function renderHistory() {
  if (historyRows.length === 0) {
    historyOutput.innerHTML = `<div class="history-empty">No positive 2 minute gains yet.</div>`;
    return;
  }

  historyOutput.innerHTML = historyRows
    .map(
      (row) => `
        <div class="history-row">
          <strong>${row.timestamp}</strong>
          <span>C ${formatNumber(row.values.crystals)}</span>
          <span>P ${formatNumber(row.values.speedPotions)}</span>
          <span>A ${formatNumber(row.values.arcanes)}</span>
        </div>
      `
    )
    .join("");
}

function snapshotHistory() {
  if (!scannerEnabled) {
    return;
  }

  const positiveDeltas = {
    crystals: Math.max(0, Number(trackerState.crystals.gainSinceSnapshot) || 0),
    speedPotions: Math.max(0, Number(trackerState.speedPotions.gainSinceSnapshot) || 0),
    arcanes: Math.max(0, Number(trackerState.arcanes.gainSinceSnapshot) || 0)
  };

  const hasPositiveGain = Object.values(positiveDeltas).some((value) => value > 0);
  if (!hasPositiveGain) {
    return;
  }

  historyRows = [
    {
      timestamp: new Date().toLocaleTimeString(),
      values: positiveDeltas
    },
    ...historyRows
  ].slice(0, MAX_HISTORY_ROWS);

  persistHistory();
  renderHistory();
  appendLog("Saved 2 minute history snapshot.");

  for (const tracker of TRACKER_ORDER) {
    trackerState[tracker.key].gainSinceSnapshot = 0;
  }
}

function setScannerState(text) {
  const label = titleCase(text);
  scannerState.textContent = label;
  panelScannerState.textContent = label;
}

function updateClock() {
  clockValue.textContent = new Date().toLocaleTimeString();
}

function updateScannerButtons() {
  const actionLabel = scannerEnabled ? "Stop Scanner" : "Start Scanner";
  scanPillTitle.textContent = scannerEnabled ? "Scanning" : "Paused";
  toggleScannerSecondaryButton.childNodes[0].textContent = actionLabel + " ";
  toggleScannerButton.classList.toggle("scan-pill-paused", !scannerEnabled);
}

function updateHotkeyDisplay() {
  hotkeyBadge.textContent = currentHotkey;
}

function resetSessionState() {
  for (const tracker of TRACKER_ORDER) {
    trackerState[tracker.key].currentValue = null;
    trackerState[tracker.key].delta = 0;
    trackerState[tracker.key].sessionGain = 0;
    trackerState[tracker.key].gainSinceSnapshot = 0;
  }

  historyRows = [];
  persistHistory();
  renderHistory();
  renderTrackers();
  appendLog("Session reset.");
}

function renderTrackers() {
  trackerCards.innerHTML = TRACKER_ORDER.map((tracker) => {
    const state = trackerState[tracker.key];
    return `
      <article class="status-box">
        <div class="label-row">
          <strong class="tracker-name">${tracker.shortLabel}</strong>
        </div>
        <div class="tracker-stats">
          <strong class="tracker-current">${formatNumber(state.currentValue)}</strong>
          <strong class="tracker-delta ${deltaClass(state.sessionGain)}">${state.sessionGain > 0 ? "+" : ""}${formatNumber(state.sessionGain)}</strong>
        </div>
      </article>
    `;
  }).join("");

  trackerButtons.innerHTML = TRACKER_ORDER.map((tracker) => `
    <button class="tracker-select-button" data-tracker-key="${tracker.key}">
      <span class="button-copy">
        <span class="button-title">Set ${tracker.shortLabel} area</span>
        <span class="button-subtitle">Refine OCR target</span>
      </span>
      <span>+</span>
    </button>
  `).join("");

  regionList.innerHTML = TRACKER_ORDER.map((tracker) => {
    const state = trackerState[tracker.key];
    return `
      <div class="region-row">
        <strong>${tracker.shortLabel}</strong>
        <code>${formatRegion(state.region)}</code>
      </div>
    `;
  }).join("");

  for (const button of trackerButtons.querySelectorAll("[data-tracker-key]")) {
    button.addEventListener("click", async () => {
      const { trackerKey } = button.dataset;
      const tracker = trackerState[trackerKey];
      appendLog(`Opening selector for ${tracker.label}...`);
      await window.scannerApi.startRegionSelect(trackerKey);
    });
  }

  const activeCount = TRACKER_ORDER.filter((tracker) => trackerState[tracker.key].currentValue !== null).length;
  sessionCount.textContent = `${activeCount} items this session`;
}

async function setScannerEnabled(nextValue) {
  const result = await window.scannerApi.setScannerEnabled(nextValue);
  scannerEnabled = result.scannerEnabled;
  updateScannerButtons();
  setScannerState(scannerEnabled ? "scanning" : "paused");
  appendLog(scannerEnabled ? "Scanner started manually." : "Scanner stopped manually.");
}

async function runAutoDetect(options = {}) {
  const result = await window.scannerApi.autoDetectRegions(options);
  if (!result.ok) {
    appendLog(`Auto detect failed: ${result.message}`);
    return result;
  }

  if ((result.applied || []).length === 0) {
    appendLog("Auto detect found no matching saved item templates.");
    return result;
  }

  appendLog(`Auto detect updated ${result.applied.length} area${result.applied.length === 1 ? "" : "s"}.`);
  return result;
}

function openSettings() {
  settingsModal.classList.remove("hidden");
}

function closeSettings() {
  settingsModal.classList.add("hidden");
}

function updateOpacityLabel() {
  opacityValue.textContent = `${opacitySlider.value}%`;
}

pollIntervalInput.addEventListener("change", async () => {
  const result = await window.scannerApi.setPollInterval(pollIntervalInput.value);
  pollIntervalInput.value = result.pollIntervalMs;
  appendLog(`Scan interval set to ${result.pollIntervalMs} ms.`);
});

toggleScannerButton.addEventListener("click", async () => {
  await setScannerEnabled(!scannerEnabled);
});

toggleScannerSecondaryButton.addEventListener("click", async () => {
  await setScannerEnabled(!scannerEnabled);
});

resetSessionButton.addEventListener("click", () => {
  resetSessionState();
});

autoDetectButton.addEventListener("click", async () => {
  appendLog("Running template auto detect...");
  await runAutoDetect({ overwriteExisting: true });
});

gearButton.addEventListener("click", openSettings);
openSettingsButton.addEventListener("click", openSettings);
closeSettingsButton.addEventListener("click", closeSettings);

saveSettingsButton.addEventListener("click", async () => {
  const result = await window.scannerApi.updateSettings({
    hideHotkey: hotkeySelect.value,
    opacityPercent: Number(opacitySlider.value)
  });

  currentHotkey = result.hideHotkey;
  hotkeySelect.value = result.hideHotkey;
  opacitySlider.value = result.opacityPercent;
  updateOpacityLabel();
  updateHotkeyDisplay();
  appendLog(`Settings updated: hotkey ${result.hideHotkey}, opacity ${result.opacityPercent}%.`);
  closeSettings();
});

opacitySlider.addEventListener("input", updateOpacityLabel);
settingsModal.addEventListener("click", (event) => {
  if (event.target === settingsModal) {
    closeSettings();
  }
});

minimizeWindowButton.addEventListener("click", async () => {
  await window.scannerApi.minimizeWindow();
});

closeWindowButton.addEventListener("click", async () => {
  await window.scannerApi.closeWindow();
});

window.scannerApi.onScannerEvent((event) => {
  if (event.type === "reading") {
    const state = trackerState[event.trackerKey];
    if (!state) {
      return;
    }

    state.currentValue = event.currentValue;
    state.delta = event.delta ?? 0;
    if (state.delta > 0) {
      state.sessionGain += state.delta;
      state.gainSinceSnapshot += state.delta;
    }
    renderTrackers();
    setScannerState(`scanning ${state.label}`);
    if (event.rawText) {
      appendLog(`${state.label}: "${event.rawText}" -> ${event.currentValue}`);
    }
    return;
  }

  if (event.type === "region-selected") {
    const state = trackerState[event.trackerKey];
    if (!state) {
      return;
    }

    state.region = event.region;
    renderTrackers();
    setScannerState(`${state.label} ready`);
    if (event.autoDetected) {
      const confidence = event.score ? ` (${Math.round(event.score * 100)}% match)` : "";
      appendLog(`${state.label} auto-detected${confidence}.`);
    } else {
      appendLog(`${state.label} area updated.`);
    }
    return;
  }

  if (event.type === "template-learned") {
    const state = trackerState[event.trackerKey];
    if (state) {
      appendLog(`${state.label} template saved for future auto detect.`);
    }
    return;
  }

  if (event.type === "auto-detect-summary") {
    if (!event.ok && event.message) {
      appendLog(`Auto detect error: ${event.message}`);
    }
    return;
  }

  if (event.type === "status") {
    setScannerState(event.state);
    if (event.state === "paused") {
      scannerEnabled = false;
      updateScannerButtons();
    }
    appendLog(`Scanner status: ${event.state}`);
    return;
  }

  if (event.type === "update-status") {
    if (event.state === "available") {
      appendLog(`Update available: v${event.version}. Downloading...`);
    } else if (event.state === "downloading") {
      appendLog(`Update downloading: ${Math.round(event.percent || 0)}%.`);
    } else if (event.state === "downloaded") {
      appendLog(`Update ready: v${event.version}. It will install after app close.`);
    } else if (event.state === "error") {
      appendLog(`Updater error: ${event.message}`);
    }
    return;
  }

  if (event.type === "error") {
    appendLog(`Error: ${event.message}`);
    return;
  }

  if (event.type === "log") {
    appendLog(event.message);
  }
});

async function init() {
  const state = await window.scannerApi.getState();
  for (const tracker of TRACKER_ORDER) {
    const savedTracker = state.trackers?.[tracker.key];
    if (savedTracker) {
      trackerState[tracker.key].region = savedTracker.region ?? null;
      trackerState[tracker.key].label = savedTracker.label ?? tracker.label;
    }
  }

  scannerEnabled = state.scannerEnabled ?? true;
  currentHotkey = state.hideHotkey ?? "F8";
  pollIntervalInput.value = state.pollIntervalMs;
  hotkeySelect.value = currentHotkey;
  opacitySlider.value = state.opacityPercent ?? 100;
  updateOpacityLabel();
  updateHotkeyDisplay();

  loadHistory();
  renderHistory();
  renderTrackers();
  updateScannerButtons();
  updateClock();
  setInterval(updateClock, 1000);
  historyIntervalId = setInterval(snapshotHistory, HISTORY_INTERVAL_MS);
  setScannerState(scannerEnabled ? "waiting for areas" : "paused");
  appendLog("Overlay ready.");

  if (!autoDetectAttempted) {
    autoDetectAttempted = true;
    const hasAnyRegion = TRACKER_ORDER.some((tracker) => trackerState[tracker.key].region);
    if (!hasAnyRegion) {
      appendLog("Trying template auto detect...");
      await runAutoDetect({ overwriteExisting: false });
    }
  }
}

window.addEventListener("beforeunload", () => {
  clearInterval(historyIntervalId);
});

init();
