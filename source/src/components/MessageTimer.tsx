import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Timer, X } from "lucide-react";
import { toast } from "sonner";
import timerAlarmSound from "@/assets/timer-alarm.mp3.asset.json";

const MINUTES_KEY = "wa_msg_timer_minutes";
const PROMPTED_KEY = "wa_msg_timer_prompted_ids";
const VOLUME_KEY = "wa_msg_timer_volume";
const AUTOSTART_KEY = "wa_msg_timer_autostart";

export function getTimerMinutes(): number {
  const v = parseFloat(localStorage.getItem(MINUTES_KEY) || "3");
  return isFinite(v) && v > 0 ? v : 3;
}
export function setTimerMinutes(v: number) {
  if (isFinite(v) && v > 0) localStorage.setItem(MINUTES_KEY, String(v));
}

export function getTimerVolume(): number {
  const v = parseFloat(localStorage.getItem(VOLUME_KEY) || "1");
  return isFinite(v) && v >= 0 && v <= 1 ? v : 1;
}
export function setTimerVolume(v: number) {
  if (isFinite(v) && v >= 0 && v <= 1) localStorage.setItem(VOLUME_KEY, String(v));
}

export function getTimerAutoStart(): boolean {
  return localStorage.getItem(AUTOSTART_KEY) === "1";
}
export function setTimerAutoStart(v: boolean) {
  localStorage.setItem(AUTOSTART_KEY, v ? "1" : "0");
}

type Timer = { endsAt: number; notified: boolean };
// persistent across navigations
const timers = new Map<string, Timer>();
const subscribers = new Set<() => void>();
const notifySubs = () => subscribers.forEach((fn) => fn());

function loadPrompted(): Set<string> {
  try {
    const arr = JSON.parse(localStorage.getItem(PROMPTED_KEY) || "[]");
    return new Set(Array.isArray(arr) ? arr : []);
  } catch { return new Set(); }
}
const prompted = loadPrompted();
function markPrompted(id: string) {
  prompted.add(id);
  localStorage.setItem(PROMPTED_KEY, JSON.stringify(Array.from(prompted).slice(-300)));
}

function resolveSoundUrl(): string {
  const raw = timerAlarmSound.url;
  if (raw.startsWith("http") || raw.startsWith("data:")) return raw;
  if (typeof window !== "undefined" && window.location.protocol === "file:") {
    return `https://calculadora-de-roll.lovable.app${raw}`;
  }
  return raw;
}

// preloaded audio (unlocked by user gesture on Sim)
let preloadedAudio: HTMLAudioElement | null = null;
function unlockAudio() {
  if (preloadedAudio) return;
  try {
    const a = new Audio(resolveSoundUrl());
    a.crossOrigin = "anonymous";
    a.volume = 0;
    a.play().then(() => { a.pause(); a.currentTime = 0; a.volume = 1; }).catch(() => {});
    preloadedAudio = a;
  } catch {}
}

function playEndSound() {
  try {
    const src = resolveSoundUrl();
    const audio = preloadedAudio ?? new Audio(src);
    if (!src.startsWith("data:")) audio.crossOrigin = "anonymous";
    audio.volume = getTimerVolume();
    audio.currentTime = 0;
    audio.play().catch((err) => console.warn("[MessageTimer] audio play failed:", err, src));
  } catch {}
}

// global tick — single interval drives all mounted timers
let tickerStarted = false;
function ensureTicker() {
  if (tickerStarted) return;
  tickerStarted = true;
  setInterval(() => {
    const now = Date.now();
    let changed = false;
    timers.forEach((t, id) => {
      if (!t.notified && now >= t.endsAt) {
        t.notified = true;
        changed = true;
        playEndSound();
        toast.success("⏰ Tempo esgotado!", { duration: 8000 });
      }
    });
    if (timers.size > 0) notifySubs();
    if (changed) notifySubs();
  }, 500);
}

export default function MessageTimer({
  messageId,
  label,
  isLatest = true,
}: {
  messageId: string;
  label?: string;
  isLatest?: boolean;
}) {
  const [, force] = useState(0);
  const [showPrompt, setShowPrompt] = useState(false);
  const lastIdRef = useRef<string | null>(null);
  const sessionInitRef = useRef(false);

  useEffect(() => {
    ensureTicker();
    const fn = () => force((x) => x + 1);
    subscribers.add(fn);
    return () => { subscribers.delete(fn); };
  }, []);

  // when the message id changes, decide whether to show the prompt
  useEffect(() => {
    if (!messageId) return;
    if (lastIdRef.current === messageId) return;
    lastIdRef.current = messageId;

    // First message we ever see in this session is treated as pre-existing —
    // do NOT autostart and do NOT prompt. Avoids firing on app load / reload.
    if (!sessionInitRef.current) {
      sessionInitRef.current = true;
      markPrompted(messageId);
      setShowPrompt(false);
      return;
    }

    const hasTimer = timers.has(messageId);
    if (hasTimer) { setShowPrompt(false); return; }

    // If user is just navigating to an older message (not the latest one),
    // never autostart and never re-prompt.
    if (!isLatest) { setShowPrompt(false); return; }

    // Already handled before (prompted or autostarted at some point) — skip.
    if (prompted.has(messageId)) { setShowPrompt(false); return; }

    if (getTimerAutoStart()) {
      const minutes = getTimerMinutes();
      timers.set(messageId, { endsAt: Date.now() + minutes * 60 * 1000, notified: false });
      markPrompted(messageId);
      setShowPrompt(false);
      notifySubs();
      return;
    }
    setShowPrompt(true);
  }, [messageId, isLatest]);

  const timer = timers.get(messageId);

  const start = () => {
    unlockAudio();
    const minutes = getTimerMinutes();
    timers.set(messageId, { endsAt: Date.now() + minutes * 60 * 1000, notified: false });
    markPrompted(messageId);
    setShowPrompt(false);
    notifySubs();
  };

  const dismiss = () => {
    markPrompted(messageId);
    setShowPrompt(false);
  };

  const cancel = () => {
    timers.delete(messageId);
    notifySubs();
  };

  const fmt = (ms: number) => {
    if (ms < 0) ms = 0;
    const s = Math.ceil(ms / 1000);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, "0")}`;
  };

  if (!messageId) return null;

  if (timer) {
    return (
      <div className={`mx-3 sm:mx-4 mb-3 flex items-center gap-2 rounded-lg border px-3 py-2 ${timer.notified ? "border-destructive/50 bg-destructive/10" : "border-emerald-500/40 bg-emerald-500/5"}`}>
        <Timer className={`w-4 h-4 ${timer.notified ? "text-destructive" : "text-emerald-400"}`} />
        <span className="text-sm font-mono tabular-nums font-bold flex-1">
          {timer.notified ? "Tempo esgotado!" : fmt(timer.endsAt - Date.now())}
        </span>
        {label && <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">{label}</span>}
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={cancel} title="Cancelar cronômetro">
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
    );
  }

  if (showPrompt) {
    const minutes = getTimerMinutes();
    return (
      <div className="mx-3 sm:mx-4 mb-3 flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-3 py-2">
        <Timer className="w-4 h-4 text-emerald-400" />
        <span className="text-xs flex-1">Iniciar cronômetro de {minutes} min?</span>
        <Button size="sm" className="h-7 px-3 text-[11px] bg-emerald-500 text-emerald-950 hover:bg-emerald-500/90 font-bold" onClick={start}>Sim</Button>
        <Button size="sm" variant="ghost" className="h-7 px-3 text-[11px]" onClick={dismiss}>Não</Button>
      </div>
    );
  }

  return null;
}
