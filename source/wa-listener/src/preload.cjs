const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getCfg: () => ipcRenderer.invoke("cfg:get"),
  setCfg: (p) => ipcRenderer.invoke("cfg:set", p),
  waState: () => ipcRenderer.invoke("wa:state"),
  waStart: () => ipcRenderer.invoke("wa:start"),
  waStop: () => ipcRenderer.invoke("wa:stop"),
  waLogout: () => ipcRenderer.invoke("wa:logout"),
  logs: () => ipcRenderer.invoke("log:get"),
  clearLogs: () => ipcRenderer.invoke("log:clear"),
  testWebhook: () => ipcRenderer.invoke("wa:test-webhook"),
  checkUpdate: () => ipcRenderer.invoke("update:check"),
  reloadApp: () => ipcRenderer.invoke("app:reload"),
  restartApp: () => ipcRenderer.invoke("app:restart"),
  onState: (cb) => ipcRenderer.on("wa-state", (_e, s) => cb(s)),
  onLog: (cb) => ipcRenderer.on("log", (_e, l) => cb(l)),
});
