const { app, BrowserWindow, ipcMain, Tray, Menu, Notification, nativeImage, shell, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const QRCode = require("qrcode");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const { ensureChrome } = require("./ensure-chrome.cjs");

let win, tray, waClient;
let cfgCache = null;
let messagesCache = null; // [{id, ts, autor, telefone, grupo, mensagem, matched, chat_id}]
let templatesCache = null; // [{id, nome, chave, banco, tipo, texto}]
let waState = { status: "disconnected", qr: null, info: null };
let logs = [];

const UPDATE_BASE = "https://ttnpouzoswhhqvedvngx.supabase.co/storage/v1/object/public/zapo2-updates";
const UPDATE_URL = `${UPDATE_BASE}/version.json`;
const NATIVE_BASE = `${UPDATE_BASE}/native`;
const NATIVE_EXE_NAME = "Zapo2.exe";
const NATIVE_ZIP_NAME = "Zapo2-win32-x64.zip";
const RESTART_FILES = new Set(["main-app.cjs", "preload.cjs"]);
const appUpdateDir = () => path.join(dataDir(), "app-update");
const versionFile = () => path.join(appUpdateDir(), ".version");

function dataDir() {
  const exeDir = path.dirname(app.getPath("exe"));
  const dir = path.join(exeDir, "wa-listener2-data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
const cfgPath = () => path.join(dataDir(), "config.json");
const msgPath = () => path.join(dataDir(), "messages.json");
const tplPath = () => path.join(dataDir(), "templates.json");

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}
function writeJson(p, data) {
  try { fs.writeFileSync(p, JSON.stringify(data, null, 2)); } catch (e) { pushLog("error", "write " + p + ": " + e.message); }
}

function loadAll() {
  cfgCache = readJson(cfgPath(), {});
  messagesCache = readJson(msgPath(), []);
  templatesCache = readJson(tplPath(), []);
}
function getCfg() {
  if (!cfgCache) loadAll();
  return { groups: "", keywords: "", notify: "1", sound: "1", inAppNotify: "1", ...cfgCache };
}

// Traz a janela pra frente — usado quando notificações do Windows estão desligadas
function bringWindowToFront() {
  if (!win || win.isDestroyed()) return;
  try {
    if (!win.isVisible()) win.show();
    if (win.isMinimized()) win.restore();
    win.setAlwaysOnTop(true, "screen-saver");
    win.focus();
    try { win.moveTop(); } catch {}
    try { win.flashFrame(true); } catch {}
    setTimeout(() => {
      try { win.setAlwaysOnTop(false); } catch {}
      try { win.flashFrame(false); } catch {}
    }, 1500);
  } catch (e) { pushLog("warn", "bringToFront: " + e.message); }
}
function setCfg(patch) {
  cfgCache = { ...getCfg(), ...patch };
  writeJson(cfgPath(), cfgCache);
}

function pushLog(level, msg) {
  const entry = { ts: Date.now(), level, msg: String(msg).slice(0, 1000) };
  logs.push(entry);
  if (logs.length > 500) logs.shift();
  if (win && !win.isDestroyed()) win.webContents.send("log", entry);
}
function broadcastState() {
  if (win && !win.isDestroyed()) win.webContents.send("wa-state", waState);
}

function pickFile(name, bundled) {
  const updated = path.join(appUpdateDir(), name);
  try { if (fs.existsSync(updated)) return updated; } catch {}
  return bundled;
}
function iconPath() {
  // Windows: usa .ico (taskbar/título). Outros: png.
  if (process.platform === "win32") {
    const candidates = [
      path.join(path.dirname(app.getPath("exe")), "resources", "build", "icon.ico"),
      path.join(__dirname, "..", "build", "icon.ico"),
      path.join(process.resourcesPath || "", "build", "icon.ico"),
    ];
    for (const p of candidates) { try { if (p && fs.existsSync(p)) return p; } catch {} }
  }
  return pickFile("icon.png", path.join(__dirname, "ui", "icon.png"));
}
function uiHtmlPath()  { return pickFile("index.html", path.join(__dirname, "ui", "index.html")); }
function preloadPath() { return pickFile("preload.cjs", path.join(__dirname, "preload.cjs")); }

function createWindow() {
  win = new BrowserWindow({
    width: 880, height: 540,
    minWidth: 880, minHeight: 540,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: "#11131a", autoHideMenuBar: true,
    title: "Zapo2",
    icon: iconPath(),
    webPreferences: { preload: preloadPath(), contextIsolation: true, nodeIntegration: false },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(uiHtmlPath());
  win.on("close", (e) => {
    if (app.isQuitting) return;
    e.preventDefault();
    if (win && !win.isDestroyed()) win.webContents.send("confirm-close");
  });
}

ipcMain.handle("app:close-action", (_e, action) => {
  if (action === "quit") { app.isQuitting = true; app.quit(); }
  else if (action === "minimize") { if (win) win.hide(); }
  return true;
});
function createTray() {
  let icon;
  try { icon = nativeImage.createFromPath(iconPath()).resize({ width: 16, height: 16 }); }
  catch { icon = nativeImage.createEmpty(); }
  tray = new Tray(icon);
  tray.setToolTip("Zapo2");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Abrir Zapo2", click: () => win.show() },
    { type: "separator" },
    { label: "Sair", click: () => { app.isQuitting = true; app.quit(); } },
  ]));
  tray.on("click", () => win.show());
}

// ---- WhatsApp ----
function clearChromeLocks() {
  try {
    const sessRoot = path.join(dataDir(), "wa-session");
    if (!fs.existsSync(sessRoot)) return;
    const lockNames = ["SingletonLock", "SingletonCookie", "SingletonSocket", "DevToolsActivePort"];
    const walk = (dir) => {
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (lockNames.includes(e.name)) { try { fs.rmSync(full, { force: true }); } catch {} }
      }
    };
    walk(sessRoot);
  } catch {}
}

async function startWa() {
  if (waClient) return pushLog("warn", "Já existe cliente.");
  waState = { status: "starting", qr: null, info: null };
  broadcastState();
  pushLog("info", "Inicializando WhatsApp Web…");
  clearChromeLocks();

  let chromeInfo;
  try {
    chromeInfo = await ensureChrome(
      path.join(dataDir(), "chrome"),
      (msg) => { pushLog("info", msg); broadcastState(); }
    );
  } catch (e) {
    pushLog("error", "Falha ao preparar Chrome: " + e.message);
    waState = { status: "disconnected", qr: null, info: null };
    broadcastState();
    return;
  }

  waClient = new Client({
    authStrategy: new LocalAuth({ dataPath: path.join(dataDir(), "wa-session") }),
    puppeteer: {
      headless: true,
      executablePath: chromeInfo.executablePath,
      browserVersion: chromeInfo.buildId,
      cacheDirectory: chromeInfo.cacheDir,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
  });

  waClient.on("qr", async (qr) => {
    try {
      const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
      waState = { status: "qr", qr: dataUrl, info: null };
      pushLog("info", "QR gerado.");
      broadcastState();
    } catch (e) { pushLog("error", "QR err: " + e.message); }
  });
  waClient.on("authenticated", () => pushLog("info", "Autenticado."));
  waClient.on("ready", () => {
    waState = { status: "connected", qr: null, info: { wid: waClient.info?.wid?.user } };
    pushLog("info", "Conectado: " + (waClient.info?.pushname || ""));
    broadcastState();
  });
  waClient.on("auth_failure", (m) => pushLog("error", "auth_failure: " + m));
  waClient.on("disconnected", (r) => {
    pushLog("warn", "Desconectado: " + r);
    waState = { status: "disconnected", qr: null, info: null };
    broadcastState();
    waClient = null;
  });
  waClient.on("message", async (msg) => {
    try { await handleMessage(msg); } catch (e) { pushLog("error", "msg err: " + e.message); }
  });

  waClient.initialize().catch((e) => {
    pushLog("error", "initialize: " + e.message);
    waState = { status: "error", qr: null, info: null };
    broadcastState();
    waClient = null;
  });
}
async function stopWa() {
  if (!waClient) return;
  try { await waClient.destroy(); } catch {}
  waClient = null;
  waState = { status: "disconnected", qr: null, info: null };
  broadcastState();
  pushLog("info", "Parado.");
}
async function logoutWa() {
  if (waClient) { try { await waClient.logout(); } catch {} waClient = null; }
  try { fs.rmSync(path.join(dataDir(), "wa-session"), { recursive: true, force: true }); pushLog("info", "Sessão removida."); } catch {}
  waState = { status: "disconnected", qr: null, info: null };
  broadcastState();
}

function parseList(s) { return String(s || "").split(/[\n,;]/).map((x) => x.trim()).filter(Boolean); }
function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// Normaliza valores BR + sufixo "k":
//   "1.500" -> "1500", "200,00" -> "200", "1.500,50" -> "1500"
//   "1,5k" / "1.5 k" / "1,5 K" -> "1500", "2k" -> "2000", "10k" -> "10000"
function normalizeAmount(s) {
  let v = String(s).trim();
  const mK = v.match(/^([\d.,]+)\s*[kK]$/);
  if (mK) {
    const num = parseFloat(mK[1].replace(",", "."));
    if (!isFinite(num)) return null;
    return String(Math.round(num * 1000));
  }
  v = v.replace(/[.,]\d{1,2}$/, "");
  v = v.replace(/[.,]/g, "");
  return v;
}
function stripUrls(s) {
  return String(s || "")
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, " ")
    .replace(/\b[\w-]+\.(?:com|net|org|io|br|co|gg|me|app|dev|xyz|info|tv|live|site|online|store|link|bet|vip|win|club|games?|cc|to|us|uk|eu)(?:\.[a-z]{2})?(?:\/\S*)?/gi, " ");
}
function matchKeyword(body, k) {
  // palavra-chave puramente numérica → match flexível com formatos BR e sufixo "k"
  if (/^\d+$/.test(k)) {
    const clean = stripUrls(body);
    const re = /\d+(?:[.,]\d+)?\s*[kK](?![\p{L}\p{N}_])|\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?/gu;
    const nums = clean.match(re) || [];
    return nums.some((n) => normalizeAmount(n) === k);
  }
  const re = new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escapeRegex(k)}(?=$|[^\\p{L}\\p{N}_])`, "iu");
  return re.test(body);
}

async function handleMessage(msg) {
  const cfg = getCfg();
  const groups = parseList(cfg.groups).map((g) => g.toLowerCase());
  const keywords = parseList(cfg.keywords);

  const chat = await msg.getChat().catch(() => null);
  if (!chat || !chat.isGroup) return;
  const groupName = (chat.name || "").toLowerCase();
  if (groups.length && !groups.some((g) => groupName.includes(g))) return;

  const body = msg.body || "";
  let matched = [];
  if (keywords.length) {
    matched = keywords.filter((p) => matchKeyword(body, p));
    if (matched.length === 0) return;
  }

  const contact = await msg.getContact().catch(() => null);
  const entry = {
    id: msg.id?._serialized || (Date.now() + "_" + Math.random().toString(36).slice(2, 8)),
    ts: Date.now(),
    autor: contact?.pushname || contact?.name || contact?.number || "",
    telefone: contact?.number || "",
    grupo: chat.name || "",
    mensagem: body,
    matched,
    chat_id: chat.id?._serialized || "",
  };

  messagesCache.unshift(entry);
  if (messagesCache.length > 500) messagesCache.length = 500;
  writeJson(msgPath(), messagesCache);

  if (win && !win.isDestroyed()) win.webContents.send("msg-new", entry);

  // Notificação no app em primeiro plano (independente do Windows)
  if (cfg.inAppNotify !== "0") bringWindowToFront();

  // notificação nativa
  if (cfg.notify !== "0" && Notification.isSupported()) {
    try {
      const n = new Notification({
        title: `Zapo2 — ${entry.autor || entry.grupo}`,
        body: body.slice(0, 180),
        silent: cfg.sound === "0" || (cfg.soundType && cfg.soundType !== "system"),
        icon: nativeImage.createFromPath(iconPath()),
        toastXml: undefined,
        timeoutType: "default",
        urgency: "normal",
      });
      n.on("click", () => { if (win) { win.show(); win.focus(); } });
      n.show();
    } catch (e) { pushLog("warn", "notify: " + e.message); }
  }
  pushLog("info", `← ${chat.name}: ${body.slice(0, 80)}`);
}

// ---- send ----
async function listChats() {
  if (!waClient || waState.status !== "connected") return { ok: false, error: "não conectado" };
  try {
    const chats = await waClient.getChats();
    return {
      ok: true,
      chats: chats.map((c) => ({
        id: c.id?._serialized || "",
        name: c.name || c.formattedTitle || c.id?.user || "",
        isGroup: !!c.isGroup,
      })).filter((c) => c.id),
    };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function sendMessageRaw({ chat_id, text, image_url, image_data }) {
  if (!waClient || waState.status !== "connected") throw new Error("não conectado");
  if (!chat_id) throw new Error("chat_id vazio");
  let media = null;
  if (image_data) {
    // image_data = "data:image/png;base64,...."
    const m = String(image_data).match(/^data:(.+?);base64,(.+)$/);
    if (m) media = new MessageMedia(m[1], m[2], "image");
  } else if (image_url) {
    try { media = await MessageMedia.fromUrl(image_url, { unsafeMime: true }); }
    catch (e) { pushLog("warn", "fromUrl: " + e.message); }
  }
  if (media) {
    await waClient.sendMessage(chat_id, media, text ? { caption: text } : {});
  } else {
    await waClient.sendMessage(chat_id, text || "");
  }
}

// ---- IPC ----
ipcMain.handle("cfg:get", () => getCfg());
ipcMain.handle("cfg:set", (_e, p) => { setCfg(p); return getCfg(); });
ipcMain.handle("wa:state", () => waState);
ipcMain.handle("wa:start", () => { startWa(); return true; });
ipcMain.handle("wa:stop", async () => { await stopWa(); return true; });
ipcMain.handle("wa:logout", async () => { await logoutWa(); return true; });
ipcMain.handle("wa:list-chats", () => listChats());
ipcMain.handle("wa:send", async (_e, p) => {
  try { await sendMessageRaw(p || {}); pushLog("info", `→ enviado ${p?.chat_id}`); return { ok: true }; }
  catch (e) { pushLog("error", "send: " + e.message); return { ok: false, error: e.message }; }
});
ipcMain.handle("msg:list", () => messagesCache || []);
ipcMain.handle("msg:remove", (_e, id) => {
  messagesCache = (messagesCache || []).filter((m) => m.id !== id);
  writeJson(msgPath(), messagesCache);
  return true;
});
ipcMain.handle("msg:clear", () => { messagesCache = []; writeJson(msgPath(), messagesCache); return true; });
ipcMain.handle("msg:test", (_e, p) => {
  const cfg = getCfg();
  const keywords = parseList(cfg.keywords);
  const body = String(p?.text || "");
  let matched = [];
  if (keywords.length) {
    matched = keywords.filter((k) => matchKeyword(body, k));
  }
  const entry = {
    id: "test_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
    ts: Date.now(),
    autor: p?.autor || "Teste",
    telefone: "",
    grupo: p?.grupo || "Teste local",
    mensagem: body,
    matched,
    chat_id: "",
  };
  messagesCache = messagesCache || [];
  messagesCache.unshift(entry);
  if (messagesCache.length > 500) messagesCache.length = 500;
  writeJson(msgPath(), messagesCache);
  if (win && !win.isDestroyed()) win.webContents.send("msg-new", entry);

  // Notificação no app em primeiro plano (independente do Windows)
  if (cfg.inAppNotify !== "0") bringWindowToFront();

  // notificação nativa do Windows também no teste
  if (cfg.notify === "0") {
    pushLog("warn", "notify(test): notificação desativada na config");
  } else if (!Notification.isSupported()) {
    pushLog("warn", `notify(test): Notification não suportada nesta instância (${process.platform})`);
  } else {
    try {
      const n = new Notification({
        title: `Zapo2 — ${entry.autor || entry.grupo}`,
        body: body.slice(0, 180) || "(teste)",
        silent: cfg.sound === "0" || (cfg.soundType && cfg.soundType !== "system"),
        icon: nativeImage.createFromPath(iconPath()),
        timeoutType: "default",
        urgency: "normal",
      });
      n.on("click", () => { if (win) { win.show(); win.focus(); } });
      n.show();
      pushLog("info", `notify(test): enviada (notify=${cfg.notify}, sound=${cfg.sound}, soundType=${cfg.soundType || "system"})`);
    } catch (e) { pushLog("warn", "notify(test): " + e.message); }
  }
  pushLog("info", `← [TESTE] ${body.slice(0, 80)}`);
  return entry;
});

ipcMain.handle("tpl:list", () => templatesCache || []);
ipcMain.handle("tpl:save", (_e, t) => {
  const tpl = { id: t.id || (Date.now() + "_" + Math.random().toString(36).slice(2, 6)), nome: t.nome || "", chave: t.chave || "", banco: t.banco || "", tipo: t.tipo || "", texto: t.texto || "" };
  templatesCache = templatesCache || [];
  const idx = templatesCache.findIndex((x) => x.id === tpl.id);
  if (idx >= 0) templatesCache[idx] = tpl; else templatesCache.unshift(tpl);
  writeJson(tplPath(), templatesCache);
  return tpl;
});
ipcMain.handle("tpl:remove", (_e, id) => {
  templatesCache = (templatesCache || []).filter((t) => t.id !== id);
  writeJson(tplPath(), templatesCache);
  return true;
});
ipcMain.handle("log:get", () => logs);
ipcMain.handle("log:clear", () => { logs = []; return true; });

function currentVersion() {
  try { return fs.readFileSync(versionFile(), "utf8").trim(); } catch { return ""; }
}
async function checkUpdate() {
  try {
    const r = await fetch(UPDATE_URL + "?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    const manifest = await r.json();
    const remote = String(manifest.version || "");
    const local = currentVersion();
    if (!remote) return { ok: false, error: "manifest sem version" };
    if (remote === local) return { ok: true, updated: false, version: remote };

    const dir = appUpdateDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const files = manifest.files || {};
    let needsRestart = false;
    for (const name of Object.keys(files)) {
      const f = files[name];
      const dest = path.join(dir, name);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (f.type === "text") {
        fs.writeFileSync(dest, String(f.content), "utf8");
      } else {
        fs.writeFileSync(dest, Buffer.from(f.content, "base64"));
      }
      if (RESTART_FILES.has(name)) needsRestart = true;
    }
    fs.writeFileSync(versionFile(), remote);
    pushLog("info", `Atualização aplicada: v${remote}${needsRestart ? " (restart)" : ""}`);
    return { ok: true, updated: true, version: remote, notes: manifest.notes || "", needsRestart };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
ipcMain.handle("update:check", () => checkUpdate());
ipcMain.handle("app:reload", () => { if (win && !win.isDestroyed()) win.loadFile(uiHtmlPath()); return true; });
ipcMain.handle("app:restart", () => { app.isQuitting = true; app.relaunch(); app.exit(0); return true; });

// ---- Native (.exe) auto-update ----
function getInstalledNativeVersion() {
  try {
    const f = path.join(path.dirname(app.getPath("exe")), "native-version.txt");
    if (fs.existsSync(f)) return fs.readFileSync(f, "utf8").trim();
  } catch {}
  return "0";
}

async function checkNativeUpdate() {
  try {
    const r = await fetch(`${NATIVE_BASE}/version.txt?t=${Date.now()}`, { cache: "no-store" });
    // 400/404 = nunca publicado ainda; trata como "sem update" pra não travar o botão único
    if (r.status === 400 || r.status === 404) {
      return { ok: true, installed: getInstalledNativeVersion(), available: null, hasUpdate: false, notPublished: true };
    }
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    const remote = (await r.text()).trim();
    const installed = getInstalledNativeVersion();
    return { ok: true, installed, available: remote, hasUpdate: !!remote && remote !== installed };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

async function applyNativeUpdate(sender) {
  if (process.platform !== "win32") return { ok: false, error: "Auto-update nativo só suportado no Windows" };
  const send = (phase, pct) => { try { sender?.send("update:native-progress", { phase, pct }); } catch {} };
  try {
    const remote = (await (await fetch(`${NATIVE_BASE}/version.txt?t=${Date.now()}`)).text()).trim();
    if (!remote) throw new Error("Versão remota inválida");

    send("download", 0);
    const r = await fetch(`${NATIVE_BASE}/${NATIVE_ZIP_NAME}?t=${Date.now()}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const total = Number(r.headers.get("content-length")) || 0;
    const reader = r.body.getReader();
    const chunks = []; let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); received += value.length;
      if (total) send("download", Math.round((received / total) * 100));
    }
    const zipBuf = Buffer.concat(chunks);

    const exeDir = path.dirname(app.getPath("exe"));
    const stagingZip = path.join(dataDir(), "native-update.zip");
    const stagingDir = path.join(dataDir(), "native-staging");
    const swapPs1 = path.join(dataDir(), "swap-update.ps1");
    const swapVbs = path.join(dataDir(), "swap-update.vbs");
    fs.writeFileSync(stagingZip, zipBuf);

    const psEsc = (p) => p.replace(/'/g, "''");
    const ps = `
$ErrorActionPreference = 'Stop'
$PID_TO_WAIT = ${process.pid}
$ZIP = '${psEsc(stagingZip)}'
$INSTALL = '${psEsc(exeDir)}'
$STAGING = '${psEsc(stagingDir)}'
$VERSION = '${psEsc(remote)}'
$EXE = Join-Path $INSTALL '${NATIVE_EXE_NAME}'
$LOG = Join-Path $INSTALL 'native-update-error.log'

try { Wait-Process -Id $PID_TO_WAIT -Timeout 60 } catch {}
Start-Sleep -Milliseconds 500

try {
  if (Test-Path $STAGING) { Remove-Item -Recurse -Force $STAGING }
  New-Item -ItemType Directory -Path $STAGING | Out-Null
  Expand-Archive -LiteralPath $ZIP -DestinationPath $STAGING -Force

  $rootExe = Join-Path $STAGING '${NATIVE_EXE_NAME}'
  if (Test-Path $rootExe) {
    $srcPath = $STAGING
  } else {
    $dirs = Get-ChildItem -Path $STAGING -Directory
    if ($dirs.Count -eq 1) { $srcPath = $dirs[0].FullName } else { $srcPath = $STAGING }
  }

  $sourceExe = Join-Path $srcPath '${NATIVE_EXE_NAME}'
  if (!(Test-Path $sourceExe)) { throw '${NATIVE_EXE_NAME} não encontrado no pacote extraído' }

  $copied = $false
  for ($i = 1; $i -le 40; $i++) {
    try {
      Copy-Item -Path (Join-Path $srcPath '*') -Destination $INSTALL -Recurse -Force -ErrorAction Stop
      if (!(Test-Path $EXE)) { throw 'Executável não encontrado após cópia' }
      $srcHash = (Get-FileHash -LiteralPath $sourceExe -Algorithm SHA256 -ErrorAction Stop).Hash
      $dstHash = (Get-FileHash -LiteralPath $EXE -Algorithm SHA256 -ErrorAction Stop).Hash
      if ($srcHash -ne $dstHash) { throw 'Executável instalado não confere com o pacote baixado' }
      $copied = $true
      break
    } catch {
      if ($i -ge 40) { throw }
      Start-Sleep -Milliseconds 750
    }
  }
  if (-not $copied) { throw 'Não foi possível substituir o executável principal' }

  Set-Content -Path (Join-Path $INSTALL 'native-version.txt') -Value $VERSION -Encoding ASCII
  Remove-Item -Recurse -Force $STAGING
  Remove-Item -Force $ZIP

  Start-Process -FilePath $EXE -WindowStyle Normal
  exit 0
} catch {
  Add-Content -Path $LOG -Value ("[" + (Get-Date) + "] " + $_.Exception.Message)
  Start-Process -FilePath $EXE -WindowStyle Normal
  exit 1
}
`.trim();
    fs.writeFileSync(swapPs1, ps, "utf8");
    fs.writeFileSync(
      swapVbs,
      [
        'Set shell = CreateObject("WScript.Shell")',
        `cmd = "powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File ""${swapPs1.replace(/"/g, '""')}"""`,
        "shell.Run cmd, 0, False",
      ].join("\r\n"),
      "utf8",
    );

    send("ready", 100);
    const child = spawn("wscript.exe", [swapVbs], { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();

    setTimeout(() => { try { stopWa(); } catch {} app.isQuitting = true; app.exit(0); }, 800);
    return { ok: true, version: remote };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

ipcMain.handle("update:check-native", () => checkNativeUpdate());
ipcMain.handle("update:apply-native", (e) => applyNativeUpdate(e.sender));
ipcMain.handle("app:native-version", () => getInstalledNativeVersion());

// ---- Combined "update everything" flow ----
// Applies frontend update first, then native if needed.
// Returns a plan so the renderer knows what to do next (reload/restart/native-swap).
ipcMain.handle("update:apply-all", async (e) => {
  const result = { ok: true, frontend: null, native: null, action: "none", error: null };
  try {
    // 1) Frontend
    const fr = await checkUpdate();
    result.frontend = fr;
    if (!fr.ok) { result.ok = false; result.error = "frontend: " + fr.error; return result; }

    // 2) Native (Windows only)
    const nv = process.platform === "win32" ? await checkNativeUpdate() : { ok: true, hasUpdate: false };
    result.native = nv;
    if (!nv.ok) { result.ok = false; result.error = "native: " + nv.error; return result; }

    if (nv.hasUpdate) {
      // Native update swap reboots the app entirely — picks up the new frontend automatically
      const ap = await applyNativeUpdate(e.sender);
      result.native.apply = ap;
      if (!ap.ok) { result.ok = false; result.error = "native apply: " + ap.error; return result; }
      result.action = "native-swap";
      return result;
    }

    if (fr.updated && fr.needsRestart) { result.action = "restart"; return result; }
    if (fr.updated) { result.action = "reload"; return result; }
    result.action = "none";
    return result;
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

app.whenReady().then(() => {
  // AppUserModelID — necessário para notificações aparecerem na Central de Ações do Windows
  if (process.platform === "win32") {
    try { app.setAppUserModelId("com.zapo2.app"); } catch {}
  }
  loadAll();
  createWindow();
  createTray();
});
app.on("window-all-closed", (e) => { e.preventDefault?.(); });
