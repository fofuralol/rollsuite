const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");
const QRCode = require("qrcode");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const { ensureChrome } = require("./ensure-chrome.cjs");

let win, tray, waClient;
let cfgCache = null;
const UPDATE_URL = "https://ttnpouzoswhhqvedvngx.supabase.co/storage/v1/object/public/zapo-updates/version.json";
function cfgPath() { return path.join(dataDir(), "config.json"); }
function appUpdateDir() { return path.join(dataDir(), "app-update"); }
function versionFile() { return path.join(appUpdateDir(), ".version"); }
// Files that need a full app restart (not just window reload) when updated
const RESTART_FILES = new Set(["main-app.cjs", "preload.cjs"]);
let waState = { status: "disconnected", qr: null, info: null };
let logs = []; // {ts, level, msg}

function dataDir() {
  const exeDir = path.dirname(app.getPath("exe"));
  const dir = path.join(exeDir, "wa-listener-data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function loadCfg() {
  try { cfgCache = JSON.parse(fs.readFileSync(cfgPath(), "utf8")); }
  catch { cfgCache = {}; }
}
function getCfg() {
  if (!cfgCache) loadCfg();
  return { webhook_url: "", token: "", groups: "", keywords: "", autostart: "0", ...cfgCache };
}
function setCfg(patch) {
  const cur = getCfg();
  cfgCache = { ...cur, ...patch };
  fs.writeFileSync(cfgPath(), JSON.stringify(cfgCache, null, 2));
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

function pickFile(name, ...bundledCandidates) {
  const updated = path.join(appUpdateDir(), name);
  try { if (fs.existsSync(updated)) return updated; } catch {}
  for (const p of bundledCandidates) { try { if (fs.existsSync(p)) return p; } catch {} }
  return null;
}

function appIconPath() {
  return pickFile("icon.png",
    path.join(__dirname, "..", "build", "icon.png"),
    path.join(process.resourcesPath || "", "app", "build", "icon.png"),
  );
}

function uiHtmlPath() {
  return pickFile("index.html", path.join(__dirname, "ui", "index.html"));
}

function preloadPath() {
  return pickFile("preload.cjs", path.join(__dirname, "preload.cjs"));
}

function createWindow() {
  const iconPath = appIconPath();
  win = new BrowserWindow({
    width: 980, height: 720, backgroundColor: "#0b3d2e", autoHideMenuBar: true,
    title: "Zapo",
    icon: iconPath || undefined,
    webPreferences: { preload: preloadPath(), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(uiHtmlPath());
  win.on("close", (e) => {
    if (!app.isQuitting) { e.preventDefault(); win.hide(); }
  });
}

function createTray() {
  const iconPath = appIconPath();
  let icon;
  try {
    icon = iconPath ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }) : nativeImage.createEmpty();
  } catch { icon = nativeImage.createEmpty(); }
  tray = new Tray(icon);
  tray.setToolTip("Zapo");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Abrir Zapo", click: () => { win.show(); } },
    { type: "separator" },
    { label: "Sair", click: () => { app.isQuitting = true; app.quit(); } },
  ]));
  tray.on("click", () => win.show());
}

// ----- WhatsApp -----
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
        else if (lockNames.includes(e.name)) {
          try { fs.rmSync(full, { force: true }); pushLog("info", "lock removido: " + e.name); } catch {}
        }
      }
    };
    walk(sessRoot);
  } catch (e) { pushLog("warn", "clearChromeLocks: " + e.message); }
}

async function startWa() {
  if (waClient) return pushLog("warn", "Já existe cliente; pare antes de iniciar.");
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
      pushLog("info", "QR gerado — escaneie no WhatsApp.");
      broadcastState();
    } catch (e) { pushLog("error", "QR err: " + e.message); }
  });
  waClient.on("authenticated", () => { pushLog("info", "Autenticado."); });
  waClient.on("ready", () => {
    waState = { status: "connected", qr: null, info: { wid: waClient.info?.wid?.user } };
    pushLog("info", "Conectado como " + (waClient.info?.pushname || waClient.info?.wid?.user));
    broadcastState();
    startOutboxLoop();
  });
  waClient.on("auth_failure", (m) => { pushLog("error", "auth_failure: " + m); });
  waClient.on("disconnected", (r) => {
    pushLog("warn", "Desconectado: " + r);
    waState = { status: "disconnected", qr: null, info: null };
    broadcastState();
    stopOutboxLoop();
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
  stopOutboxLoop();
  if (!waClient) return;
  try { await waClient.destroy(); } catch {}
  waClient = null;
  waState = { status: "disconnected", qr: null, info: null };
  broadcastState();
  pushLog("info", "Cliente parado.");
}

async function logoutWa() {
  if (!waClient) {
    // limpa sessão mesmo desconectado
    const sessDir = path.join(dataDir(), "wa-session");
    try { fs.rmSync(sessDir, { recursive: true, force: true }); pushLog("info", "Sessão removida."); } catch (e) { pushLog("error", e.message); }
    return;
  }
  try { await waClient.logout(); } catch (e) { pushLog("error", "logout: " + e.message); }
  waClient = null;
  waState = { status: "disconnected", qr: null, info: null };
  broadcastState();
}

function parseList(s) {
  return String(s || "").split(/[\n,;]/).map((x) => x.trim()).filter(Boolean);
}
function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// Normaliza valores BR + sufixo "k":
//   "1.500" -> "1500", "200,00" -> "200", "1,5k" / "1.5 k" -> "1500", "2k" -> "2000"
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
  const payload = {
    autor: contact?.pushname || contact?.name || contact?.number || "",
    telefone: contact?.number || "",
    grupo: chat.name || "",
    mensagem: body,
    matched,
    msg_id: msg.id?._serialized || "",
    chat_id: chat.id?._serialized || "",
    author_id: msg.author || msg.from || "",
    source: "wa-listener-desktop",
  };

  if (!cfg.webhook_url || !cfg.token) {
    pushLog("warn", `Mensagem capturada mas webhook/token não configurado: ${chat.name} :: ${body.slice(0, 60)}`);
    return;
  }

  try {
    const r = await fetch(cfg.webhook_url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-webhook-token": cfg.token },
      body: JSON.stringify(payload),
    });
    const txt = await r.text();
    pushLog(r.ok ? "info" : "error", `[${r.status}] ${chat.name} → "${body.slice(0, 60)}" ${r.ok ? "" : txt.slice(0, 200)}`);
  } catch (e) {
    pushLog("error", "POST falhou: " + e.message);
  }
}

// ----- Outbox (envio) -----
let outboxTimer = null;
let outboxBusy = false;

function outboxUrl(webhookUrl) {
  if (!webhookUrl) return "";
  return webhookUrl.replace(/\/whatsapp-webhook\/?$/, "/whatsapp-outbox");
}

async function pollOutbox() {
  if (outboxBusy) return;
  if (!waClient || waState.status !== "connected") return;
  const cfg = getCfg();
  const url = outboxUrl(cfg.webhook_url);
  if (!url || !cfg.token) return;
  outboxBusy = true;
  try {
    const r = await fetch(url, { method: "GET", headers: { "x-webhook-token": cfg.token } });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      pushLog("error", `outbox GET [${r.status}] ${t.slice(0, 200)}`);
      return;
    }
    const data = await r.json().catch(() => ({}));
    const messages = Array.isArray(data.messages) ? data.messages : [];
    for (const m of messages) {
      await sendOutboxItem(url, cfg.token, m);
    }
  } catch (e) {
    pushLog("error", "outbox: " + e.message);
  } finally {
    outboxBusy = false;
  }
}

function isTransientWaError(msg) {
  const s = String(msg || "").toLowerCase();
  return (
    s.includes("detached frame") ||
    s.includes("execution context was destroyed") ||
    s.includes("target closed") ||
    s.includes("session closed") ||
    s.includes("protocol error") ||
    s.includes("most likely the page has been closed") ||
    s.includes("cannot read properties of undefined") ||
    s.includes("navigation") ||
    s.includes("frame got detached")
  );
}

async function waitForPageReady(timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const page = waClient && waClient.pupPage;
      if (page && !page.isClosed()) {
        const ready = await page.evaluate(() => {
          // @ts-ignore
          return !!(window.Store && window.Store.Chat);
        }).catch(() => false);
        if (ready) return true;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function trySendOnce(m) {
  const opts = {};
  if (m.quoted_msg_id) opts.quotedMessageId = m.quoted_msg_id;
  let media = null;
  if (m.image_url) {
    try {
      media = await MessageMedia.fromUrl(m.image_url, { unsafeMime: true });
    } catch (e) {
      pushLog("warn", "fromUrl falhou, tentando fetch: " + e.message);
      const ir = await fetch(m.image_url);
      if (!ir.ok) throw new Error(`download img [${ir.status}]`);
      const buf = Buffer.from(await ir.arrayBuffer());
      const mime = ir.headers.get("content-type") || "image/png";
      media = new MessageMedia(mime, buf.toString("base64"), "image");
    }
  }
  if (media) {
    if (m.text) opts.caption = m.text;
    await waClient.sendMessage(m.chat_id, media, opts);
  } else {
    await waClient.sendMessage(m.chat_id, m.text || "", opts);
  }
}

async function sendOutboxItem(url, token, m) {
  let ok = false, errMsg = "", transient = false;
  if (!m.chat_id) {
    errMsg = "chat_id vazio";
  } else {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await trySendOnce(m);
        ok = true;
        errMsg = "";
        transient = false;
        pushLog("info", `→ enviado para ${m.chat_id}${m.image_url ? " (img)" : ""}${attempt > 1 ? ` (tent. ${attempt})` : ""}`);
        break;
      } catch (e) {
        errMsg = e.message || String(e);
        transient = isTransientWaError(errMsg);
        pushLog(transient ? "warn" : "error", `envio tent.${attempt}/${maxAttempts} (${m.id}): ${errMsg}`);
        if (!transient) break;
        // espera o WhatsApp Web reidratar antes de retentar
        await waitForPageReady(6000);
        await new Promise((r) => setTimeout(r, 800 * attempt));
        if (!waClient || waState.status !== "connected") break;
      }
    }
    if (!ok && transient) {
      pushLog("warn", `envio adiado (${m.id}): WhatsApp recarregando, tentarei de novo`);
      try {
        await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-webhook-token": token },
          body: JSON.stringify({ id: m.id, ok: false, retry: true, error: errMsg }),
        });
      } catch {}
      return;
    }
    if (!ok) {
      pushLog("error", `envio falhou (${m.id}): ${errMsg}`);
    }
  }
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-webhook-token": token },
      body: JSON.stringify({ id: m.id, ok, error: errMsg }),
    });
  } catch (e) {
    pushLog("error", "ack outbox: " + e.message);
  }
}

function startOutboxLoop() {
  if (outboxTimer) return;
  outboxTimer = setInterval(pollOutbox, 5000);
  pushLog("info", "Loop de envio iniciado (5s).");
}
function stopOutboxLoop() {
  if (outboxTimer) { clearInterval(outboxTimer); outboxTimer = null; }
}
ipcMain.handle("cfg:get", () => getCfg());
ipcMain.handle("cfg:set", (_e, patch) => { setCfg(patch); return getCfg(); });
ipcMain.handle("wa:state", () => waState);
ipcMain.handle("wa:start", () => { startWa(); return true; });
ipcMain.handle("wa:stop", async () => { await stopWa(); return true; });
ipcMain.handle("wa:logout", async () => { await logoutWa(); return true; });
ipcMain.handle("log:get", () => logs);
ipcMain.handle("log:clear", () => { logs = []; return true; });
ipcMain.handle("wa:test-webhook", async () => {
  const cfg = getCfg();
  if (!cfg.webhook_url || !cfg.token) return { ok: false, error: "config incompleta" };
  try {
    const r = await fetch(cfg.webhook_url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-webhook-token": cfg.token },
      body: JSON.stringify({ autor: "TESTE", grupo: "TESTE", mensagem: "ping do listener desktop", matched: ["teste"], source: "wa-listener-desktop-test" }),
    });
    const txt = await r.text();
    pushLog(r.ok ? "info" : "error", `Teste webhook [${r.status}] ${txt.slice(0, 200)}`);
    return { ok: r.ok, status: r.status, body: txt };
  } catch (e) { return { ok: false, error: e.message }; }
});

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
      if (f.type === "base64") {
        fs.writeFileSync(dest, Buffer.from(f.content, "base64"));
      } else {
        fs.writeFileSync(dest, String(f.content), "utf8");
      }
      if (RESTART_FILES.has(name)) needsRestart = true;
    }
    fs.writeFileSync(versionFile(), remote);
    pushLog("info", `Atualização aplicada: v${remote}${needsRestart ? " (restart necessário)" : ""}`);
    return { ok: true, updated: true, version: remote, notes: manifest.notes || "", needsRestart };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

ipcMain.handle("update:check", () => checkUpdate());
ipcMain.handle("app:reload", () => {
  if (win && !win.isDestroyed()) {
    win.loadFile(uiHtmlPath());
  }
  return true;
});
ipcMain.handle("app:restart", () => {
  app.isQuitting = true;
  app.relaunch();
  app.exit(0);
  return true;
});

app.whenReady().then(() => {
  loadCfg();
  createWindow();
  createTray();
});
app.on("window-all-closed", (e) => { e.preventDefault?.(); });
