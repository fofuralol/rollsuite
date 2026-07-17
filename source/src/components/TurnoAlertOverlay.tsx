import { useEffect, useState } from "react";
import { Volume2, X } from "lucide-react";
import { TURNO_ALERT_EVENT, speakTurno } from "@/hooks/useDkDashTurno";
import { Button } from "@/components/ui/button";

export default function TurnoAlertOverlay() {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<{ categoria: string; proximo?: string } | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      setInfo({ categoria: detail.categoria || "montante", proximo: detail.proximo });
      setOpen(true);
      window.setTimeout(() => setOpen(false), 12000);
    };
    window.addEventListener(TURNO_ALERT_EVENT, handler);
    return () => window.removeEventListener(TURNO_ALERT_EVENT, handler);
  }, []);

  if (!open || !info) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 animate-in fade-in"
      onClick={() => setOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative max-w-lg w-[92%] rounded-2xl border-2 border-emerald-400/60 bg-gradient-to-br from-emerald-500/30 via-emerald-600/20 to-emerald-900/40 p-8 shadow-[0_0_60px_hsl(142_76%_45%/0.6)] animate-pulse"
      >
        <button
          onClick={() => setOpen(false)}
          className="absolute top-3 right-3 text-emerald-100/80 hover:text-white"
          title="Fechar"
        >
          <X className="w-5 h-5" />
        </button>
        <div className="text-center space-y-3">
          <div className="text-[11px] uppercase tracking-[0.3em] text-emerald-200/80 font-bold">
            DK Dash · {info.categoria}
          </div>
          <div className="text-5xl font-black text-white drop-shadow-[0_0_20px_hsl(142_76%_45%)]">
            🎯 É A SUA VEZ!
          </div>
          {info.proximo && (
            <div className="text-sm text-emerald-100/90">
              Próximo da fila: <span className="font-bold">{info.proximo}</span>
            </div>
          )}
          <div className="pt-3 flex items-center justify-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="bg-white/10 border-white/30 text-white hover:bg-white/20"
              onClick={() => speakTurno("É a sua vez!")}
            >
              <Volume2 className="w-4 h-4 mr-1.5" /> Falar de novo
            </Button>
            <Button
              size="sm"
              className="bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-bold"
              onClick={() => setOpen(false)}
            >
              OK, entendi
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
