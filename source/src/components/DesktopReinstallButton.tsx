import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw, Loader2 } from "lucide-react";
import { IS_DESKTOP } from "@/lib/runtime";
import { toast } from "sonner";

export default function DesktopReinstallButton() {
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState<number | null>(null);

  if (!IS_DESKTOP) return null;

  const handleClick = async () => {
    const api = (window as any).electronAPI;
    if (!api?.applyNativeUpdate) {
      toast.error("Esta versão do app não suporta autoupdate nativo. Reinstale manualmente uma vez.");
      return;
    }
    setBusy(true);
    setPct(0);
    const off = api.onNativeUpdateProgress?.((p: any) => {
      if (p?.phase === "download") setPct(p.pct ?? 0);
      else if (p?.phase === "ready") setPct(100);
    });
    try {
      const chk = await api.checkNativeUpdate?.();
      if (chk?.error) throw new Error(chk.error.message);
      if (!chk?.data?.hasUpdate) {
        toast.success(`Já está na última versão (${chk?.data?.installed || "atual"})`);
        setBusy(false);
        setPct(null);
        return;
      }
      toast.info(`Baixando ${chk.data.available}… o app vai fechar e abrir sozinho.`);
      const res = await api.applyNativeUpdate();
      if (res?.error) throw new Error(res.error.message);
      toast.success(`Aplicando ${res.data.version} e reiniciando…`);
    } catch (e: any) {
      toast.error("Falha no autoupdate: " + (e?.message || String(e)));
      setBusy(false);
      setPct(null);
    } finally {
      try { off?.(); } catch {}
    }
  };

  const label = busy ? (pct === 100 ? "Reiniciando…" : `Baixando ${pct ?? 0}%`) : "Reinstalar .exe";

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-9 px-2 gap-1.5"
      onClick={handleClick}
      disabled={busy}
      title="Baixa o .exe mais recente, fecha o app e abre a nova versão"
    >
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
      <span className="text-xs hidden sm:inline">{label}</span>
    </Button>
  );
}
