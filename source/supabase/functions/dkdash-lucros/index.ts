// DK Dash integration: stores user credentials encrypted, logs in to api.dkdash.site,
// fetches /ciclos/ and aggregates daily profit (lucro) by data_logica.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DK_API = "https://api.dkdash.site";

// ---------- AES-GCM helpers ----------
async function getKey(): Promise<CryptoKey> {
  const raw = Deno.env.get("DKDASH_ENC_KEY");
  if (!raw) throw new Error("DKDASH_ENC_KEY not configured");
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(raw),
  );
  return crypto.subtle.importKey("raw", buf, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function unb64(str: string): Uint8Array {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function encrypt(plain: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(plain),
    ),
  );
  const merged = new Uint8Array(iv.length + ct.length);
  merged.set(iv, 0);
  merged.set(ct, iv.length);
  return b64(merged);
}

async function decrypt(payload: string): Promise<string> {
  const key = await getKey();
  const data = unb64(payload);
  const iv = data.slice(0, 12);
  const ct = data.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

// ---------- DK Dash API ----------
function fetchWithTimeout(url: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const { timeoutMs = 20000, ...rest } = init;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...rest, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

async function dkLoginFull(filialId: string, username: string, password: string, timeoutMs = 30000): Promise<{ token: string; info: any }> {
  const body = new URLSearchParams({ username, password }).toString();
  const res = await fetchWithTimeout(`${DK_API}/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Filial-ID": filialId,
    },
    body,
    timeoutMs,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`DK login falhou (${res.status}): ${text}`);
  let j: any;
  try { j = JSON.parse(text); } catch { throw new Error("DK login resposta inválida"); }
  const token: string | undefined = j.access_token || j.token;
  if (!token) throw new Error("DK login sem token");
  return { token, info: j };
}

async function dkLogin(filialId: string, username: string, password: string, timeoutMs = 30000): Promise<string> {
  const r = await dkLoginFull(filialId, username, password, timeoutMs);
  return r.token;
}

async function dkFetchCiclos(filialId: string, token: string): Promise<any[]> {
  const res = await fetchWithTimeout(`${DK_API}/ciclos/`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Filial-ID": filialId,
      "Content-Type": "application/json",
    },
    timeoutMs: 60000,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`DK ciclos falhou (${res.status}): ${t}`);
  }
  const j = await res.json();
  return j.ciclos || [];
}

const TOKEN_SAFETY_MS = 60_000;
const FALLBACK_TTL_MS = 45 * 60_000;
type DkCredRow = {
  user_id: string;
  filial_id: string;
  dk_username: string;
  password_encrypted: string;
  cached_token?: string | null;
  cached_token_exp?: number | string | null;
  cached_token_info?: Record<string, unknown> | null;
};
type CachedLogin = { token: string; info: Record<string, unknown>; expiresAt: number };
const runtimeTokenCache = new Map<string, CachedLogin>();
const inflightLoginCache = new Map<string, Promise<CachedLogin>>();

function decodeJwtExpMs(token: string): number {
  try {
    const part = token.split(".")[1];
    if (!part) return 0;
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded));
    if (payload && typeof payload.exp === "number") return payload.exp * 1000;
  } catch {}
  return 0;
}

function credCacheKey(userId: string, filialId: string) {
  return `${userId}:${filialId}`;
}

function getRuntimeCachedLogin(userId: string, filialId: string): CachedLogin | null {
  const cached = runtimeTokenCache.get(credCacheKey(userId, filialId));
  if (!cached) return null;
  if (Date.now() >= cached.expiresAt - TOKEN_SAFETY_MS) {
    runtimeTokenCache.delete(credCacheKey(userId, filialId));
    return null;
  }
  return cached;
}

function setRuntimeCachedLogin(userId: string, filialId: string, login: CachedLogin) {
  runtimeTokenCache.set(credCacheKey(userId, filialId), login);
}

function clearRuntimeCachedLogin(userId: string, filialId: string) {
  runtimeTokenCache.delete(credCacheKey(userId, filialId));
}

function getPersistedCachedLogin(cred: DkCredRow): CachedLogin | null {
  const token = cred.cached_token;
  const expiresAt = Number(cred.cached_token_exp || 0);
  const info = cred.cached_token_info || {};
  if (!token || !expiresAt) return null;
  if (Date.now() >= expiresAt - TOKEN_SAFETY_MS) return null;
  return { token, info, expiresAt };
}

async function persistCachedLogin(supabase: ReturnType<typeof createClient>, cred: DkCredRow, login: CachedLogin) {
  const { error } = await supabase
    .from("dkdash_credentials")
    .update({
      cached_token: login.token,
      cached_token_exp: login.expiresAt,
      cached_token_info: login.info,
      last_login_at: new Date().toISOString(),
    })
    .eq("user_id", cred.user_id)
    .eq("filial_id", cred.filial_id);
  if (error) throw error;
}

async function clearPersistedCachedLogin(supabase: ReturnType<typeof createClient>, cred: Pick<DkCredRow, "user_id" | "filial_id">) {
  await supabase
    .from("dkdash_credentials")
    .update({ cached_token: null, cached_token_exp: null, cached_token_info: null })
    .eq("user_id", cred.user_id)
    .eq("filial_id", cred.filial_id);
}

async function getCachedLogin(
  supabase: ReturnType<typeof createClient>,
  cred: DkCredRow,
  force = false,
): Promise<CachedLogin> {
  const key = credCacheKey(cred.user_id, cred.filial_id);

  if (!force) {
    const runtime = getRuntimeCachedLogin(cred.user_id, cred.filial_id);
    if (runtime) return runtime;

    const persisted = getPersistedCachedLogin(cred);
    if (persisted) {
      setRuntimeCachedLogin(cred.user_id, cred.filial_id, persisted);
      return persisted;
    }

    const inflight = inflightLoginCache.get(key);
    if (inflight) return await inflight;
  } else {
    clearRuntimeCachedLogin(cred.user_id, cred.filial_id);
    inflightLoginCache.delete(key);
    await clearPersistedCachedLogin(supabase, cred);
  }

  const promise = (async () => {
    console.log(`[dkdash] /login DK (${cred.dk_username}@${cred.filial_id})`);
    const password = await decrypt(cred.password_encrypted);
    const login = await dkLoginFull(cred.filial_id, cred.dk_username, password);
    const expiresAt = decodeJwtExpMs(login.token) || (Date.now() + FALLBACK_TTL_MS);
    const cached = { token: login.token, info: login.info, expiresAt };
    setRuntimeCachedLogin(cred.user_id, cred.filial_id, cached);
    await persistCachedLogin(supabase, cred, cached);
    return cached;
  })();

  inflightLoginCache.set(key, promise);
  try {
    return await promise;
  } finally {
    if (inflightLoginCache.get(key) === promise) inflightLoginCache.delete(key);
  }
}

async function getCachedToken(supabase: ReturnType<typeof createClient>, cred: DkCredRow, force = false): Promise<string> {
  return (await getCachedLogin(supabase, cred, force)).token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Não autenticado" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimData, error: claimErr } = await supabase.auth.getClaims(token);
    if (claimErr || !claimData?.claims) return json({ error: "Token inválido" }, 401);
    const userId = claimData.claims.sub as string;

    const body = await req.json().catch(() => ({}));
    const action: string = body.action || "fetch";
    const filialId: string = (body.filial_id || "filial01").toString();

    if (action === "save-credentials") {
      const username = (body.username || "").toString().trim();
      const password = (body.password || "").toString();
      if (!username || !password) return json({ error: "username e password obrigatórios" }, 400);
      try {
        await dkLogin(filialId, username, password);
      } catch (e) {
        return json({ error: `Credenciais inválidas: ${(e as Error).message}` }, 400);
      }
      const password_encrypted = await encrypt(password);
      const { error } = await supabase
        .from("dkdash_credentials")
        .upsert({
          user_id: userId,
          filial_id: filialId,
          dk_username: username,
          password_encrypted,
          cached_token: null,
          cached_token_exp: null,
          cached_token_info: null,
          last_login_at: new Date().toISOString(),
        }, { onConflict: "user_id,filial_id" });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (action === "status") {
      const { data, error } = await supabase
        .from("dkdash_credentials")
        .select("dk_username, filial_id, last_login_at, updated_at")
        .eq("user_id", userId)
        .eq("filial_id", filialId)
        .maybeSingle();
      if (error) return json({ error: error.message }, 500);
      return json({ connected: !!data, info: data || null });
    }

    if (action === "delete-credentials") {
      const { error } = await supabase
        .from("dkdash_credentials")
        .delete()
        .eq("user_id", userId)
        .eq("filial_id", filialId);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (action === "top1") {
      const { data: cred } = await supabase
        .from("dkdash_credentials")
        .select("user_id, dk_username, password_encrypted, filial_id, cached_token, cached_token_exp, cached_token_info")
        .eq("user_id", userId).eq("filial_id", filialId).maybeSingle();
      if (!cred) return json({ error: "Credenciais não cadastradas" }, 404);
      const tk = await getCachedToken(supabase, cred as DkCredRow);
      const r = await fetchWithTimeout(`${DK_API}/ranking-top1`, {
        headers: { Authorization: `Bearer ${tk}`, "X-Filial-ID": cred.filial_id },
        timeoutMs: 20000,
      });
      if (!r.ok) {
        const t = await r.text();
        return json({ error: `DK ranking-top1 falhou (${r.status}): ${t}` }, 500);
      }
      const data = await r.json();
      return json({ ok: true, ...data });
    }

    if (action === "probe") {
      const { data: cred } = await supabase
        .from("dkdash_credentials")
        .select("user_id, dk_username, password_encrypted, filial_id, cached_token, cached_token_exp, cached_token_info")
        .eq("user_id", userId).eq("filial_id", filialId).maybeSingle();
      if (!cred) return json({ error: "Credenciais não cadastradas" }, 404);
      const tk = await getCachedToken(supabase, cred as DkCredRow);
      const paths = [
        "/ranking-top1?limit=10", "/ranking-top1?todos=1", "/ranking-top1?completo=1",
        "/ranking-top1/all", "/ranking-top1/completo", "/ranking-top1?n=5",
        "/admin/", "/admin/usuarios", "/admin/operadores", "/admin/ranking",
        "/comissoes/", "/metricas/", "/relatorios/", "/relatorio/",
        "/operadores/?todos=1", "/contas/?usuario=jotave", "/ciclos/?usuario=jotave",
        "/contas/?username=jotave", "/ciclos/?username=jotave",
        "/contas/?user=jotave", "/ciclos/?user=jotave",
        "/usuario/jotave", "/users/jotave", "/operador/jotave",
        "/filial/", "/filial/operadores", "/me", "/me/", "/perfil/", "/profile/",
      ];
      const results: any[] = [];
      for (const p of paths) {
        try {
          const r = await fetchWithTimeout(`${DK_API}${p}`, {
            headers: { Authorization: `Bearer ${tk}`, "X-Filial-ID": cred.filial_id },
            timeoutMs: 10000,
          });
          const t = await r.text();
          results.push({ path: p, status: r.status, len: t.length, sample: t.slice(0, 300) });
        } catch (e: any) {
          results.push({ path: p, error: e.message });
        }
      }
      return json({ ok: true, results });
    }

    if (action === "turnos") {
      const { data: cred } = await supabase
        .from("dkdash_credentials")
        .select("user_id, dk_username, password_encrypted, filial_id, cached_token, cached_token_exp, cached_token_info")
        .eq("user_id", userId).eq("filial_id", filialId).maybeSingle();
      if (!cred) return json({ error: "Credenciais não cadastradas" }, 404);
      const tk = await getCachedToken(supabase, cred as DkCredRow);
      const categoria = (body.categoria || "montante").toString();
      const r = await fetchWithTimeout(`${DK_API}/turnos/?categoria=${encodeURIComponent(categoria)}`, {
        headers: { Authorization: `Bearer ${tk}`, "X-Filial-ID": cred.filial_id },
        timeoutMs: 15000,
      });
      if (!r.ok) {
        const t = await r.text();
        return json({ error: `DK turnos falhou (${r.status}): ${t}` }, 500);
      }
      const data = await r.json();
      const fila = (data?.fila || []) as Array<{ nome: string; username: string }>;
      const newFirst = fila[0]?.username || null;

      // Detecta rodada: quem era o 1º foi pro fim da fila
      let rotationsToday = 0;
      try {
        const { data: state } = await supabase
          .from("dkdash_turno_alert_state")
          .select("id, last_first_username")
          .eq("user_id", userId)
          .eq("filial_id", cred.filial_id)
          .eq("categoria", categoria)
          .maybeSingle();
        const prevFirst = state?.last_first_username || null;

        if (newFirst && prevFirst && prevFirst !== newFirst && fila.length > 1) {
          const lastIdx = fila.length - 1;
          if (fila[lastIdx]?.username === prevFirst) {
            // rodada detectada
            await supabase.from("dkdash_turno_rotations").insert({
              user_id: userId,
              filial_id: cred.filial_id,
              categoria,
              rotated_username: prevFirst,
            });
          }
        }
        if (newFirst && newFirst !== prevFirst) {
          await supabase
            .from("dkdash_turno_alert_state")
            .upsert({
              user_id: userId,
              filial_id: cred.filial_id,
              categoria,
              last_first_username: newFirst,
            }, { onConflict: "user_id,filial_id,categoria" });
        }

        // Conta rodadas de hoje (timezone São Paulo)
        const tzDate = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
        const dayStr = `${tzDate.getFullYear()}-${String(tzDate.getMonth() + 1).padStart(2, "0")}-${String(tzDate.getDate()).padStart(2, "0")}`;
        const { count } = await supabase
          .from("dkdash_turno_rotations")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("filial_id", cred.filial_id)
          .eq("categoria", categoria)
          .eq("day", dayStr);
        rotationsToday = count || 0;
      } catch (e) {
        console.error("rotation detect failed", e);
      }

      return json({ ok: true, my_username: cred.dk_username, categoria, data, rotations_today: rotationsToday });
    }

    if (action === "turno-action") {
      const op = (body.op || "").toString();
      const categoria = (body.categoria || "montante").toString();
      const target = (body.target || "").toString();
      const direcao = (body.direcao || "").toString();
      const allowed = new Set(["entrar","sair","proximo","mover"]);
      if (!allowed.has(op)) return json({ error: "op inválida" }, 400);

      const { data: cred } = await supabase
        .from("dkdash_credentials")
        .select("user_id, dk_username, password_encrypted, filial_id, cached_token, cached_token_exp, cached_token_info")
        .eq("user_id", userId).eq("filial_id", filialId).maybeSingle();
      if (!cred) return json({ error: "Credenciais não cadastradas" }, 404);
      const tk = await getCachedToken(supabase, cred as DkCredRow);

      let path = "";
      if (op === "mover") {
        const user = target || cred.dk_username;
        const dir = direcao === "baixo" ? "baixo" : "cima";
        path = `/turnos/mover/${encodeURIComponent(user)}/${dir}?categoria=${encodeURIComponent(categoria)}`;
      } else {
        path = `/turnos/${op}?categoria=${encodeURIComponent(categoria)}`;
      }

      const r = await fetchWithTimeout(`${DK_API}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tk}`, "X-Filial-ID": cred.filial_id },
        timeoutMs: 12000,
      });
      const text = await r.text();
      let data: any; try { data = JSON.parse(text); } catch { data = { raw: text }; }
      if (!r.ok) return json({ error: data?.detail || `Falhou (${r.status})`, data }, r.status);
      return json({ ok: true, my_username: cred.dk_username, data });
    }

    if (action === "create-montante") {
      const nome = (body.nome || "").toString().trim();
      const deposito = Number(body.deposito || 0);
      const saque = Number(body.saque || 0);
      const blogueiro = Number(body.blogueiro || 0);
      const qtdContas = Math.max(1, Number(body.qtd_contas || 1));
      // Novo: bonus_perc (pontos percentuais somados à % do blogueiro).
      // Aceita rollover_bonus (1.04 / 1.10) por compatibilidade.
      let bonusPerc = Number(body.bonus_perc || 0);
      if (!bonusPerc && body.rollover_bonus) {
        const rb = Number(body.rollover_bonus);
        if (Math.abs(rb - 1.10) < 0.001) bonusPerc = 10;
        else if (Math.abs(rb - 1.04) < 0.001) bonusPerc = 4;
      }
      if (!nome) return json({ error: "Nome do montante obrigatório" }, 400);

      const { data: cred } = await supabase
        .from("dkdash_credentials")
        .select("user_id, dk_username, password_encrypted, filial_id, cached_token, cached_token_exp, cached_token_info")
        .eq("user_id", userId).eq("filial_id", filialId).maybeSingle();
      if (!cred) return json({ error: "Credenciais DK Dash não cadastradas" }, 404);

      const tk = await getCachedToken(supabase, cred as DkCredRow);

      // DK espera blogueiro BASE (sem o extra) + bonus_perc separado.
      // Frontend manda o valor cheio (com extra já somado) por compat visual,
      // então subtraímos aqui antes de enviar.
      const extra = deposito * (bonusPerc / 100);
      const blogueiroBase = Math.max(0, Math.round((blogueiro - extra) * 100) / 100);

      const payload = {
        usuario_id: cred.dk_username,
        nome_ciclo: nome,
        deposito,
        saque,
        blogueiro: blogueiroBase,
        qtd_contas: qtdContas,
        bonus_perc: bonusPerc,
        sk: null,
      };
      console.log("[dkdash] create-montante payload:", JSON.stringify(payload));

      const r = await fetchWithTimeout(`${DK_API}/ciclos/`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tk}`,
          "X-Filial-ID": cred.filial_id,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        timeoutMs: 45000,
      });
      const text = await r.text();
      if (!r.ok) return json({ error: `DK ciclos falhou (${r.status}): ${text}` }, 500);
      let data: unknown;
      try { data = JSON.parse(text); } catch { data = { raw: text }; }
      return json({ ok: true, data });
    }

    if (action === "sync-task-times") {
      const { data: cred } = await supabase
        .from("dkdash_credentials")
        .select("user_id, dk_username, password_encrypted, filial_id, cached_token, cached_token_exp, cached_token_info")
        .eq("user_id", userId).eq("filial_id", filialId).maybeSingle();
      if (!cred) return json({ error: "Credenciais não cadastradas" }, 404);
      const tk = await getCachedToken(supabase, cred as DkCredRow);
      const ciclos = await dkFetchCiclos(cred.filial_id, tk);

      // Index ciclos by nome_ciclo (latest first)
      const byNome = new Map<string, any>();
      for (const c of ciclos) {
        const nome = String(c.nome_ciclo || "").trim();
        if (!nome) continue;
        const ts = c.created_at || c.data_criacao || c.data_ciclo || c.data_logica || null;
        const prev = byNome.get(nome);
        if (!prev || (ts && String(ts) > String(prev._ts || ""))) {
          byNome.set(nome, { ...c, _ts: ts });
        }
      }

      const { data: tasks } = await supabase
        .from("wa_tasks")
        .select("id, nome_tarefa, link, completed_at, operation_data")
        .eq("user_id", userId)
        .eq("status", "done");

      const updates: any[] = [];
      const skipped: any[] = [];
      for (const t of (tasks || [])) {
        const candidates = [t.nome_tarefa, t.link].map((s) => String(s || "").trim()).filter(Boolean);
        let matched: any = null;
        for (const c of candidates) { if (byNome.has(c)) { matched = byNome.get(c); break; } }
        if (!matched) { skipped.push({ id: t.id, nome: t.nome_tarefa, reason: "sem ciclo" }); continue; }
        const rawTs = matched._ts;
        if (!rawTs) { skipped.push({ id: t.id, nome: t.nome_tarefa, reason: "ciclo sem timestamp" }); continue; }
        // Parse timestamp - if only date, append 12:00
        let iso: string;
        const s = String(rawTs);
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) iso = `${s}T12:00:00-03:00`;
        else { const d = new Date(s); if (isNaN(d.getTime())) { skipped.push({ id: t.id, reason: `ts inválido: ${s}` }); continue; } iso = d.toISOString(); }
        const prevOp = (t.operation_data as any) || {};
        const newOp = { ...prevOp, dk_synced: true, savedAt: iso };
        const { error: upErr } = await supabase
          .from("wa_tasks")
          .update({ completed_at: iso, operation_data: newOp })
          .eq("id", t.id);
        if (upErr) { skipped.push({ id: t.id, reason: upErr.message }); continue; }
        updates.push({ id: t.id, nome: t.nome_tarefa, completed_at: iso });
      }
      return json({ ok: true, updated: updates.length, total_tasks: tasks?.length || 0, total_ciclos: ciclos.length, updates, skipped, sample_ciclo: ciclos[0] || null });
    }

    if (action === "contas") {
      const { data: cred } = await supabase
        .from("dkdash_credentials")
        .select("user_id, dk_username, password_encrypted, filial_id, cached_token, cached_token_exp, cached_token_info")
        .eq("user_id", userId).eq("filial_id", filialId).maybeSingle();
      if (!cred) return json({ error: "Credenciais não cadastradas" }, 404);
      const tk = await getCachedToken(supabase, cred as DkCredRow);
      const r = await fetchWithTimeout(`${DK_API}/contas/`, {
        headers: { Authorization: `Bearer ${tk}`, "X-Filial-ID": cred.filial_id },
        timeoutMs: 30000,
      });
      const text = await r.text();
      if (!r.ok) return json({ error: `DK contas falhou (${r.status}): ${text}` }, 500);
      let data: any; try { data = JSON.parse(text); } catch { data = { raw: text }; }
      return json({ ok: true, data });
    }

    if (action === "fetch") {
      const { data: cred, error: credErr } = await supabase
        .from("dkdash_credentials")
        .select("user_id, dk_username, password_encrypted, filial_id, cached_token, cached_token_exp, cached_token_info")
        .eq("user_id", userId).eq("filial_id", filialId).maybeSingle();
      if (credErr) return json({ error: credErr.message }, 500);
      if (!cred) return json({ error: "Credenciais não cadastradas" }, 404);

      const dkToken = await getCachedToken(supabase, cred as DkCredRow);
      const ciclos = await dkFetchCiclos(cred.filial_id, dkToken);

      await supabase.from("dkdash_credentials")
        .update({ last_login_at: new Date().toISOString() })
        .eq("user_id", userId).eq("filial_id", filialId);

      const map = new Map<string, {
        data: string; lucro: number; investido: number; saque: number;
        retorno: number; taxa_dk: number; ciclos: any[];
      }>();
      for (const c of ciclos) {
        const k = (c.data_logica || c.data_ciclo || "").toString();
        if (!k) continue;
        if (!map.has(k)) map.set(k, { data: k, lucro: 0, investido: 0, saque: 0, retorno: 0, taxa_dk: 0, ciclos: [] });
        const agg = map.get(k)!;
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
      return json({
        ok: true, filial_id: cred.filial_id,
        username: cred.dk_username,
        total_lucro: totalLucro, total_taxa_dk: totalTaxaDk,
        total_ciclos: ciclos.length, dias,
      });
    }

    if (action === "main-dashboard") {
      const { data: cred } = await supabase
        .from("dkdash_credentials")
        .select("user_id, dk_username, password_encrypted, filial_id, cached_token, cached_token_exp, cached_token_info")
        .eq("user_id", userId).eq("filial_id", filialId).maybeSingle();
      if (!cred) return json({ error: "Credenciais não cadastradas" }, 404);
      const { token: tk, info: loginInfo } = await getCachedLogin(supabase, cred as DkCredRow);

      const inicio = (body.inicio || "").toString();
      const fim = (body.fim || "").toString();
      let q = "";
      if (inicio && fim) q = `?inicio=${inicio}&fim=${fim}`;
      else if (inicio) q = `?inicio=${inicio}`;

      const auth = { Authorization: `Bearer ${tk}`, "X-Filial-ID": cred.filial_id };
      const fetchJ = async (path: string) => {
        const r = await fetchWithTimeout(`${DK_API}${path}`, { headers: auth, timeoutMs: 30000 });
        if (!r.ok) return null;
        try { return await r.json(); } catch { return null; }
      };

      const [contasR, ciclosR, metaR, rankR, finR] = await Promise.all([
        fetchJ(`/contas/${q}`),
        fetchJ(`/ciclos/${q}`),
        fetchJ(`/meta/`),
        fetchJ(`/ranking-top1`),
        fetchJ(`/financeiro/status`),
      ]);

      console.log("[dkdash] /financeiro/status payload:", JSON.stringify(finR));
      console.log("[dkdash] /ranking-top1 payload:", JSON.stringify(rankR));

      return json({
        ok: true,
        username: cred.dk_username,
        filial_id: cred.filial_id,
        nome: loginInfo.nome,
        role: loginInfo.role,
        categoria: loginInfo.categoria,
        comissao: loginInfo.comissao,
        contas: contasR?.contas || [],
        ciclos: ciclosR?.ciclos || [],
        meta: Number(metaR?.valor || 0),
        ranking: rankR || {},
        financeiro: finR || null,
      });
    }


    if (action === "set-meta") {
      const { data: cred } = await supabase
        .from("dkdash_credentials")
        .select("user_id, dk_username, password_encrypted, filial_id, cached_token, cached_token_exp, cached_token_info")
        .eq("user_id", userId).eq("filial_id", filialId).maybeSingle();
      if (!cred) return json({ error: "Credenciais não cadastradas" }, 404);
      const tk = await getCachedToken(supabase, cred as DkCredRow);
      const valor = Number(body.valor || 0);
      const r = await fetchWithTimeout(`${DK_API}/meta/`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tk}`, "X-Filial-ID": cred.filial_id, "Content-Type": "application/json" },
        body: JSON.stringify({ valor }),
        timeoutMs: 12000,
      });
      const text = await r.text();
      if (!r.ok) return json({ error: `DK meta falhou (${r.status}): ${text}` }, 500);
      return json({ ok: true, valor });
    }

    if (action === "delete-ciclo") {
      const usuarioDono = (body.usuario_dono || "").toString().trim();
      const sk = (body.sk || "").toString().trim();
      if (!usuarioDono || !sk) return json({ error: "usuario_dono e sk obrigatórios" }, 400);
      const { data: cred } = await supabase
        .from("dkdash_credentials")
        .select("user_id, dk_username, password_encrypted, filial_id, cached_token, cached_token_exp, cached_token_info")
        .eq("user_id", userId).eq("filial_id", filialId).maybeSingle();
      if (!cred) return json({ error: "Credenciais não cadastradas" }, 404);
      const tk = await getCachedToken(supabase, cred as DkCredRow);
      const r = await fetchWithTimeout(
        `${DK_API}/ciclos/${encodeURIComponent(usuarioDono)}/${encodeURIComponent(sk)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${tk}`, "X-Filial-ID": cred.filial_id },
          timeoutMs: 15000,
        },
      );
      const text = await r.text();
      if (!r.ok) return json({ error: `DK delete falhou (${r.status}): ${text}` }, r.status);
      let data: any; try { data = JSON.parse(text); } catch { data = { raw: text }; }
      return json({ ok: true, data });
    }

    return json({ error: `Ação desconhecida: ${action}` }, 400);
  } catch (err: any) {
    console.error("dkdash-lucros error:", err);
    return json({ error: err?.message || "Erro interno" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
