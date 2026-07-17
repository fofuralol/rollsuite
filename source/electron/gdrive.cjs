// Google Drive backup — OAuth 2.0 Desktop loopback + PKCE.
// Uploads/downloads a single file `rollsuite-backup.json` no Drive do usuário
// usando o escopo drive.file (só enxerga arquivos criados por este app).
const { app, shell } = require("electron");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { URL, URLSearchParams } = require("url");

const CLIENT_ID = process.env.GDRIVE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GDRIVE_CLIENT_SECRET || "";
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const BACKUP_PREFIX = "rollsuite-backup";
const LEGACY_FILENAME = "rollsuite-backup.json";

function makeBackupFilename() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `${BACKUP_PREFIX}-${stamp}.json`;
}

function tokenPath() {
  return path.join(app.getPath("userData"), "gdrive-token.json");
}
function loadState() {
  try { return JSON.parse(fs.readFileSync(tokenPath(), "utf8")); } catch { return null; }
}
function saveState(s) {
  try { fs.writeFileSync(tokenPath(), JSON.stringify(s, null, 2)); } catch {}
}
function clearState() {
  try { fs.unlinkSync(tokenPath()); } catch {}
}
function b64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function pkcePair() {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function postForm(url, params) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();
    const u = new URL(url);
    const req = https.request({
      method: "POST",
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const j = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) return resolve(j);
          reject(new Error(j.error_description || j.error || `HTTP ${res.statusCode}`));
        } catch (e) { reject(new Error(`Resposta inválida: ${data.slice(0, 200)}`)); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function driveRaw(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      method,
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve({ status: res.statusCode, buffer: buf });
        reject(new Error(`Drive ${method} ${res.statusCode}: ${buf.toString("utf8").slice(0, 300)}`));
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function connect() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const redirectUri = `http://127.0.0.1:${port}`;
  const { verifier, challenge } = pkcePair();
  const state = b64url(crypto.randomBytes(16));

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPE);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);

  const codePromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      try { server.close(); } catch {}
      reject(new Error("Tempo esgotado aguardando autorização"));
    }, 5 * 60 * 1000);

    server.on("request", (req, res) => {
      const u = new URL(req.url, redirectUri);
      const code = u.searchParams.get("code");
      const err = u.searchParams.get("error");
      const st = u.searchParams.get("state");
      const html = (title, msg, ok) => `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui,sans-serif;background:#0f1115;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center"><div style="max-width:420px;padding:32px;border-radius:16px;background:#1a1d24;border:1px solid #2a2f3a"><div style="font-size:44px;margin-bottom:8px">${ok ? "✅" : "⚠️"}</div><h1 style="color:#e5a83d;margin:0 0 8px;font-size:22px">RollSuite</h1><p style="margin:0 0 6px">${msg}</p><p style="opacity:.55;margin:0;font-size:13px">Você já pode fechar esta janela.</p></div></body>`;
      if (err || !code || st !== state) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html("Erro", `Autorização não concluída: ${err || "código ausente"}`, false));
        clearTimeout(timeout);
        try { server.close(); } catch {}
        return reject(new Error(err || "Autorização cancelada"));
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html("Conectado", "Google Drive conectado com sucesso.", true));
      clearTimeout(timeout);
      try { server.close(); } catch {}
      resolve(code);
    });
  });

  await shell.openExternal(authUrl.toString());
  const code = await codePromise;

  const tokens = await postForm("https://oauth2.googleapis.com/token", {
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  if (!tokens.refresh_token) {
    // Já autorizado antes — sem refresh_token. Revoga e pede pra reconectar.
    throw new Error("Google não retornou refresh_token. Vá em myaccount.google.com/permissions, remova o acesso do app e conecte novamente.");
  }

  saveState({
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token,
    expires_at: Date.now() + (tokens.expires_in || 3600) * 1000 - 60_000,
    connected_at: Date.now(),
    last_upload_at: null,
  });
  return { connected: true };
}

async function getAccessToken() {
  const s = loadState();
  if (!s?.refresh_token) throw new Error("Google Drive não conectado");
  if (s.access_token && s.expires_at && Date.now() < s.expires_at) return s.access_token;
  const r = await postForm("https://oauth2.googleapis.com/token", {
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: s.refresh_token,
    grant_type: "refresh_token",
  });
  const next = {
    ...s,
    access_token: r.access_token,
    expires_at: Date.now() + (r.expires_in || 3600) * 1000 - 60_000,
  };
  saveState(next);
  return next.access_token;
}

async function listBackups(token) {
  // Lista backups criados por este app (contains do prefixo). Ordena por modifiedTime desc.
  const q = encodeURIComponent(
    `(name contains '${BACKUP_PREFIX}') and trashed = false`
  );
  const r = await driveRaw(
    "GET",
    `https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&orderBy=modifiedTime desc&pageSize=100&fields=files(id,name,modifiedTime,size)`,
    { Authorization: `Bearer ${token}` }
  );
  const j = JSON.parse(r.buffer.toString("utf8"));
  return j.files || [];
}

async function upload(jsonString) {
  if (typeof jsonString !== "string" || !jsonString.length) {
    throw new Error("Conteúdo do backup vazio");
  }
  const token = await getAccessToken();
  const filename = makeBackupFilename();

  const boundary = "-------rs" + Date.now();
  const metadata = JSON.stringify({ name: filename, mimeType: "application/json" });
  const bodyStr =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    metadata + "\r\n" +
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    jsonString + "\r\n" +
    `--${boundary}--`;
  const body = Buffer.from(bodyStr, "utf8");

  const url = `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
  const r = await driveRaw("POST", url, {
    Authorization: `Bearer ${token}`,
    "Content-Type": `multipart/related; boundary=${boundary}`,
    "Content-Length": body.length,
  }, body);
  const j = JSON.parse(r.buffer.toString("utf8"));

  const s = loadState() || {};
  s.last_upload_at = Date.now();
  s.last_size = body.length;
  saveState(s);
  return { id: j.id, name: filename, size: body.length, at: s.last_upload_at };
}

async function list() {
  const token = await getAccessToken();
  return { files: await listBackups(token) };
}

async function download(fileId) {
  const token = await getAccessToken();
  let target = null;
  if (fileId) {
    target = { id: String(fileId) };
  } else {
    const all = await listBackups(token);
    target = all[0] || null;
  }
  if (!target) return { content: null, meta: null };
  const r = await driveRaw("GET", `https://www.googleapis.com/drive/v3/files/${target.id}?alt=media`, {
    Authorization: `Bearer ${token}`,
  });
  return { content: r.buffer.toString("utf8"), meta: target };
}

async function remove(fileId) {
  if (!fileId) throw new Error("fileId obrigatório");
  const token = await getAccessToken();
  await driveRaw("DELETE", `https://www.googleapis.com/drive/v3/files/${fileId}`, {
    Authorization: `Bearer ${token}`,
  });
  return { ok: true };
}

async function status() {
  const s = loadState();
  if (!s?.refresh_token) return { connected: false };
  let latest = null;
  let count = 0;
  try {
    const token = await getAccessToken();
    const all = await listBackups(token);
    count = all.length;
    latest = all[0] || null;
  } catch {}
  return {
    connected: true,
    last_upload_at: s.last_upload_at || null,
    remote: latest,
    count,
  };
}

async function disconnect() {
  const s = loadState();
  if (s?.refresh_token) {
    try {
      await new Promise((resolve) => {
        const req = https.request({
          method: "POST",
          hostname: "oauth2.googleapis.com",
          path: `/revoke?token=${encodeURIComponent(s.refresh_token)}`,
        }, (res) => { res.on("data", () => {}); res.on("end", resolve); });
        req.on("error", resolve);
        req.end();
      });
    } catch {}
  }
  clearState();
  return { connected: false };
}

module.exports = { connect, upload, download, list, remove, status, disconnect };
