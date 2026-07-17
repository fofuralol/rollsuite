import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import webpush from "https://esm.sh/web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const VAPID_PUBLIC = "BBoQs8679ZB5Hbs7CS0zuYf8rX-GrMHo6m8ebAcUw3pGzslglF8GlwpT9w_kCVp13RxJ029S3ADTRZItAZyhMdE";
const DK_API = "https://api.dkdash.site";
const TOKEN_SAFETY_MS = 60_000;
const FALLBACK_TTL_MS = 45 * 60_000;

type CredentialRow = {
  user_id: string;
  filial_id: string;
  dk_username: string;
  password_encrypted: string;
  cached_token?: string | null;
  cached_token_exp?: number | string | null;
  cached_token_info?: Record<string, unknown> | null;
};

type SubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

type LoginCacheEntry = {
  token: string;
  info: Record<string, unknown>;
  expiresAt: number;
};

const tokenCache = new Map<string, LoginCacheEntry>();
const loginInflight = new Map<string, Promise<LoginCacheEntry>>();

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getKey(): Promise<CryptoKey> {
  const raw = Deno.env.get("DKDASH_ENC_KEY");
  if (!raw) throw new Error("DKDASH_ENC_KEY not configured");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return crypto.subtle.importKey("raw", buf, { name: "AES-GCM" }, false, ["decrypt"]);
}

function unb64(str: string): Uint8Array {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function decrypt(payload: string): Promise<string> {
  const key = await getKey();
  const data = unb64(payload);
  const iv = data.slice(0, 12);
  const ct = data.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

function fetchWithTimeout(url: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const { timeoutMs = 15000, ...rest } = init;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...rest, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

async function dkLoginFull(filialId: string, username: string, password: string): Promise<{ token: string; info: Record<string, unknown> }> {
  const body = new URLSearchParams({ username, password }).toString();
  const res = await fetchWithTimeout(`${DK_API}/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Filial-ID": filialId,
    },
    body,
    timeoutMs: 12000,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`DK login falhou (${res.status}): ${text}`);
  const parsed = JSON.parse(text);
  const token = parsed.access_token || parsed.token;
  if (!token) throw new Error("DK login sem token");
  return { token, info: parsed };
}

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

function cacheKey(cred: Pick<CredentialRow, "user_id" | "filial_id">) {
  return `${cred.user_id}:${cred.filial_id}`;
}

function cacheGet(cred: Pick<CredentialRow, "user_id" | "filial_id">): LoginCacheEntry | null {
  const cached = tokenCache.get(cacheKey(cred));
  if (!cached) return null;
  if (Date.now() >= cached.expiresAt - TOKEN_SAFETY_MS) {
    tokenCache.delete(cacheKey(cred));
    return null;
  }
  return cached;
}

function cacheSet(cred: Pick<CredentialRow, "user_id" | "filial_id">, entry: LoginCacheEntry) {
  tokenCache.set(cacheKey(cred), entry);
}

function cacheInvalidate(cred: Pick<CredentialRow, "user_id" | "filial_id">) {
  tokenCache.delete(cacheKey(cred));
}

function loadPersistedToken(cred: CredentialRow): LoginCacheEntry | null {
  const token = cred.cached_token;
  const expiresAt = Number(cred.cached_token_exp || 0);
  const info = cred.cached_token_info || {};
  if (!token || !expiresAt) return null;
  if (Date.now() >= expiresAt - TOKEN_SAFETY_MS) return null;
  return { token, info, expiresAt };
}

async function persistToken(supabase: ReturnType<typeof createClient>, cred: CredentialRow, entry: LoginCacheEntry) {
  const { error } = await supabase
    .from("dkdash_credentials")
    .update({
      cached_token: entry.token,
      cached_token_exp: entry.expiresAt,
      cached_token_info: entry.info,
      last_login_at: new Date().toISOString(),
    })
    .eq("user_id", cred.user_id)
    .eq("filial_id", cred.filial_id);
  if (error) throw error;
}

async function clearPersistedToken(supabase: ReturnType<typeof createClient>, cred: CredentialRow) {
  await supabase
    .from("dkdash_credentials")
    .update({ cached_token: null, cached_token_exp: null, cached_token_info: null })
    .eq("user_id", cred.user_id)
    .eq("filial_id", cred.filial_id);
}

async function getCachedLogin(supabase: ReturnType<typeof createClient>, cred: CredentialRow, force = false): Promise<LoginCacheEntry> {
  const key = cacheKey(cred);

  if (!force) {
    const cached = cacheGet(cred);
    if (cached) return cached;

    const persisted = loadPersistedToken(cred);
    if (persisted) {
      cacheSet(cred, persisted);
      return persisted;
    }

    const inflight = loginInflight.get(key);
    if (inflight) return await inflight;
  } else {
    cacheInvalidate(cred);
    loginInflight.delete(key);
    await clearPersistedToken(supabase, cred);
  }

  const loginPromise = (async () => {
    console.log(`[dkdash-turno-poll] /login DK (${cred.dk_username}@${cred.filial_id})`);
    const password = await decrypt(cred.password_encrypted);
    const login = await dkLoginFull(cred.filial_id, cred.dk_username, password);
    const expiresAt = decodeJwtExpMs(login.token) || (Date.now() + FALLBACK_TTL_MS);
    const entry = { token: login.token, info: login.info, expiresAt };
    cacheSet(cred, entry);
    await persistToken(supabase, cred, entry);
    return entry;
  })();

  loginInflight.set(key, loginPromise);
  try {
    return await loginPromise;
  } finally {
    if (loginInflight.get(key) === loginPromise) loginInflight.delete(key);
  }
}

async function fetchTurnos(supabase: ReturnType<typeof createClient>, cred: CredentialRow, categoria: string) {
  let login = await getCachedLogin(supabase, cred, false);
  const doFetch = (token: string) => fetchWithTimeout(`${DK_API}/turnos/?categoria=${encodeURIComponent(categoria)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Filial-ID": cred.filial_id,
      "Content-Type": "application/json",
    },
    timeoutMs: 12000,
  });

  let res = await doFetch(login.token);
  if (res.status === 401) {
    login = await getCachedLogin(supabase, cred, true);
    res = await doFetch(login.token);
  }

  const text = await res.text();
  if (!res.ok) throw new Error(`DK turnos falhou (${res.status}): ${text}`);
  const data = JSON.parse(text);
  return (data?.fila || []) as Array<{ nome: string; username: string }>;
}

async function sendPushToUser(subs: SubscriptionRow[], title: string, message: string, tag: string) {
  const payload = JSON.stringify({
    title,
    body: message.slice(0, 200),
    url: "/dk-dash",
    tag,
    requireInteraction: true,
  });

  const results = await Promise.allSettled(
    subs.map((s) =>
      webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
      )
    )
  );

  return results.filter((r) => r.status === "fulfilled").length;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const internalToken = Deno.env.get("TURNO_POLL_INTERNAL_TOKEN");
    if (internalToken) {
      const received = req.headers.get("x-internal-token");
      if (received !== internalToken) return json({ error: "forbidden" }, 403);
    }

    const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY");
    const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";
    if (!VAPID_PRIVATE) return json({ error: "missing VAPID_PRIVATE_KEY" }, 500);

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: credentials, error: credentialsError } = await supabase
      .from("dkdash_credentials")
      .select("user_id, filial_id, dk_username, password_encrypted, cached_token, cached_token_exp, cached_token_info");

    if (credentialsError) throw credentialsError;
    if (!credentials?.length) return json({ ok: true, checked: 0, sent: 0 });

    const categorias = ["montante"];
    let checked = 0;
    let sent = 0;

    for (const cred of credentials as CredentialRow[]) {
      for (const categoria of categorias) {
        checked += 1;

        try {
          const fila = await fetchTurnos(supabase, cred, categoria);
          const first = fila[0];
          const proximo = fila[1]?.nome;

          const signature = first?.username === cred.dk_username
            ? `${categoria}:${cred.dk_username}:${fila[1]?.username || ""}`
            : null;

          const { data: state } = await supabase
            .from("dkdash_turno_alert_state")
            .select("id, last_signature")
            .eq("user_id", cred.user_id)
            .eq("filial_id", cred.filial_id)
            .eq("categoria", categoria)
            .maybeSingle();

          if (!signature) {
            if (state?.id && state.last_signature) {
              await supabase
                .from("dkdash_turno_alert_state")
                .update({ last_signature: null })
                .eq("id", state.id);
            }
            continue;
          }

          if (state?.last_signature === signature) continue;

          const { data: subs } = await supabase
            .from("push_subscriptions")
            .select("id, user_id, endpoint, p256dh, auth")
            .eq("user_id", cred.user_id);

          if (!subs?.length) {
            await supabase
              .from("dkdash_turno_alert_state")
              .upsert({
                user_id: cred.user_id,
                filial_id: cred.filial_id,
                categoria,
                last_signature: signature,
                last_notified_at: new Date().toISOString(),
              }, { onConflict: "user_id,filial_id,categoria" });
            continue;
          }

          const delivered = await sendPushToUser(
            subs as SubscriptionRow[],
            "🎯 DK Dash · É a sua vez!",
            `Categoria ${categoria}${proximo ? ` · próximo: ${proximo}` : ""}`,
            `dkdash-turno-${signature}`,
          );

          if (delivered > 0) {
            sent += delivered;
            await supabase
              .from("dkdash_turno_alert_state")
              .upsert({
                user_id: cred.user_id,
                filial_id: cred.filial_id,
                categoria,
                last_signature: signature,
                last_notified_at: new Date().toISOString(),
              }, { onConflict: "user_id,filial_id,categoria" });
          }
        } catch (error) {
          console.error("dkdash-turno-poll user failed", {
            user_id: cred.user_id,
            filial_id: cred.filial_id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return json({ ok: true, checked, sent });
  } catch (error) {
    console.error("dkdash-turno-poll fatal", error);
    return json({ error: error instanceof Error ? error.message : "unknown" }, 500);
  }
});