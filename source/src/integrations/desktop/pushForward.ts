// Encaminha mensagens do WhatsApp (recebidas no app desktop) para a nuvem:
//  1) edge function `send-push` -> notificação Web Push no browser/PWA
//  2) edge function `whatsapp-webhook` -> insere em `wa_messages` para que o
//     card do WhatsApp no browser receba a mensagem em realtime.
import { createClient } from "@supabase/supabase-js";

const URL = import.meta.env.VITE_SUPABASE_URL as string;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

const ENABLED_KEY = "monitor_push_forward_enabled";
const USER_ID_KEY = "monitor_push_forward_user_id";
const WA_TOKEN_KEY = "monitor_push_forward_wa_token";

const nickToEmail = (n: string) => {
  const t = n.trim();
  if (t.includes("@")) return t.toLowerCase();
  return `${t.toLowerCase().replace(/[^a-z0-9_]/g, "")}@rolls.local`;
};

export function isPushForwardEnabled(): boolean {
  try { return localStorage.getItem(ENABLED_KEY) === "1"; } catch { return false; }
}

export function getPushForwardUserId(): string | null {
  try { return localStorage.getItem(USER_ID_KEY); } catch { return null; }
}

function getWaToken(): string | null {
  try { return localStorage.getItem(WA_TOKEN_KEY); } catch { return null; }
}

export function setPushForwardEnabled(v: boolean) {
  try { localStorage.setItem(ENABLED_KEY, v ? "1" : "0"); } catch {}
}

/** Login na nuvem, salva user_id + wa_token e ativa o encaminhamento. */
export async function activatePushForward(emailOrNick: string, password: string): Promise<string> {
  if (!URL || !KEY) throw new Error("Supabase env ausente");
  const cloud = createClient(URL, KEY, { auth: { persistSession: false } });
  const email = nickToEmail(emailOrNick);
  const { data, error } = await cloud.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error(error?.message || "Login falhou");
  try { localStorage.setItem(USER_ID_KEY, data.user.id); } catch {}

  // Busca o primeiro wa_token do usuário pra usar no webhook. Se não houver,
  // cria um novo automaticamente para que o card do WhatsApp no browser receba
  // as mensagens.
  try {
    const { data: tokens } = await cloud
      .from("wa_tokens")
      .select("token")
      .order("created_at")
      .limit(1);
    let token = tokens?.[0]?.token as string | undefined;
    if (!token) {
      const arr = new Uint8Array(24);
      crypto.getRandomValues(arr);
      token = Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
      await cloud.from("wa_tokens").insert({ token, label: "Desktop App", user_id: data.user.id });
    }
    try { localStorage.setItem(WA_TOKEN_KEY, token); } catch {}
  } catch (e) {
    console.warn("[pushForward] wa_token fetch fail", e);
  }

  setPushForwardEnabled(true);
  return data.user.id;
}

export function deactivatePushForward() {
  setPushForwardEnabled(false);
}

async function ensureWaToken(force = false): Promise<string | null> {
  if (force) { try { localStorage.removeItem(WA_TOKEN_KEY); } catch {} }
  let token = force ? null : getWaToken();
  if (token) return token;
  if (!URL || !KEY) return null;
  // Lazy fetch usando credenciais salvas no Monitor (mesmas do botão "Sincronizar / Push").
  let email = "";
  let pwd = "";
  try {
    email = localStorage.getItem("monitor_sync_email") || "";
    pwd = localStorage.getItem("monitor_sync_pwd") || "";
  } catch {}
  if (!email || !pwd) {
    console.warn("[pushForward] wa_token ausente e sem credenciais — reative o Push no Monitor");
    return null;
  }
  try {
    const cloud = createClient(URL, KEY, {
      auth: { persistSession: false, storageKey: "rolls-cloud-push-auth", autoRefreshToken: false, detectSessionInUrl: false },
    });
    const e = email.includes("@") ? email.toLowerCase() : `${email.toLowerCase().replace(/[^a-z0-9_]/g, "")}@rolls.local`;
    const { data, error } = await cloud.auth.signInWithPassword({ email: e, password: pwd });
    if (error || !data.user) {
      if (/invalid.*credentials|invalid login/i.test(error?.message || "")) {
        try { localStorage.removeItem("monitor_sync_pwd"); } catch {}
      }
      throw new Error(error?.message || "login fail");
    }
    try { localStorage.setItem(USER_ID_KEY, data.user.id); } catch {}
    const { data: tokens } = await cloud
      .from("wa_tokens").select("token").order("created_at").limit(1);
    token = tokens?.[0]?.token as string | undefined;
    if (!token) {
      const arr = new Uint8Array(24);
      crypto.getRandomValues(arr);
      token = Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
      await cloud.from("wa_tokens").insert({ token, label: "Desktop App", user_id: data.user.id });
    }
    try { localStorage.setItem(WA_TOKEN_KEY, token); } catch {}
    console.log("[pushForward] wa_token recuperado lazy");
    return token;
  } catch (e) {
    console.warn("[pushForward] lazy wa_token fail", e);
    return null;
  }
}

export async function forwardWaMessage(msg: {
  autor?: string;
  telefone?: string;
  grupo?: string;
  mensagem?: string;
  matched?: string[];
  id?: string;
  source_msg_id?: string;
  source_chat_id?: string;
  source_author_id?: string;
}) {
  if (!isPushForwardEnabled()) return;
  if (!URL || !KEY) return;

  const title = msg.autor ? `WhatsApp · ${msg.autor}` : "WhatsApp";
  const body = (msg.mensagem || "").slice(0, 200);

  // 2) Webhook PRIMEIRO — garante user_id atualizado e insere em wa_messages
  //    (realtime no card do browser).
  const waToken = await ensureWaToken();
  const userId = getPushForwardUserId();
  if (waToken) {
    const doPost = (tk: string) => fetch(`${URL}/functions/v1/whatsapp-webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": KEY,
        "Authorization": `Bearer ${KEY}`,
        "x-webhook-token": tk,
      },
      body: JSON.stringify({
        autor: msg.autor ?? "",
        telefone: msg.telefone ?? "",
        grupo: msg.grupo ?? "",
        mensagem: msg.mensagem ?? "",
        matched: msg.matched ?? [],
        msg_id: msg.source_msg_id || msg.id || "",
        chat_id: msg.source_chat_id || "",
        author_id: msg.source_author_id || "",
        source: "v2",
      }),
    });
    try {
      let res = await doPost(waToken);
      if (res.status === 401) {
        console.warn("[pushForward] wa_token 401 — invalidando cache e re-tentando");
        const fresh = await ensureWaToken(true);
        if (fresh && fresh !== waToken) res = await doPost(fresh);
      }
      const txt = await res.text();
      console.log("[pushForward] webhook", res.status, txt.slice(0, 200));
    } catch (e) {
      console.warn("[pushForward] webhook fail", e);
    }
  } else {
    console.warn("[pushForward] sem wa_token, pulando webhook");
  }

  // 1) Push notification (não bloqueia o webhook)
  if (userId) {
    try {
      await fetch(`${URL}/functions/v1/send-push`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": KEY,
          "Authorization": `Bearer ${KEY}`,
        },
        body: JSON.stringify({
          user_id: userId,
          title,
          message: body,
          url: "/monitor",
          tag: msg.id || msg.source_msg_id || "wa-desktop",
        }),
      });
    } catch (e) {
      console.warn("[pushForward] push fail", e);
    }
  }
}
