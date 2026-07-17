// Local HTTP server that receives "meta atingida" events directly from the
// Chrome extension without going through the Cloud. Loopback-only.
const http = require("http");

const HOST = "127.0.0.1";
const DEFAULT_PORT = 47821;
const MAX_PORT_TRIES = 10;

let server = null;
let currentPort = null;
let getConfig = () => ({ token: "", local_enabled: false });
let onEvent = (_ev) => {};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", ...CORS });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 65536) { reject(new Error("payload too large")); req.destroy(); }
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

function handle(req, res) {
  if (req.method === "OPTIONS") { res.writeHead(204, CORS); res.end(); return; }

  const url = req.url || "/";

  if (url.startsWith("/ping")) {
    return json(res, 200, { ok: true, service: "rolls-meta-local", port: currentPort });
  }

  if (url.startsWith("/meta") && req.method === "POST") {
    return readBody(req).then((raw) => {
      let body;
      try { body = JSON.parse(raw || "{}"); } catch { return json(res, 400, { ok: false, error: "invalid json" }); }
      const cfg = getConfig();
      if (!cfg.local_enabled) return json(res, 503, { ok: false, error: "local disabled" });
      const token = String(body.token || "").trim();
      if (!token || !cfg.token || token !== cfg.token) {
        return json(res, 401, { ok: false, error: "invalid token" });
      }
      const ev = {
        id: String(body.id || `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
        title: body.title || body.tab_title || null,
        url: body.url || body.tab_url || null,
        steps: body.steps ?? null,
        target: body.target ?? null,
        source_tab_id: body.source_tab_id ?? body.tab_id ?? null,
        source_token: token,
        created_at: body.created_at || body.timestamp || new Date().toISOString(),
        _local: true,
      };
      try { onEvent(ev); } catch (e) { console.warn("[meta-local] onEvent err", e?.message || e); }
      return json(res, 200, { ok: true, id: ev.id });
    }).catch((e) => json(res, 400, { ok: false, error: e?.message || String(e) }));
  }

  json(res, 404, { ok: false, error: "not found" });
}

function tryListen(port, remainingTries) {
  return new Promise((resolve, reject) => {
    const s = http.createServer(handle);
    s.once("error", (err) => {
      if (err && err.code === "EADDRINUSE" && remainingTries > 0) {
        resolve(tryListen(port + 1, remainingTries - 1));
      } else {
        reject(err);
      }
    });
    s.listen(port, HOST, () => {
      server = s;
      currentPort = port;
      console.log(`[meta-local] listening on http://${HOST}:${port}`);
      resolve(port);
    });
  });
}

async function start({ config, onEvent: cb }) {
  if (config) getConfig = config;
  if (cb) onEvent = cb;
  if (server) return currentPort;
  try {
    return await tryListen(DEFAULT_PORT, MAX_PORT_TRIES);
  } catch (e) {
    console.warn("[meta-local] failed to start:", e?.message || e);
    return null;
  }
}

function stop() {
  return new Promise((resolve) => {
    if (!server) return resolve();
    server.close(() => { server = null; currentPort = null; resolve(); });
  });
}

function getPort() { return currentPort; }
function isRunning() { return !!server; }

module.exports = { start, stop, getPort, isRunning };
