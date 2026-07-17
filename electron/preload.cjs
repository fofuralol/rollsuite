const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  dbQuery: (op) => ipcRenderer.invoke("db:query", op),
  fnInvoke: (name, body) => ipcRenderer.invoke("fn:invoke", name, body),
  notify: (payload) => ipcRenderer.invoke("app:notify", payload),
  readClipboardImage: () => ipcRenderer.invoke("clipboard:read-image"),
  uploadTaskImage: (payload) => ipcRenderer.invoke("storage:task-image-upload", payload),
  readTaskImage: (path) => ipcRenderer.invoke("storage:task-image-read", path),
  removeTaskImage: (paths) => ipcRenderer.invoke("storage:task-image-remove", paths),
  checkUpdate: () => ipcRenderer.invoke("update:check"),
  applyUpdate: () => ipcRenderer.invoke("update:apply"),
  checkNativeUpdate: () => ipcRenderer.invoke("update:check-native"),
  applyNativeUpdate: () => ipcRenderer.invoke("update:apply-native"),
  getNativeVersion: () => ipcRenderer.invoke("app:native-version"),
  reloadApp: () => ipcRenderer.invoke("app:reload"),
  openDataDir: () => ipcRenderer.invoke("app:open-data-dir"),
  chatSaveMedia: (payload) => ipcRenderer.invoke("chat:save-media", payload),
  chatOpenMedia: (payload) => ipcRenderer.invoke("chat:open-media", payload),
  chatOpenMediaDir: () => ipcRenderer.invoke("chat:open-media-dir"),
  chatClearMedia: () => ipcRenderer.invoke("chat:clear-media"),
  chatMediaStats: () => ipcRenderer.invoke("chat:media-stats"),
  getVersion: () => ipcRenderer.invoke("app:version"),
  openUrl: (url) => ipcRenderer.invoke("app:open-url", url),
  onDbChange: (cb) => {
    const listener = (_e, p) => cb(p);
    ipcRenderer.on("db:change", listener);
    return () => ipcRenderer.removeListener("db:change", listener);
  },
  onUpdateProgress: (cb) => {
    const listener = (_e, p) => cb(p);
    ipcRenderer.on("update:progress", listener);
    return () => ipcRenderer.removeListener("update:progress", listener);
  },
  onNativeUpdateProgress: (cb) => {
    const listener = (_e, p) => cb(p);
    ipcRenderer.on("update:native-progress", listener);
    return () => ipcRenderer.removeListener("update:native-progress", listener);
  },
  // WhatsApp listener
  waStart: () => ipcRenderer.invoke("wa:start"),
  waStop: () => ipcRenderer.invoke("wa:stop"),
  waLogout: () => ipcRenderer.invoke("wa:logout"),
  waState: () => ipcRenderer.invoke("wa:state"),
  waConfigGet: () => ipcRenderer.invoke("wa:config-get"),
  waConfigSet: (patch) => ipcRenderer.invoke("wa:config-set", patch),
  waForwardTest: (text) => ipcRenderer.invoke("wa:forward-test", text),
  waReadLog: () => ipcRenderer.invoke("wa:read-log"),
  waClearLog: () => ipcRenderer.invoke("wa:clear-log"),
  waDiagnostics: () => ipcRenderer.invoke("wa:diagnostics"),
  waListGroups: () => ipcRenderer.invoke("wa:list-groups"),
  waSendNow: (payload) => ipcRenderer.invoke("wa:send-now", payload),
  waBackfill: (payload) => ipcRenderer.invoke("wa:backfill", payload),
  waReact: (payload) => ipcRenderer.invoke("wa:react", payload),
  waSetLiveChat: (enabled) => ipcRenderer.invoke("wa:set-live-chat", enabled),
  onWaState: (cb) => {
    const listener = (_e, s) => cb(s);
    ipcRenderer.on("wa:state", listener);
    return () => ipcRenderer.removeListener("wa:state", listener);
  },
  onWaMessage: (cb) => {
    const listener = (_e, m) => cb(m);
    ipcRenderer.on("wa:new-message", listener);
    return () => ipcRenderer.removeListener("wa:new-message", listener);
  },
  onWaRawMessage: (cb) => {
    const listener = (_e, m) => cb(m);
    ipcRenderer.on("wa:raw-message", listener);
    return () => ipcRenderer.removeListener("wa:raw-message", listener);
  },
  onWaRawReaction: (cb) => {
    const listener = (_e, r) => cb(r);
    ipcRenderer.on("wa:raw-reaction", listener);
    return () => ipcRenderer.removeListener("wa:raw-reaction", listener);
  },
  metaGetConfig: () => ipcRenderer.invoke("meta:get-config"),
  metaSetConfig: (patch) => ipcRenderer.invoke("meta:set-config", patch),
  metaTestNotify: () => ipcRenderer.invoke("meta:test-notify"),
  metaPollNow: () => ipcRenderer.invoke("meta:poll-now"),
  metaList: (opts) => ipcRenderer.invoke("meta:list", opts),
  metaLocalStatus: () => ipcRenderer.invoke("meta:local-status"),
  onMetaNewEvent: (cb) => {
    const listener = (_e, ev) => cb(ev);
    ipcRenderer.on("meta:new-event", listener);
    return () => ipcRenderer.removeListener("meta:new-event", listener);
  },
  onMetaPlaySound: (cb) => {
    const listener = () => cb();
    ipcRenderer.on("meta:play-sound", listener);
    return () => ipcRenderer.removeListener("meta:play-sound", listener);
  },
  // Extension token injector
  extPickAndRead: () => ipcRenderer.invoke("extension:pick-and-read"),
  extInjectToken: (payload) => ipcRenderer.invoke("extension:inject-token", payload),
  extGenerate: (payload) => ipcRenderer.invoke("extension:generate", payload),
  onExtInjectProgress: (cb) => {
    const listener = (_e, p) => cb(p);
    ipcRenderer.on("extension:inject-progress", listener);
    return () => ipcRenderer.removeListener("extension:inject-progress", listener);
  },
  // Cash Hunters automation
  chGetCursorPos: (title) => ipcRenderer.invoke("ch:get-cursor-pos", title),
  chConfigGet: () => ipcRenderer.invoke("ch:config-get"),
  chConfigSet: (cfg) => ipcRenderer.invoke("ch:config-set", cfg),
  chRun: (args) => ipcRenderer.invoke("ch:run", args),
  // Platform group auto-detection
  detectPlatformGroup: (payload) => ipcRenderer.invoke("platform:detect-group", payload),
  onPlatformDetectProgress: (cb) => {
    const listener = (_e, p) => cb(p);
    ipcRenderer.on("platform:detect-progress", listener);
    return () => ipcRenderer.removeListener("platform:detect-progress", listener);
  },
  // Google Drive backup
  gdriveConnect: () => ipcRenderer.invoke("gdrive:connect"),
  gdriveStatus: () => ipcRenderer.invoke("gdrive:status"),
  gdriveDisconnect: () => ipcRenderer.invoke("gdrive:disconnect"),
  gdriveUpload: (jsonString) => ipcRenderer.invoke("gdrive:upload", jsonString),
  gdriveDownload: (fileId) => ipcRenderer.invoke("gdrive:download", fileId || null),
  gdriveList: () => ipcRenderer.invoke("gdrive:list"),
  gdriveDelete: (fileId) => ipcRenderer.invoke("gdrive:delete", fileId),
  isDesktop: true,
});
