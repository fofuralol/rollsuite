// WhatsApp listener embutido no RollsSuite.
// Salva mensagens diretamente em wa_messages (db local) e processa wa_outbox.
const path = require("path");
const fs = require("fs");
const QRCode = require("qrcode");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const { ensureChrome } = require("./ensure-chrome.cjs");

const USER_ID = "fofuralol-local";

let waClient = null;
let waState = { status: "disconnected", qr: null, info: null, progress: "" };
let dataDir;
let db;
let sendStateFn = null;
let outboxTimer = null;

function setSendState(fn) { sendStateFn = fn; }
function broadcast() { try { sendStateFn?.(waState); } catch {} }
function log(msg) { console.log("[wa]", msg); waState.progress = msg; broadcast(); }

function clearChromeLocks() {
  try {
    const sessRoot = path.join(dataDir, "wa-session");
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

function guessMimeType(filePath) {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

function isRemoteUrl(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

function resolveTaskImagePath(imageUrl) {
  const raw = String(imageUrl || "").trim();
  if (!raw) return "";
  if (path.isAbsolute(raw)) return raw;
  return path.join(dataDir, "..", raw.replace(/^\/+/, ""));
}

async function loadMessageMedia(imageUrl) {
  if (/^data:/i.test(imageUrl)) {
    const m = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) throw new Error("data URL inválido");
    return new MessageMedia(m[1], m[2]);
  }
  if (isRemoteUrl(imageUrl)) {
    const r = await fetch(imageUrl);
    if (!r.ok) throw new Error("download img " + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    const ct = r.headers.get("content-type") || "image/jpeg";
    return new MessageMedia(ct, buf.toString("base64"));
  }
  const absPath = resolveTaskImagePath(imageUrl);
  if (!absPath || !fs.existsSync(absPath)) throw new Error(`imagem local não encontrada: ${imageUrl}`);
  const buf = fs.readFileSync(absPath);
  return new MessageMedia(guessMimeType(absPath), buf.toString("base64"), path.basename(absPath));
}

function parseList(s) { return String(s || "").split(/[\n,;]/).map((x) => x.trim()).filter(Boolean); }
function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
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
    .replace(/\b[\w-]+\.(?:com|net|org|io|br|co|gg|me|app|dev|xyz|info|tv|live|site|online|store|link|bet|vip|win|club|games?|cc|to|us|uk|eu)(?:\.[a-z]{2})?(?:\/\S*)?/gi, " ")
    // Nomes de arquivo conhecidos
    .replace(/\b[\w\-_.]+\.(?:pdf|jpg|jpeg|png|gif|webp|mp4|mov|avi|mp3|ogg|opus|m4a|wav|aac|flac|webm|mkv|doc|docx|xls|xlsx|csv|txt|zip|rar|7z|pff|tmp|bin)\b/gi, " ")
    // Qualquer "nome.ext" cujo nome contém dígitos (ex: 2026-05-12.pff, foto_001.xyz)
    .replace(/\b[\w\-_.]*\d[\w\-_.]*\.[a-z]{2,5}\b/gi, " ");
}
function isAttachmentArtifactLine(line) {
  const value = String(line || "").trim();
  if (!value) return false;
  return /^(?:[\w._-]*\d[\w._-]*\.(?:pdf|jpg|jpeg|png|gif|webp|mp4|mov|avi|mp3|ogg|opus|m4a|wav|aac|flac|webm|mkv|doc|docx|xls|xlsx|csv|txt|zip|rar|7z|pff|tmp|bin|[a-z]{2,5})|[\w._-]+\.(?:pdf|jpg|jpeg|png|gif|webp|mp4|mov|avi|mp3|ogg|opus|m4a|wav|aac|flac|webm|mkv|doc|docx|xls|xlsx|csv|txt|zip|rar|7z|pff|tmp|bin))$/iu.test(value);
}
function isPixModel(body) {
  const lower = String(body || "").toLowerCase();
  const pixLabels = [
    "valor:", "chave:", "chave pix", "tipo de chave", "tipo da chave",
    "destinatário", "destinatario", "remetente", "instituição", "instituicao",
    "comprovante", "id da transação", "id da transacao", "id transação", "id transacao",
    "data e hora", "data/hora", "horário", "horario",
    "cpf/cnpj", "banco:", "agência", "agencia", "conta:",
  ];
  const hitCount = pixLabels.reduce((n, w) => (lower.includes(w) ? n + 1 : n), 0);
  if (hitCount >= 2) return true;
  if (
    lower.includes("pix") &&
    (lower.includes("valor") || lower.includes("chave") || lower.includes("comprovante") ||
     lower.includes("confirmado") || lower.includes("enviado") || lower.includes("deposito") ||
     lower.includes("depósito") || lower.includes("transferência") || lower.includes("transferencia"))
  ) return true;
  if (lower.includes("nome:") && lower.includes("valor:")) return true;
  return false;
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

function getConfig() {
  const rows = db.exec({ table: "app_settings", action: "select", filters: [{ col: "user_id", op: "eq", val: USER_ID }, { col: "key", op: "eq", val: "wa_listener_config" }] });
  let cfg = { groups: "", keywords_from_table: true };
  try { if (rows[0]?.value) cfg = { ...cfg, ...JSON.parse(rows[0].value) }; } catch {}
  return cfg;
}
function getKeywordsFromTable() {
  // Desktop é single-user; ignoramos o filtro por user_id porque palavras antigas
  // podem ter sido salvas com user_id diferente (null, UUID antigo, etc.)
  const rows = db.exec({ table: "wa_keywords", action: "select" });
  return rows
    .map((r) => String(r.palavra || "").trim())
    .filter(Boolean);
}
function getKeywordsFromDisk() {
  try {
    const f = path.join(dataDir, "..", "db", "wa_keywords.json");
    if (!fs.existsSync(f)) return { exists: false, path: f, count: 0, sample: [] };
    const rows = JSON.parse(fs.readFileSync(f, "utf8"));
    const list = (Array.isArray(rows) ? rows : []).map((r) => String(r.palavra || "").trim()).filter(Boolean);
    return { exists: true, path: f, count: list.length, sample: list.slice(0, 20) };
  } catch (e) { return { exists: false, error: String(e.message || e), count: 0, sample: [] }; }
}

function debugLog(reason, extra) {
  try {
    const line = `[${new Date().toISOString()}] ${reason}` +
      (extra ? ` ${JSON.stringify(extra)}` : "") + "\n";
    fs.appendFileSync(path.join(dataDir, "wa-debug.log"), line);
  } catch {}
  try {
    waState.progress = `[debug] ${reason}`;
    broadcast();
  } catch {}
}

const recentHandled = new Set();
function rememberId(id) {
  recentHandled.add(id);
  if (recentHandled.size > 500) {
    const it = recentHandled.values();
    for (let i = 0; i < 100; i++) recentHandled.delete(it.next().value);
  }
}

async function handleMessage(msg, onNewMessage) {
  const sourceMsgId = msg.id?._serialized || "";
  if (sourceMsgId && recentHandled.has(sourceMsgId)) return;
  if (sourceMsgId) rememberId(sourceMsgId);

  const cfg = getConfig();
  const groups = parseList(cfg.groups).map((g) => g.toLowerCase());
  const keywords = getKeywordsFromTable();

  debugLog("msg recebida", { id: sourceMsgId, body: (msg.body || "").slice(0, 80), keywordsCount: keywords.length, fromMe: !!msg.fromMe });

  if (msg.fromMe) { debugLog("drop: mensagem do próprio número", { id: sourceMsgId }); return; }

  if (keywords.length === 0) { debugLog("drop: nenhuma palavra-chave carregada"); return; }

  const chat = await msg.getChat().catch(() => null);
  if (!chat) { debugLog("drop: getChat falhou"); return; }
  if (!chat.isGroup) { debugLog("drop: não é grupo", { chat: chat.name }); return; }

  const groupName = (chat.name || "").toLowerCase();
  if (groups.length && !groups.some((g) => groupName.includes(g))) {
    debugLog("drop: grupo não bate filtro", { grupo: groupName, filtros: groups });
    return;
  }

  const body = msg.body || "";
  const meaningfulLines = body.split(/\r?\n/).map((line) => String(line || "").trim()).filter(Boolean).filter((line) => !isAttachmentArtifactLine(line));
  if (meaningfulLines.length === 0) {
    debugLog("drop: anexo/arquivo sem linha útil", { body: body.slice(0, 120) });
    return;
  }
  if (isPixModel(body)) {
    debugLog("drop: modelo de PIX/comprovante", { body: body.slice(0, 120) });
    return;
  }
  const searchableBody = meaningfulLines.join("\n");
  const matched = keywords.filter((p) => matchKeyword(searchableBody, p));
  if (matched.length === 0) {
    debugLog("drop: nenhuma palavra-chave casou", { body: body.slice(0, 120) });
    return;
  }

  const contact = await msg.getContact().catch(() => null);

  const existing = db.exec({
    table: "wa_messages", action: "select",
    filters: [{ col: "user_id", op: "eq", val: USER_ID }, { col: "source_msg_id", op: "eq", val: sourceMsgId }],
  });
  if (existing.length) { debugLog("drop: duplicada (db)", { sourceMsgId }); return; }

  const inserted = db.exec({
    table: "wa_messages", action: "insert", single: true,
    payload: {
      user_id: USER_ID,
      autor: contact?.pushname || contact?.name || contact?.number || "",
      telefone: contact?.number || "",
      grupo: chat.name || "",
      mensagem: body,
      matched,
      source_msg_id: sourceMsgId,
      source_chat_id: chat.id?._serialized || "",
      source_author_id: contact?.id?._serialized || "",
      created_at: new Date().toISOString(),
    },
  });
  debugLog("OK: notificando", { autor: inserted?.autor, matched });
  try { onNewMessage?.(inserted); } catch {}
}

async function startWa(onNewMessage) {
  if (waClient) { log("Já existe cliente"); return; }
  waState = { status: "starting", qr: null, info: null, progress: "Inicializando…" };
  broadcast();
  clearChromeLocks();

  let chromeInfo;
  try {
    chromeInfo = await ensureChrome(path.join(dataDir, "chrome"), (m) => log(m));
  } catch (e) {
    waState = { status: "error", qr: null, info: null, progress: "Falha Chrome: " + e.message };
    broadcast();
    return;
  }

  waClient = new Client({
    authStrategy: new LocalAuth({ dataPath: path.join(dataDir, "wa-session") }),
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
      waState = { status: "qr", qr: dataUrl, info: null, progress: "Escaneie o QR" };
      broadcast();
    } catch (e) { log("QR err: " + e.message); }
  });
  waClient.on("authenticated", () => log("Autenticado"));
  waClient.on("ready", () => {
    waState = { status: "connected", qr: null, info: { wid: waClient.info?.wid?.user, pushname: waClient.info?.pushname }, progress: "Conectado" };
    broadcast();
    startOutboxWorker();
  });
  waClient.on("auth_failure", (m) => log("auth_failure: " + m));
  waClient.on("disconnected", (r) => {
    waState = { status: "disconnected", qr: null, info: null, progress: "Desconectado: " + r };
    broadcast();
    waClient = null;
    stopOutboxWorker();
  });
  waClient.on("message", async (msg) => {
    try { await handleMessage(msg, onNewMessage); } catch (e) { log("msg err: " + e.message); }
  });

  waClient.initialize().catch((e) => {
    log("initialize: " + e.message);
    waState = { status: "error", qr: null, info: null, progress: "Erro: " + e.message };
    broadcast();
    waClient = null;
  });
}

async function stopWa() {
  stopOutboxWorker();
  if (!waClient) return;
  try { await waClient.destroy(); } catch {}
  waClient = null;
  waState = { status: "disconnected", qr: null, info: null, progress: "Parado" };
  broadcast();
}

async function logoutWa() {
  stopOutboxWorker();
  if (waClient) { try { await waClient.logout(); } catch {} waClient = null; }
  try { fs.rmSync(path.join(dataDir, "wa-session"), { recursive: true, force: true }); } catch {}
  waState = { status: "disconnected", qr: null, info: null, progress: "Sessão removida" };
  broadcast();
}

// ---- Outbox worker ----
async function processOutboxRow(row) {
  if (!waClient) throw new Error("WhatsApp não conectado");
  const chatId = row.chat_id;
  if (!chatId) throw new Error("chat_id vazio");
  const options = {};
  if (row.quoted_msg_id) options.quotedMessageId = row.quoted_msg_id;

  if (row.image_url) {
    const media = await loadMessageMedia(row.image_url);
    if (row.text) options.caption = row.text;
    await waClient.sendMessage(chatId, media, options);
  } else {
    if (!row.text) throw new Error("text vazio");
    await waClient.sendMessage(chatId, row.text, options);
  }
}

async function pollOutboxOnce() {
  if (!waClient || waState.status !== "connected") return;
  const all = db.exec({
    table: "wa_outbox", action: "select",
    filters: [{ col: "user_id", op: "eq", val: USER_ID }],
    limit: 50,
  });
  const pending = all.filter((r) => !r.status || r.status === "pending").slice(0, 5);
  for (const row of pending) {
    try {
      db.exec({ table: "wa_outbox", action: "update", filters: [{ col: "id", op: "eq", val: row.id }], payload: { status: "sending" } });
      await processOutboxRow(row);
      db.exec({ table: "wa_outbox", action: "update", filters: [{ col: "id", op: "eq", val: row.id }], payload: { status: "sent", sent_at: new Date().toISOString(), error: "" } });
      console.log("[wa] outbox sent", row.chat_id, (row.text || "").slice(0, 60));
    } catch (e) {
      db.exec({ table: "wa_outbox", action: "update", filters: [{ col: "id", op: "eq", val: row.id }], payload: { status: "error", error: String(e.message || e) } });
      console.error("[wa] outbox error", row.chat_id, e && e.message);
    }
  }
}

function startOutboxWorker() {
  stopOutboxWorker();
  outboxTimer = setInterval(() => { pollOutboxOnce().catch(() => {}); }, 3000);
}
function stopOutboxWorker() {
  if (outboxTimer) { clearInterval(outboxTimer); outboxTimer = null; }
}

function getState() { return waState; }
function setConfig(patch) {
  const cur = getConfig();
  const next = { ...cur, ...patch };
  db.exec({
    table: "app_settings", action: "upsert", onConflict: "user_id,key",
    payload: { user_id: USER_ID, key: "wa_listener_config", value: JSON.stringify(next) },
  });
  return next;
}

function init(opts) {
  dataDir = opts.dataDir;
  db = opts.db;
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
}

function getDiagnostics() {
  const disk = getKeywordsFromDisk();
  const mem = getKeywordsFromTable();
  return { dataDir, disk, memoryCount: mem.length, memorySample: mem.slice(0, 20) };
}

async function listGroups() {
  if (!waClient || waState.status !== "connected") return [];
  try {
    const chats = await waClient.getChats();
    return chats
      .filter((c) => c.isGroup)
      .map((c) => ({ chat_id: c.id?._serialized || "", grupo: c.name || c.id?._serialized || "" }))
      .filter((g) => g.chat_id)
      .sort((a, b) => a.grupo.localeCompare(b.grupo));
  } catch (e) { console.error("[wa] listGroups", e.message); return []; }
}

module.exports = { init, startWa, stopWa, logoutWa, getState, getConfig, setConfig, setSendState, getDiagnostics, listGroups };
