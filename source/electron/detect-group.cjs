// Auto-detecção do grupo (nome da plataforma) inspecionando o site.
// Estratégia A: fetch simples de HTML + regex. Sem BrowserWindow oculta.
const path = require("path");

const NOTICE_PATHS = [
  "/home/notice", "/notice", "/help/notice", "/support", "/help",
  // Centro de mensagens / SAC (onde ficam handles Telegram/WhatsApp)
  "/message", "/messages", "/message-center", "/help/messages",
  "/service", "/customer", "/kefu", "/contact", "/help/contact",
  "/mine/service", "/home/service",
];
const FETCH_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 512 * 1024;
const CONCURRENCY = 4;
const cache = new Map(); // host -> { at, result }
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeHost(url) {
  try {
    let u = String(url || "").trim();
    if (!u) return "";
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    const parsed = new URL(u);
    return parsed.hostname.toLowerCase();
  } catch { return ""; }
}

function decodeEntities(s) {
  return String(s || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code) || 0));
}

function stripTags(s) {
  return decodeEntities(String(s || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

// Extrai o SLD (primeiro rótulo antes do TLD). Ex: w1.onde.com -> "onde"
function extractSld(host) {
  const parts = String(host || "").split(".").filter(Boolean);
  if (parts.length < 2) return "";
  return parts[parts.length - 2].toLowerCase();
}

async function fetchWithTimeout(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
      },
    });
    if (!res.ok) return null;
    const reader = res.body?.getReader?.();
    if (!reader) {
      const text = await res.text();
      return text.slice(0, MAX_HTML_BYTES);
    }
    const chunks = [];
    let received = 0;
    while (received < MAX_HTML_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
    }
    try { reader.cancel(); } catch {}
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    return buf.toString("utf8");
  } catch { return null; } finally { clearTimeout(t); }
}

// Coleta "sinais" de texto extraídos do HTML (título, og, headings, texto plain)
function extractSignals(html) {
  const signals = [];
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) signals.push({ src: "title", text: stripTags(titleMatch[1]) });

  const metaRe = /<meta[^>]+(?:property|name)=["'](og:site_name|og:title|application-name|twitter:title|description|og:description)["'][^>]*content=["']([^"']+)["']/gi;
  let m;
  while ((m = metaRe.exec(html))) {
    signals.push({ src: `meta:${m[1]}`, text: stripTags(m[2]) });
  }

  const hRe = /<h([1-3])[^>]*>([\s\S]{0,400}?)<\/h\1>/gi;
  while ((m = hRe.exec(html))) {
    const text = stripTags(m[2]);
    if (text) signals.push({ src: `h${m[1]}`, text });
    if (signals.length > 40) break;
  }

  // Nomes de arquivos de imagem (logo/avatar de suporte) — o slug do arquivo
  // costuma conter o nome do grupo (ex: ek_logo.png, okok-avatar.svg).
  const imgRe = /<img[^>]+(?:src|data-src)=["']([^"']+)["']/gi;
  while ((m = imgRe.exec(html))) {
    const src = m[1];
    const name = src.split("/").pop() || "";
    if (name && /[a-zA-Z]/.test(name)) signals.push({ src: "img", text: name });
    if (signals.length > 80) break;
  }

  // Texto plain do body (últimos 20k chars) — pega labels visíveis
  const bodyMatch = html.match(/<body[\s\S]*?<\/body>/i);
  if (bodyMatch) {
    const plain = stripTags(bodyMatch[0]).slice(0, 20000);
    if (plain) signals.push({ src: "body", text: plain });
  }
  return signals;
}

// Tenta casar sinais com nomes de grupo conhecidos. Retorna o match mais forte.
function scoreAgainstKnownGroups(signals, knownGroups) {
  let best = null;
  for (const name of knownGroups) {
    const clean = String(name || "").trim();
    if (!clean) continue;
    const esc = clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // borda por não-alfanumérico pra evitar "W1" bater em "W10"
    const re = new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, "i");
    for (const sig of signals) {
      if (re.test(sig.text)) {
        // pesos: title/og > h1-h3 > img > body
        const weight = sig.src.startsWith("title") ? 100
          : sig.src.startsWith("meta:og:site_name") ? 95
          : sig.src.startsWith("meta:og:title") || sig.src.startsWith("meta:application-name") ? 85
          : sig.src.startsWith("h1") ? 80
          : sig.src.startsWith("h2") ? 60
          : sig.src.startsWith("h3") ? 50
          : sig.src === "img" ? 40
          : 20;
        const score = weight + clean.length; // desempate por nome mais longo
        if (!best || score > best.score) best = { name: clean, score, source: sig.src, snippet: sig.text.slice(0, 120) };
      }
    }
  }
  return best;
}

// Procura ocorrências de "GRUPO" + sufixo alfanumérico (ex: GRUPOEK, GRUPO DY).
// Retorna o nome mais frequente encontrado, priorizando sinais de peso (title/h1).
function extractGrupoName(signals) {
  // Casa "GRUPO<sufixo>" e também "<prefixo>GRUPO" (ex: EKGRUPO -> GRUPOEK)
  const rx = /\b(?:GRUPO[\s\-_]*([A-Z0-9]{1,10})|([A-Z0-9]{1,10})[\s\-_]*GRUPO)\b/gi;
  const counts = new Map(); // name -> weight
  for (const sig of signals) {
    const weight = sig.src.startsWith("title") ? 100
      : sig.src.startsWith("meta:og:site_name") ? 95
      : sig.src.startsWith("meta:og:title") || sig.src.startsWith("meta:application-name") ? 85
      : sig.src.startsWith("h1") ? 80
      : sig.src.startsWith("h2") ? 60
      : sig.src.startsWith("h3") ? 50
      : sig.src === "img" ? 40
      : 10;
    let m;
    rx.lastIndex = 0;
    while ((m = rx.exec(sig.text))) {
      const suffix = (m[1] || m[2] || "").toUpperCase();
      if (!suffix || suffix === "GRUPO") continue;
      const name = `GRUPO${suffix}`;
      counts.set(name, Math.max(counts.get(name) || 0, weight));
    }
  }
  if (!counts.size) return null;
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return { name: best[0], score: best[1] };
}

// Extrai candidatos "novos" (não estão nos grupos conhecidos). Fallback pra
// sugestão de criação de grupo (não auto-atribui).
function extractCandidateNames(signals) {
  const candidates = new Map(); // name -> count
  const rx = /\b(?:GRUPO[\s\-_]*([A-Z0-9]{1,10})|([A-Z][A-Z0-9]{1,9})[\s\-_]*GRUPO|([A-Z][A-Z0-9]{1,9}))\b/g;
  for (const sig of signals) {
    if (sig.src === "body") continue; // body é muito ruidoso
    let m;
    while ((m = rx.exec(sig.text))) {
      const grupoSuffix = m[1] || m[2];
      const name = grupoSuffix ? `GRUPO${grupoSuffix.toUpperCase()}` : m[3];
      if (!name) continue;
      if (/^(?:HTTP|HTML|HTTPS|API|SDK|CSS|JS|PDF|CDN|SVG|PNG|JPG|GIF|COM|BR|WWW|URL|FAQ|GRUPO)$/i.test(name)) continue;
      candidates.set(name, (candidates.get(name) || 0) + 1);
    }
  }
  return [...candidates.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count }));
}
// Fallback: procura handles de suporte (Telegram/@user, "Apelido: xxx") e
// deriva um nome de grupo removendo ruído comum (oficial, sac, canal, bot…).
// NÃO removemos "equipe"/"team" — fazem parte do nome do grupo (ex: 888equipe).
const HANDLE_NOISE_RE = /^(?:sac|suporte|support|atendimento|canal|oficial|official|bot|telegram|whatsapp|wa)+|(?:oficial|official|bot|sac|suporte|support|canal|atendimento|telegram|whatsapp|wa)+$/g;
function normalizeHandle(raw) {
  let t = String(raw || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  for (let i = 0; i < 3; i++) {
    const prev = t;
    t = t.replace(HANDLE_NOISE_RE, "");
    if (t === prev) break;
  }
  if (t.length < 3) return "";
  return t;
}
function extractHandleGroup(html, signals) {
  const counts = new Map();
  const bump = (raw, weight) => {
    const t = normalizeHandle(raw);
    if (!t) return;
    counts.set(t, (counts.get(t) || 0) + weight);
  };
  let m;
  // t.me/telegram links no HTML
  const linkRe = /(?:t\.me|telegram\.me|telegram\.dog)\/([a-zA-Z0-9_]{4,32})/gi;
  while ((m = linkRe.exec(html))) bump(m[1], 3);
  // @handles e "Apelido:/Nickname:/Nome:" nos sinais (inclui body)
  for (const s of signals) {
    const atRe = /@([a-zA-Z0-9_]{4,32})\b/g;
    while ((m = atRe.exec(s.text))) bump(m[1], 2);
    const nickRe = /(?:apelido|nickname|nome|name|id)\s*[:：]\s*([A-Za-z0-9_]{4,32})/gi;
    while ((m = nickRe.exec(s.text))) bump(m[1], 3);
  }
  if (!counts.size) return null;
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return { name: best[0].toUpperCase(), score: 55 + best[1] * 5 };
}



async function detectOne(rawUrl, knownGroups) {
  const host = normalizeHost(rawUrl);
  if (!host) return { url: rawUrl, host: "", group: "", confidence: 0, source: "invalid" };

  const cached = cache.get(host);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { ...cached.result, host, cached: true };
  }

  const sld = extractSld(host);
  let bestMatch = null;
  let grupoHit = null; // { name, score } — SEMPRE prioritário
  let handleHit = null; // { name, score } — fallback via Telegram/@apelido
  let candidates = [];
  let sourceUsed = "";
  let handleSource = "";
  let fetched = false;

  for (const p of NOTICE_PATHS) {
    const url = `https://${host}${p}`;
    const html = await fetchWithTimeout(url);
    if (!html) continue;
    fetched = true;
    const signals = extractSignals(html);

    // Prioridade máxima: se o site menciona "GRUPO<NOME>" (ex.: GRUPOEK), usa.
    const g = extractGrupoName(signals);
    if (g && (!grupoHit || g.score > grupoHit.score)) {
      grupoHit = g;
      sourceUsed = `${p}:grupo`;
    }

    const match = scoreAgainstKnownGroups(signals, knownGroups);
    if (match && (!bestMatch || match.score > bestMatch.score)) {
      bestMatch = match;
      if (!grupoHit) sourceUsed = `${p}:${match.source}`;
    }

    // Fallback: handles do centro de mensagens (Telegram, @user, "Apelido:")
    const h = extractHandleGroup(html, signals);
    if (h && (!handleHit || h.score > handleHit.score)) {
      handleHit = h;
      handleSource = `${p}:handle`;
    }

    if (!candidates.length) candidates = extractCandidateNames(signals);
    if (grupoHit && grupoHit.score >= 100) break;
    if (bestMatch && bestMatch.score >= 100 && !grupoHit) break;
  }

  if (grupoHit) {
    const result = {
      url: rawUrl,
      host,
      group: grupoHit.name,
      confidence: Math.min(100, Math.round(grupoHit.score)),
      source: sourceUsed,
      snippet: `Encontrado ${grupoHit.name}`,
      candidates,
    };
    cache.set(host, { at: Date.now(), result });
    return result;
  }

  // Se não achou grupo conhecido, usa o handle do suporte como fallback.
  if (!bestMatch && handleHit) {
    const result = {
      url: rawUrl,
      host,
      group: handleHit.name,
      confidence: Math.min(90, Math.round(handleHit.score)),
      source: handleSource,
      snippet: `Handle de suporte: ${handleHit.name}`,
      candidates,
    };
    cache.set(host, { at: Date.now(), result });
    return result;
  }

  const result = bestMatch
    ? {
        url: rawUrl,
        host,
        group: bestMatch.name,
        confidence: Math.min(100, Math.round(bestMatch.score)),
        source: sourceUsed,
        snippet: bestMatch.snippet,
        candidates,
      }
    : {
        url: rawUrl,
        host,
        group: "",
        confidence: 0,
        source: fetched ? "no-match" : "fetch-failed",
        candidates,
        sld,
      };
  cache.set(host, { at: Date.now(), result });
  return result;
}

async function detectMany(urls, knownGroups, onProgress) {
  const list = Array.from(new Set(urls.filter(Boolean)));
  const results = [];
  let idx = 0;
  const workers = new Array(Math.min(CONCURRENCY, list.length)).fill(0).map(async () => {
    while (idx < list.length) {
      const i = idx++;
      const url = list[i];
      try {
        const r = await detectOne(url, knownGroups);
        results[i] = r;
      } catch (e) {
        results[i] = { url, host: "", group: "", confidence: 0, source: "error", error: String(e?.message || e) };
      }
      try { onProgress?.({ done: results.filter(Boolean).length, total: list.length, last: results[i] }); } catch {}
    }
  });
  await Promise.all(workers);
  return results;
}

module.exports = { detectOne, detectMany };
