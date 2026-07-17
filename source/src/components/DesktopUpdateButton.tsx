import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { IS_DESKTOP } from "@/lib/runtime";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function DesktopUpdateButton() {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [nativeProgress, setNativeProgress] = useState<{ phase: string; pct: number } | null>(null);
  const [version, setVersion] = useState<string>("");
  const [nativeVersion, setNativeVersion] = useState<string>("");
  const [hasUpdate, setHasUpdate] = useState(false);
  const [updateKind, setUpdateKind] = useState<"native" | "bundle" | null>(null);

  useEffect(() => {
    if (!IS_DESKTOP) return;
    const api = (window as any).electronAPI;
    api.getVersion?.().then((r: any) => setVersion(r?.data || ""));
    api.getNativeVersion?.().then((r: any) => setNativeVersion(r?.data || ""));
    const off1 = api.onUpdateProgress?.((p: any) => setProgress(p));
    const off2 = api.onNativeUpdateProgress?.((p: any) => setNativeProgress(p));

    let cancelled = false;
    const pollOnce = async () => {
      try {
        // Nativo tem prioridade (precisa clique do usuário pra reiniciar)
        const nat = await api.checkNativeUpdate?.();
        if (cancelled) return;
        if (nat?.data?.hasUpdate) {
          setHasUpdate(true);
          setUpdateKind("native");
          return;
        }
        // Bundle: apenas detecta. Não aplica automaticamente para evitar loop de reload
        // quando o app local ainda não consegue persistir/validar a versão instalada.
        const chk = await api.checkUpdate?.();
        if (cancelled) return;
        if (chk?.data?.hasUpdate) {
          setHasUpdate(true);
          setUpdateKind("bundle");
        } else {
          setHasUpdate(false);
          setUpdateKind(null);
        }
      } catch {}
    };
    pollOnce();
    const id = window.setInterval(pollOnce, 60_000);
    return () => { cancelled = true; clearInterval(id); try { off1?.(); off2?.(); } catch {} };
  }, []);

  if (!IS_DESKTOP) return null;

  const runNativeUpdate = async () => {
    const api = (window as any).electronAPI;
    toast.info("Baixando nova versão do app… ele será reiniciado automaticamente.");
    const res = await api.applyNativeUpdate();
    if (res?.error) throw new Error(res.error.message);
    toast.success(`Aplicando ${res.data.version} e reiniciando…`);
  };

  const handleUpdate = async () => {
    const api = (window as any).electronAPI;
    setBusy(true);
    setProgress(null);
    setNativeProgress(null);
    try {
      const nat = await api.checkNativeUpdate?.();
      if (nat?.data?.hasUpdate) {
        await runNativeUpdate();
        return;
      }
      const chk = await api.checkUpdate();
      if (chk.error) throw new Error(chk.error.message);
      if (!chk.data.hasUpdate) {
        toast.success(`Já está na última versão (${chk.data.installed || "inicial"})`);
        setHasUpdate(false);
        setUpdateKind(null);
        setBusy(false);
        return;
      }
      toast.info(`Baixando versão ${chk.data.available}…`);
      const res = await api.applyUpdate();
      if (res.error) throw new Error(res.error.message);
      toast.success(`Atualizado para ${res.data.version}. Recarregando…`);
      setTimeout(() => api.reloadApp(), 600);
    } catch (e: any) {
      toast.error("Falha ao atualizar: " + (e?.message || String(e)));
    } finally {
      setBusy(false);
    }
  };

  const label = busy
    ? nativeProgress
      ? nativeProgress.phase === "download"
        ? `App ${nativeProgress.pct}%`
        : "Reiniciando…"
      : progress
      ? `${progress.done}/${progress.total}`
      : "Verificando…"
    : hasUpdate
    ? "Atualização disponível"
    : "Atualizar";

  const highlight = hasUpdate && !busy;

  return (
    <Button
      variant={highlight ? "default" : "ghost"}
      size="sm"
      className={cn(
        "h-9 px-2 gap-1.5 transition-colors",
        highlight && "bg-emerald-500 hover:bg-emerald-600 text-white animate-pulse ring-2 ring-emerald-400/60 shadow-[0_0_12px_rgba(16,185,129,0.55)]"
      )}
      onClick={handleUpdate}
      disabled={busy}
      title={
        (hasUpdate ? `Atualização ${updateKind === "native" ? "do app" : "de conteúdo"} disponível\n` : "") +
        (nativeVersion ? `App: ${nativeVersion}\n` : "") +
        (version ? `Bundle: ${version}` : "Verificar atualizações")
      }
    >
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className={cn("w-4 h-4", highlight && "animate-bounce")} />}
      <span className={cn("text-xs", highlight ? "inline" : "hidden sm:inline")}>{label}</span>
    </Button>
  );
}
