// WhatsApp listener embutido no RollsSuite.
// Salva mensagens diretamente em wa_messages (db local) e processa wa_outbox.
const path = require("path");
const fs = require("fs");
const QRCode = require("qrcode");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const { ensureChrome } = require("./ensure-chrome.cjs");

const USER_ID = "fofuralol-local";

// ============ Cloud sync (ponte celular <-> PC via Supabase) ============
const SUPABASE_URL = "https://pmwevrhnoxnbcuslkeid.supabase.co";
const CLOUD_FN_URL = `${SUPABASE_URL}/functions/v1/wa-cloud-sync`;
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtd2V2cmhub3huYmN1c2xrZWlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxOTE5MTMsImV4cCI6MjA5ODc2NzkxM30.5YcvB4ETz0tborOn58GzrBOiP3OQMJ_HQiJf77ccWrM";
let cloudPullTimer = null;
let cloudPushQueue = [];
let cloudPushTimer = null;
const cloudRowIds = new Set(); // ids puxados da nuvem (pra acka depois)

function getCloudToken() {
  try {
    const cfg = getConfig();
    if (!cfg.cloud_sync_enabled) return "";
    return String(cfg.cloud_token || "").trim();
  } catch { return ""; }
}
async function cloudFetch(path, init = {}) {
  const token = getCloudToken();
  if (!token) return null;
  const url = CLOUD_FN_URL + (path || "");
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        "content-type": "application/json",
        "apikey": SUPABASE_ANON,
        "authorization": `Bearer ${SUPABASE_ANON}`,
        "x-webhook-token": token,
        ...(init.headers || {}),
      },
    });
    const text = await res.text();
    let data = null; try { data = JSON.parse(text); } catch {}
    if (!res.ok) { console.error("[wa] cloud", path, res.status, text.slice(0, 200)); return null; }
    return data;
  } catch (e) {
    console.error("[wa] cloud fetch error", path, e.message);
    return null;
  }
}
function queuePushMessage(row) {
  if (!getCloudToken()) return;
  cloudPushQueue.push({
    autor: row.autor || "",
    telefone: row.telefone || "",
    grupo: row.grupo || "",
    mensagem: row.mensagem || "",
    matched: row.matched || [],
    source_msg_id: row.source_msg_id || "",
    source_chat_id: row.source_chat_id || "",
    source_author_id: row.source_author_id || "",
    created_at: row.created_at || new Date().toISOString(),
  });
  if (cloudPushTimer) return;
  cloudPushTimer = setTimeout(async () => {
    cloudPushTimer = null;
    const batch = cloudPushQueue.splice(0, cloudPushQueue.length);
    if (!batch.length) return;
    const r = await cloudFetch("?op=push-messages", { method: "POST", body: JSON.stringify({ op: "push-messages", messages: batch }) });
    if (r?.ok) console.log("[wa] cloud push", batch.length, "msg(s)");
  }, 150);
}
async function pullCloudOutboxOnce() {
  if (!getCloudToken()) return;
  if (!waClient || waState.status !== "connected") return;
  const r = await cloudFetch("?op=pull-outbox", { method: "GET" });
  if (!r?.ok) return;
  const msgs = Array.isArray(r.messages) ? r.messages : [];
  if (!msgs.length) return;
  let added = 0;
  for (const m of msgs) {
    if (!m?.id) continue;
    const exists = db.exec({ table: "wa_outbox", action: "select", filters: [{ col: "id", op: "eq", val: m.id }] });
    if (exists.length) { cloudRowIds.add(m.id); continue; }
    db.exec({
      table: "wa_outbox", action: "insert", single: true,
      payload: {
        id: m.id,
        user_id: USER_ID,
        chat_id: m.chat_id || "",
        quoted_msg_id: m.quoted_msg_id || "",
        text: m.text || "",
        image_url: m.image_url || "",
        status: "pending",
        error: "",
        created_at: new Date().toISOString(),
      },
    });
    cloudRowIds.add(m.id);
    added++;
  }
  if (added) console.log("[wa] cloud pull", added, "nova(s) pra enviar");
}
async function ackCloud(id, ok, error) {
  if (!cloudRowIds.has(id)) return;
  cloudRowIds.delete(id);
  await cloudFetch("?op=ack-outbox", {
    method: "POST",
    body: JSON.stringify({ op: "ack-outbox", id, ok, error: error || "" }),
  });
}
// ============ /Cloud sync ============


// Números/IDs bloqueados (bots etc) — inclui telefone e aliases internos (LID/@c.us)
const BLOCKED_NUMBERS = new Set([
  "558195284554",
  "183619180089396",
]);
function getSenderCandidates(msg, contact) {
  return [
    msg?.author || "",
    msg?.from || "",
    msg?.to || "",
    contact?.id?._serialized || "",
    contact?.id?.user || "",
    contact?.number || "",
  ].filter(Boolean);
}
function getSenderDigitTokens(raw) {
  const text = String(raw || "");
  const variants = new Set([
    text,
    text.split("@")[0] || "",
    text.split(":")[0] || "",
    text.split("_")[0] || "",
  ]);
  const digits = new Set();
  for (const value of variants) {
    const onlyDigits = String(value || "").replace(/\D/g, "");
    if (onlyDigits) digits.add(onlyDigits);
  }
  return [...digits];
}
function isBlockedSender(msg, contact) {
  // Considera só candidatos que representam DE FATO o remetente da mensagem
  // (nunca o chat/grupo — senão o próprio id do grupo cai como "bloqueado").
  const senderRaws = [
    msg?.author || "",              // em grupos, quem enviou
    contact?.id?._serialized || "", // ex: 55XXXXXXXXX@c.us
    contact?.id?.user || "",        // ex: 55XXXXXXXXX
    contact?.number || "",
  ].filter(Boolean);
  for (const raw of senderRaws) {
    for (const digits of getSenderDigitTokens(raw)) {
      if (!digits || digits.length < 10) continue; // ignora fragmentos curtos
      for (const blocked of BLOCKED_NUMBERS) {
        if (digits === blocked) return true;
        // só o REMETENTE pode terminar com o bloqueado (número com/sem DDI/DDD),
        // nunca o bloqueado terminar com o remetente (isso causava falso positivo).
        if (blocked.length >= 10 && digits.endsWith(blocked)) return true;
      }
    }
  }
  return false;
}

let waClient = null;
let waState = { status: "disconnected", qr: null, info: null, progress: "" };
let dataDir;
let db;
let sendStateFn = null;
let outboxTimer = null;
let healthTimer = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let lastOnNewMessage = null;
let lastOnRawMessage = null;
let lastOnRawReaction = null;
function setRawListener(cb) { lastOnRawMessage = cb || null; }
function setRawReactionListener(cb) { lastOnRawReaction = cb || null; }
// Toggle da UI ("Chat ao vivo no Monitor"). Quando desativado, pulamos o
// downloadMedia pesado no raw feed — o cliente pode baixar a mídia sob demanda.
let liveChatEnabled = true;
function setLiveChatEnabled(v) { liveChatEnabled = !!v; }
let restarting = false;

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

function normalizeChatId(chatId) {
  if (!chatId) return "";
  if (typeof chatId === "string") return chatId.trim();
  if (typeof chatId === "object") {
    const serialized = String(chatId._serialized || "").trim();
    if (serialized) return serialized;
    const user = String(chatId.user || "").trim();
    const server = String(chatId.server || "").trim();
    if (user && server) return `${user}@${server}`;
  }
  return "";
}

function isLidId(chatId) {
  return normalizeChatId(chatId).toLowerCase().endsWith("@lid");
}

function getMessageSourceId(msg) {
  const direct = normalizeChatId(msg?.id?._serialized || msg?._data?.id?._serialized);
  if (direct) return direct;
  const rawId = String(msg?.id?.id || msg?._data?.id?.id || "").trim();
  const remote = normalizeChatId(msg?.id?.remote || msg?._data?.id?.remote || msg?._data?.chatId);
  if (!rawId) return "";
  if (!remote) return rawId;
  const fromMe = !!msg?.fromMe;
  if (!fromMe && remote.endsWith("@g.us")) {
    const participant = normalizeChatId(
      msg?.id?.participant || msg?._data?.id?.participant
      || msg?.author || msg?._data?.author
    );
    // Mensagens de terceiros em grupos usam o participante como quarto campo.
    // Sem ele o ID parece válido, mas não pode ser recuperado para reply.
    if (participant) return `false_${remote}_${rawId}_${participant}`;
  }
  return `${fromMe ? "true" : "false"}_${remote}_${rawId}`;
}

async function resolveQuotedMessageId(requestedId, chatId) {
  const requested = String(requestedId || "").trim();
  const expectedChat = normalizeChatId(chatId);
  const page = waClient?.pupPage;
  if (!requested || !page || page.isClosed?.()) return { id: "", crossChat: false };
  try {
    return await page.evaluate(async ({ requested, expectedChat }) => {
      const collections = window.require?.("WAWebCollections");
      const messages = collections?.Msg;
      if (!messages) return { id: "", crossChat: false };
      const serialize = (value) => value?._serialized
        || (value?.user && value?.server ? `${value.user}@${value.server}` : String(value || ""));
      const serializedId = (model) => serialize(model?.id);
      const chatOf = (model) => serialize(model?.id?.remote || model?.chat?.id || model?.from || model?.to);
      const belongsToChat = (model) => !expectedChat || chatOf(model) === expectedChat;

      let found = messages.get?.(requested) || null;
      if (!found) {
        try {
          found = (await messages.getMessagesById?.([requested]))?.messages?.[0] || null;
        } catch {}
      }
      if (found) {
        const sid = serializedId(found) || requested;
        if (belongsToChat(found)) return { id: sid, crossChat: false };
        // "Responder em particular": mantém o id — Store.Msg é global e o
        // WhatsApp Web aceita citação cross-chat quando destino é privado.
        return { id: sid, crossChat: true, foundChat: chatOf(found) };
      }

      const parts = requested.split("_");
      const stanzaCandidates = new Set([requested]);
      if (parts.length >= 3) stanzaCandidates.add(parts[2]);
      const models = messages.getModelsArray?.() || messages.models || [];
      const arr = Array.from(models);
      const matcher = (model) => {
        const stanza = String(model?.id?.id || "");
        const full = serializedId(model);
        return stanzaCandidates.has(stanza) || full === requested;
      };
      found = arr.find((m) => belongsToChat(m) && matcher(m));
      if (found) return { id: serializedId(found), crossChat: false };
      const anywhere = arr.find(matcher);
      if (anywhere) return { id: serializedId(anywhere) || requested, crossChat: true, foundChat: chatOf(anywhere) };
      return { id: "", crossChat: false };
    }, { requested, expectedChat });
  } catch (e) {
    debugLog("send: resolução da citação falhou", { requested, chatId: expectedChat, error: String(e?.message || e) });
    return { id: "", crossChat: false };
  }
}

// O WA Web diferencia uma resposta comum de "responder em particular" no
// canReplyMsg. Em algumas versões recentes ele retorna false quando a mensagem
// está no grupo e o destino é o privado; o whatsapp-web.js então envia o texto
// normalmente, porém remove silenciosamente o contexto da citação. Durante
// esse envio específico liberamos somente a mensagem original já resolvida.
async function setPrivateReplyCapability(messageId, enabled) {
  const page = waClient?.pupPage;
  const targetId = String(messageId || "").trim();
  if (!page || page.isClosed?.() || !targetId) return false;
  try {
    return await page.evaluate(({ targetId, enabled }) => {
      const key = "__rollsPrivateReplyOverride";
      const req = window.require;
      if (!req) return false;
      const replyUtils = req("WAWebMsgReply");
      if (!replyUtils?.canReplyMsg) return false;

      if (!enabled) {
        const state = window[key];
        if (state?.original) replyUtils.canReplyMsg = state.original;
        delete window[key];
        return true;
      }

      // Sempre restaura uma eventual instalação anterior antes de trocar o alvo.
      const previous = window[key];
      if (previous?.original) replyUtils.canReplyMsg = previous.original;
      const original = replyUtils.canReplyMsg;
      const serialize = (value) => value?._serialized
        || (value?.user && value?.server ? `${value.user}@${value.server}` : String(value || ""));
      replyUtils.canReplyMsg = function rollsCanReplyPrivately(model) {
        const id = serialize(model?.id || model?.get?.("id"));
        if (id === targetId) return true;
        return original.apply(this, arguments);
      };
      window[key] = { original, targetId };
      return true;
    }, { targetId, enabled });
  } catch (e) {
    debugLog("send: override de resposta privada falhou", { targetId, enabled, error: String(e?.message || e) });
    return false;
  }
}

function getMessageChatCandidates(msg) {
  const values = msg?.fromMe
    ? [msg?.to, msg?._data?.to, msg?.id?.remote, msg?._data?.id?.remote, msg?._data?.chatId]
    : [msg?.from, msg?._data?.from, msg?.id?.remote, msg?._data?.id?.remote, msg?._data?.chatId];
  // @lid identifica uma pessoa/dispositivo, não o grupo. Em eventos recentes
  // ele pode aparecer em remote/from e não deve ser consultado como Chat.
  return [...new Set(values.map(normalizeChatId).filter(Boolean))]
    .filter((chatId) => !isLidId(chatId));
}

// Algumas versões recentes do WhatsApp Web entregam a mensagem antes de o
// whatsapp-web.js conseguir desserializar o Chat. Mantemos os chats conhecidos
// em cache e, se necessário, lemos os campos básicos direto do Store.
const resolvedChatCache = new Map();
let chatCacheRefreshPromise = null;
let lastChatCacheRefreshAt = 0;

function rememberResolvedChat(chat) {
  const id = normalizeChatId(chat?.id);
  if (id) {
    const previous = resolvedChatCache.get(id);
    // Nunca deixa um fallback sem nome apagar um Chat completo. Esse cache
    // "vazio" fazia todas as mensagens seguintes do grupo falharem no filtro.
    if (!previous || String(chat?.name || "").trim() || !String(previous?.name || "").trim()) {
      resolvedChatCache.set(id, chat);
    }
  }
  return chat || null;
}

function resolveChatFromLocalHistory(chatIds) {
  if (!db) return null;
  for (const chatId of chatIds) {
    if (!String(chatId).endsWith("@g.us")) continue;
    for (const table of ["wa_live_messages", "wa_messages"]) {
      try {
        const rows = db.exec({
          table,
          action: "select",
          filters: [{ col: "source_chat_id", op: "eq", val: chatId }],
          limit: 20,
        });
        const row = rows.find((item) => String(item?.grupo || "").trim());
        if (row) {
          return rememberResolvedChat({
            id: { _serialized: chatId },
            name: String(row.grupo).trim(),
            isGroup: true,
            isLocalHistory: true,
          });
        }
      } catch {}
    }
  }
  return null;
}

async function resolveBasicChatFromStore(chatId, sourceMsgId = "") {
  const id = normalizeChatId(chatId);
  const page = waClient?.pupPage;
  if (!id || !page || page.isClosed?.()) return null;
  try {
    const basic = await page.evaluate(({ remoteId, messageId }) => {
      const serializeId = (value) => value?._serialized
        || (value?.user && value?.server ? `${value.user}@${value.server}` : String(value || ""));
      let collections = null;
      let widFactory = null;
      try { collections = window.require?.("WAWebCollections"); } catch {}
      try { widFactory = window.require?.("WAWebWidFactory"); } catch {}
      const store = window.Store || collections || {};
      const chats = collections?.Chat || store?.Chat;
      const messages = collections?.Msg || store?.Msg;
      let wid = remoteId;
      try { wid = widFactory?.createWid?.(remoteId) || remoteId; } catch {}
      let chat = chats?.get?.(wid) || chats?.get?.(remoteId);

      // O modelo cru da mensagem frequentemente já aponta para o Chat mesmo
      // quando WWebJS.getChat/getChats quebram durante a serialização.
      if (!chat && messageId) {
        const rawMsg = messages?.get?.(messageId);
        chat = rawMsg?.chat || rawMsg?.getChat?.();
        if (!chat) {
          const msgRemote = serializeId(rawMsg?.id?.remote || rawMsg?.from);
          if (msgRemote) {
            let msgWid = msgRemote;
            try { msgWid = widFactory?.createWid?.(msgRemote) || msgRemote; } catch {}
            chat = chats?.get?.(msgWid) || chats?.get?.(msgRemote);
          }
        }
      }
      if (!chat) {
        const models = chats?.getModelsArray?.() || chats?.models || [];
        chat = Array.from(models).find((item) => serializeId(item?.id) === remoteId);
      }
      if (!chat) return null;
      const serialized = serializeId(chat?.id) || remoteId;
      return {
        id: { _serialized: serialized },
        name: chat.name || chat.formattedTitle || chat.subject || chat.contact?.pushname || chat.contact?.name || "",
        isGroup: chat.isGroup === true || String(serialized).endsWith("@g.us"),
      };
    }, { remoteId: id, messageId: String(sourceMsgId || "") });
    return basic ? rememberResolvedChat(basic) : null;
  } catch (e) {
    debugLog("chat store: falhou", { chatId: id, error: String(e?.message || e) });
    return null;
  }
}

async function warmResolvedChatCache() {
  if (!waClient) return;
  // Marca a tentativa, não apenas o sucesso. Assim uma falha do Store não gera
  // várias varreduras simultâneas para cada mensagem recebida na mesma rajada.
  lastChatCacheRefreshAt = Date.now();
  try {
    const page = waClient.pupPage;
    if (!page || page.isClosed?.()) return;
    // Não usa Client.getChats(): ele serializa modelos completos e, em algumas
    // builds do WhatsApp Web, lança apenas o erro minificado "r". Copiamos só
    // ID/nome/tipo, que é tudo que o monitor precisa para aplicar os filtros.
    const chats = await page.evaluate(() => {
      let collections = null;
      try { collections = window.require?.("WAWebCollections"); } catch {}
      const chatCollection = collections?.Chat || window.Store?.Chat;
      const models = chatCollection?.getModelsArray?.() || chatCollection?.models || [];
      return Array.from(models).map((chat) => {
        const id = chat?.id?._serialized
          || (chat?.id?.user && chat?.id?.server ? `${chat.id.user}@${chat.id.server}` : "");
        return {
          id: { _serialized: id },
          name: chat.name || chat.formattedTitle || chat.subject || chat.contact?.pushname || chat.contact?.name || "",
          isGroup: chat.isGroup === true || String(id).endsWith("@g.us"),
        };
      }).filter((chat) => chat.id._serialized);
    });
    for (const chat of chats) rememberResolvedChat(chat);
    debugLog("chat cache: carregado", { count: chats.length });
  } catch (e) {
    debugLog("chat cache: falhou", { error: String(e?.message || e) });
  }
}

async function refreshResolvedChatCache() {
  if (chatCacheRefreshPromise) return chatCacheRefreshPromise;
  // Evita disparar getChats para cada mensagem de uma rajada. Uma atualização
  // recente já é suficiente; o Store ainda será consultado individualmente.
  if (Date.now() - lastChatCacheRefreshAt < 2000) return;
  chatCacheRefreshPromise = warmResolvedChatCache().finally(() => {
    chatCacheRefreshPromise = null;
  });
  return chatCacheRefreshPromise;
}

async function resolveMessageChat(msg) {
  if (!waClient) return null;
  const candidates = getMessageChatCandidates(msg);
  if (!candidates.length) return null;
  // Primeiro usa o nome já salvo localmente. Isso mantém o monitor funcionando
  // mesmo durante falhas transitórias do JavaScript interno do WhatsApp Web.
  const localChat = resolveChatFromLocalHistory(candidates);
  if (localChat) return localChat;
  // Caminho principal: cache simples e Store cru. Eles não serializam metadata
  // dos participantes e portanto não passam pela conversão LID que lança "r".
  for (const chatId of candidates) {
    const cached = resolvedChatCache.get(chatId);
    if (String(cached?.name || "").trim()) return cached;
    const basic = await resolveBasicChatFromStore(chatId, getMessageSourceId(msg));
    if (String(basic?.name || "").trim()) return basic;
  }
  // APIs públicas ficam apenas como fallback: nesta versão da biblioteca elas
  // podem lançar "r" ao serializar participantes @lid de qualquer grupo.
  try {
    const chat = await msg?.getChat?.();
    if (String(chat?.name || "").trim()) return rememberResolvedChat(chat);
  } catch {}
  for (const chatId of candidates) {
    try {
      const chat = await waClient.getChatById(chatId);
      if (String(chat?.name || "").trim()) return rememberResolvedChat(chat);
    } catch {}
  }
  // getChat/getChatById podem falhar enquanto a mensagem já chegou. Recarrega
  // a lista local de chats e procura pelo ID antes de criar o fallback vazio.
  await refreshResolvedChatCache().catch(() => {});
  for (const chatId of candidates) {
    const cached = resolvedChatCache.get(chatId);
    if (String(cached?.name || "").trim()) return cached;
  }
  // Último fallback: só retorna grupo quando o payload contém o nome. Um objeto
  // com nome vazio nunca pode entrar no cache nem ser comparado aos filtros.
  const groupId = candidates.find((chatId) => chatId.endsWith("@g.us"));
  const eventName = String(
    msg?._data?.chatName
    || msg?._data?.formattedTitle
    || msg?._data?.chat?.name
    || msg?._data?.chat?.formattedTitle
    || msg?._data?.groupMetadata?.subject
    || ""
  ).trim();
  if (groupId && eventName) {
    return {
      id: { _serialized: groupId },
      isGroup: true,
      name: eventName,
      isFallback: true,
    };
  }
  return null;
}

function isPrivateChatId(chatId) {
  const value = normalizeChatId(chatId);
  return !!value && !value.endsWith("@g.us");
}

function getDigitVariants(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return [];
  const out = new Set([digits]);
  if (digits.length > 11 && digits.startsWith("55")) out.add(digits.slice(2));
  if (digits.length === 11) out.add(`55${digits}`);
  return [...out].filter(Boolean);
}

async function tryResolveChatId(candidate) {
  const raw = normalizeChatId(candidate);
  if (!raw || !waClient) return "";
  try {
    const chat = await waClient.getChatById(raw);
    return chat?.id?._serialized || "";
  } catch {
    return "";
  }
}

async function tryResolveNumberId(candidate) {
  if (!waClient) return "";
  for (const digits of getDigitVariants(candidate)) {
    try {
      const contact = await waClient.getNumberId(digits);
      const resolved = contact?._serialized || "";
      if (resolved) return resolved;
    } catch {}

    for (const suffix of ["@c.us", "@s.whatsapp.net"]) {
      const resolved = await tryResolveChatId(`${digits}${suffix}`);
      if (resolved) return resolved;
    }
  }
  return "";
}

async function resolveSendChatId(chatId, extra = {}) {
  const raw = normalizeChatId(chatId);
  const fallbackPhone = normalizeChatId(extra.fallbackPhone || "");
  const altChatIds = Array.isArray(extra.altChatIds)
    ? extra.altChatIds.map((value) => normalizeChatId(value)).filter(Boolean)
    : [];
  const candidates = [raw, ...altChatIds, fallbackPhone].filter(Boolean);

  if (!waClient) return raw || altChatIds[0] || fallbackPhone;

  for (const candidate of candidates) {
    if (!candidate) continue;

    if (!isPrivateChatId(candidate)) {
      const resolvedGroup = await tryResolveChatId(candidate);
      return resolvedGroup || candidate;
    }

    const resolvedChat = await tryResolveChatId(candidate);
    if (resolvedChat) {
      if (resolvedChat !== candidate) {
        debugLog("send: destino privado resolvido por chatId", { from: candidate, to: resolvedChat });
      }
      return resolvedChat;
    }

    const resolvedNumber = await tryResolveNumberId(candidate);
    if (resolvedNumber) {
      debugLog("send: destino privado resolvido por número", { from: candidate, to: resolvedNumber });
      return resolvedNumber;
    }
  }

  if (raw) return raw;
  throw new Error("destino privado não resolvido");
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
// Mapeia palavras/expressões em português pra valores numéricos.
// Reconhece: "mil", "2 mil", "dois mil", "cem", "duzentos", "quinhentos",
// "1 conto", "5 contos", "10 pila", etc.
const NUM_UNITS = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, três: 3, quatro: 4, cinco: 5,
  seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12,
  treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16,
  dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30,
  quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90,
};
const NUM_HUNDREDS = {
  cem: 100, cento: 100, duzentos: 200, trezentos: 300, quatrocentos: 400,
  quinhentos: 500, seiscentos: 600, setecentos: 700, oitocentos: 800, novecentos: 900,
};
function extractWrittenAmounts(body) {
  const out = [];
  const text = " " + String(body || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") + " ";
  // "<n> mil" / "<n> contos" / "<n> pila"
  const multRe = /(?:^|[^\p{L}\p{N}_])(\d+(?:[.,]\d+)?|[a-z]+)\s*(mil|milhao|milhoes|conto|contos|pila|pilas)(?![\p{L}\p{N}_])/giu;
  let m;
  while ((m = multRe.exec(text))) {
    const raw = m[1]; const unit = m[2];
    let n = parseFloat(raw.replace(",", "."));
    if (!isFinite(n)) n = NUM_UNITS[raw] ?? NUM_HUNDREDS[raw];
    if (!isFinite(n)) continue;
    let mult = 1;
    if (unit === "mil") mult = 1000;
    else if (unit === "milhao" || unit === "milhoes") mult = 1000000;
    else if (unit.startsWith("conto") || unit.startsWith("pila")) mult = 1000;
    out.push(String(Math.round(n * mult)));
  }
  // "mil" sozinho => 1000
  if (/(?:^|[^\p{L}\p{N}_])mil(?![\p{L}\p{N}_])/iu.test(text)) out.push("1000");
  // centenas isoladas: "quinhentos", "duzentos"...
  for (const [w, v] of Object.entries(NUM_HUNDREDS)) {
    const re = new RegExp(`(?:^|[^\\p{L}\\p{N}_])${w}(?![\\p{L}\\p{N}_])`, "iu");
    if (re.test(text)) out.push(String(v));
  }
  return out;
}

function extractUrlHostLabels(body) {
  // Retorna o primeiro rótulo do host de cada URL/domínio encontrado no texto.
  // Ex.: "https://okokteam1.com/?id=1" -> "okokteam1"
  //      "okoklucky.com"               -> "okoklucky"
  const out = [];
  const s = String(body || "");
  const urlRe = /\b(?:https?:\/\/|www\.)?([\w-]+)(?:\.[\w-]+)+(?:\/[^\s]*)?/gi;
  let m;
  while ((m = urlRe.exec(s))) {
    const first = String(m[1] || "").toLowerCase();
    if (first) out.push(first);
  }
  return out;
}

function matchKeyword(body, k) {
  if (/^\d+$/.test(k)) {
    const clean = stripUrls(body);
    const re = /\d+(?:[.,]\d+)?\s*[kK](?![\p{L}\p{N}_])|\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?/gu;
    const nums = clean.match(re) || [];
    if (nums.some((n) => normalizeAmount(n) === k)) return true;
    // Fallback: valores escritos por extenso ("mil", "quinhentos", "2 contos"...)
    const written = extractWrittenAmounts(body);
    return written.includes(k);
  }
  const re = new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escapeRegex(k)}(?=$|[^\\p{L}\\p{N}_])`, "iu");
  if (re.test(body)) return true;
  // Fallback: casa a keyword como prefixo do primeiro rótulo do host de qualquer URL/domínio
  // no corpo. Ex.: keyword "okok" bate em "okokteam1.com", "okokgold.net", etc.
  const kLower = String(k).toLowerCase();
  if (kLower.length >= 2) {
    const labels = extractUrlHostLabels(body);
    for (const label of labels) {
      if (label.startsWith(kLower)) return true;
    }
  }
  return false;
}


// ==== Cache de config/keywords (evita hit no db.exec a cada mensagem) ====
let _cfgCache = null; let _cfgCacheAt = 0;
let _kwCache = null; let _kwCacheAt = 0;
const CACHE_TTL_MS = 5000;
function invalidateWaCache() { _cfgCache = null; _kwCache = null; }
function getConfig() {
  const now = Date.now();
  if (_cfgCache && (now - _cfgCacheAt) < CACHE_TTL_MS) return _cfgCache;
  const rows = db.exec({ table: "app_settings", action: "select", filters: [{ col: "user_id", op: "eq", val: USER_ID }, { col: "key", op: "eq", val: "wa_listener_config" }] });
  let cfg = { groups: "", keywords_from_table: true };
  try { if (rows[0]?.value) cfg = { ...cfg, ...JSON.parse(rows[0].value) }; } catch {}
  _cfgCache = cfg; _cfgCacheAt = now;
  return cfg;
}
function getKeywordsFromTable() {
  const now = Date.now();
  if (_kwCache && (now - _kwCacheAt) < CACHE_TTL_MS) return _kwCache;
  const rows = db.exec({ table: "wa_keywords", action: "select" });
  const list = rows.map((r) => String(r.palavra || "").trim()).filter(Boolean);
  _kwCache = list; _kwCacheAt = now;
  return list;
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

// ==== debugLog assíncrono (não bloqueia thread; sem IPC broadcast por linha) ====
let _logBuf = []; let _logFlushing = false;
function _flushLogSoon() {
  if (_logFlushing) return;
  _logFlushing = true;
  setImmediate(() => {
    const chunk = _logBuf.join(""); _logBuf = [];
    try {
      fs.appendFile(path.join(dataDir, "wa-debug.log"), chunk, () => { _logFlushing = false; });
    } catch { _logFlushing = false; }
  });
}
function debugLog(reason, extra) {
  try {
    const line = `[${new Date().toISOString()}] ${reason}` +
      (extra ? ` ${JSON.stringify(extra)}` : "") + "\n";
    _logBuf.push(line);
    if (_logBuf.length > 500) _logBuf.splice(0, _logBuf.length - 500);
    _flushLogSoon();
  } catch {}
  // Broadcast do progress removido daqui — era chamado por linha de log e
  // disparava IPC pra UI a cada evento (custo alto no caminho crítico).
}

const recentHandled = new Set();
function rememberId(id) {
  recentHandled.add(id);
  if (recentHandled.size > 500) {
    const it = recentHandled.values();
    for (let i = 0; i < 100; i++) recentHandled.delete(it.next().value);
  }
}

// ============ Awaiting-proof (comprovante após modelo de PIX) ============
// Chave = `${source_chat_id}|${source_author_id}`; valor = { expiresAt }
const awaitingProof = new Map();
const DEFAULT_PROOF_TTL_MIN = 30;
function getProofTtlMs() {
  try {
    const cfg = getConfig();
    const raw = Number(cfg?.proof_ttl_min);
    const min = isFinite(raw) && raw > 0 ? raw : DEFAULT_PROOF_TTL_MIN;
    return min * 60 * 1000;
  } catch { return DEFAULT_PROOF_TTL_MIN * 60 * 1000; }
}

function sameChat(row, chatId) {
  const expected = String(chatId || "").trim();
  if (!expected) return true;
  const actual = String(row?.source_chat_id || "").trim();
  return !actual || actual === expected;
}

function sourceMatchesQuoted(sourceMsgId, quotedId) {
  const source = String(sourceMsgId || "").trim();
  const quoted = String(quotedId || "").trim();
  if (!source || !quoted) return false;
  if (source === quoted) return true;
  // WhatsApp às vezes entrega só o stanza id do quote, enquanto salvamos o id
  // completo: false_<chat>_<stanza>. Por isso precisa casar por sufixo também.
  return source.endsWith(`_${quoted}`) || source.includes(quoted);
}

function findOriginalMessageByQuote(quotedId, chatId = "") {
  const quoted = String(quotedId || "").trim();
  if (!quoted) return null;
  try {
    const exact = db.exec({
      table: "wa_messages", action: "select",
      filters: [{ col: "source_msg_id", op: "eq", val: quoted }],
    }).find((row) => sameChat(row, chatId));
    if (exact) return exact;

    const rows = db.exec({ table: "wa_messages", action: "select", limit: 2000 });
    return rows.find((row) => sameChat(row, chatId) && sourceMatchesQuoted(row.source_msg_id, quoted)) || null;
  } catch {
    return null;
  }
}

function markAwaitingProofFromOutbox(row) {
  try {
    const quoted = row?.quoted_msg_id;
    if (!quoted) return;
    const orig = findOriginalMessageByQuote(quoted, row?.chat_id || "");
    const chatId = orig?.source_chat_id || row?.chat_id || "";
    const authorId = orig?.source_author_id || "";
    if (!chatId || !authorId) return;
    const key = `${chatId}|${authorId}`;
    awaitingProof.set(key, {
      expiresAt: Date.now() + getProofTtlMs(),
      origSourceMsgId: orig?.source_msg_id || "",
      origId: orig?.id || "",
    });
    // Marca a mensagem original com pix_sent_at pra UI piscar
    if (orig?.id) {
      try {
        const updated = db.exec({
          table: "wa_messages", action: "update",
          filters: [{ col: "id", op: "eq", val: orig.id }],
          payload: { pix_sent_at: new Date().toISOString() },
        });
        const row = Array.isArray(updated) ? updated[0] : updated;
        try { lastOnNewMessage?.(row || { ...orig, pix_sent_at: new Date().toISOString() }); } catch {}
      } catch (e) { debugLog("awaiting-proof: update orig falhou", { error: String(e?.message || e) }); }
    }
    debugLog("awaiting-proof: marcado", { key, ttl_min: getProofTtlMs()/60000 });
  } catch (e) {
    debugLog("awaiting-proof: erro ao marcar", { error: String(e?.message || e) });
  }
}

function cleanupAwaitingProof() {
  const now = Date.now();
  for (const [k, v] of awaitingProof) {
    if (v.expiresAt <= now) awaitingProof.delete(k);
  }
}

function isProofAttachment(msg) {
  if (!msg?.hasMedia) return false;
  const mime = String(msg?._data?.mimetype || "").toLowerCase();
  if (mime.startsWith("image/")) return true;
  if (mime === "application/pdf") return true;
  const type = String(msg?.type || "").toLowerCase();
  if (type === "image") return true;
  if (type === "document" && mime === "application/pdf") return true;
  return false;
}
// ============ /Awaiting-proof ============

// Baixa mídia com tentativas + fallback via Puppeteer Store. Em builds novas do
// WhatsApp Web o primeiro downloadMedia() costuma vir vazio (mídia ainda não
// decifrada), então tentamos algumas vezes e por fim caímos no Store direto.
async function downloadMediaWithRetry(msg, { attempts = 8, delayMs = 1000 } = {}) {
  const sourceMsgId = getMessageSourceId(msg);
  for (let i = 0; i < attempts; i++) {
    try {
      const media = await msg.downloadMedia();
      if (media?.data) return media;
    } catch (e) {
      debugLog("downloadMedia: tentativa falhou", { i, error: String(e?.message || e) });
    }
    // Tenta refetchar a mensagem — às vezes o objeto local está stale.
    if (i === 1 && sourceMsgId && waClient?.getMessageById) {
      try {
        const fresh = await waClient.getMessageById(sourceMsgId);
        if (fresh) msg = fresh;
      } catch {}
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  // Fallback: replica os módulos internos usados pela própria versão instalada
  // do whatsapp-web.js. `window.Store.DownloadManager` não existe em todas as
  // versões do WhatsApp Web e fazia o fallback anterior retornar vazio.
  try {
    const page = waClient?.pupPage;
    if (page && !page.isClosed?.() && sourceMsgId) {
      const media = await page.evaluate(async (id) => {
        const collections = window.require?.('WAWebCollections');
        const managerModule = window.require?.('WAWebDownloadManager');
        if (!collections?.Msg || !managerModule?.downloadManager) return null;
        const m = collections.Msg.get(id)
          || (await collections.Msg.getMessagesById([id]).catch(() => null))?.messages?.[0];
        if (!m) return null;
        try {
          if (m.mediaData?.mediaStage !== 'RESOLVED' && typeof m.downloadMedia === 'function') {
            await m.downloadMedia({ downloadEvenIfExpensive: true, rmrReason: 1 });
          }
          const mockQpl = { addAnnotations() { return this; }, addPoint() { return this; } };
          const decrypted = await managerModule.downloadManager.downloadAndMaybeDecrypt({
            directPath: m.directPath, encFilehash: m.encFilehash, filehash: m.filehash,
            mediaKey: m.mediaKey, mediaKeyTimestamp: m.mediaKeyTimestamp,
            type: m.type, signal: (new AbortController()).signal,
            downloadQpl: mockQpl,
          });
          const data = window.WWebJS?.arrayBufferToBase64Async
            ? await window.WWebJS.arrayBufferToBase64Async(decrypted)
            : null;
          return data ? { data, mimetype: m.mimetype || "", filename: m.filename || "" } : null;
        } catch { return null; }
      }, sourceMsgId);
      if (media?.data) return media;
    }
  } catch (e) {
    debugLog("downloadMedia: fallback Store falhou", { error: String(e?.message || e) });
  }
  return null;
}


function msgCreatedAtIso(msg) {
  return (msg?.timestamp && Number.isFinite(Number(msg.timestamp)))
    ? new Date(Number(msg.timestamp) * 1000).toISOString()
    : new Date().toISOString();
}

function isConfiguredLiveGroup(chat) {
  if (!chat?.isGroup) return false;
  const cfg = getConfig();
  const filters = parseList(cfg.groups).map((g) => g.toLowerCase());
  if (!filters.length) return true;
  const name = String(chat.name || "").toLowerCase();
  return filters.some((g) => name.includes(g));
}

async function buildLiveRawPayload(msg, chatHint = null, contactHint = null) {
  const sourceMsgId = getMessageSourceId(msg);
  const chat = chatHint || await resolveMessageChat(msg);
  if (!isConfiguredLiveGroup(chat)) return null;
  const contact = contactHint || await msg.getContact().catch(() => null);

  let mediaDataUrl = "";
  let mediaMime = "";
  let mediaFilename = "";
  let mediaKind = "";
  try {
    if (msg.hasMedia && liveChatEnabled) {
      const mime = String(msg?._data?.mimetype || "").toLowerCase();
      const size = Number(msg?._data?.size || 0);
      const isSmall = !size || size <= 6 * 1024 * 1024;
      const wanted = mime.startsWith("image/") || mime.startsWith("video/") ||
        mime.startsWith("audio/") || mime === "application/pdf" ||
        ["ptt", "audio", "image", "video", "sticker", "document"].includes(String(msg.type || "").toLowerCase());
      if (isSmall && wanted) {
        const media = await downloadMediaWithRetry(msg, { attempts: 3, delayMs: 500 }).catch(() => null);
        if (media?.data) {
          mediaMime = media.mimetype || mime || "";
          mediaFilename = media.filename || msg?._data?.filename || "";
          mediaDataUrl = `data:${mediaMime};base64,${media.data}`;
          if (mediaMime.startsWith("image/")) mediaKind = "image";
          else if (mediaMime.startsWith("video/")) mediaKind = "video";
          else if (mediaMime.startsWith("audio/")) mediaKind = "audio";
          else mediaKind = "document";
        }
      }
    } else if (msg.hasMedia) {
      // Chat ao vivo desativado: só registra o tipo, sem baixar bytes.
      const mime = String(msg?._data?.mimetype || "").toLowerCase();
      mediaMime = mime;
      if (mime.startsWith("image/")) mediaKind = "image";
      else if (mime.startsWith("video/")) mediaKind = "video";
      else if (mime.startsWith("audio/")) mediaKind = "audio";
      else mediaKind = "document";
    }
  } catch (e) { debugLog("raw media falhou", { error: String(e?.message || e) }); }

  return {
    id: `raw-${sourceMsgId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`}`,
    autor: msg.fromMe ? "Você" : (contact?.pushname || contact?.name || msg?._data?.notifyName || contact?.number || ""),
    telefone: msg.fromMe ? "" : (contact?.number || ""),
    grupo: chat.name || "",
    grupo_id: chat.id?._serialized || "",
    mensagem: msg.body || "",
    matched: [],
    source_msg_id: sourceMsgId,
    source_chat_id: chat.id?._serialized || "",
    source_author_id: msg.fromMe ? "me" : (contact?.id?._serialized || ""),
    created_at: msgCreatedAtIso(msg),
    from_me: !!msg.fromMe,
    media_data_url: mediaDataUrl,
    media_mime: mediaMime,
    media_filename: mediaFilename,
    media_kind: mediaKind,
    quoted_msg_id: msg?._data?.quotedStanzaID || msg?._data?.quotedMsg?.id?._serialized || "",
    quoted_body: msg?._data?.quotedMsg?.body || "",
  };
}

function persistLiveRawPayload(payload) {
  if (!payload?.grupo) return null;
  try {
    const row = {
      user_id: USER_ID,
      ...payload,
      id: payload.id || `raw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      created_at: payload.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (row.source_msg_id) {
      const existing = db.exec({
        table: "wa_live_messages", action: "select",
        filters: [{ col: "source_msg_id", op: "eq", val: row.source_msg_id }],
        limit: 1,
      });
      if (existing.length) {
        const updated = db.exec({
          table: "wa_live_messages", action: "update",
          filters: [{ col: "id", op: "eq", val: existing[0].id }],
          payload: { ...row, id: existing[0].id, created_at: existing[0].created_at || row.created_at },
        });
        return Array.isArray(updated) ? updated[0] : updated;
      }
    }
    return db.exec({ table: "wa_live_messages", action: "insert", single: true, payload: row });
  } catch (e) {
    debugLog("raw persist falhou", { error: String(e?.message || e) });
    return null;
  }
}

function emitLiveRawPayload(payload) {
  if (!payload) return;
  try { persistLiveRawPayload(payload); } catch {}
  try { lastOnRawMessage?.(payload); } catch {}
}


async function handleMessage(msg, onNewMessage) {
  const t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
  const stepMs = (t) => Math.round(((typeof performance !== "undefined" ? performance.now() : Date.now()) - t) * 100) / 100;

  // Usa o timestamp real da mensagem do WhatsApp (segundos) quando disponível,
  // pra que backfill (e mesmo tempo-real) grave created_at correto e a lista
  // fique ordenada pelo horário verdadeiro.
  const msgCreatedAt = msgCreatedAtIso(msg);

  const sourceMsgId = getMessageSourceId(msg);
  if (sourceMsgId && recentHandled.has(sourceMsgId)) return;
  if (sourceMsgId) rememberId(sourceMsgId);

  const cfg = getConfig();
  const groups = parseList(cfg.groups).map((g) => g.toLowerCase());
  const keywords = getKeywordsFromTable();
  const tAfterCache = stepMs(t0);

  debugLog("msg recebida", { id: sourceMsgId, body: (msg.body || "").slice(0, 80), keywordsCount: keywords.length, fromMe: !!msg.fromMe, t_cache_ms: tAfterCache });

  // ==== Raw feed p/ Chat ao vivo (sem filtro de keyword) ====
  // Persiste e emite todas as mensagens dos grupos monitorados, sem depender de keyword.
  let rawChat = null;
  let rawContact = null;
  try {
    rawChat = await resolveMessageChat(msg);
    rawContact = await msg.getContact().catch(() => null);
    emitLiveRawPayload(await buildLiveRawPayload(msg, rawChat, rawContact));
  } catch (e) { debugLog("raw emit falhou", { error: String(e?.message || e) }); }

  if (msg.fromMe) {
    // Detecta se ESTA mensagem do próprio número é uma resposta com modelo de
    // PIX a uma mensagem já monitorada (feed). Nesse caso, marca a mensagem
    // original com pix_sent_at pra UI piscar (mesmo quando o envio é manual,
    // fora do outbox/send-now).
    try {
      const body = msg.body || "";
      if (isPixModel(body)) {
        const quotedId = msg?._data?.quotedStanzaID
          || msg?._data?.quotedMsg?.id?._serialized
          || "";
        if (quotedId) {
          const chatIdHint = msg?.to || msg?.from || msg?._data?.chatId?._serialized || "";
          const orig = findOriginalMessageByQuote(quotedId, chatIdHint);
          if (orig?.id) {
            const updated = db.exec({
              table: "wa_messages", action: "update",
              filters: [{ col: "id", op: "eq", val: orig.id }],
              payload: { pix_sent_at: new Date().toISOString() },
            });
            const row = Array.isArray(updated) ? updated[0] : updated;
            try { onNewMessage?.(row || { ...orig, pix_sent_at: new Date().toISOString() }); } catch {}
            // Também arma o awaiting-proof pro comprovante do cliente
            const chatId = orig.source_chat_id || "";
            const authorId = orig.source_author_id || "";
            if (chatId && authorId) {
              awaitingProof.set(`${chatId}|${authorId}`, {
                expiresAt: Date.now() + getProofTtlMs(),
                origSourceMsgId: orig.source_msg_id || "",
                origId: orig.id || "",
              });
              debugLog("awaiting-proof: marcado via fromMe manual", { key: `${chatId}|${authorId}` });
            }
          }
        }
      }
    } catch (e) { debugLog("fromMe pix detect falhou", { error: String(e?.message || e) }); }
    debugLog("drop: mensagem do próprio número", { id: sourceMsgId });
    return;
  }

  if (keywords.length === 0) { debugLog("drop: nenhuma palavra-chave carregada"); return; }

  // Roda getChat + getContact em paralelo (antes eram sequenciais — cada uma
  // é um round-trip Puppeteer, então serializar somava latência sem ganho).
  const tRt = (typeof performance !== "undefined" ? performance.now() : Date.now());
  const [chat, earlyContact] = await Promise.all([
    rawChat ? Promise.resolve(rawChat) : resolveMessageChat(msg),
    msg.getContact().catch(() => null),
  ]);
  const tRoundtripMs = stepMs(tRt);

  if (!chat) {
    debugLog("drop: chat não resolvido", {
      t_rt_ms: tRoundtripMs,
      candidates: getMessageChatCandidates(msg),
      has_id: !!msg?.id,
      has_raw_id: !!msg?._data?.id,
    });
    return;
  }
  if (!chat.isGroup) { debugLog("drop: não é grupo", { chat: chat.name, t_rt_ms: tRoundtripMs }); return; }

  const groupName = (chat.name || "").toLowerCase();
  if (groups.length && !groups.some((g) => groupName.includes(g))) {
    debugLog("drop: grupo não bate filtro", { grupo: groupName, filtros: groups });
    return;
  }

  // Bloqueio por número (bots) — ignora mensagem do remetente bloqueado
  if (isBlockedSender(msg, earlyContact)) {
    debugLog("drop: remetente bloqueado", {
      author: msg.author,
      from: msg.from,
      contactId: earlyContact?.id?._serialized || "",
      contactNumber: earlyContact?.number || "",
      senderCandidates: getSenderCandidates(msg, earlyContact).map((value) => ({ raw: value, digits: getSenderDigitTokens(value) })),
    });
    return;
  }

  // ==== Gatilho: comprovante após modelo de PIX ====
  // Só notifica anexo (imagem/PDF) se estivermos aguardando prova daquele autor
  // naquele chat específico. A marca é feita quando enviamos o modelo de PIX
  // (via outbox OU via send-now direto) — ver markAwaitingProofFromOutbox e sendNow.
  cleanupAwaitingProof();
  const earlyChatId = chat.id?._serialized || "";
  const earlyAuthorId = earlyContact?.id?._serialized || "";
  const proofKey = earlyChatId && earlyAuthorId ? `${earlyChatId}|${earlyAuthorId}` : "";
  const proofEntry = proofKey ? awaitingProof.get(proofKey) : null;
  if (proofEntry && proofEntry.expiresAt > Date.now() && isProofAttachment(msg)) {
    awaitingProof.delete(proofKey);
    const dupCheck = db.exec({
      table: "wa_messages", action: "select",
      filters: [{ col: "user_id", op: "eq", val: USER_ID }, { col: "source_msg_id", op: "eq", val: sourceMsgId }],
    });
    if (!dupCheck.length) {
      const mime = String(msg?._data?.mimetype || "").toLowerCase();
      const label = mime === "application/pdf" ? "PDF" : "imagem";

      // Baixa a mídia pra data URL (pra popup exibir/abrir)
      let mediaDataUrl = "";
      let mediaMime = mime || "";
      let mediaFilename = "";
      try {
        const media = await downloadMediaWithRetry(msg);
        if (media && media.data) {
          mediaMime = media.mimetype || mime || "application/octet-stream";
          mediaFilename = media.filename || `comprovante-${sourceMsgId.slice(-8)}${mediaMime.includes("pdf") ? ".pdf" : ".jpg"}`;
          mediaDataUrl = `data:${mediaMime};base64,${media.data}`;
        } else {
          debugLog("comprovante: mídia vazia após retries", { sourceMsgId });
        }
      } catch (e) {
        debugLog("comprovante: downloadMedia falhou", { error: String(e?.message || e) });
      }


      const insertedProof = db.exec({
        table: "wa_messages", action: "insert", single: true,
        payload: {
          user_id: USER_ID,
          autor: earlyContact?.pushname || earlyContact?.name || msg?._data?.notifyName || earlyContact?.number || "",
          telefone: earlyContact?.number || "",
          grupo: chat.name || "",
          mensagem: `📎 Comprovante (${label})${msg.body ? `: ${msg.body}` : ""}`,
          matched: ["📎 comprovante"],
          source_msg_id: sourceMsgId,
          source_chat_id: earlyChatId,
          source_author_id: earlyAuthorId,
          is_comprovante: true,
          parent_source_msg_id: proofEntry.origSourceMsgId || "",
          media_data_url: mediaDataUrl,
          media_mime: mediaMime,
          media_filename: mediaFilename,
          created_at: msgCreatedAt,
        },
      });

      // Marca a mensagem original com comprovante_at
      if (proofEntry.origId) {
        try {
          const updatedParent = db.exec({
            table: "wa_messages", action: "update",
            filters: [{ col: "id", op: "eq", val: proofEntry.origId }],
            payload: { comprovante_at: new Date().toISOString() },
          });
          const parentRow = Array.isArray(updatedParent) ? updatedParent[0] : updatedParent;
          if (parentRow) { try { lastOnNewMessage?.(parentRow); } catch {} }
        } catch {}
      }

      debugLog("OK: comprovante detectado", { autor: insertedProof?.autor, mime: mediaMime, size: mediaDataUrl.length });
      try { onNewMessage?.(insertedProof); } catch {}
      try { queuePushMessage(insertedProof); } catch (e) { console.error("[wa] queuePushMessage", e.message); }
      // Se a decifragem ainda não estava pronta, mantém o popup aberto e tenta
      // completar a mesma linha depois. O update é reemitido para o renderer.
      if (!mediaDataUrl && insertedProof?.id) {
        // Retry tardio: WhatsApp Web às vezes demora vários segundos para
        // finalizar a decifragem. Tenta em backoff por até ~30s.
        const scheduleLate = async () => {
          for (let attempt = 0; attempt < 6; attempt++) {
            await new Promise((r) => setTimeout(r, 3000 + attempt * 2000));
            try {
              let freshMsg = msg;
              if (sourceMsgId && waClient?.getMessageById) {
                freshMsg = await waClient.getMessageById(sourceMsgId).catch(() => msg) || msg;
              }
              const lateMedia = await downloadMediaWithRetry(freshMsg, { attempts: 3, delayMs: 1500 });
              if (!lateMedia?.data) continue;
              const lateMime = lateMedia.mimetype || mime || "application/octet-stream";
              const lateFilename = lateMedia.filename || `comprovante-${sourceMsgId.slice(-8)}${lateMime.includes("pdf") ? ".pdf" : ".jpg"}`;
              const updated = db.exec({
                table: "wa_messages", action: "update",
                filters: [{ col: "id", op: "eq", val: insertedProof.id }],
                payload: {
                  media_data_url: `data:${lateMime};base64,${lateMedia.data}`,
                  media_mime: lateMime,
                  media_filename: lateFilename,
                },
              });
              const updatedRow = Array.isArray(updated) ? updated[0] : updated;
              if (updatedRow) { try { onNewMessage?.(updatedRow); } catch {} }
              debugLog("comprovante: mídia recuperada no retry tardio", { sourceMsgId, mime: lateMime, attempt });
              return;
            } catch (e) {
              debugLog("comprovante: retry tardio erro", { sourceMsgId, attempt, error: String(e?.message || e) });
            }
          }
          debugLog("comprovante: mídia continuou vazia após retries tardios", { sourceMsgId });
        };
        scheduleLate();
      }
    }
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

  const contact = earlyContact || (await msg.getContact().catch(() => null));

  const existing = db.exec({
    table: "wa_messages", action: "select",
    filters: [{ col: "user_id", op: "eq", val: USER_ID }, { col: "source_msg_id", op: "eq", val: sourceMsgId }],
  });
  if (existing.length) { debugLog("drop: duplicada (db)", { sourceMsgId }); return; }

  const inserted = db.exec({
    table: "wa_messages", action: "insert", single: true,
    payload: {
      user_id: USER_ID,
      autor: contact?.pushname || contact?.name || msg?._data?.notifyName || contact?.number || "",
      telefone: contact?.number || "",
      grupo: chat.name || "",
      mensagem: body,
      matched,
      source_msg_id: sourceMsgId,
      source_chat_id: chat.id?._serialized || "",
      source_author_id: contact?.id?._serialized || "",
      created_at: msgCreatedAt,
    },
  });
  const tTotal = stepMs(t0);
  debugLog("OK: notificando", { autor: inserted?.autor, matched, t_total_ms: tTotal });
  try { onNewMessage?.(inserted); } catch {}
  try { queuePushMessage(inserted); } catch (e) { console.error("[wa] queuePushMessage", e.message); }
  try { await forwardMatchedMessage(msg, body, chat, matched); } catch (e) { debugLog("forward falhou", { error: String(e?.message || e) }); }
}

// ============ Reencaminhamento p/ número configurado ============
function parseForwardNumbers(raw) {
  return String(raw || "")
    .split(/[\s,;\n]+/)
    .map((s) => s.replace(/\D+/g, ""))
    .filter((n) => n.length >= 8)
    .map((n) => `${n}@c.us`);
}
async function forwardMatchedMessage(msg, body, chat, matched) {
  const cfg = getConfig();
  const targets = parseForwardNumbers(cfg?.forward_numbers);
  if (targets.length === 0) return;
  if (!waClient) return;
  const header = `↪️ Encaminhado (${matched.join(", ")})\n👤 ${chat?.name || ""}\n\n`;
  for (const chatId of targets) {
    try {
      if (msg.hasMedia) {
        const media = await msg.downloadMedia().catch(() => null);
        if (media) {
          await waClient.sendMessage(chatId, media, { caption: header + (body || "") });
          continue;
        }
      }
      await waClient.sendMessage(chatId, header + (body || ""));
    } catch (e) {
      debugLog("forward erro", { chatId, error: String(e?.message || e) });
    }
  }
}

// ============ Backfill de mensagens antigas ============
// Percorre grupos (respeitando o filtro cfg.groups), busca as últimas N
// mensagens de cada e passa por handleMessage — o dedup por source_msg_id já
// evita duplicar no db, e o filtro de keyword é o mesmo do fluxo normal.
let backfillRunning = false;
async function backfillHistory({ hours = 24, perChat = 50, onNewMessage } = {}) {
  if (!waClient || waState.status !== "connected") {
    debugLog("backfill: cliente não conectado");
    return { ok: false, error: "not_connected" };
  }
  if (backfillRunning) { debugLog("backfill: já em execução"); return { ok: false, error: "busy" }; }
  backfillRunning = true;
  const cb = onNewMessage || lastOnNewMessage;
  const sinceTs = hours > 0 ? (Date.now() - hours * 3600 * 1000) / 1000 : 0; // whatsapp usa segundos
  const cfg = getConfig();
  const groupFilters = parseList(cfg.groups).map((g) => g.toLowerCase());
  let scanned = 0, processed = 0;
  try {
    const chats = await waClient.getChats();
    const groups = chats.filter((c) => c.isGroup);
    debugLog("backfill: start", { hours, perChat, groups: groups.length, filtros: groupFilters });
    for (const chat of groups) {
      const name = (chat.name || "").toLowerCase();
      if (groupFilters.length && !groupFilters.some((g) => name.includes(g))) continue;
      let msgs = [];
      try { msgs = await chat.fetchMessages({ limit: perChat }); }
      catch (e) { debugLog("backfill: fetchMessages falhou", { chat: chat.name, error: e.message }); continue; }
      for (const msg of msgs) {
        scanned++;
        // Cede o event loop a cada 5 msgs pra não travar IPC (hover/nav) durante backfill.
        if (scanned % 5 === 0) await new Promise((r) => setImmediate(r));
        if (sinceTs && msg.timestamp && msg.timestamp < sinceTs) continue;
        if (msg.fromMe) {
          // Emite no feed raw para o Chat ao vivo, sem rodar pipeline de keyword/pix.
          try { emitLiveRawPayload(await buildLiveRawPayload(msg, chat)); processed++; }
          catch (e) { debugLog("backfill: raw fromMe falhou", { error: e.message }); }
          continue;
        }
        try { await handleMessage(msg, cb); processed++; }
        catch (e) { debugLog("backfill: handleMessage erro", { error: e.message }); }
      }
    }
    debugLog("backfill: fim", { scanned, processed });
    return { ok: true, scanned, processed };
  } catch (e) {
    const error = String(e?.message || e || "erro desconhecido");
    debugLog("backfill: erro geral", {
      error,
      name: String(e?.name || ""),
      stack: String(e?.stack || "").split("\n").slice(0, 4).join(" | "),
    });
    return { ok: false, error };
  } finally {
    backfillRunning = false;
  }
}

async function startWa(onNewMessage) {
  if (onNewMessage) lastOnNewMessage = onNewMessage;
  if (waClient) { log("Já existe cliente"); return; }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  waState = { status: "starting", qr: null, info: null, progress: "Inicializando…" };
  broadcast();
  clearChromeLocks();

  let chromeInfo;
  try {
    chromeInfo = await ensureChrome(path.join(dataDir, "chrome"), (m) => log(m));
  } catch (e) {
    waState = { status: "error", qr: null, info: null, progress: "Falha Chrome: " + e.message };
    broadcast();
    scheduleReconnect("chrome error");
    return;
  }

  waClient = new Client({
    authStrategy: new LocalAuth({ dataPath: path.join(dataDir, "wa-session") }),
    puppeteer: {
      headless: "shell",
      executablePath: chromeInfo.executablePath,
      browserVersion: chromeInfo.buildId,
      cacheDirectory: chromeInfo.cacheDir,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--window-position=-32000,-32000",
        "--window-size=1,1",
      ],
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
  waClient.on("ready", async () => {
    reconnectAttempts = 0;
    waState = { status: "connected", qr: null, info: { wid: waClient.info?.wid?.user, pushname: waClient.info?.pushname }, progress: "Conectado" };
    broadcast();
    recoverStuckSending();
    startOutboxWorker();
    startHealthCheck();
    // Preenche o fallback antes do backfill. Em algumas contas o evento de
    // mensagem chega com getChat()/getChatById temporariamente indisponíveis.
    await warmResolvedChatCache().catch(() => {});
    // === Diagnóstico de conexão: mostra pro usuário se está tudo OK ===
    try {
      const cfg = getConfig();
      const groupFilters = String(cfg.groups || "")
        .split("\n").map((s) => s.trim().toLowerCase()).filter(Boolean);
      const keywords = getKeywordsFromTable();
      const kwDisk = getKeywordsFromDisk();
      // Usa o mesmo cache que resolve as mensagens (Store do Puppeteer),
      // evitando o getChats() do whatsapp-web.js que quebra com IDs @lid.
      await warmResolvedChatCache().catch(() => {});
      const groupChats = Array.from(resolvedChatCache.values()).filter(
        (c) => c?.isGroup && String(c?.name || "").trim()
      );
      const matched = groupChats.filter((c) => {
        const name = String(c?.name || "").toLowerCase();
        return groupFilters.some((f) => name.includes(f));
      });
      const matchedNames = matched.map((c) => c?.name).filter(Boolean);
      const missing = groupFilters.filter(
        (f) => !groupChats.some((c) => String(c?.name || "").toLowerCase().includes(f))
      );
      const diagnostics = {
        connectedAs: waClient.info?.pushname || null,
        keywordsCount: keywords.length,
        keywordsSample: keywords.slice(0, 8),
        keywordsDiskCount: kwDisk.count,
        groupFiltersCount: groupFilters.length,
        groupFilters,
        totalGroupChats: groupChats.length,
        matchedGroupsCount: matched.length,
        matchedGroups: matchedNames,
        unmatchedFilters: missing,
        cloudSyncEnabled: !!cfg.cloud_sync_enabled && !!cfg.cloud_token,
        checkedAt: new Date().toISOString(),
      };
      waState.diagnostics = diagnostics;
      const okKw = keywords.length > 0;
      const okGrp = groupFilters.length === 0 || matched.length > 0;
      const summary =
        `Conectado${diagnostics.connectedAs ? " · " + diagnostics.connectedAs : ""} · ` +
        `${keywords.length} palavras-chave ${okKw ? "OK" : "⚠"} · ` +
        `${matched.length}/${groupFilters.length} grupos mapeados ${okGrp ? "OK" : "⚠"}`;
      waState.progress = summary;
      broadcast();
      console.log("[wa] ready diagnostics:", JSON.stringify(diagnostics, null, 2));
      debugLog("ready: diagnóstico", diagnostics);
      if (!okKw) debugLog("ready: ⚠ sem palavras-chave carregadas");
      if (missing.length) debugLog("ready: ⚠ filtros sem grupo correspondente", { missing });
    } catch (e) {
      debugLog("ready: diagnóstico falhou", { error: String(e?.message || e) });
    }
    // Hook puppeteer browser disconnect
    try {
      const browser = waClient.pupBrowser;
      if (browser && !browser.__waHook) {
        browser.__waHook = true;
        browser.on("disconnected", () => {
          console.warn("[wa] puppeteer browser disconnected — forçando restart");
          handleUnhealthy("browser disconnected");
        });
      }
    } catch {}
    // Backfill automático: recupera mensagens antigas que casem com keyword.
    // Config: backfill_hours (0 desativa, default 24), backfill_per_chat (default 50).
    try {
      const cfg = getConfig();
      const hours = Number.isFinite(Number(cfg.backfill_hours)) ? Number(cfg.backfill_hours) : 24;
      const perChat = Number.isFinite(Number(cfg.backfill_per_chat)) ? Number(cfg.backfill_per_chat) : 50;
      if (hours > 0) {
        setTimeout(() => {
          backfillHistory({ hours, perChat }).catch((e) => debugLog("backfill auto erro", { error: e.message }));
        }, 3000);
      }
    } catch (e) { debugLog("backfill auto skip", { error: e.message }); }
  });
  waClient.on("auth_failure", (m) => log("auth_failure: " + m));
  waClient.on("change_state", (s) => {
    console.log("[wa] change_state:", s);
    // Não derruba o cliente em change_state — WhatsApp Web oscila entre estados
    // transitórios (TIMEOUT, CONFLICT, UNPAIRED) e se recupera sozinho.
    // Só o evento "disconnected" é definitivo.
  });
  waClient.on("disconnected", (r) => {
    waState = { status: "disconnected", qr: null, info: null, progress: "Desconectado: " + r };
    broadcast();
    stopHealthCheck();
    stopOutboxWorker();
    const wasClient = waClient;
    waClient = null;
    try { wasClient?.destroy?.(); } catch {}
    scheduleReconnect("disconnected: " + r);
  });
  waClient.on("message", async (msg) => {
    try { await handleMessage(msg, lastOnNewMessage); } catch (e) { log("msg err: " + e.message); }
  });
  waClient.on("message_reaction", (reaction) => {
    try {
      if (!lastOnRawReaction) return;
      const msgId = reaction?.msgId?._serialized || reaction?.id?._serialized || "";
      const chatId = reaction?.msgId?.remote || reaction?.id?.remote || "";
      if (!msgId) return;
      lastOnRawReaction({
        source_msg_id: msgId,
        source_chat_id: chatId,
        emoji: String(reaction?.reaction || ""),
        sender_id: reaction?.senderId || "",
        timestamp: reaction?.timestamp ? new Date(Number(reaction.timestamp) * 1000).toISOString() : new Date().toISOString(),
      });
    } catch (e) { debugLog("reaction emit falhou", { error: String(e?.message || e) }); }
  });

  waClient.initialize().catch((e) => {
    log("initialize: " + e.message);
    waState = { status: "error", qr: null, info: null, progress: "Erro: " + e.message };
    broadcast();
    waClient = null;
    scheduleReconnect("init error");
  });
}

function scheduleReconnect(reason) {
  if (reconnectTimer) return;
  reconnectAttempts = Math.min(reconnectAttempts + 1, 6);
  const delay = Math.min(30000, 5000 * reconnectAttempts);
  console.warn("[wa] agendando reconexão em", delay, "ms —", reason);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startWa(lastOnNewMessage).catch((e) => console.error("[wa] reconnect", e.message));
  }, delay);
}

async function handleUnhealthy(reason) {
  if (restarting) return;
  restarting = true;
  console.warn("[wa] unhealthy — reiniciando:", reason);
  stopHealthCheck();
  stopOutboxWorker();
  const c = waClient;
  waClient = null;
  waState = { status: "disconnected", qr: null, info: null, progress: "Reiniciando: " + reason };
  broadcast();
  try { await c?.destroy?.(); } catch {}
  restarting = false;
  scheduleReconnect(reason);
}

let healthFailStreak = 0;
const HEALTH_FAIL_THRESHOLD = 3; // só reinicia após 3 checagens ruins seguidas (~3min)
function startHealthCheck() {
  stopHealthCheck();
  healthFailStreak = 0;
  healthTimer = setInterval(async () => {
    if (!waClient || waState.status !== "connected") return;
    const withTimeout = (p, ms, label) => Promise.race([
      Promise.resolve().then(() => p),
      new Promise((_, rej) => setTimeout(() => rej(new Error(label + " timeout")), ms)),
    ]);
    let badReason = null;
    try {
      const st = await withTimeout(waClient.getState(), 10000, "getState");
      // Aceita CONNECTED. Qualquer outro estado conta como falha do ciclo,
      // mas só reinicia após HEALTH_FAIL_THRESHOLD ciclos consecutivos.
      if (st !== "CONNECTED") {
        badReason = "getState=" + st;
      } else {
        const page = waClient.pupPage;
        if (!page || page.isClosed?.()) {
          badReason = "pupPage closed";
        } else {
          const alive = await withTimeout(
            page.evaluate(() => {
              try {
                const s = window.Store && window.Store.Conn && window.Store.Conn.state;
                return s || "no-store";
              } catch (e) { return "evaluate-error"; }
            }),
            10000,
            "pupPage.evaluate",
          );
          // Aceita CONNECTED. "no-store"/"evaluate-error" ocorrem em recargas
          // internas do WhatsApp Web e não são fatais — ignora.
          if (alive !== "CONNECTED" && alive !== "no-store" && alive !== "evaluate-error") {
            badReason = "Conn.state=" + alive;
          }
        }
      }
    } catch (e) {
      badReason = "health err: " + (e?.message || e);
    }
    if (badReason) {
      healthFailStreak++;
      console.warn("[wa] health bad (" + healthFailStreak + "/" + HEALTH_FAIL_THRESHOLD + "):", badReason);
      if (healthFailStreak >= HEALTH_FAIL_THRESHOLD) {
        healthFailStreak = 0;
        await handleUnhealthy(badReason);
      }
    } else {
      if (healthFailStreak > 0) console.log("[wa] health ok — streak resetada");
      healthFailStreak = 0;
    }
  }, 60000); // 60s entre checagens
}
function stopHealthCheck() {
  if (healthTimer) { clearInterval(healthTimer); healthTimer = null; }
  healthFailStreak = 0;
}

function recoverStuckSending() {
  try {
    const all = db.exec({ table: "wa_outbox", action: "select", limit: 500 });
    let n = 0;
    for (const r of all) {
      if (r.status === "sending") {
        db.exec({ table: "wa_outbox", action: "update", filters: [{ col: "id", op: "eq", val: r.id }], payload: { status: "pending", error: "" } });
        n++;
      }
    }
    if (n) console.log("[wa] recuperadas", n, "linha(s) presas em 'sending'");
  } catch (e) { console.error("[wa] recoverStuckSending", e.message); }
}

async function stopWa() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  stopHealthCheck();
  stopOutboxWorker();
  lastOnNewMessage = null;
  if (!waClient) return;
  try { await waClient.destroy(); } catch {}
  waClient = null;
  waState = { status: "disconnected", qr: null, info: null, progress: "Parado" };
  broadcast();
}

async function logoutWa() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  stopHealthCheck();
  stopOutboxWorker();
  lastOnNewMessage = null;
  if (waClient) { try { await waClient.logout(); } catch {} waClient = null; }
  try { fs.rmSync(path.join(dataDir, "wa-session"), { recursive: true, force: true }); } catch {}
  waState = { status: "disconnected", qr: null, info: null, progress: "Sessão removida" };
  broadcast();
}

// ---- Outbox worker ----
async function sendRowNow(row) {
  if (!waClient) throw new Error("WhatsApp não conectado");
  const rawChatId = row.chat_id;
  if (!rawChatId) throw new Error("chat_id vazio");
  const chatId = await resolveSendChatId(rawChatId, {
    fallbackPhone: row.fallback_phone || row.telefone || row.phone || "",
    altChatIds: [row.alt_chat_id || "", row.source_author_id || ""],
  });
  const requestedQuoteId = String(row.quoted_msg_id || "").trim();

  const options = {};
  let privateReplyOverride = false;
  if (requestedQuoteId) {
    const resolved = await resolveQuotedMessageId(requestedQuoteId, chatId);
    if (resolved?.id) {
      // Aceita citação intra-chat E cross-chat (responder em particular:
      // original no grupo, resposta no privado). Store.Msg é global e o
      // WhatsApp Web monta o contextInfo correto a partir do id.
      options.quotedMessageId = resolved.id;
      // Nunca aceite degradação silenciosa para mensagem solta.
      options.ignoreQuoteErrors = false;
      if (resolved.crossChat) {
        privateReplyOverride = await setPrivateReplyCapability(resolved.id, true);
        if (!privateReplyOverride) {
          throw new Error("O WhatsApp não liberou o contexto para responder em particular. A mensagem não foi enviada solta.");
        }
        debugLog("send: reply privately (cross-chat)", {
          chatId, requestedQuoteId, foundChat: resolved.foundChat || "",
        });
      }
    } else {
      debugLog("send: mensagem citada não encontrada no Store", { chatId, requestedQuoteId });
      throw new Error("Não foi possível localizar a mensagem original para responder. O modelo não foi enviado solto.");
    }
  }

  try {
    if (row.image_url) {
      const media = await loadMessageMedia(row.image_url);
      if (row.text) options.caption = row.text;
      return await waClient.sendMessage(chatId, media, options);
    }
    if (!row.text) throw new Error("text vazio");
    return await waClient.sendMessage(chatId, row.text, options);
  } finally {
    if (privateReplyOverride) await setPrivateReplyCapability(options.quotedMessageId, false);
  }
}

async function processOutboxRow(row) {
  return sendRowNow(row);
}

async function pollOutboxOnce() {
  if (!waClient || waState.status !== "connected") {
    try {
      const all = db.exec({ table: "wa_outbox", action: "select", limit: 50 });
      const pending = all.filter((r) => !r.status || r.status === "pending");
      if (pending.length && Date.now() % 60000 < 3500) {
        console.log("[wa] outbox: ", pending.length, "pendente(s), mas WA status=", waState.status);
      }
    } catch {}
    return;
  }
  // Desktop é single-user — o DB local SÓ contém dados desta máquina.
  // Processa TODOS os pendentes locais, independente de user_id, porque tarefas
  // podem ter user_id do FAKE_USER local ("fofuralol-local") OU o UUID real da
  // nuvem (quando criadas via realtime/push) — todas são deste mesmo usuário.
  const all = db.exec({ table: "wa_outbox", action: "select", limit: 200 });
  const pending = all.filter((r) => !r.status || r.status === "pending").slice(0, 5);
  if (pending.length) console.log("[wa] outbox: processando", pending.length, "pendente(s)");
  for (const row of pending) {
    try {
      db.exec({ table: "wa_outbox", action: "update", filters: [{ col: "id", op: "eq", val: row.id }], payload: { status: "sending" } });
      await processOutboxRow(row);
      db.exec({ table: "wa_outbox", action: "update", filters: [{ col: "id", op: "eq", val: row.id }], payload: { status: "sent", sent_at: new Date().toISOString(), error: "" } });
      console.log("[wa] outbox sent", row.chat_id, (row.text || "").slice(0, 60));
      debugLog("outbox: enviado", { id: row.id, chat_id: row.chat_id, hasImage: !!row.image_url });
      try { markAwaitingProofFromOutbox(row); } catch {}
      ackCloud(row.id, true, "").catch(() => {});
    } catch (e) {
      const errMsg = String(e?.message || e || "");
      const sessionDead = /Session closed|Target closed|Execution context|Protocol error|Evaluation failed|disconnected|not connected/i.test(errMsg);
      if (sessionDead) {
        // devolve pra pending, sinaliza unhealthy e para o loop atual
        db.exec({ table: "wa_outbox", action: "update", filters: [{ col: "id", op: "eq", val: row.id }], payload: { status: "pending", error: "" } });
        console.error("[wa] outbox: sessão morta detectada, reiniciando WA:", errMsg);
        debugLog("outbox: sessão morta no envio", { id: row.id, chat_id: row.chat_id, error: errMsg });
        handleUnhealthy("send error: " + errMsg).catch(() => {});
        return;
      }
      db.exec({ table: "wa_outbox", action: "update", filters: [{ col: "id", op: "eq", val: row.id }], payload: { status: "error", error: errMsg } });
      console.error("[wa] outbox error", row.chat_id, errMsg);
      debugLog("outbox: erro", { id: row.id, chat_id: row.chat_id, error: errMsg, quoted_msg_id: row.quoted_msg_id || "", hasImage: !!row.image_url });
      ackCloud(row.id, false, errMsg).catch(() => {});
    }
  }
}

function skipStalePendings() {
  try {
    const all = db.exec({ table: "wa_outbox", action: "select", limit: 500 });
    const cutoff = Date.now() - 10 * 60 * 1000; // 10 min
    let skipped = 0;
    for (const r of all) {
      const isPending = !r.status || r.status === "pending";
      if (!isPending) continue;
      const isOld = r.created_at && new Date(r.created_at).getTime() < cutoff;
      if (isOld) {
        db.exec({ table: "wa_outbox", action: "update", filters: [{ col: "id", op: "eq", val: r.id }], payload: { status: "skipped", error: "expirado ao iniciar" } });
        skipped++;
      }
    }
    if (skipped) console.log("[wa] outbox: ignoradas", skipped, "linha(s) antigas");
  } catch (e) { console.error("[wa] skipStalePendings", e.message); }
}

let outboxBusy = false;
let cloudPullBusy = false;
function startOutboxWorker() {
  stopOutboxWorker();
  skipStalePendings();
  outboxTimer = setInterval(async () => {
    if (outboxBusy) return;
    outboxBusy = true;
    try { await pollOutboxOnce(); } catch {} finally { outboxBusy = false; }
  }, 300);
  if (cloudPullTimer) clearInterval(cloudPullTimer);
  cloudPullTimer = setInterval(async () => {
    if (cloudPullBusy) return;
    if (!getCloudToken()) return; // pula quando sync nuvem desligado
    cloudPullBusy = true;
    try { await pullCloudOutboxOnce(); } catch {} finally { cloudPullBusy = false; }
  }, 4000);
}
function stopOutboxWorker() {
  if (outboxTimer) { clearInterval(outboxTimer); outboxTimer = null; }
  if (cloudPullTimer) { clearInterval(cloudPullTimer); cloudPullTimer = null; }
  outboxBusy = false;
  cloudPullBusy = false;
}


function getState() { return waState; }
function setConfig(patch) {
  const cur = getConfig();
  const next = { ...cur, ...patch };
  db.exec({
    table: "app_settings", action: "upsert", onConflict: "user_id,key",
    payload: { user_id: USER_ID, key: "wa_listener_config", value: JSON.stringify(next) },
  });
  invalidateWaCache();
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

async function sendNow(payload) {
  debugLog("send: disparo direto", {
    chat_id: payload?.chat_id || "",
    quoted_msg_id: payload?.quoted_msg_id || "",
    hasImage: !!payload?.image_url,
    hasText: !!payload?.text,
  });
  const result = await sendRowNow(payload || {});
  // Se o envio direto respondeu a uma mensagem específica, marca awaiting-proof
  // pra que quando o autor original responder com imagem/PDF, a gente notifique.
  // (O loop do outbox já faz isso; aqui é pra o caminho send-now não perder.)
  try {
    if (payload?.quoted_msg_id) {
      markAwaitingProofFromOutbox({
        quoted_msg_id: payload.quoted_msg_id,
        chat_id: payload.chat_id || "",
      });
    }
  } catch (e) { debugLog("sendNow: markAwaitingProof falhou", { error: String(e?.message || e) }); }
  try {
    const rawPayload = await buildLiveRawPayload(result);
    if (rawPayload) emitLiveRawPayload(rawPayload);
  } catch (e) { debugLog("sendNow: raw persist falhou", { error: String(e?.message || e) }); }
  return {
    ok: true,
    source_msg_id: result?.id?._serialized || "",
    source_chat_id: result?.to || result?.from || payload?.chat_id || "",
    created_at: msgCreatedAtIso(result),
  };
}

async function sendReaction(payload) {
  const chatId = String(payload?.chat_id || "");
  const msgId = String(payload?.msg_id || "");
  const emoji = String(payload?.emoji || "");
  if (!waClient) throw new Error("WhatsApp não conectado");
  if (!msgId) throw new Error("msg_id vazio");
  debugLog("react: tentando reagir", { chatId, msgId, emoji });

  // Usa o mesmo resolvedor de reply. Assim reação e citação trabalham com o
  // mesmo ID canônico, inclusive mensagens de grupo cujo autor usa @lid.
  const resolved = await resolveQuotedMessageId(msgId, chatId);
  const resolvedMsgId = String(resolved?.id || "").trim();
  if (!resolvedMsgId) {
    debugLog("react: mensagem não localizada", { chatId, msgId });
    throw new Error("Não foi possível localizar a mensagem original para reagir.");
  }

  // Caminho principal: envia direto pelo Store via pupPage, evitando o
  // getMessageById do whatsapp-web.js (que quebra ao serializar @lid).
  const page = waClient?.pupPage;
  if (page && !page.isClosed?.()) {
    try {
      const result = await page.evaluate(async ({ requested, expectedChat, emoji }) => {
        const req = window.require;
        if (!req) return { ok: false, reason: "no-require" };
        const collections = req("WAWebCollections");
        const messages = collections?.Msg;
        if (!messages) return { ok: false, reason: "no-msg-collection" };
        const serialize = (v) => v?._serialized || (v?.user && v?.server ? `${v.user}@${v.server}` : String(v || ""));
        const belongsToChat = (m) => {
          if (!expectedChat) return true;
          const remote = serialize(m?.id?.remote || m?.chat?.id || m?.from || m?.to);
          return remote === expectedChat;
        };
        let model = messages.get?.(requested) || null;
        if (!model) {
          try { model = (await messages.getMessagesById?.([requested]))?.messages?.[0] || null; } catch {}
        }
        if (!model) {
          const parts = requested.split("_");
          const stanzas = new Set([requested]);
          if (parts.length >= 3) stanzas.add(parts[2]);
          const arr = messages.getModelsArray?.() || messages.models || [];
          model = Array.from(arr).find((m) => {
            if (!belongsToChat(m)) return false;
            const stanza = String(m?.id?.id || "");
            return stanzas.has(stanza) || serialize(m?.id) === requested;
          }) || null;
        }
        if (!model) return { ok: false, reason: "msg-not-found" };
        // Nome usado pela versão instalada do whatsapp-web.js vem primeiro.
        const candidates = [
          "WAWebSendReactionMsgAction",
          "WAWebSendReactionToMsgAction",
          "WAWebSendReactionAction",
          "WAWebReactionSendAction",
        ];
        for (const name of candidates) {
          try {
            const mod = req(name);
            const fn = mod?.sendReactionToMsg || mod?.default || mod?.sendReaction;
            if (typeof fn === "function") {
              await fn(model, emoji || "");
              return { ok: true, via: name };
            }
          } catch {}
        }
        // Fallback: método no próprio model
        if (typeof model.sendReaction === "function") {
          await model.sendReaction(emoji || "");
          return { ok: true, via: "model.sendReaction" };
        }
        return { ok: false, reason: "no-reaction-api" };
      }, { requested: resolvedMsgId, expectedChat: normalizeChatId(chatId), emoji });
      if (result?.ok) {
        debugLog("react: enviado via Store", { via: result.via, emoji });
        return { ok: true };
      }
      debugLog("react: Store falhou", { reason: result?.reason });
    } catch (e) {
      debugLog("react: evaluate falhou", { error: String(e?.message || e) });
    }
  }

  // Fallback: caminho antigo (pode falhar com @lid mas mantém compatibilidade)
  try {
    const msg = await waClient.getMessageById(resolvedMsgId);
    if (msg && typeof msg.react === "function") {
      await msg.react(emoji || "");
      return { ok: true };
    }
  } catch (e) {
    debugLog("react: getMessageById fallback falhou", { error: String(e?.message || e) });
  }
  throw new Error("Não foi possível reagir à mensagem (Reaction API indisponível).");
}

module.exports = { init, startWa, stopWa, logoutWa, getState, getConfig, setConfig, setSendState, getDiagnostics, listGroups, sendNow, sendReaction, backfillHistory, setRawListener, setRawReactionListener, setLiveChatEnabled };
