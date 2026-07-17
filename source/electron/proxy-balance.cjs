// Local port of the proxy-balance edge function.
// Calls api.marceloproxies.com.br directly from the Electron main process,
// no Lovable Cloud involved.

const DEFAULT_PROXY_ID = "948924";
const API_BASE = "https://api.marceloproxies.com.br";
const BYTES_IN_GB = 1024 * 1024 * 1024;
const PACOTE_GB = 5;

function buildResponse(disponivelBytes, balanceFormat) {
  const disponivelGbTotal = disponivelBytes / BYTES_IN_GB;
  const disponivelGb = Math.min(PACOTE_GB, disponivelGbTotal);
  const usadoGb = Math.max(0, PACOTE_GB - disponivelGb);
  const percentualUsado = (usadoGb / PACOTE_GB) * 100;
  const fmt = (gb) => `${gb.toFixed(2)} GB`;
  return {
    usadoGb: Math.round(usadoGb * 100) / 100,
    totalGb: PACOTE_GB,
    disponivelGb: Math.round(disponivelGb * 100) / 100,
    percentualUsado: Math.round(percentualUsado * 10) / 10,
    usadoText: fmt(usadoGb),
    totalText: fmt(PACOTE_GB),
    disponivelText: balanceFormat != null ? balanceFormat : fmt(disponivelGb),
    atualizadoEm: new Date().toISOString(),
  };
}

function extractProxyId(input) {
  if (!input) return DEFAULT_PROXY_ID;
  const trimmed = String(input).trim();
  if (!trimmed) return DEFAULT_PROXY_ID;
  if (/^[A-Za-z0-9]+$/.test(trimmed) && !/^https?:/i.test(trimmed)) return trimmed;
  const m = trimmed.match(/\/proxy\/([A-Za-z0-9_-]+)/i);
  if (m) return m[1];
  const seg = trimmed.split(/[\/?#]/).filter(Boolean).pop();
  if (seg && /^[A-Za-z0-9_-]+$/.test(seg)) return seg;
  const digits = trimmed.match(/(\d{3,})(?!.*\d)/);
  return digits ? digits[1] : DEFAULT_PROXY_ID;
}

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json",
};

async function fetchSafe(url, ms = 9000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
    if (!r.ok) return {};
    return await r.json().catch(() => ({}));
  } catch (e) {
    console.warn(`[proxy-balance] fetch falhou ${url}:`, e && e.message);
    return {};
  } finally {
    clearTimeout(t);
  }
}

module.exports = async function proxyBalanceLocal(body) {
  const panelUrl = body && body.panelUrl;
  const proxyIdRaw = (body && body.proxyId) || panelUrl;
  const PROXY_ID = extractProxyId(proxyIdRaw);
  try {
    const results = await Promise.allSettled([
      fetchSafe(`${API_BASE}/proxies/${PROXY_ID}`),
      fetchSafe(`${API_BASE}/balance/${PROXY_ID}/balance`),
    ]);
    const proxy = results[0].status === "fulfilled" ? results[0].value : {};
    const bal = results[1].status === "fulfilled" ? results[1].value : {};
    const disponivelBytes = Number(
      (bal && bal.balance) != null ? bal.balance : (proxy && proxy.currentBalance) || 0,
    );
    const data = buildResponse(disponivelBytes, bal && bal.balance_format);
    return { ...data, proxyId: PROXY_ID };
  } catch (err) {
    const message = err && err.message ? err.message : "Erro desconhecido";
    console.error("[proxy-balance] erro:", message);
    return { ...buildResponse(0), error: message, proxyId: PROXY_ID };
  }
};
