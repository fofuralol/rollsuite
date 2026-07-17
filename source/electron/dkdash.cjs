// Local reimplementation of the dkdash-lucros edge function.
const crypto = require("crypto");

const DK_API = "https://api.dkdash.site";
const ENC_KEY_RAW = "rolls-suite-desktop-fixed-key-v1";

function getKey() {
  return crypto.createHash("sha256").update(ENC_KEY_RAW).digest();
}
function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, enc, tag]).toString("base64");
}
function decrypt(b64) {
  const buf = Buffer.from(b64, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(buf.length - 16);
  const data = buf.subarray(12, buf.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

function fetchWithTimeout(url, init = {}) {
  const { timeoutMs = 20000, ...rest } = init;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...rest, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

async function dkLoginFull(filialId, username, password, timeoutMs = 30000) {
  const body = new URLSearchParams({ username, password }).toString();
  const res = await fetchWithTimeout(`${DK_API}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Filial-ID": filialId },
    body,
    timeoutMs,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`DK login (${res.status}): ${text}`);
  let json;
  try { json = JSON.parse(text); } catch { throw new Error("DK login resposta inválida"); }
  const token = json.access_token || json.token;
  if (!token) throw new Error("DK login sem token");
  return { token, info: json };
}

async function dkLogin(filialId, username, password, timeoutMs = 30000) {
  const { token } = await dkLoginFull(filialId, username, password, timeoutMs);
  return token;
}

// ============================================================
// Token cache — DK Dash rate-limita /login (HTTP 429) e BLOQUEIA o
// usuário se loga demais. Persistimos o JWT em disco (na linha de
// dkdash_credentials) usando o `exp` real do token, pra sobreviver a
// reinícios do app. Só chamamos /login quando não há token válido.
// ============================================================
const TOKEN_SAFETY_MS = 60 * 1000; // expira 1min antes do exp real
const FALLBACK_TTL_MS = 45 * 60 * 1000;
const tokenCache = new Map(); // filialId -> { token, info, expiresAt }

function decodeJwtExpMs(token) {
  try {
    const part = token.split(".")[1];
    if (!part) return 0;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.padEnd(Math.ceil(b64.length / 4) * 4, "=");
    const json = JSON.parse(Buffer.from(pad, "base64").toString("utf8"));
    if (json && typeof json.exp === "number") return json.exp * 1000;
  } catch {}
  return 0;
}

function cacheGet(filialId) {
  const e = tokenCache.get(filialId);
  if (!e) return null;
  if (Date.now() >= e.expiresAt - TOKEN_SAFETY_MS) { tokenCache.delete(filialId); return null; }
  return e;
}
function cacheSet(filialId, token, info, expiresAt) {
  tokenCache.set(filialId, { token, info, expiresAt });
}
function cacheInvalidate(filialId) { tokenCache.delete(filialId); }

function loadPersistedToken(cred) {
  const tk = cred.cached_token;
  const exp = Number(cred.cached_token_exp || 0);
  const info = cred.cached_token_info || null;
  if (!tk || !exp) return null;
  if (Date.now() >= exp - TOKEN_SAFETY_MS) return null;
  return { token: tk, info: info || {}, expiresAt: exp };
}
function persistToken(db, cred, token, info, expiresAt) {
  try {
    db.exec({
      table: "dkdash_credentials",
      action: "update",
      filters: [{ col: "filial_id", op: "eq", val: cred.filial_id }],
      payload: {
        cached_token: token,
        cached_token_exp: expiresAt,
        cached_token_info: info,
        last_login_at: new Date().toISOString(),
      },
    });
  } catch (e) { console.error("[dkdash] persistToken falhou", e.message); }
}
function clearPersistedToken(db, cred) {
  try {
    db.exec({
      table: "dkdash_credentials",
      action: "update",
      filters: [{ col: "filial_id", op: "eq", val: cred.filial_id }],
      payload: { cached_token: null, cached_token_exp: null, cached_token_info: null },
    });
  } catch {}
}

async function getCachedLogin(cred, force = false, db = null) {
  if (!force) {
    const c = cacheGet(cred.filial_id);
    if (c) return c;
    if (db) {
      const persisted = loadPersistedToken(cred);
      if (persisted) {
        cacheSet(cred.filial_id, persisted.token, persisted.info, persisted.expiresAt);
        console.log(`[dkdash] usando token persistido (expira em ${Math.round((persisted.expiresAt - Date.now())/60000)}min)`);
        return persisted;
      }
    }
  } else {
    cacheInvalidate(cred.filial_id);
    if (db) clearPersistedToken(db, cred);
  }
  console.log(`[dkdash] /login DK (${cred.dk_username}@${cred.filial_id})`);
  const pwd = decrypt(cred.password_encrypted);
  const r = await dkLoginFull(cred.filial_id, cred.dk_username, pwd);
  const expFromJwt = decodeJwtExpMs(r.token);
  const expiresAt = expFromJwt || (Date.now() + FALLBACK_TTL_MS);
  cacheSet(cred.filial_id, r.token, r.info, expiresAt);
  if (db) persistToken(db, cred, r.token, r.info, expiresAt);
  return { token: r.token, info: r.info, expiresAt };
}
async function getCachedToken(cred, force = false, db = null) {
  return (await getCachedLogin(cred, force, db)).token;
}

async function dkFetchCiclos(filialId, token) {
  const res = await fetchWithTimeout(`${DK_API}/ciclos/`, {
    headers: { Authorization: `Bearer ${token}`, "X-Filial-ID": filialId },
    timeoutMs: 60000,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`DK ciclos (${res.status}): ${text}`);
  let json;
  try { json = JSON.parse(text); } catch { throw new Error("DK ciclos resposta inválida"); }
  return json.ciclos || [];
}

function getCred(db, filialId) {
  const rows = db.exec({
    table: "dkdash_credentials", action: "select",
    filters: [{ col: "filial_id", op: "eq", val: filialId }],
  });
  return rows[0] || null;
}

async function syncTaskTimes(db, cred, token) {
  const ciclos = await dkFetchCiclos(cred.filial_id, token);
  const byNome = new Map();
  for (const c of ciclos) {
    const nome = String(c.nome_ciclo || "").trim();
    if (!nome) continue;
    const ts = c.created_at || c.data_criacao || c.data_ciclo || c.data_logica || null;
    const prev = byNome.get(nome);
    if (!prev || (ts && String(ts) > String(prev._ts || ""))) {
      byNome.set(nome, { ...c, _ts: ts });
    }
  }

  const tasks = db.exec({ table: "wa_tasks", action: "select", filters: [{ col: "status", op: "eq", val: "done" }] }) || [];
  const updates = [];
  const skipped = [];

  for (const t of tasks) {
    const candidates = [t.nome_tarefa, t.link].map((s) => String(s || "").trim()).filter(Boolean);
    let matched = null;
    for (const candidate of candidates) {
      if (byNome.has(candidate)) {
        matched = byNome.get(candidate);
        break;
      }
    }
    if (!matched) {
      skipped.push({ id: t.id, nome: t.nome_tarefa, reason: "sem ciclo" });
      continue;
    }
    const rawTs = matched._ts;
    if (!rawTs) {
      skipped.push({ id: t.id, nome: t.nome_tarefa, reason: "ciclo sem timestamp" });
      continue;
    }

    let iso;
    const stamp = String(rawTs);
    if (/^\d{4}-\d{2}-\d{2}$/.test(stamp)) iso = `${stamp}T12:00:00-03:00`;
    else {
      const parsed = new Date(stamp);
      if (Number.isNaN(parsed.getTime())) {
        skipped.push({ id: t.id, reason: `ts inválido: ${stamp}` });
        continue;
      }
      iso = parsed.toISOString();
    }

    const newOp = { ...(t.operation_data || {}), dk_synced: true, savedAt: iso };
    db.exec({
      table: "wa_tasks",
      action: "update",
      filters: [{ col: "id", op: "eq", val: t.id }],
      payload: { completed_at: iso, operation_data: newOp },
    });
    updates.push({ id: t.id, nome: t.nome_tarefa, completed_at: iso });
  }

  return {
    ok: true,
    updated: updates.length,
    total_tasks: tasks.length,
    total_ciclos: ciclos.length,
    updates,
    skipped,
    sample_ciclo: ciclos[0] || null,
  };
}

async function handle(body, db) {
  const action = body.action || "fetch";
  const filialId = (body.filial_id || "filial01").toString();

  if (action === "save-credentials") {
    const username = (body.username || "").trim();
    const password = (body.password || "").toString();
    if (!username || !password) return { error: "username e password obrigatórios" };
    try { await dkLogin(filialId, username, password); }
    catch (e) { return { error: `Credenciais inválidas: ${e.message}` }; }
    db.exec({
      table: "dkdash_credentials", action: "upsert",
      onConflict: "filial_id",
      payload: {
        filial_id: filialId,
        dk_username: username,
        password_encrypted: encrypt(password),
        last_login_at: new Date().toISOString(),
      },
    });
    return { ok: true };
  }

  if (action === "status") {
    const c = getCred(db, filialId);
    return { connected: !!c, info: c ? { dk_username: c.dk_username, filial_id: c.filial_id, last_login_at: c.last_login_at, updated_at: c.updated_at } : null };
  }

  if (action === "delete-credentials") {
    db.exec({ table: "dkdash_credentials", action: "delete", filters: [{ col: "filial_id", op: "eq", val: filialId }] });
    return { ok: true };
  }

  const cred = getCred(db, filialId);
  if (!cred) return { error: "Credenciais não cadastradas" };

  if (action === "main-dashboard") {
    let cached;
    try {
      cached = await getCachedLogin(cred, false, db);
    } catch (e) {
      return { error: `Falha no login DK (${cred.dk_username}@${cred.filial_id}): ${e.message}` };
    }
    let token = cached.token;
    let loginInfo = cached.info;
    const inicio = (body.inicio || "").toString();
    const fim = (body.fim || "").toString();
    let query = "";
    if (inicio && fim) query = `?inicio=${inicio}&fim=${fim}`;
    else if (inicio) query = `?inicio=${inicio}`;

    const buildHeaders = (t) => ({ Authorization: `Bearer ${t}`, "X-Filial-ID": cred.filial_id });
    let headers = buildHeaders(token);
    let triedRelogin = false;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const doFetch = async (path) => {
      let res = await fetchWithTimeout(`${DK_API}${path}`, { headers, timeoutMs: 30000 });
      if (res.status === 401 && !triedRelogin) {
        triedRelogin = true;
        cacheInvalidate(cred.filial_id);
        const re = await getCachedLogin(cred, true, db);
        token = re.token; loginInfo = re.info;
        headers = buildHeaders(token);
        res = await fetchWithTimeout(`${DK_API}${path}`, { headers, timeoutMs: 30000 });
      }
      return res;
    };
    const fetchJson = async (path) => {
      let lastErr = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await doFetch(path);
          const text = await res.text();
          if (!res.ok) {
            console.error(`[dkdash] ${path} -> HTTP ${res.status}: ${text.slice(0, 200)}`);
            return { __err: `HTTP ${res.status}` };
          }
          try { return JSON.parse(text); } catch {
            console.error(`[dkdash] ${path} -> JSON parse falhou: ${text.slice(0, 200)}`);
            return { __err: "JSON inválido" };
          }
        } catch (e) {
          lastErr = e;
          console.error(`[dkdash] ${path} tentativa ${attempt + 1} falhou: ${e.message}`);
          if (attempt < 2) await sleep(500 * (attempt + 1));
        }
      }
      return { __err: (lastErr && lastErr.message) || "fetch failed" };
    };

    // Sequencial — evita falhas de rede do undici quando 4 requests sobem juntas
    const contasR = await fetchJson(`/contas/${query}`);
    const ciclosR = await fetchJson(`/ciclos/${query}`);
    const metaR = await fetchJson(`/meta/`);
    const rankR = await fetchJson(`/ranking-top1`);

    const errs = [];
    if (contasR?.__err) errs.push(`contas: ${contasR.__err}`);
    if (ciclosR?.__err) errs.push(`ciclos: ${ciclosR.__err}`);
    if (errs.length) {
      return { error: `DK API falhou — ${errs.join(" | ")}` };
    }

    const contas = contasR?.contas || [];
    const ciclos = ciclosR?.ciclos || [];

    return {
      ok: true,
      username: cred.dk_username,
      filial_id: cred.filial_id,
      nome: loginInfo.nome,
      role: loginInfo.role,
      categoria: loginInfo.categoria,
      comissao: loginInfo.comissao,
      contas,
      ciclos,
      meta: Number(metaR?.valor || 0),
      ranking: (rankR && !rankR.__err) ? rankR : {},
    };
  }




  let tk;
  try {
    tk = await getCachedToken(cred, false, db);
  } catch (e) {
    return { error: `Falha no login DK (${cred.dk_username}@${cred.filial_id}): ${e.message}` };
  }

  if (action === "top1") {
    const r = await fetchWithTimeout(`${DK_API}/ranking-top1`, { headers: { Authorization: `Bearer ${tk}`, "X-Filial-ID": cred.filial_id }, timeoutMs: 20000 });
    const text = await r.text();
    if (!r.ok) return { error: `top1 falhou (${r.status}): ${text}` };
    return { ok: true, ...JSON.parse(text) };
  }

  if (action === "turnos") {
    const categoria = body.categoria || "montante";
    const r = await fetchWithTimeout(`${DK_API}/turnos/?categoria=${encodeURIComponent(categoria)}`, { headers: { Authorization: `Bearer ${tk}`, "X-Filial-ID": cred.filial_id }, timeoutMs: 15000 });
    const text = await r.text();
    if (!r.ok) return { error: `turnos falhou (${r.status}): ${text}` };
    const data = JSON.parse(text);
    const fila = (data && data.fila) || [];
    const newFirst = fila[0]?.username || null;
    let rotationsToday = 0;
    try {
      const stateRows = db.exec({
        table: "dkdash_turno_alert_state", action: "select",
        filters: [{ col: "filial_id", op: "eq", val: cred.filial_id }, { col: "categoria", op: "eq", val: categoria }],
      });
      const state = stateRows[0];
      const prevFirst = state?.last_first_username || null;
      if (newFirst && prevFirst && prevFirst !== newFirst) {
        const tz = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
        const dayStr = `${tz.getFullYear()}-${String(tz.getMonth() + 1).padStart(2, "0")}-${String(tz.getDate()).padStart(2, "0")}`;
        db.exec({
          table: "dkdash_turno_rotations", action: "insert",
          payload: { user_id: "local", filial_id: cred.filial_id, categoria, rotated_username: prevFirst, day: dayStr },
        });
      }
      if (newFirst && newFirst !== prevFirst) {
        if (state) {
          db.exec({
            table: "dkdash_turno_alert_state", action: "update",
            filters: [{ col: "id", op: "eq", val: state.id }],
            payload: { last_first_username: newFirst },
          });
        } else {
          db.exec({
            table: "dkdash_turno_alert_state", action: "insert",
            payload: { filial_id: cred.filial_id, categoria, last_first_username: newFirst },
          });
        }
      }
      const tz2 = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
      const dayStr2 = `${tz2.getFullYear()}-${String(tz2.getMonth() + 1).padStart(2, "0")}-${String(tz2.getDate()).padStart(2, "0")}`;
      const todayRows = db.exec({
        table: "dkdash_turno_rotations", action: "select",
        filters: [
          { col: "filial_id", op: "eq", val: cred.filial_id },
          { col: "categoria", op: "eq", val: categoria },
          { col: "day", op: "eq", val: dayStr2 },
        ],
      });
      rotationsToday = todayRows.length;
    } catch (e) {
      console.error("[dkdash] rotation detect failed", e);
    }
    return { ok: true, my_username: cred.dk_username, categoria, data, rotations_today: rotationsToday };
  }

  if (action === "turno-action") {
    const op = body.op;
    const categoria = body.categoria || "montante";
    const target = body.target || "";
    const direcao = body.direcao === "baixo" ? "baixo" : "cima";
    let path = "";
    if (op === "mover") path = `/turnos/mover/${encodeURIComponent(target || cred.dk_username)}/${direcao}?categoria=${encodeURIComponent(categoria)}`;
    else path = `/turnos/${op}?categoria=${encodeURIComponent(categoria)}`;
    const r = await fetchWithTimeout(`${DK_API}${path}`, { method: "POST", headers: { Authorization: `Bearer ${tk}`, "X-Filial-ID": cred.filial_id }, timeoutMs: 12000 });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!r.ok) return { error: data?.detail || `Falhou (${r.status})`, data };
    return { ok: true, my_username: cred.dk_username, data };
  }

  if (action === "create-montante") {
    let bonusPerc = Number(body.bonus_perc || 0);
    if (!bonusPerc && body.rollover_bonus) {
      const rb = Number(body.rollover_bonus);
      if (Math.abs(rb - 1.10) < 0.001) bonusPerc = 10;
      else if (Math.abs(rb - 1.04) < 0.001) bonusPerc = 4;
    }
    const payload = {
      usuario_id: cred.dk_username,
      nome_ciclo: (body.nome || "").toString().trim(),
      deposito: Number(body.deposito || 0),
      saque: Number(body.saque || 0),
      blogueiro: Number(body.blogueiro || 0),
      qtd_contas: Math.max(1, Number(body.qtd_contas || 1)),
      bonus_perc: bonusPerc,
    };
    if (!payload.nome_ciclo) return { error: "Nome do montante obrigatório" };
    const r = await fetchWithTimeout(`${DK_API}/ciclos/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tk}`, "X-Filial-ID": cred.filial_id, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      timeoutMs: 45000,
    });
    const text = await r.text();
    if (!r.ok) return { error: `DK ciclos (${r.status}): ${text}` };
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { ok: true, data };
  }

  if (action === "set-meta") {
    const valor = Number(body.valor || 0);
    const r = await fetchWithTimeout(`${DK_API}/meta/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tk}`, "X-Filial-ID": cred.filial_id, "Content-Type": "application/json" },
      body: JSON.stringify({ valor }),
      timeoutMs: 12000,
    });
    const text = await r.text();
    if (!r.ok) return { error: `DK meta falhou (${r.status}): ${text}` };
    return { ok: true, valor };
  }

  if (action === "delete-ciclo") {
    const usuarioDono = (body.usuario_dono || "").toString().trim();
    const sk = (body.sk || "").toString().trim();
    if (!usuarioDono || !sk) return { error: "usuario_dono e sk obrigatórios" };
    const r = await fetchWithTimeout(`${DK_API}/ciclos/${encodeURIComponent(usuarioDono)}/${encodeURIComponent(sk)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tk}`, "X-Filial-ID": cred.filial_id },
      timeoutMs: 15000,
    });
    const text = await r.text();
    if (!r.ok) return { error: `DK delete falhou (${r.status}): ${text}` };
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { ok: true, data };
  }

  if (action === "sync-task-times") {
    return await syncTaskTimes(db, cred, tk);
  }

  if (action === "fetch") {
    const ciclos = await dkFetchCiclos(cred.filial_id, tk);
    db.exec({ table: "dkdash_credentials", action: "update", filters: [{ col: "filial_id", op: "eq", val: filialId }], payload: { last_login_at: new Date().toISOString() } });
    const map = new Map();
    for (const c of ciclos) {
      const k = (c.data_logica || c.data_ciclo || "").toString();
      if (!k) continue;
      if (!map.has(k)) map.set(k, { data: k, lucro: 0, investido: 0, saque: 0, retorno: 0, taxa_dk: 0, ciclos: [] });
      const agg = map.get(k);
      agg.lucro += Number(c.lucro || 0);
      agg.investido += Number(c.investido || 0);
      agg.saque += Number(c.saque || 0);
      agg.retorno += Number(c.retorno || 0);
      const blogueiro = Number(c.blogueiro || 0);
      const taxaCiclo = Number(c.taxa_dk ?? blogueiro * 0.2);
      agg.taxa_dk += taxaCiclo;
      agg.ciclos.push({ ...c, taxa_dk: taxaCiclo });
    }
    const dias = Array.from(map.values()).sort((a, b) => b.data.localeCompare(a.data));
    const totalLucro = dias.reduce((s, d) => s + d.lucro, 0);
    const totalTaxaDk = dias.reduce((s, d) => s + d.taxa_dk, 0);
    return { ok: true, username: cred.dk_username, filial_id: cred.filial_id, total_lucro: totalLucro, total_taxa_dk: totalTaxaDk, total_ciclos: ciclos.length, dias };
  }

  return { error: `Ação desconhecida: ${action}` };
}

module.exports = { handle };
