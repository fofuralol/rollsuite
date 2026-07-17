import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { IS_DESKTOP } from "@/lib/runtime";
import { createClient } from "@supabase/supabase-js";
import { pushComprovantePopup, updateComprovantePopup } from "@/lib/comprovantePopups";

export interface WaMessage {
  id: string;
  autor: string;
  telefone: string;
  grupo: string;
  mensagem: string;
  matched: string[];
  created_at: string;
  source_msg_id?: string;
  source_chat_id?: string;
  source_author_id?: string;
  pix_sent_at?: string | null;
  comprovante_at?: string | null;
  is_comprovante?: boolean;
  parent_source_msg_id?: string;
  media_data_url?: string;
  media_mime?: string;
  media_filename?: string;
  media_kind?: "image" | "video" | "audio" | "document" | "";
  quoted_msg_id?: string;
  quoted_body?: string;
  from_me?: boolean;
}

export interface WaKeyword {
  id: string;
  palavra: string;
}

export interface WaToken {
  id: string;
  token: string;
  label: string;
}

const WEBHOOK_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-webhook`;
const CLOUD_URL = import.meta.env.VITE_SUPABASE_URL as string;
const CLOUD_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
const DESKTOP_LOCAL_USER_ID = "fofuralol-local";

function randToken() {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeKeyword(value: string) {
  return value.trim();
}

let waTokensCloudWarnShown = false;

function hasMatchedKeywords(message: WaMessage) {
  return Array.isArray(message.matched) && message.matched.some((value) => String(value || "").trim().length > 0);
}

function uniqKeywords(rows: WaKeyword[]) {
  const seen = new Set<string>();
  const out: WaKeyword[] = [];
  for (const row of rows) {
    const palavra = normalizeKeyword(row.palavra);
    if (!palavra || seen.has(palavra)) continue;
    seen.add(palavra);
    out.push({ ...row, palavra });
  }
  return out;
}

function uniqTokens(rows: WaToken[]) {
  const seen = new Set<string>();
  const out: WaToken[] = [];
  for (const row of rows) {
    const token = String(row.token || "").trim();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push({ ...row, token });
  }
  return out;
}

function normalizeAmount(s: string): string | null {
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
function isAttachmentArtifactLine(line: string): boolean {
  const value = String(line || "").trim();
  if (!value) return false;
  return /^(?:[\w._-]*\d[\w._-]*\.(?:pdf|jpg|jpeg|png|gif|webp|mp4|mov|avi|mp3|ogg|opus|m4a|wav|aac|flac|webm|mkv|doc|docx|xls|xlsx|csv|txt|zip|rar|7z|pff|tmp|bin|[a-z]{2,5})|[\w._-]+\.(?:pdf|jpg|jpeg|png|gif|webp|mp4|mov|avi|mp3|ogg|opus|m4a|wav|aac|flac|webm|mkv|doc|docx|xls|xlsx|csv|txt|zip|rar|7z|pff|tmp|bin))$/iu.test(value);
}
function stripUrlsAndFiles(s: string): string {
  return String(s || "")
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, " ")
    .replace(/\b[\w-]+\.(?:com|net|org|io|br|co|gg|me|app|dev|xyz|info|tv|live|site|online|store|link|bet|vip|win|club|games?|cc|to|us|uk|eu)(?:\.[a-z]{2})?(?:\/\S*)?/gi, " ")
    // Nomes de arquivo conhecidos
    .replace(/\b[\w\-_.]+\.(?:pdf|jpg|jpeg|png|gif|webp|mp4|mov|avi|mp3|ogg|opus|m4a|wav|aac|flac|webm|mkv|doc|docx|xls|xlsx|csv|txt|zip|rar|7z|pff|tmp|bin)\b/gi, " ")
    // Qualquer "nome.ext" cujo nome contém dígitos (ex: 2026-05-12.pff, foto_001.xyz)
    .replace(/\b[\w\-_.]*\d[\w\-_.]*\.[a-z]{2,5}\b/gi, " ");
}
export function isPixModelMessage(body: string): boolean {
  const lower = String(body || "").toLowerCase();
  const labels = [
    "valor:", "chave:", "chave pix", "tipo de chave", "tipo da chave",
    "destinatário", "destinatario", "remetente", "instituição", "instituicao",
    "comprovante", "id da transação", "id da transacao", "id transação", "id transacao",
    "data e hora", "data/hora", "horário", "horario",
    "cpf/cnpj", "banco:", "agência", "agencia", "conta:",
  ];
  const hits = labels.reduce((n, w) => (lower.includes(w) ? n + 1 : n), 0);
  if (hits >= 2) return true;
  if (lower.includes("pix") && (lower.includes("valor") || lower.includes("chave") ||
      lower.includes("comprovante") || lower.includes("confirmado") || lower.includes("enviado") ||
      lower.includes("deposito") || lower.includes("depósito") ||
      lower.includes("transferência") || lower.includes("transferencia"))) return true;
  if (lower.includes("nome:") && lower.includes("valor:")) return true;
  return false;
}
function lineMatches(line: string, p: string): boolean {
  if (!p) return false;
  if (/^\d+$/.test(p)) {
    const clean = stripUrlsAndFiles(line);
    const re = /\d+(?:[.,]\d+)?\s*[kK](?![\p{L}\p{N}_])|\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?/gu;
    const nums = clean.match(re) || [];
    return nums.some((n) => normalizeAmount(n) === p);
  }
  const re = new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escapeRegex(p)}(?=$|[^\\p{L}\\p{N}_])`, "iu");
  return re.test(line);
}
export function extractMatchingLines(mensagem: string, matched: string[]): string {
  const lines = mensagem.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!matched.length || !lines.length) return "";
  const hits = lines.filter((line) => !isAttachmentArtifactLine(line) && matched.some((p) => lineMatches(line, p)));
  return hits.join(". ").trim();
}

function stripLinks(text: string): string {
  return text
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, "")
    .replace(/\b[\w.-]+\.(?:com|net|org|io|br|co|gg|me|app|dev|xyz|info|tv|live|site|online|store|link)(?:\/\S*)?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function speak(text: string) {
  try {
    const synth = window.speechSynthesis;
    const clean = stripLinks(text || "");
    if (!synth || !clean) return;
    // Lê settings de narração (enabled/volume)
    let enabled = true;
    let volume = 1;
    try {
      const raw = localStorage.getItem("wa-narration-settings-v1");
      if (raw) {
        const p = JSON.parse(raw);
        enabled = p.enabled !== false;
        if (typeof p.volume === "number") volume = Math.max(0, Math.min(1, p.volume));
      }
    } catch {}
    if (!enabled || volume <= 0) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = "pt-BR";
    u.rate = 1;
    u.pitch = 1;
    u.volume = volume;
    const voices = synth.getVoices();
    const male = voices.find((v) => /pt[-_]BR/i.test(v.lang) && /male|masc|daniel|ricardo|felipe|paulo|antonio|antônio|thiago|bruno|diego|google.*portugu/i.test(v.name) && !/female|fem/i.test(v.name))
      || voices.find((v) => /pt[-_]BR/i.test(v.lang) && !/female|fem|maria|luciana|joana|francisca|helena/i.test(v.name))
      || voices.find((v) => /pt[-_]BR/i.test(v.lang))
      || voices.find((v) => /pt/i.test(v.lang));
    if (male) u.voice = male;
    u.pitch = 0.85;
    synth.speak(u);
  } catch {}
}

function playDing() {
  try {
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext);
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      const start = now + i * 0.18;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.25, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
      o.connect(g).connect(ctx.destination);
      o.start(start);
      o.stop(start + 0.4);
    });
    setTimeout(() => ctx.close().catch(() => {}), 900);
  } catch {}
}

const nickToEmail = (n: string) => {
  const t = n.trim();
  if (t.includes("@")) return t.toLowerCase();
  return `${t.toLowerCase().replace(/[^a-z0-9_]/g, "")}@rolls.local`;
};

let cloudCredsBroken = false;

async function withCloudSession<T>(run: (cloud: any, userId: string) => Promise<T>): Promise<T> {
  if (!CLOUD_URL || !CLOUD_KEY) throw new Error("Backend indisponível");
  if (cloudCredsBroken) throw new Error("Credenciais de sync inválidas — reative o Push no Monitor");
  let email = "";
  let pwd = "";
  try {
    email = localStorage.getItem("monitor_sync_email") || "";
    pwd = localStorage.getItem("monitor_sync_pwd") || "";
  } catch {}
  if (!email || !pwd) {
    throw new Error("No desktop, informe email e senha no painel de sincronização primeiro.");
  }

  const cloud = createClient(CLOUD_URL, CLOUD_KEY, {
    auth: { persistSession: false, storageKey: "rolls-cloud-sync-auth", autoRefreshToken: false, detectSessionInUrl: false },
  });
  const normalizedEmail = nickToEmail(email);
  const { data, error } = await cloud.auth.signInWithPassword({ email: normalizedEmail, password: pwd });
  if (error || !data.user) {
    const msg = error?.message || "";
    if (/invalid.*credentials|invalid login/i.test(msg)) {
      cloudCredsBroken = true;
      try { localStorage.removeItem("monitor_sync_pwd"); } catch {}
    }
    throw new Error(msg || "Falha ao autenticar no backend");
  }

  try {
    return await run(cloud, data.user.id);
  } finally {
    try { await cloud.auth.signOut(); } catch {}
  }
}

export function useWhatsApp() {
  const [messages, setAllMessages] = useState<WaMessage[]>([]);
  const [keywords, setKeywords] = useState<WaKeyword[]>([]);
  const [tokens, setTokens] = useState<WaToken[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const seenIds = useRef<Set<string>>(new Set());
  const keywordsRef = useRef<WaKeyword[]>([]);

  const fetchAllKeywordRows = useCallback(async (): Promise<WaKeyword[]> => {
    const out: WaKeyword[] = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("wa_keywords").select("id,palavra")
        .order("palavra").range(from, from + PAGE - 1);
      if (error || !data) break;
      out.push(...(data as WaKeyword[]));
      if (data.length < PAGE) break;
    }
    return out;
  }, []);

  // Não recalcula match na UI, mas só aceita mensagens que já vieram marcadas
  // pelo listener/webhook com ao menos uma keyword encontrada.
  const shouldKeepMessage = useCallback(
    (message: WaMessage) => !message.is_comprovante && hasMatchedKeywords(message) && !isPixModelMessage(message.mensagem) && !!extractMatchingLines(message.mensagem, message.matched || []),
    [],
  );

  const handleIncoming = useCallback((msg: WaMessage) => {
    // Mensagens "frescas" (últimos 30s) tocam ding/toast/narração.
    // Mensagens antigas (backfill/histórico ao abrir o app) entram silenciosamente no feed.
    const createdMs = new Date(msg.created_at || 0).getTime();
    const isFresh = Number.isFinite(createdMs) && (Date.now() - createdMs) < 30_000;

    // Comprovante: dispara popup flutuante + narração, não entra no feed
    if (msg.is_comprovante) {
      if (seenIds.current.has(msg.id)) {
        // O processo desktop pode recuperar a mídia alguns segundos depois da
        // notificação inicial; atualiza o popup existente em vez de descartar.
        updateComprovantePopup(msg.id, {
          mediaDataUrl: msg.media_data_url || "",
          mediaMime: msg.media_mime || "",
          mediaFilename: msg.media_filename || "",
        });
        return;
      }
      seenIds.current.add(msg.id);
      pushComprovantePopup({
        id: msg.id,
        autor: msg.autor || "",
        telefone: msg.telefone || "",
        grupo: msg.grupo || "",
        mensagem: msg.mensagem || "",
        mediaDataUrl: msg.media_data_url || "",
        mediaMime: msg.media_mime || "",
        mediaFilename: msg.media_filename || "",
        createdAt: msg.created_at || new Date().toISOString(),
        chatId: msg.source_chat_id || "",
        msgId: msg.source_msg_id || "",
      });
      if (isFresh) {
        playDing();
        setTimeout(() => speak("Cliente enviou o comprovante"), 300);
      }
      return;
    }
    // Update de mensagem já vista (pix_sent_at / comprovante_at)
    if (seenIds.current.has(msg.id)) {
      setAllMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, ...msg } : m)));
      return;
    }
    if (!shouldKeepMessage(msg)) return;
    seenIds.current.add(msg.id);
    setAllMessages((prev) => {
      const next = [msg, ...prev];
      next.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
      return next;
    });
    if (isFresh) {
      toast.success(`WhatsApp: ${msg.autor}`, { description: (msg.mensagem || "").slice(0, 120) });
      playDing();
      setTimeout(() => speak(extractMatchingLines(msg.mensagem, msg.matched || [])), 450);
    }
  }, [shouldKeepMessage]);

  const reload = useCallback(async () => {
    // mantém apenas mensagens das últimas 24h (apenas filtro, sem deletar do banco)
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const localUserId = userId || DESKTOP_LOCAL_USER_ID;
    const [m, k, localTokensRes] = await Promise.all([
      supabase.from("wa_messages").select("*").gte("created_at", cutoff).order("created_at", { ascending: false }).limit(500),
      fetchAllKeywordRows(),
      supabase.from("wa_tokens").select("id,token,label").eq("user_id", localUserId).order("created_at"),
    ]);
    if (m.data) {
      const filteredMessages = (m.data as WaMessage[]).filter(shouldKeepMessage);
      setAllMessages(filteredMessages);
      filteredMessages.forEach((x) => seenIds.current.add(x.id));
    }
    const uniqueKeywords = uniqKeywords(k);
    keywordsRef.current = uniqueKeywords;
    setKeywords(uniqueKeywords);

    let nextTokens = uniqTokens((localTokensRes.data as WaToken[] | null) || []);
    let tokensError: any = localTokensRes.error || null;

    if (IS_DESKTOP) {
      try {
        const cloudResult = await withCloudSession(async (cloud, cloudUserId) => {
          const { data, error } = await cloud
            .from("wa_tokens")
            .select("id,token,label")
            .eq("user_id", cloudUserId)
            .order("created_at");
          if (error) throw error;

          const cloudTokens = uniqTokens((data as WaToken[] | null) || []);
          const localByToken = new Set(nextTokens.map((row) => row.token));
          const cloudByToken = new Set(cloudTokens.map((row) => row.token));

          const missingInCloud = nextTokens.filter((row) => !cloudByToken.has(row.token));
          if (missingInCloud.length) {
            const { error: pushError } = await cloud.from("wa_tokens").insert(
              missingInCloud.map((row) => ({ token: row.token, label: row.label, user_id: cloudUserId }))
            );
            if (pushError) throw pushError;
          }

          const missingLocal = cloudTokens.filter((row) => !localByToken.has(row.token));
          if (missingLocal.length) {
            const { error: pullError } = await supabase.from("wa_tokens").insert(
              missingLocal.map((row) => ({ token: row.token, label: row.label, user_id: localUserId }))
            );
            if (pullError) throw pullError;
            const refreshedLocal = await supabase.from("wa_tokens").select("id,token,label").eq("user_id", localUserId).order("created_at");
            if (refreshedLocal.error) throw refreshedLocal.error;
            nextTokens = uniqTokens((refreshedLocal.data as WaToken[] | null) || []);
          }
        });
        void cloudResult;
      } catch (error: any) {
        tokensError = error;
      }
    }

    if (tokensError) {
      const message = typeof tokensError?.message === "string" ? tokensError.message : String(tokensError || "");
      if (IS_DESKTOP && !waTokensCloudWarnShown) {
        waTokensCloudWarnShown = true;
        console.info("[wa_tokens] cloud sync skipped; using local cache", message);
      }
    }

    setTokens(nextTokens);
  }, [fetchAllKeywordRows, shouldKeepMessage, userId]);

  useEffect(() => {
    let active = true;
    // pre-warm voices
    try { window.speechSynthesis?.getVoices(); } catch {}
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      if (active) setUserId(s?.user?.id ?? null);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (active) setUserId(data.session?.user?.id ?? null);
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const subscribe = () => {
      if (channel) { try { supabase.removeChannel(channel); } catch {} }
      channel = supabase
        .channel(`wa_messages_rt_${userId}_${Math.random().toString(36).slice(2, 8)}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "wa_messages", filter: `user_id=eq.${userId}` }, (payload) => {
          const msg = payload.new as WaMessage;
          if (!active) return;
          handleIncoming(msg);
        })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "wa_messages", filter: `user_id=eq.${userId}` }, (payload) => {
          const msg = payload.new as WaMessage;
          if (!active) return;
          if (msg.is_comprovante) return;
          setAllMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, ...msg } : m)));
        })
        .subscribe();
    };

    reload();
    subscribe();

    // Desktop: o realtime do Supabase é stub; recebemos via IPC do main process.
    let offWa: (() => void) | null = null;
    if (IS_DESKTOP) {
      const api = (window as any).electronAPI;
      offWa = api?.onWaMessage?.((msg: WaMessage) => {
        if (!active) return;
        handleIncoming(msg);
        if (msg.is_comprovante) return;
        const pushedKey = (msg.id || `${msg.source_msg_id || ""}:${msg.source_chat_id || ""}:${msg.mensagem || ""}`) + "_pushed";
        if (seenIds.current.has(pushedKey)) return;
        let forwardOn = true;
        try { forwardOn = localStorage.getItem("wa_forward_enabled") !== "false"; } catch {}
        if (!forwardOn) {
          try { console.log("[wa-forward] desativado pelo toggle; msg ignorada", msg.id); } catch {}
          return;
        }
        seenIds.current.add(pushedKey);
        import("@/integrations/desktop/pushForward").then(({ forwardWaMessage }) => {
          try { console.log("[wa-forward] enviando", msg.id); } catch {}
          forwardWaMessage(msg);
        }).catch((e) => { try { console.warn("[wa-forward] import fail", e); } catch {} });
      }) || null;
    }

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        reload();
        subscribe();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onVisible);

    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onVisible);
      if (channel) supabase.removeChannel(channel);
      try { offWa?.(); } catch {}
    };
  }, [userId, reload, handleIncoming]);


  const addKeyword = async (palavra: string) => {
    const p = normalizeKeyword(palavra);
    if (!p || !userId) return;
    if (keywords.some((k) => normalizeKeyword(k.palavra) === p)) {
      toast.message("Essa palavra-chave já existe");
      return;
    }
    const { error } = await supabase.from("wa_keywords").insert({ palavra: p, user_id: userId });
    if (error) toast.error(error.message); else { toast.success("Palavra adicionada"); reload(); }
  };
  const removeKeyword = async (id: string) => {
    const { error } = await supabase.from("wa_keywords").delete().eq("id", id);
    if (error) toast.error(error.message); else reload();
  };
  const replaceKeywords = async (lines: string[]) => {
    if (!userId) return;
    const cleaned = Array.from(
      new Set(lines.map((l) => normalizeKeyword(l)).filter(Boolean))
    );
    const currentRows = await fetchAllKeywordRows();
    const current = new Map<string, string>();
    const duplicateIds: string[] = [];
    for (const row of currentRows) {
      const palavra = normalizeKeyword(row.palavra);
      if (!palavra) {
        duplicateIds.push(row.id);
        continue;
      }
      if (current.has(palavra)) duplicateIds.push(row.id);
      else current.set(palavra, row.id);
    }
    const desired = new Set(cleaned);
    const toRemove = Array.from(new Set([
      ...currentRows.filter((k) => !desired.has(normalizeKeyword(k.palavra))).map((k) => k.id),
      ...duplicateIds,
    ]));
    const toAdd = cleaned.filter((p) => !current.has(p));
    if (toRemove.length === 0 && toAdd.length === 0) return;
    const chunk = <T,>(arr: T[], n: number): T[][] => {
      const out: T[][] = [];
      for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
      return out;
    };
    try {
      for (const ids of chunk(toRemove, 200)) {
        const { error } = await supabase.from("wa_keywords").delete().in("id", ids);
        if (error) throw error;
      }
      for (const batch of chunk(toAdd, 500)) {
        const rows = batch.map((palavra) => ({ palavra, user_id: userId }));
        const { error } = await supabase.from("wa_keywords").upsert(rows, { onConflict: "user_id,palavra", ignoreDuplicates: true });
        if (error) throw error;
      }
    } catch (e: any) {
      toast.error(e?.message || "Falha ao salvar");
      await reload();
      return;
    }
    toast.success(`Palavras-chave salvas (+${toAdd.length} / -${toRemove.length})`);
    reload();
  };

  const createToken = async (label = "listener") => {
    const localUserId = userId || (IS_DESKTOP ? DESKTOP_LOCAL_USER_ID : null);
    if (!localUserId) {
      toast.error("Faça login na nuvem primeiro — sem sessão, o token não pode ser salvo no banco.");
      return;
    }
    const token = randToken();
    const localInsert = await supabase.from("wa_tokens").insert({ token, label, user_id: localUserId });
    if (localInsert.error) {
      toast.error(localInsert.error.message);
      return;
    }

    if (!IS_DESKTOP) {
      toast.success("Token gerado");
      reload();
      return;
    }

    try {
      await withCloudSession(async (cloud, cloudUserId) =>
        await cloud.from("wa_tokens").insert({ token, label, user_id: cloudUserId })
      );
      toast.success("Token gerado");
    } catch (error: any) {
      toast.warning("Token gerado só neste PC", {
        description: "Pra extensão/webhook aceitar, abra Sincronizar/Push e informe email e senha para sincronizar com a nuvem.",
      });
      if (!waTokensCloudWarnShown) {
        waTokensCloudWarnShown = true;
        console.info("[wa_tokens] cloud sync skipped after local create", error?.message || error);
      }
    }

    reload();
  };
  const removeToken = async (id: string) => {
    const tokenValue = tokens.find((row) => row.id === id)?.token || null;
    const localDelete = await supabase.from("wa_tokens").delete().eq("id", id);
    if (localDelete.error) {
      toast.error(localDelete.error.message);
      return;
    }

    if (IS_DESKTOP && tokenValue) {
      try {
        await withCloudSession(async (cloud, cloudUserId) =>
          await cloud.from("wa_tokens").delete().eq("token", tokenValue).eq("user_id", cloudUserId)
        );
      } catch (error: any) {
        if (!waTokensCloudWarnShown) {
          waTokensCloudWarnShown = true;
          console.info("[wa_tokens] cloud delete skipped; token removed only from local cache", error?.message || error);
        }
      }
    }

    reload();
  };

  const removeMessage = async (id: string) => {
    const { error } = await supabase.from("wa_messages").delete().eq("id", id);
    if (error) toast.error(error.message); else setAllMessages((p) => p.filter((m) => m.id !== id));
  };

  const testMessage = async (mensagem: string, autor = "Teste") => {
    const matched = keywords
      .map((k) => k.palavra)
      .filter((p) => {
        if (!p) return false;
        const re = new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escapeRegex(p)}(?=$|[^\\p{L}\\p{N}_])`, "iu");
        return re.test(mensagem);
      });
    if (matched.length === 0) {
      toast.message("Nenhuma palavra-chave bateu", { description: "Mensagem ignorada (igual ao webhook real)." });
      return;
    }
    if (!userId) return;

    const createdAt = new Date().toISOString();
    const fake: WaMessage = {
      id: `test-${Date.now()}`,
      autor,
      telefone: "",
      grupo: "Teste local",
      mensagem,
      matched,
      created_at: createdAt,
    };

    setAllMessages((prev) => [fake, ...prev]);
    toast.success(`WhatsApp: ${autor}`, { description: mensagem.slice(0, 120) });
    playDing();
    setTimeout(() => speak(extractMatchingLines(mensagem, matched)), 450);

    const { error, data } = await supabase
      .from("wa_messages")
      .insert({ user_id: userId, autor, grupo: "Teste local", mensagem, matched, created_at: createdAt })
      .select("*")
      .single();

    if (error) {
      setAllMessages((prev) => prev.filter((msg) => msg.id !== fake.id));
      toast.error(error.message);
      return;
    }

    const inserted = data as WaMessage;
    seenIds.current.add(inserted.id);
    setAllMessages((prev) => {
      const withoutFake = prev.filter((msg) => msg.id !== fake.id);
      if (withoutFake.some((msg) => msg.id === inserted.id)) return withoutFake;
      return [inserted, ...withoutFake];
    });
  };

  return {
    messages, keywords, tokens, webhookUrl: WEBHOOK_URL,
    addKeyword, removeKeyword, replaceKeywords, createToken, removeToken, removeMessage, reload, testMessage,
  };
}
