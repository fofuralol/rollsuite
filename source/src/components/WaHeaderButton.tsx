import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Play, Square, Wifi, WifiOff, QrCode, LogOut } from "lucide-react";
import { IS_DESKTOP } from "@/lib/runtime";
import { toast } from "sonner";

interface WaState {
  status: "disconnected" | "starting" | "qr" | "connected" | "error";
  qr: string | null;
  info: { wid?: string; pushname?: string } | null;
  progress?: string;
}

export default function WaHeaderButton() {
  const [state, setState] = useState<WaState>({ status: "disconnected", qr: null, info: null });
  const [busy, setBusy] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  useEffect(() => {
    if (!IS_DESKTOP) return;
    const api = (window as any).electronAPI;
    api.waState?.().then((r: any) => r?.data && setState(r.data));
    const off = api.onWaState?.((s: WaState) => setState(s));
    return () => { try { off?.(); } catch {} };
  }, []);

  useEffect(() => {
    if (state.status === "qr") setQrOpen(true);
    if (state.status === "connected") setQrOpen(false);
  }, [state.status]);

  if (!IS_DESKTOP) return null;
  const api = (window as any).electronAPI;

  const start = async () => {
    setBusy(true);
    const r = await api.waStart();
    setBusy(false);
    if (r?.error) toast.error(r.error.message);
  };
  const stop = async () => { setBusy(true); await api.waStop(); setBusy(false); };
  const logout = async () => {
    if (!confirm("Remover sessão do WhatsApp? Vai precisar escanear o QR de novo.")) return;
    setBusy(true); await api.waLogout(); setBusy(false);
  };

  if (state.status === "connected") {
    return (
      <button
        onClick={stop}
        disabled={busy}
        title={`Conectado${state.info?.pushname ? ` · ${state.info.pushname}` : ""} — clique para parar`}
        className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-emerald-600/40 bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-300 text-xs font-semibold transition-colors"
      >
        <Wifi className="w-3.5 h-3.5" />
        <span>Conectado{state.info?.pushname ? ` · ${state.info.pushname}` : ""}</span>
      </button>
    );
  }

  if (state.status === "starting") {
    return (
      <div className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-border bg-card/40 text-xs text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        <span>{state.progress || "Iniciando…"}</span>
      </div>
    );
  }

  if (state.status === "qr") {
    return (
      <>
        <button
          onClick={() => setQrOpen(true)}
          className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-amber-600/40 bg-amber-600/10 hover:bg-amber-600/20 text-amber-300 text-xs font-semibold"
        >
          <QrCode className="w-3.5 h-3.5" />
          <span>Escanear QR</span>
        </button>
        <Dialog open={qrOpen} onOpenChange={setQrOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Conectar WhatsApp</DialogTitle></DialogHeader>
            {state.qr ? (
              <div className="flex flex-col items-center gap-2">
                <img src={state.qr} alt="QR WhatsApp" className="w-64 h-64 rounded bg-white p-2" />
                <p className="text-xs text-muted-foreground text-center">Abra WhatsApp → Aparelhos conectados → Conectar aparelho</p>
              </div>
            ) : <p className="text-sm text-muted-foreground">Aguardando QR…</p>}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={stop}><Square className="w-3.5 h-3.5 mr-1" />Parar</Button>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // disconnected / error
  return (
    <div className="inline-flex items-center gap-1">
      <button
        onClick={start}
        disabled={busy}
        className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-primary/50 bg-primary/10 hover:bg-primary/20 text-primary text-xs font-semibold disabled:opacity-60"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
        <span>Iniciar WhatsApp</span>
      </button>
      {state.status === "error" && (
        <button onClick={logout} title="Remover sessão" className="h-8 px-1.5 text-muted-foreground hover:text-foreground">
          <LogOut className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
