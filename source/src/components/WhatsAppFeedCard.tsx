import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MessageCircle, Copy, Trash2, ChevronLeft, ChevronRight, Timer, Settings, X } from "lucide-react";
import { useWhatsApp, extractMatchingLines } from "@/hooks/useWhatsApp";
import { toast } from "sonner";
import coinsSound from "@/assets/coins.mp3";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";

const TIMER_MINUTES_KEY = "wa_feed_timer_minutes";
const PROMPTED_KEY = "wa_feed_timer_prompted_ids";

function loadMinutes(): number {
  const v = parseFloat(localStorage.getItem(TIMER_MINUTES_KEY) || "3");
  return isFinite(v) && v > 0 ? v : 3;
}

function loadPrompted(): Set<string> {
  try {
    const arr = JSON.parse(localStorage.getItem(PROMPTED_KEY) || "[]");
    return new Set(Array.isArray(arr) ? arr : []);
  } catch { return new Set(); }
}
function savePrompted(set: Set<string>) {
  const arr = Array.from(set).slice(-200);
  localStorage.setItem(PROMPTED_KEY, JSON.stringify(arr));
}

type Timer = { messageId: string; endsAt: number; durationMs: number; notified: boolean };

const WhatsAppFeedCard = () => {
  const { messages, removeMessage } = useWhatsApp();
  const [idx, setIdx] = useState(0);
  const [minutes, setMinutes] = useState<number>(loadMinutes());
  const [minutesInput, setMinutesInput] = useState<string>(String(loadMinutes()));
  const [timers, setTimers] = useState<Record<string, Timer>>({});
  const [promptVisible, setPromptVisible] = useState<Record<string, boolean>>({});
  const promptedRef = useRef<Set<string>>(loadPrompted());
  const [, force] = useState(0);

  // sempre que chegar nova mensagem (lista cresce no topo), volta para a mais recente
  useEffect(() => {
    setIdx(0);
    const top = messages[0];
    if (top && !promptedRef.current.has(top.id) && !timers[top.id]) {
      setPromptVisible((p) => ({ ...p, [top.id]: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages[0]?.id]);

  // garante que o índice fique dentro do range
  useEffect(() => {
    if (idx > messages.length - 1) setIdx(Math.max(0, messages.length - 1));
  }, [messages.length, idx]);

  // tick a cada 500ms p/ atualizar countdowns e disparar notificação
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      let changed = false;
      setTimers((curr) => {
        const next = { ...curr };
        for (const id of Object.keys(next)) {
          const tm = next[id];
          if (!tm.notified && now >= tm.endsAt) {
            tm.notified = true;
            changed = true;
            try {
              const audio = new Audio(coinsSound);
              audio.volume = 1;
              audio.play().catch(() => {});
            } catch {}
            const msg = messages.find((m) => m.id === id);
            toast.success(`⏰ Tempo esgotado${msg ? ` — ${msg.autor}` : ""}`, { duration: 8000 });
          }
        }
        return changed ? next : curr;
      });
      force((x) => x + 1);
    }, 500);
    return () => clearInterval(t);
  }, [messages]);

  const current = messages[idx];

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.success("Copiado"); } catch { toast.error("Falha ao copiar"); }
  };

  const handleRemove = async (id: string) => {
    await removeMessage(id);
    setIdx((i) => Math.max(0, Math.min(i, messages.length - 2)));
    setTimers((t) => { const n = { ...t }; delete n[id]; return n; });
    setPromptVisible((p) => { const n = { ...p }; delete n[id]; return n; });
  };

  const startTimer = (id: string) => {
    const durationMs = minutes * 60 * 1000;
    setTimers((t) => ({ ...t, [id]: { messageId: id, endsAt: Date.now() + durationMs, durationMs, notified: false } }));
    setPromptVisible((p) => ({ ...p, [id]: false }));
    promptedRef.current.add(id);
    savePrompted(promptedRef.current);
  };

  const dismissPrompt = (id: string) => {
    setPromptVisible((p) => ({ ...p, [id]: false }));
    promptedRef.current.add(id);
    savePrompted(promptedRef.current);
  };

  const cancelTimer = (id: string) => {
    setTimers((t) => { const n = { ...t }; delete n[id]; return n; });
  };

  const commitMinutes = () => {
    const v = parseFloat(minutesInput.replace(",", "."));
    if (isFinite(v) && v > 0) {
      setMinutes(v);
      localStorage.setItem(TIMER_MINUTES_KEY, String(v));
      toast.success(`Cronômetro: ${v} min`);
    } else {
      setMinutesInput(String(minutes));
    }
  };

  const fmt = (ms: number) => {
    if (ms < 0) ms = 0;
    const s = Math.ceil(ms / 1000);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, "0")}`;
  };

  const currentTimer = current ? timers[current.id] : undefined;
  const showPrompt = current ? !!promptVisible[current.id] && !currentTimer : false;

  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 p-3 h-full flex flex-col">
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <MessageCircle className="w-4 h-4 text-primary shrink-0" />
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground truncate">
            WhatsApp
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title="Configurar cronômetro">
                <Settings className="w-3.5 h-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-3 space-y-2" align="end">
              <div className="text-xs font-medium">Cronômetro</div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step="0.5"
                  min="0.1"
                  className="h-7 text-xs"
                  value={minutesInput}
                  onChange={(e) => setMinutesInput(e.target.value)}
                  onBlur={commitMinutes}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                />
                <span className="text-[11px] text-muted-foreground">min</span>
              </div>
              <div className="text-[10px] text-muted-foreground">
                Toca um som quando o tempo acabar.
              </div>
            </PopoverContent>
          </Popover>
          {messages.length > 0 && (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0"
                disabled={idx >= messages.length - 1}
                onClick={() => setIdx((i) => Math.min(messages.length - 1, i + 1))}
                title="Mensagem anterior"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {idx + 1}/{messages.length}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0"
                disabled={idx <= 0}
                onClick={() => setIdx((i) => Math.max(0, i - 1))}
                title="Próxima mensagem"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>
      {!current ? (
        <div className="text-[11px] text-muted-foreground italic text-center py-3">
          Sem mensagens. Configure no Monitor WhatsApp.
        </div>
      ) : (
        <div className={`rounded-md border p-2 text-xs group transition-colors ${
          current.pix_sent_at && !current.comprovante_at
            ? "border-amber-400 animate-pix-blink"
            : current.comprovante_at
              ? "border-emerald-500/60 bg-emerald-500/10"
              : "border-border/40 bg-background/40"
        }`}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-primary truncate">{current.autor}</span>
                {current.telefone && (
                  <span className="text-[10px] text-muted-foreground">{current.telefone}</span>
                )}
                <span className="text-[10px] text-muted-foreground">
                  {new Date(current.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </span>
                {current.matched.map((p) => (
                  <Badge key={p} variant="outline" className="h-4 text-[9px] px-1">{p}</Badge>
                ))}
              </div>
              <div className="mt-1 whitespace-pre-wrap break-words font-medium">
                {extractMatchingLines(current.mensagem, current.matched)}
              </div>

              {showPrompt && (
                <div className="mt-2 flex items-center gap-2 rounded border border-primary/40 bg-primary/5 px-2 py-1">
                  <Timer className="w-3.5 h-3.5 text-primary" />
                  <span className="text-[11px] flex-1">Iniciar cronômetro de {minutes} min?</span>
                  <Button size="sm" className="h-6 px-2 text-[11px]" onClick={() => startTimer(current.id)}>Sim</Button>
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => dismissPrompt(current.id)}>Não</Button>
                </div>
              )}

              {currentTimer && (
                <div className={`mt-2 flex items-center gap-2 rounded border px-2 py-1 ${currentTimer.notified ? "border-destructive/50 bg-destructive/10" : "border-primary/40 bg-primary/5"}`}>
                  <Timer className={`w-3.5 h-3.5 ${currentTimer.notified ? "text-destructive" : "text-primary"}`} />
                  <span className="text-[11px] font-mono tabular-nums flex-1">
                    {currentTimer.notified ? "Tempo esgotado!" : fmt(currentTimer.endsAt - Date.now())}
                  </span>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => cancelTimer(current.id)} title="Cancelar">
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition">
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => copy(current.mensagem)}><Copy className="w-3 h-3" /></Button>
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive" onClick={() => handleRemove(current.id)}><Trash2 className="w-3 h-3" /></Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WhatsAppFeedCard;
