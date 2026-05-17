const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("scannerApi", {
  getState: () => ipcRenderer.invoke("app:get-state"),
  startRegionSelect: (trackerKey) => ipcRenderer.invoke("app:start-region-select", trackerKey),
  setPollInterval: (value) => ipcRenderer.invoke("app:set-poll-interval", value),
  setScannerEnabled: (value) => ipcRenderer.invoke("app:set-scanner-enabled", value),
  updateSettings: (settings) => ipcRenderer.invoke("app:update-settings", settings),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  onScannerEvent: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("scanner:event", handler);
    return () => ipcRenderer.removeListener("scanner:event", handler);
  },
  confirmSelection: (region) => ipcRenderer.send("selector:confirm", region),
  cancelSelection: () => ipcRenderer.send("selector:cancel")
});
