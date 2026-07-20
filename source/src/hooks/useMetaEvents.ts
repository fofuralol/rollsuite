import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { IS_DESKTOP } from "@/lib/runtime";
import { toast } from "sonner";

export interface MetaEvent {
  id: string;
  title: string | null;
  url: string | null;
  steps: number | null;
  target: number | null;
  balance: number | null;
  balance_raw: string | null;
  source_tab_id: string | null;
  source_token?: string | null;
  created_at: string;
}

export interface MetaDiagnostics {
  localToken: string | null;
  lastBatchTotal: number;
  lastAccepted: number;
  mismatchedTokenCount: number;
  missingTokenCount: number;
  recentSourceTokens: string[];
  lastRejectedToken: string | null;
}

/**
 * REGRA SIMPLES (não complicar):
 *
 *   Cada PC só notifica metas cujo `source_token` seja igual ao token
 *   configurado LOCALMENTE neste PC.
 *
 *   - No desktop (Electron): token = `meta:get-config` (Meta → Config).
 *   - No browser: token = localStorage `monitor_push_forward_wa_token`.
 *
 *   NÃO usamos a tabela `wa_tokens` do Supabase aqui, porque essa tabela é a
 *   lista GLOBAL de tokens do usuário (todos os PCs/extensões dele). Usar ela
 *   faria todos os PCs notificarem metas de qualquer extensão — o oposto do
 *   que queremos.
 *
 *   Assim:
 *     extensão A (token 1) → PC A (token 1) → notifica
 *     extensão B (token 2) → PC B (token 2) → notifica
 *     extensão A (token 1) → PC B (token 2) → IGNORA (card + som)
 */
let localToken: string | null = null;
let diagnostics: MetaDiagnostics = {
  localToken: null,
  lastBatchTotal: 0,
  lastAccepted: 0,
  mismatchedTokenCount: 0,
  missingTokenCount: 0,
  recentSourceTokens: [],
  lastRejectedToken: null,
};

function setDiagnostics(updater: MetaDiagnostics | ((prev: MetaDiagnostics) => MetaDiagnostics)) {
  diagnostics = typeof updater === "function" ? updater(diagnostics) : updater;
  listeners.forEach((l) => l());
}

async function refreshLocalToken() {
  try {
    let tok: string | null = null;

    // 1) Desktop: token do Electron (Meta → Config). É o que a extensão usa.
    if (IS_DESKTOP) {
      try {
        const api = (window as any).electronAPI;
        const cfgRes = await api?.metaGetConfig?.().catch?.(() => null);
        const t = cfgRes?.data?.token;
        if (t) tok = String(t);
      } catch {}
    }

    // 2) Browser (ou fallback no desktop): localStorage
    if (!tok && typeof localStorage !== "undefined") {
      const t = localStorage.getItem("monitor_push_forward_wa_token");
      if (t) tok = String(t);
    }

    const changed = tok !== localToken;
    localToken = tok;
    setDiagnostics((prev) => ({ ...prev, localToken: tok }));
    console.log(
      "[meta] token local deste PC:",
      localToken ? localToken.slice(0, 8) + "…" : "(nenhum)"
    );
    // Se o token mudou, reassina o realtime com o filtro novo (source_token)
    // pra o backend parar de empurrar metas de outros PCs/extensões.
    if (changed && userId) {
      try { if (currentChannel) supabase.removeChannel(currentChannel); } catch {}
      currentChannel = null;
      realtimeBound = false;
      bindRealtime(userId);
    }
  } catch (e) {
    console.warn("[meta] refreshLocalToken exception", e);
  }
}

async function getCurrentMetaSourceToken() {
  if (localToken) return localToken;
  await refreshLocalToken();
  return localToken;
}

function shouldAcceptForThisDevice(ev: MetaEvent): boolean {
  // Modo offline puro: evento vindo do servidor local do Electron já é loopback-only
  // e não precisa de token para tocar/entrar no card.
  if (IS_DESKTOP && (ev as any)._local) {
    // Se o evento é local (loopback), aceitamos sempre para garantir que o teste funcione 
    // mesmo sem token configurado no app.
    return true;
  }
  // sem token local configurado → não notifica nada de nuvem (evita ruído cruzado)
  if (!localToken) return false;
  // eventos antigos sem source_token: bloqueia na nuvem (não dá pra atribuir a um PC)
  if (!ev.source_token) return false;
  return ev.source_token === localToken;
}

let sharedAudioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext | null {
  try {
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext);
    if (!Ctx) return null;
    if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
      sharedAudioCtx = new Ctx();
    }
    return sharedAudioCtx;
  } catch { return null; }
}

function playMetaSound() {
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const start = () => {
      const now = ctx.currentTime;
      [
        { f: 329.63, t: 0 },
        { f: 415.3, t: 0.12 },
        { f: 493.88, t: 0.24 },
        { f: 659.25, t: 0.36 },
        { f: 659.25, t: 0.62 },
      ].forEach(({ f, t }) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "triangle";
        o.frequency.value = f;
        const s = now + t;
        g.gain.setValueAtTime(0, s);
        g.gain.linearRampToValueAtTime(0.35, s + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, s + 0.45);
        o.connect(g).connect(ctx.destination);
        o.start(s);
        o.stop(s + 0.5);
      });
    };

    if (ctx.state === "suspended") ctx.resume().then(start).catch(() => {});
    else start();
  } catch {}
}

if (typeof window !== "undefined") {
  const unlock = () => {
    const ctx = getAudioCtx();
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
    window.removeEventListener("click", unlock);
    window.removeEventListener("keydown", unlock);
    window.removeEventListener("touchstart", unlock);
  };
  window.addEventListener("click", unlock);
  window.addEventListener("keydown", unlock);
  window.addEventListener("touchstart", unlock);
}

// ---- Shared store (singleton) ----
const seen = new Set<string>();
let events: MetaEvent[] = [];
const listeners = new Set<() => void>();
let userId: string | null = null;
let realtimeBound = false;
let electronBound = false;
let desktopPollBound = false;
let desktopCursor: string | null = null;

const META_RECENT_PATH = "/functions/v1/meta-events-recent";
const META_DISMISSED_STORAGE_KEY = "meta-events-dismissed";

function readDismissedIds() {
  if (typeof window === "undefined") return new Set<string>();
  try {
    const raw = window.localStorage.getItem(META_DISMISSED_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set<string>();
  }
}

let dismissed = readDismissedIds();

function persistDismissedIds() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(META_DISMISSED_STORAGE_KEY, JSON.stringify(Array.from(dismissed).slice(-1000)));
  } catch {}
}

function dismissEvents(ids: string[]) {
  ids.forEach((id) => {
    if (!id) return;
    dismissed.add(id);
    seen.delete(id);
  });
  persistDismissedIds();
}

function acceptEvents(list: MetaEvent[]) {
  let mismatchedTokenCount = 0;
  let missingTokenCount = 0;
  let lastRejectedToken: string | null = null;
  const recentSourceTokens = new Set<string>();

  const accepted = list.filter((ev) => {
    if (!ev?.id || dismissed.has(ev.id)) return false;
    if (ev.source_token) recentSourceTokens.add(ev.source_token);
    if (IS_DESKTOP && (ev as any)._local && (!localToken || !ev.source_token || ev.source_token === localToken)) {
      return true;
    }
    if (!localToken) {
      lastRejectedToken = ev.source_token || null;
      return false;
    }
    if (!ev.source_token) {
      missingTokenCount += 1;
      return false;
    }
    if (ev.source_token !== localToken) {
      mismatchedTokenCount += 1;
      lastRejectedToken = ev.source_token;
      return false;
    }
    return true;
  });

  setDiagnostics((prev) => ({
    ...prev,
    localToken,
    lastBatchTotal: list.length,
    lastAccepted: accepted.length,
    mismatchedTokenCount,
    missingTokenCount,
    recentSourceTokens: Array.from(recentSourceTokens).slice(0, 5),
    lastRejectedToken,
  }));

  return accepted;
}

function mergeEvents(primary: MetaEvent[], secondary: MetaEvent[] = []) {
  const merged = new Map<string, MetaEvent>();
  [...primary, ...secondary].forEach((ev) => {
    if (!ev?.id || dismissed.has(ev.id)) return;
    merged.set(ev.id, ev);
  });
  return Array.from(merged.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

function updateDesktopCursor(list: MetaEvent[], fallback?: string) {
  const latest = list.reduce<string | null>((acc, ev) => {
    if (!ev?.created_at) return acc;
    if (!acc || ev.created_at > acc) return ev.created_at;
    return acc;
  }, null);
  desktopCursor = latest || fallback || desktopCursor || new Date().toISOString();
}

function setEvents(updater: (prev: MetaEvent[]) => MetaEvent[]) {
  events = updater(events);
  listeners.forEach((l) => l());
}

function pushEvent(ev: MetaEvent, { silent = false }: { silent?: boolean } = {}) {
  if (!ev?.id) { console.warn("[meta] pushEvent: sem id"); return; }
  if (seen.has(ev.id)) return;
  if (!shouldAcceptForThisDevice(ev)) {
    setDiagnostics((prev) => ({
      ...prev,
      localToken,
      mismatchedTokenCount: ev.source_token && localToken && ev.source_token !== localToken ? prev.mismatchedTokenCount + 1 : prev.mismatchedTokenCount,
      missingTokenCount: !ev.source_token ? prev.missingTokenCount + 1 : prev.missingTokenCount,
      lastRejectedToken: ev.source_token || prev.lastRejectedToken,
      recentSourceTokens: ev.source_token
        ? Array.from(new Set([ev.source_token, ...prev.recentSourceTokens])).slice(0, 5)
        : prev.recentSourceTokens,
    }));
    console.log("[meta] evento ignorado (token de outro PC):", ev.source_token, ev.title);
    return;
  }
  seen.add(ev.id);
  setEvents((prev) => [ev, ...prev]);
  if (!silent) {
    console.log("[meta] notificando:", ev.title, ev.id);
    toast.success(`🎯 Meta atingida${ev.title ? `: ${ev.title}` : ""}`, {
      description: ev.steps != null && ev.target != null ? `${ev.steps} / ${ev.target}` : undefined,
    });
    playMetaSound();
  }
}


async function reloadFromDb() {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const reloadStartedAt = new Date().toISOString();
  const electronApi = (window as any).electronAPI;
  if (electronApi?.metaList) {
    const res = await electronApi.metaList({ since: cutoff });
    const list = acceptEvents((res?.data || []) as MetaEvent[]);
    list.forEach((x) => seen.add(x.id));
    updateDesktopCursor(list, cutoff);
    setEvents((prev) => mergeEvents(list, prev.filter(
      (ev) => ev.id.startsWith("test-") || ev.created_at > reloadStartedAt
    )));
    return;
  }
  supabase.from("meta_events").delete().lt("created_at", cutoff).then(() => {});
  let q = supabase
    .from("meta_events")
    .select("*")
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(200);
  // Filtro server-side por token deste PC — backend não envia eventos de outros tokens
  if (localToken) q = q.eq("source_token", localToken);
  const { data } = await q;
  if (data) {
    const list = acceptEvents(data as MetaEvent[]);
    list.forEach((x) => seen.add(x.id));
    updateDesktopCursor(list, cutoff);
    setEvents((prev) => mergeEvents(list, prev.filter(
      (ev) => ev.id.startsWith("test-") || ev.created_at > reloadStartedAt
    )));
  }
}

let desktopPollingStopped = false;
let desktopPollingTimer: number | null = null;

async function fetchDesktopEvents(since: string) {
  const electronApi = (window as any).electronAPI;
  const configRes = await electronApi?.metaGetConfig?.().catch?.(() => null);
  const configuredToken = configRes?.data?.token as string | undefined;
  const baseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  // Sem token Meta configurado pelo usuário → não chama a edge function.
  // (Evita 401 flood quando o usuário não usa o recurso Meta.)
  if (!configuredToken || !baseUrl || !anonKey) return [] as MetaEvent[];

  const res = await fetch(`${baseUrl}${META_RECENT_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({ token: configuredToken, since }),
  });
  if (res.status === 401 || res.status === 403) {
    // Token inválido — para o polling pra não inundar o console com 401s.
    desktopPollingStopped = true;
    if (desktopPollingTimer != null) {
      window.clearInterval(desktopPollingTimer);
      desktopPollingTimer = null;
    }
    console.warn("[meta] polling desligado: token Meta inválido (reconfigure em Meta → Config)");
    return [] as MetaEvent[];
  }
  if (!res.ok) return [] as MetaEvent[];
  const data = await res.json().catch(() => ({}));
  const list = acceptEvents(Array.isArray(data.events) ? (data.events as MetaEvent[]) : []);
  updateDesktopCursor(list, data.now);
  return list;
}

function bindDesktopPollingOnce() {
  if (!IS_DESKTOP || desktopPollBound) return;
  // Se o Electron já entrega eventos via IPC (onMetaNewEvent), o polling HTTP
  // contra a edge function é redundante e gera 401 quando o token Meta está
  // inválido/ausente. Pula nesse caso.
  const api = (window as any).electronAPI;
  if (api?.onMetaNewEvent) {
    desktopPollBound = true;
    console.log("[meta] desktop polling HTTP desabilitado — usando IPC do Electron + realtime");
    return;
  }
  desktopPollBound = true;

  const run = async ({ silent = false }: { silent?: boolean } = {}) => {
    if (desktopPollingStopped) return;
    try {
      const since = desktopCursor || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const list = await fetchDesktopEvents(since);
      if (!list.length) return;

      const initialLoad = events.length === 0;
      for (const ev of [...list].reverse()) {
        pushEvent(ev, { silent: silent || initialLoad });
      }
      setEvents((prev) =>
        [...prev].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      );
    } catch {}
  };

  run({ silent: true });
  desktopPollingTimer = window.setInterval(() => {
    run();
  }, 3000);
}

async function syncMetaTokenToElectron() {
  try {
    const api = (window as any).electronAPI;
    if (!api?.metaSetConfig) return;
    await api.metaSetConfig({ token: "", cloud_enabled: false, local_enabled: true, enabled: false });
    localToken = null;
    setDiagnostics((prev) => ({ ...prev, localToken: null }));
    console.log("[meta] modo offline puro ativo — nuvem/token desabilitados");
  } catch (e) {
    console.warn("[meta] syncMetaTokenToElectron fail", e);
  }
}

function bindElectronOnce() {
  if (electronBound) return;
  const api = (window as any).electronAPI;
  if (!api?.onMetaNewEvent) return;
  electronBound = true;
  // ÚNICO caminho: evento do main → pushEvent → filtro por token local → som
  // (não usamos mais `onMetaPlaySound` direto, senão tocaria som de outro PC)
  api.onMetaNewEvent?.((ev: MetaEvent) => pushEvent(ev));
  syncMetaTokenToElectron();
  if (typeof window !== "undefined") {
    window.addEventListener("storage", (e) => {
      if (e.key === "monitor_push_forward_wa_token") {
        syncMetaTokenToElectron();
        refreshLocalToken();
      }
    });
  }
}

let currentChannel: ReturnType<typeof supabase.channel> | null = null;
let webPollTimer: number | null = null;

async function browserSafetyPoll() {
  if (!userId) return;
  try {
    const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    let q = supabase
      .from("meta_events")
      .select("*")
      .eq("user_id", userId)
      .gt("created_at", since)
      .order("created_at", { ascending: false })
      .limit(20);
    // Backend só devolve metas do token deste PC
    if (localToken) q = q.eq("source_token", localToken);
    const { data, error } = await q;
    if (error) { console.warn("[meta] safety poll error", error.message); return; }
    const list = acceptEvents((data || []) as MetaEvent[]);
    if (!list.length) return;
    let pushed = 0;
    for (const ev of [...list].reverse()) {
      if (!seen.has(ev.id)) pushed++;
      pushEvent(ev);
    }
    if (pushed > 0) console.log("[meta] safety poll captou", pushed, "evento(s) que o realtime perdeu");
  } catch (e) { console.warn("[meta] safety poll exception", e); }
}

function bindRealtime(uid: string) {
  if (realtimeBound && currentChannel) return;
  realtimeBound = true;

  if (currentChannel) {
    try { supabase.removeChannel(currentChannel); } catch {}
    currentChannel = null;
  }

  const chName = `meta_events_rt_${uid}_${Math.random().toString(36).slice(2, 8)}`;
  // Filtro server-side: se temos token local, assina SÓ os INSERTs com aquele
  // source_token. Como source_token é único por wa_token (e cada token pertence
  // a um único user_id), isso já isola este PC de metas de outros PCs/usuários
  // sem precisar baixar nada e filtrar no cliente.
  const insertFilter = localToken
    ? `source_token=eq.${localToken}`
    : `user_id=eq.${uid}`;
  console.log("[meta] subscribing realtime channel", chName, "filter:", insertFilter);

  currentChannel = supabase
    .channel(chName)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "meta_events", filter: insertFilter },
      (payload) => {
        console.log("[meta] realtime INSERT recebido", (payload.new as any)?.id, (payload.new as any)?.title);
        pushEvent(payload.new as MetaEvent);
      }
    )
    .on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "meta_events" },
      (payload) => {
        const oldId = (payload.old as { id?: string })?.id;
        if (!oldId) return;
        seen.delete(oldId);
        setEvents((prev) => prev.filter((m) => m.id !== oldId));
      }
    )
    .subscribe((status) => {
      console.log("[meta] realtime status:", status);
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        // tenta reconectar em 3s
        if (currentChannel) { try { supabase.removeChannel(currentChannel); } catch {} ; currentChannel = null; }
        realtimeBound = false;
        if (userId) setTimeout(() => bindRealtime(userId!), 3000);
      }
    });

  // safety polling backup (browser apenas) — pega o que o realtime perder
  if (!IS_DESKTOP && webPollTimer == null) {
    webPollTimer = window.setInterval(browserSafetyPoll, 20000);
  }

  // re-subscreve / re-poll quando aba volta ao foco
  if (typeof document !== "undefined" && !(window as any).__metaVisBound) {
    (window as any).__metaVisBound = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && userId) {
        console.log("[meta] aba voltou ao foco — safety poll + verificar canal");
        browserSafetyPoll();
      }
    });
  }
}

let authBound = false;
function bindAuthOnce() {
  if (authBound) return;
  authBound = true;
  const init = async (uid: string) => {
    await refreshLocalToken();
    reloadFromDb();
    bindRealtime(uid);
  };
  supabase.auth.onAuthStateChange((_e, s) => {
    userId = s?.user?.id ?? null;
    if (userId) init(userId);
  });
  supabase.auth.getSession().then(({ data }) => {
    userId = data.session?.user?.id ?? null;
    if (userId) init(userId);
  });
}



export function useMetaEvents() {
  const [snap, setSnap] = useState<MetaEvent[]>(events);
  const [diagSnap, setDiagSnap] = useState<MetaDiagnostics>(diagnostics);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    bindAuthOnce();
    bindElectronOnce();
    bindDesktopPollingOnce();
    const listener = () => {
      if (!mounted.current) return;
      setSnap(events);
      setDiagSnap(diagnostics);
    };
    listeners.add(listener);
    return () => { mounted.current = false; listeners.delete(listener); };
  }, []);

  const reload = useCallback(reloadFromDb, []);

  const removeEvent = useCallback(async (id: string) => {
    if (id.startsWith("test-")) {
      dismissEvents([id]);
      seen.delete(id);
      setEvents((p) => p.filter((m) => m.id !== id));
      return;
    }
    const { error } = await supabase.from("meta_events").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      dismissEvents([id]);
      seen.delete(id);
      setEvents((p) => p.filter((m) => m.id !== id));
    }
  }, []);

  const clearAll = useCallback(async () => {
    if (!userId) {
      seen.clear();
      setEvents(() => []);
      return;
    }
    const { error } = await supabase.from("meta_events").delete().eq("user_id", userId);
    if (error) toast.error(error.message);
    else {
      dismissEvents(events.map((ev) => ev.id));
      seen.clear();
      setEvents(() => []);
    }
  }, []);

  const testMetaEvent = useCallback(async () => {
    const sourceToken = await getCurrentMetaSourceToken();
    const ev: MetaEvent = {
      id: "test-" + Date.now(),
      title: "Meta de teste",
      url: "https://example.com",
      steps: 42,
      target: 50,
      balance: 60,
      balance_raw: "R$ 60,00",
      source_tab_id: null,
      source_token: sourceToken,
      created_at: new Date().toISOString(),
    };

    if (!sourceToken) {
      toast.error("Nenhum token Meta foi encontrado neste PC.");
      return;
    }

    pushEvent(ev, { silent: true });
    toast.success(`🎯 Meta atingida: ${ev.title}`, {
      description: `${ev.steps} / ${ev.target}`,
    });
    playMetaSound();
  }, []);

  return {
    events: snap,
    diagnostics: diagSnap,
    removeEvent,
    clearAll,
    reload,
    playMetaSound,
    testMetaEvent,
  };
}
