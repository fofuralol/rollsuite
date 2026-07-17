const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // config
  getCfg: () => ipcRenderer.invoke("cfg:get"),
  setCfg: (p) => ipcRenderer.invoke("cfg:set", p),
  // wa control
  waState: () => ipcRenderer.invoke("wa:state"),
  waStart: () => ipcRenderer.invoke("wa:start"),
  waStop: () => ipcRenderer.invoke("wa:stop"),
  waLogout: () => ipcRenderer.invoke("wa:logout"),
  // chats / send
  listChats: () => ipcRenderer.invoke("wa:list-chats"),
  sendMessage: (p) => ipcRenderer.invoke("wa:send", p),
  // messages (history)
  listMessages: () => ipcRenderer.invoke("msg:list"),
  removeMessage: (id) => ipcRenderer.invoke("msg:remove", id),
  clearMessages: () => ipcRenderer.invoke("msg:clear"),
  testMessage: (p) => ipcRenderer.invoke("msg:test", p),

  // templates
  listTemplates: () => ipcRenderer.invoke("tpl:list"),
  saveTemplate: (t) => ipcRenderer.invoke("tpl:save", t),
  removeTemplate: (id) => ipcRenderer.invoke("tpl:remove", id),
  // logs
  logs: () => ipcRenderer.invoke("log:get"),
  clearLogs: () => ipcRenderer.invoke("log:clear"),
  // updates
  checkUpdate: () => ipcRenderer.invoke("update:check"),
  checkNativeUpdate: () => ipcRenderer.invoke("update:check-native"),
  applyNativeUpdate: () => ipcRenderer.invoke("update:apply-native"),
  applyAllUpdates: () => ipcRenderer.invoke("update:apply-all"),
  nativeVersion: () => ipcRenderer.invoke("app:native-version"),
  reloadApp: () => ipcRenderer.invoke("app:reload"),
  restartApp: () => ipcRenderer.invoke("app:restart"),
  // events
  onState: (cb) => ipcRenderer.on("wa-state", (_e, s) => cb(s)),
  onLog: (cb) => ipcRenderer.on("log", (_e, l) => cb(l)),
  onMessage: (cb) => ipcRenderer.on("msg-new", (_e, m) => cb(m)),
  onNativeProgress: (cb) => ipcRenderer.on("update:native-progress", (_e, p) => cb(p)),
  onConfirmClose: (cb) => ipcRenderer.on("confirm-close", () => cb()),
  closeAction: (action) => ipcRenderer.invoke("app:close-action", action),
});
