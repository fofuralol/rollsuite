import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type TurnoEntry = { nome: string; username: string };

const STORAGE_LAST_TURN_KEY = "dkdash_turno_last_alerted_v1";
const STORAGE_VOLUME_KEY = "dkdash_turno_volume_v1";
const STORAGE_ENABLED_KEY = "dkdash_turno_enabled";
const POLL_MS = 10_000;

export const TURNO_ALERT_EVENT = "dkdash:turno-alert";

export function getStoredVolume(): number {
  try {
    const v = parseFloat(localStorage.getItem(STORAGE_VOLUME_KEY) || "0.9");
    if (Number.isFinite(v) && v >= 0 && v <= 1) return v;
  } catch {}
  return 0.9;
}

export function setStoredVolume(v: number) {
  try { localStorage.setItem(STORAGE_VOLUME_KEY, String(v)); } catch {}
}

function ensureNotifPermission() {
  if (typeof window === "undefined") return;
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    try { Notification.requestPermission(); } catch {}
  }
}

export function speakTurno(text: string = "É a sua vez!", volume?: number) {
  try {
    if (!("speechSynthesis" in window)) return;
    const vol = typeof volume === "number" ? volume : getStoredVolume();
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "pt-BR";
    u.volume = Math.max(0, Math.min(1, vol));
    u.rate = 1;
    u.pitch = 1.05;
    const voices = window.speechSynthesis.getVoices();
    const pt = voices.find((v) => /pt[-_]BR/i.test(v.lang)) || voices.find((v) => /^pt/i.test(v.lang));
    if (pt) u.voice = pt;
    window.speechSynthesis.speak(u);
  } catch {}
}

function notifyOS(title: string, body: string) {
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      const n = new Notification(title, { body, tag: "dkdash-turno", requireInteraction: true });
      n.onclick = () => { window.focus(); n.close(); };
    }
  } catch {}
}

function triggerOverlay(detail: { categoria: string; proximo?: string }) {
  try { window.dispatchEvent(new CustomEvent(TURNO_ALERT_EVENT, { detail })); } catch {}
}

export function useDkDashTurno(categoria: string = "montante") {
  const [fila, setFila] = useState<TurnoEntry[]>([]);
  const [myUsername, setMyUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [rodadasHoje, setRodadasHoje] = useState<number>(0);
  const [enabled, setEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_ENABLED_KEY) !== "0"; } catch { return true; }
  });
  const lastAlertedRef = useRef<string | null>(null);

  useEffect(() => {
    try { lastAlertedRef.current = localStorage.getItem(STORAGE_LAST_TURN_KEY); } catch {}
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("dkdash-lucros", {
        body: { action: "turnos", categoria },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const f = ((data as any)?.data?.fila || []) as TurnoEntry[];
      const me = (data as any)?.my_username || null;
      setFila(f);
      setMyUsername(me);
      if (typeof (data as any)?.rotations_today === "number") {
        setRodadasHoje((data as any).rotations_today);
      }

      if (enabled && me && f.length > 0 && f[0].username === me) {
        const sig = `${categoria}:${me}:${f[1]?.username || ""}`;
        const proximo = f[1]?.nome;
        if (lastAlertedRef.current !== sig) {
          lastAlertedRef.current = sig;
          try { localStorage.setItem(STORAGE_LAST_TURN_KEY, sig); } catch {}
          toast.success(`🎯 É a sua vez no Montante!${proximo ? ` · próximo: ${proximo}` : ""}`, { duration: 15000 });
          speakTurno("É a sua vez! É a sua vez no montante.");
          notifyOS("DK Dash · É a sua vez!", `Categoria ${categoria}${proximo ? ` · próximo: ${proximo}` : ""}`);
          triggerOverlay({ categoria, proximo });
        }
      } else if (me && f.length > 0 && f[0].username !== me) {
        const wasMine = (lastAlertedRef.current || "").includes(`:${me}:`);
        if (wasMine) {
          lastAlertedRef.current = null;
          try { localStorage.removeItem(STORAGE_LAST_TURN_KEY); } catch {}
        }
      }
    } catch {
      // silencioso
    } finally {
      setLoading(false);
    }
  }, [categoria, enabled]);

  useEffect(() => {
    ensureNotifPermission();
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const toggleEnabled = useCallback(() => {
    setEnabled((v) => {
      const next = !v;
      try { localStorage.setItem(STORAGE_ENABLED_KEY, next ? "1" : "0"); } catch {}
      if (next) ensureNotifPermission();
      return next;
    });
  }, []);

  const minhaPosicao = myUsername ? fila.findIndex((e) => e.username === myUsername) : -1;
  const naFila = minhaPosicao >= 0;

  const callAction = useCallback(async (op: string, extra: Record<string, any> = {}, successMsg?: string) => {
    try {
      const { data, error } = await supabase.functions.invoke("dkdash-lucros", {
        body: { action: "turno-action", op, categoria, ...extra },
      });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      if (successMsg) toast.success(successMsg);
      const f = ((data as any)?.data?.fila || []) as TurnoEntry[];
      if (f.length || (data as any)?.data?.status === "ok") setFila(f);
      else await load();
    } catch (e: any) {
      toast.error(e.message || "Erro");
    }
  }, [categoria, load]);

  const entrar = useCallback(() => callAction("entrar", {}, "Você entrou na fila"), [callAction]);
  const sair = useCallback(() => callAction("sair", {}, "Você saiu da fila"), [callAction]);
  const passarVez = useCallback(() => callAction("proximo", {}, "Vez passada"), [callAction]);
  const mover = useCallback((username: string, direcao: "cima" | "baixo") => callAction("mover", { target: username, direcao }), [callAction]);

  const fetchHistoricoHoje = useCallback(async () => {
    try {
      const tz = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
      const dayStr = `${tz.getFullYear()}-${String(tz.getMonth() + 1).padStart(2, "0")}-${String(tz.getDate()).padStart(2, "0")}`;
      const { data, error } = await supabase
        .from("dkdash_turno_rotations")
        .select("rotated_username, created_at")
        .eq("categoria", categoria)
        .eq("day", dayStr)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as Array<{ rotated_username: string; created_at: string }>;
    } catch {
      return [];
    }
  }, [categoria]);

  return { fila, myUsername, minhaPosicao, naFila, loading, enabled, toggleEnabled, reload: load, entrar, sair, passarVez, mover, rodadasHoje, fetchHistoricoHoje };
}
