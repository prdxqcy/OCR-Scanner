const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, ipcMain, globalShortcut, screen } = require("electron");
const { spawn } = require("child_process");
const { autoUpdater } = require("electron-updater");

const CONFIG_DEFAULTS = {
  trackers: {
    crystals: { key: "crystals", label: "Crystals", region: null },
    speedPotions: { key: "speedPotions", label: "Speed Potions", region: null },
    arcanes: { key: "arcanes", label: "Arcanes", region: null }
  },
  pollIntervalMs: 10000,
  hideHotkey: "F8",
  opacityPercent: 100,
  scannerEnabled: true
};

let overlayWindow;
let selectorWindow;
let pythonProcess;
let overlayHidden = false;
let pythonStdoutBuffer = "";
let configPath;
let templatesDir;
let store = { ...CONFIG_DEFAULTS };
let pendingSelectionTrackerKey = null;
let updateCheckTimer = null;
let pendingDetectionRequests = new Map();

function getAppIconPath() {
  return path.join(__dirname, "..", "build", "icon.ico");
}

function normalizeTrackers(trackers) {
  const nextTrackers = JSON.parse(JSON.stringify(CONFIG_DEFAULTS.trackers));
  if (!trackers || typeof trackers !== "object") {
    return nextTrackers;
  }

  for (const [key, tracker] of Object.entries(nextTrackers)) {
    if (trackers[key]) {
      tracker.region = trackers[key].region ?? null;
      tracker.label = trackers[key].label ?? tracker.label;
    }
  }

  return nextTrackers;
}

function loadStore() {
  configPath = path.join(app.getPath("userData"), "config.json");
  templatesDir = path.join(app.getPath("userData"), "templates");
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);
    store = {
      ...CONFIG_DEFAULTS,
      ...parsed,
      trackers: normalizeTrackers(parsed.trackers)
    };
  } catch (_error) {
    store = { ...CONFIG_DEFAULTS };
  }

  if (store.scannerRegion) {
    store.trackers.crystals.region = store.scannerRegion;
    delete store.scannerRegion;
    persistStore();
  }
}

function persistStore() {
  if (!configPath) {
    return;
  }

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(store, null, 2), "utf8");
}

function getStoreValue(key) {
  return store[key];
}

function setStoreValue(key, value) {
  store[key] = value;
  persistStore();
}

function setTrackerRegion(trackerKey, region) {
  const trackers = normalizeTrackers(store.trackers);
  if (!trackers[trackerKey]) {
    return;
  }

  trackers[trackerKey].region = region;
  store.trackers = trackers;
  persistStore();
}

function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    width: 370,
    height: 690,
    x: 40,
    y: 40,
    frame: false,
    transparent: true,
    resizable: true,
    minWidth: 340,
    minHeight: 620,
    skipTaskbar: false,
    alwaysOnTop: true,
    focusable: true,
    hasShadow: true,
    icon: getAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.setMinimumSize(340, 620);
  overlayWindow.setOpacity(Math.max(0.35, Math.min(1, getStoreValue("opacityPercent") / 100)));
  overlayWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  overlayWindow.on("closed", () => {
    overlayWindow = null;
  });
}

function sendOverlayEvent(payload) {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send("scanner:event", payload);
  }
}

function createSelectorWindow(trackerKey) {
  if (selectorWindow) {
    selectorWindow.focus();
    return;
  }

  pendingSelectionTrackerKey = trackerKey;

  const tracker = normalizeTrackers(store.trackers)[trackerKey];

  const bounds = screen.getAllDisplays().reduce(
    (acc, display) => {
      const { x, y, width, height } = display.bounds;
      const right = x + width;
      const bottom = y + height;

      return {
        x: Math.min(acc.x, x),
        y: Math.min(acc.y, y),
        right: Math.max(acc.right, right),
        bottom: Math.max(acc.bottom, bottom)
      };
    },
    { x: 0, y: 0, right: 0, bottom: 0 }
  );

  selectorWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.right - bounds.x,
    height: bounds.bottom - bounds.y,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    icon: getAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  selectorWindow.setAlwaysOnTop(true, "screen-saver");
  selectorWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  selectorWindow.loadFile(path.join(__dirname, "renderer", "selector.html"), {
    query: {
      offsetX: String(bounds.x),
      offsetY: String(bounds.y),
      trackerKey,
      trackerLabel: tracker?.label ?? trackerKey
    }
  });
  selectorWindow.on("closed", () => {
    selectorWindow = null;
    pendingSelectionTrackerKey = null;
  });
}

function registerShortcuts() {
  globalShortcut.unregisterAll();
  const hotkey = getStoreValue("hideHotkey") || CONFIG_DEFAULTS.hideHotkey;
  const registered = globalShortcut.register(hotkey, () => {
    overlayHidden = !overlayHidden;
    if (overlayWindow) {
      if (overlayHidden) {
        overlayWindow.hide();
      } else {
        overlayWindow.showInactive();
        overlayWindow.setAlwaysOnTop(true, "screen-saver");
      }
    }
  });

  if (!registered) {
    setStoreValue("hideHotkey", CONFIG_DEFAULTS.hideHotkey);
    globalShortcut.register(CONFIG_DEFAULTS.hideHotkey, () => {
      overlayHidden = !overlayHidden;
      if (overlayWindow) {
        if (overlayHidden) {
          overlayWindow.hide();
        } else {
          overlayWindow.showInactive();
          overlayWindow.setAlwaysOnTop(true, "screen-saver");
        }
      }
    });
  }
}

function getPythonCommand() {
  const bundledPython = path.join(
    process.resourcesPath,
    "python-runtime",
    process.platform === "win32" ? "python.exe" : path.join("bin", "python3")
  );
  const bundledScanner = path.join(process.resourcesPath, "python-src", "scanner.py");
  if (app.isPackaged && fs.existsSync(bundledPython) && fs.existsSync(bundledScanner)) {
    return {
      command: bundledPython,
      args: [bundledScanner]
    };
  }

  if (process.platform === "win32") {
    return {
      command: "py",
      args: ["-3.11", path.join(__dirname, "..", "python", "scanner.py")]
    };
  }

  return {
    command: "python3",
    args: [path.join(__dirname, "..", "python", "scanner.py")]
  };
}

function getPythonWorkingDirectory() {
  if (app.isPackaged) {
    return process.resourcesPath;
  }

  return path.join(__dirname, "..");
}

function restartPythonWorker() {
  if (pythonProcess) {
    pythonProcess.kill();
    pythonProcess = null;
  }

  const python = getPythonCommand();
  pythonProcess = spawn(python.command, python.args, {
    cwd: getPythonWorkingDirectory(),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  });

  pythonProcess.on("error", (error) => {
    sendOverlayEvent({
      type: "error",
      message: `Scanner failed to start: ${error.message}`
    });
  });

  pythonProcess.stdout.on("data", (chunk) => {
    pythonStdoutBuffer += chunk.toString();
    const lines = pythonStdoutBuffer.split(/\r?\n/);
    pythonStdoutBuffer = lines.pop() ?? "";

    for (const line of lines) {
      try {
        const message = JSON.parse(line.trim());
        if (message.type === "detect-result" && message.requestId) {
          const pendingRequest = pendingDetectionRequests.get(message.requestId);
          if (pendingRequest) {
            pendingDetectionRequests.delete(message.requestId);
            pendingRequest(message);
          }
        }
        sendOverlayEvent(message);
      } catch (error) {
        sendOverlayEvent({
          type: "log",
          message: `Scanner output parse error: ${error.message}`
        });
      }
    }
  });

  pythonProcess.stderr.on("data", (chunk) => {
    const message = chunk.toString().trim();
    if (!message) {
      return;
    }

    sendOverlayEvent({
      type: "error",
      message
    });
  });

  pythonProcess.on("exit", (code) => {
    sendOverlayEvent({
      type: "status",
      state: "stopped",
      code
    });
  });

  sendConfigToPython();
}

function sendConfigToPython() {
  if (!pythonProcess || !pythonProcess.stdin.writable) {
    return;
  }

  const payload = {
    type: "config",
    trackers: normalizeTrackers(getStoreValue("trackers")),
    pollIntervalMs: getStoreValue("pollIntervalMs"),
    scannerEnabled: getStoreValue("scannerEnabled"),
    templatesDir
  };

  pythonProcess.stdin.write(`${JSON.stringify(payload)}\n`);
}

function sendPythonCommand(payload) {
  if (!pythonProcess || !pythonProcess.stdin.writable) {
    return false;
  }

  pythonProcess.stdin.write(`${JSON.stringify(payload)}\n`);
  return true;
}

function learnTemplateForTracker(trackerKey, region) {
  sendPythonCommand({
    type: "learn-template",
    trackerKey,
    region
  });
}

function applyDetectedRegions(detections, overwriteExisting = true) {
  const trackers = normalizeTrackers(getStoreValue("trackers"));
  const applied = [];

  for (const [trackerKey, detection] of Object.entries(detections || {})) {
    if (!trackers[trackerKey] || !detection?.region) {
      continue;
    }

    if (!overwriteExisting && trackers[trackerKey].region) {
      continue;
    }

    trackers[trackerKey].region = detection.region;
    applied.push({
      trackerKey,
      trackerLabel: trackers[trackerKey].label ?? trackerKey,
      region: detection.region,
      score: detection.score ?? null
    });
  }

  if (applied.length === 0) {
    return [];
  }

  store.trackers = trackers;
  persistStore();

  for (const entry of applied) {
    sendOverlayEvent({
      type: "region-selected",
      trackerKey: entry.trackerKey,
      trackerLabel: entry.trackerLabel,
      region: entry.region,
      score: entry.score,
      autoDetected: true
    });
  }

  sendConfigToPython();
  return applied;
}

function detectRegionsWithTemplates() {
  return new Promise((resolve) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    pendingDetectionRequests.set(requestId, resolve);

    const sent = sendPythonCommand({
      type: "detect-regions",
      requestId
    });

    if (!sent) {
      pendingDetectionRequests.delete(requestId);
      resolve({
        requestId,
        error: "Scanner is not ready yet.",
        detections: {}
      });
      return;
    }

    setTimeout(() => {
      const pendingRequest = pendingDetectionRequests.get(requestId);
      if (pendingRequest) {
        pendingDetectionRequests.delete(requestId);
        pendingRequest({
          requestId,
          error: "Template detection timed out.",
          detections: {}
        });
      }
    }, 15000);
  });
}

ipcMain.handle("app:get-state", async () => {
  return {
    trackers: normalizeTrackers(getStoreValue("trackers")),
    pollIntervalMs: getStoreValue("pollIntervalMs"),
    hideHotkey: getStoreValue("hideHotkey"),
    opacityPercent: getStoreValue("opacityPercent"),
    scannerEnabled: getStoreValue("scannerEnabled")
  };
});

ipcMain.handle("app:start-region-select", async (_event, trackerKey) => {
  const trackers = normalizeTrackers(getStoreValue("trackers"));
  if (!trackers[trackerKey]) {
    return { ok: false, message: `Unknown tracker: ${trackerKey}` };
  }

  createSelectorWindow(trackerKey);
  return { ok: true, trackerKey };
});

ipcMain.handle("app:set-poll-interval", async (_event, pollIntervalMs) => {
  const parsed = Math.max(150, Number(pollIntervalMs) || CONFIG_DEFAULTS.pollIntervalMs);
  setStoreValue("pollIntervalMs", parsed);
  sendConfigToPython();
  return { ok: true, pollIntervalMs: parsed };
});

ipcMain.handle("app:set-scanner-enabled", async (_event, scannerEnabled) => {
  const enabled = Boolean(scannerEnabled);
  setStoreValue("scannerEnabled", enabled);
  sendConfigToPython();
  return { ok: true, scannerEnabled: enabled };
});

ipcMain.handle("app:auto-detect-regions", async (_event, options) => {
  const overwriteExisting = Boolean(options?.overwriteExisting);
  const result = await detectRegionsWithTemplates();

  if (result.error) {
    sendOverlayEvent({
      type: "auto-detect-summary",
      ok: false,
      message: result.error
    });
    return { ok: false, message: result.error, applied: [] };
  }

  const applied = applyDetectedRegions(result.detections, overwriteExisting);
  sendOverlayEvent({
    type: "auto-detect-summary",
    ok: true,
    applied,
    detectedCount: Object.keys(result.detections || {}).length
  });

  return {
    ok: true,
    applied,
    detectedCount: Object.keys(result.detections || {}).length
  };
});

ipcMain.handle("app:update-settings", async (_event, settings) => {
  const nextHotkey = String(settings?.hideHotkey || getStoreValue("hideHotkey") || CONFIG_DEFAULTS.hideHotkey);
  const nextOpacity = Math.max(35, Math.min(100, Number(settings?.opacityPercent) || 100));

  setStoreValue("hideHotkey", nextHotkey);
  setStoreValue("opacityPercent", nextOpacity);

  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setOpacity(nextOpacity / 100);
  }

  registerShortcuts();

  return {
    ok: true,
    hideHotkey: getStoreValue("hideHotkey"),
    opacityPercent: getStoreValue("opacityPercent")
  };
});

ipcMain.handle("window:minimize", async () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.minimize();
  }
  return { ok: true };
});

ipcMain.handle("window:close", async () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close();
  }
  return { ok: true };
});

function setupAutoUpdater() {
  if (!app.isPackaged) {
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    sendOverlayEvent({ type: "update-status", state: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    sendOverlayEvent({
      type: "update-status",
      state: "available",
      version: info.version
    });
  });

  autoUpdater.on("update-not-available", () => {
    sendOverlayEvent({ type: "update-status", state: "not-available" });
  });

  autoUpdater.on("download-progress", (progress) => {
    sendOverlayEvent({
      type: "update-status",
      state: "downloading",
      percent: progress.percent
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    sendOverlayEvent({
      type: "update-status",
      state: "downloaded",
      version: info.version
    });
  });

  autoUpdater.on("error", (error) => {
    sendOverlayEvent({
      type: "update-status",
      state: "error",
      message: error == null ? "Unknown updater error" : error.message
    });
  });

  autoUpdater.checkForUpdates().catch((error) => {
    sendOverlayEvent({
      type: "update-status",
      state: "error",
      message: error.message
    });
  });

  updateCheckTimer = setInterval(() => {
    autoUpdater.checkForUpdates().catch((error) => {
      sendOverlayEvent({
        type: "update-status",
        state: "error",
        message: error.message
      });
    });
  }, 6 * 60 * 60 * 1000);
}

ipcMain.on("selector:confirm", (_event, region) => {
  if (!pendingSelectionTrackerKey) {
    return;
  }

  const trackerKey = pendingSelectionTrackerKey;
  const trackers = normalizeTrackers(getStoreValue("trackers"));
  const tracker = trackers[trackerKey];

  setTrackerRegion(trackerKey, region);
  learnTemplateForTracker(trackerKey, region);
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send("scanner:event", {
      type: "region-selected",
      trackerKey,
      trackerLabel: tracker?.label ?? trackerKey,
      region
    });
  }
  sendConfigToPython();
  if (selectorWindow) {
    selectorWindow.close();
  }
});

ipcMain.on("selector:cancel", () => {
  if (selectorWindow) {
    selectorWindow.close();
  }
});

app.whenReady().then(() => {
  loadStore();
  createOverlayWindow();
  restartPythonWorker();
  registerShortcuts();
  setupAutoUpdater();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createOverlayWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
    updateCheckTimer = null;
  }
  if (pythonProcess) {
    pythonProcess.kill();
    pythonProcess = null;
  }
});
