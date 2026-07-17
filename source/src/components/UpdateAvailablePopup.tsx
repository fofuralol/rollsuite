import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Download, Loader2, Sparkles } from "lucide-react";
import { IS_DESKTOP } from "@/lib/runtime";
import { toast } from "sonner";

type Kind = "native" | "bundle";
const DISMISS_KEY = "update:dismissed";

export default function UpdateAvailablePopup() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind | null>(null);
  const [available, setAvailable] = useState<string>("");
  const [installed, setInstalled] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [nativeProgress, setNativeProgress] = useState<{ phase: string; pct: number } | null>(null);

  useEffect(() => {
    if (!IS_DESKTOP) return;
    const api = (window as any).electronAPI;
    if (!api) return;

    const off1 = api.onUpdateProgress?.((p: any) => setProgress(p));
    const off2 = api.onNativeUpdateProgress?.((p: any) => setNativeProgress(p));

    let cancelled = false;
    const check = async () => {
      try {
        const nat = await api.checkNativeUpdate?.();
        if (cancelled) return;
        if (nat?.data?.hasUpdate) {
          const v = String(nat.data.available || "");
          const dismissed = localStorage.getItem(DISMISS_KEY) || "";
          if (v && v !== dismissed) {
            setKind("native");
            setAvailable(v);
            setInstalled(String(nat.data.installed || ""));
            setOpen(true);
          }
          return;
        }
        const chk = await api.checkUpdate?.();
        if (cancelled) return;
        if (chk?.data?.hasUpdate) {
          const v = String(chk.data.available || "");
          const dismissed = localStorage.getItem(DISMISS_KEY) || "";
          if (v && v !== dismissed) {
            setKind("bundle");
            setAvailable(v);
            setInstalled(String(chk.data.installed || ""));
            setOpen(true);
          }
        }
      } catch {}
    };
    check();
    const id = window.setInterval(check, 60_000);
    return () => { cancelled = true; clearInterval(id); try { off1?.(); off2?.(); } catch {} };
  }, []);

  if (!IS_DESKTOP) return null;

  const handleUpdate = async () => {
    const api = (window as any).electronAPI;
    setBusy(true);
    setProgress(null);
    setNativeProgress(null);
    try {
      if (kind === "native") {
        toast.info("Baixando nova versão do app… ele será reiniciado.");
        const res = await api.applyNativeUpdate();
        if (res?.error) throw new Error(res.error.message);
        toast.success(`Aplicando ${res.data.version} e reiniciando…`);
        return;
      }
      const res = await api.applyUpdate();
      if (res.error) throw new Error(res.error.message);
      toast.success(`Atualizado para ${res.data.version}. Recarregando…`);
      setTimeout(() => api.reloadApp(), 600);
    } catch (e: any) {
      toast.error("Falha ao atualizar: " + (e?.message || String(e)));
      setBusy(false);
    }
  };

  const handleDismiss = () => {
    try { if (available) localStorage.setItem(DISMISS_KEY, available); } catch {}
    setOpen(false);
  };

  // Progresso unificado 0-100
  let pct: number | null = null;
  let phaseLabel = "";
  if (busy) {
    if (kind === "native") {
      if (nativeProgress) {
        pct = Math.max(0, Math.min(100, Math.round(nativeProgress.pct || 0)));
        phaseLabel = nativeProgress.phase === "download" ? "Baixando nova versão…" : "Reiniciando…";
      } else {
        phaseLabel = "Preparando download…";
      }
    } else {
      if (progress && progress.total > 0) {
        pct = Math.round((progress.done / progress.total) * 100);
        phaseLabel = `Baixando arquivos (${progress.done}/${progress.total})`;
      } else {
        phaseLabel = "Aplicando atualização…";
      }
    }
  }

  const btnLabel = busy ? (pct !== null ? `${pct}%` : "Atualizando…") : "Atualizar agora";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !busy) handleDismiss(); }}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden border-border/60">
        {/* Header com gradient sutil */}
        <div className="relative px-6 pt-6 pb-5 bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent border-b border-border/60">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-2xl bg-emerald-500/15 flex items-center justify-center shrink-0 ring-1 ring-emerald-500/30">
              <Sparkles className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-base leading-tight">Atualização disponível</DialogTitle>
              <DialogDescription className="text-xs mt-1 leading-snug">
                {kind === "native"
                  ? "Uma nova versão do app está pronta. Ele será reiniciado automaticamente."
                  : "Uma nova versão do conteúdo está pronta para ser aplicada."}
              </DialogDescription>
            </div>
          </div>
        </div>

        {/* Corpo: versões + progresso */}
        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Atual</div>
              <div className="text-xs font-mono mt-0.5 truncate">{installed || "—"}</div>
            </div>
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-emerald-400/80">Nova</div>
              <div className="text-xs font-mono mt-0.5 truncate text-emerald-400">{available || "—"}</div>
            </div>
          </div>

          {busy && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  {phaseLabel}
                </span>
                {pct !== null && (
                  <span className="font-mono font-semibold tabular-nums text-emerald-400">{pct}%</span>
                )}
              </div>
              <Progress value={pct ?? undefined} className="h-2" />
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2 px-6 pb-5 pt-0 border-t-0">
          <Button variant="ghost" onClick={handleDismiss} disabled={busy}>
            Depois
          </Button>
          <Button
            onClick={handleUpdate}
            disabled={busy}
            className="gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white"
          >
            {busy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            {btnLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

