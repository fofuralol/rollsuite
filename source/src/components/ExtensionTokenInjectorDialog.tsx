import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { FileArchive, Syringe, Copy, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { IS_DESKTOP } from "@/lib/runtime";

type ZipInfo = {
  zipPath: string;
  currentToken: string;
  currentSupabaseUrl: string | null;
  targetSupabaseUrl: string;
  needsUrlSwap: boolean;
  files: { file: string; count: number; urlCount?: number }[];
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const OFFLINE_TOKEN = "ROLLSUITE_OFFLINE";

export default function ExtensionTokenInjectorDialog({ open, onOpenChange }: Props) {
  const [zip, setZip] = useState<ZipInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState<string>("");
  const [log, setLog] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!IS_DESKTOP) return;
    const api: any = (window as any).electronAPI;
    const off = api?.onExtInjectProgress?.((p: any) => {
      if (typeof p.pct === "number") setProgress(p.pct);
      if (p.step) setStep(p.step);
      if (p.log) setLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${p.log}`]);
    });
    return () => off?.();
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  useEffect(() => {
    if (!open) {
      setZip(null); setBusy(false);
      setProgress(0); setStep(""); setLog([]);
    }
  }, [open]);

  const pickZip = async () => {
    const api: any = (window as any).electronAPI;
    if (!api?.extPickAndRead) { toast.error("Disponível apenas no app desktop"); return; }
    const { data, error } = await api.extPickAndRead();
    if (error) { toast.error(error.message); return; }
    if (!data) return;
    setZip(data);
    setLog((p) => [...p,
      `[${new Date().toLocaleTimeString()}] Carregado: ${data.zipPath}`,
      `[${new Date().toLocaleTimeString()}] Modo alvo: offline puro (sem token/nuvem)`,
      `[${new Date().toLocaleTimeString()}] URL local:  ${data.targetSupabaseUrl}`,
      ...data.files.map((f: any) => `[${new Date().toLocaleTimeString()}] ${f.file}: ${f.count} token(s), ${f.urlCount ?? 0} URL(s)`),
    ]);
  };

  const doInject = async () => {
    if (!zip) return;
    if (!zip.needsUrlSwap) {
      toast.message("Extensão já está em modo offline");
      return;
    }
    setBusy(true); setProgress(0); setStep("Iniciando…");
    const api: any = (window as any).electronAPI;
    const { error } = await api.extInjectToken({
      zipPath: zip.zipPath,
      newToken: OFFLINE_TOKEN,
      newSupabaseUrl: zip.targetSupabaseUrl,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    try {
      localStorage.removeItem("desktop_extension_token");
      await api?.metaSetConfig?.({ token: "", cloud_enabled: false, local_enabled: true, enabled: false });
    } catch {}
    toast.success("Extensão convertida para offline puro");
    setZip({ ...zip, currentToken: OFFLINE_TOKEN, currentSupabaseUrl: zip.targetSupabaseUrl, needsUrlSwap: false });
  };

  const copy = (s: string) => { navigator.clipboard.writeText(s); toast.success("Copiado"); };

  const doGenerate = async () => {
    const api: any = (window as any).electronAPI;
    if (!api?.extGenerate) { toast.error("Disponível apenas no app desktop"); return; }
    setBusy(true); setProgress(0); setStep("Iniciando…");
    const { data, error } = await api.extGenerate({ token: OFFLINE_TOKEN });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    if (!data) return;
    try {
      localStorage.removeItem("desktop_extension_token");
      await api?.metaSetConfig?.({ token: "", cloud_enabled: false, local_enabled: true, enabled: false });
    } catch {}
    toast.success(`Extensão pronta: ${data.zipPath}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Syringe className="w-4 h-4 text-primary" /> Gerador offline da extensão
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 space-y-2">
            <div className="text-[10px] uppercase font-bold tracking-wider text-primary">
              Extensão pronta pra este PC
            </div>
            <div className="text-[11px] text-muted-foreground">
              Gera um .zip em modo offline puro, sem login, token ou nuvem.
            </div>
            <Button onClick={doGenerate} disabled={busy} className="w-full gap-2" variant="default">
              <FileArchive className="w-4 h-4" />
              {busy ? "Gerando…" : "Gerar extensão offline"}
            </Button>
          </div>

          <div className="rounded-lg border border-border/60 bg-card/40 p-3 space-y-2">
            <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">Avançado: converter zip existente</div>
            {!zip ? (
              <Button onClick={pickZip} variant="outline" className="w-full gap-2">
                <FileArchive className="w-4 h-4" /> Selecionar extensão zipada
              </Button>
            ) : (
              <div className="space-y-2">
                <div className="text-[11px] text-muted-foreground truncate" title={zip.zipPath}>📦 {zip.zipPath}</div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px]">Estado</Badge>
                  <Input readOnly value={zip.needsUrlSwap ? "Converter para offline" : "Offline puro"} className="h-7 text-[11px] font-mono" onFocus={(e) => e.currentTarget.select()} />
                  <Button size="sm" variant="ghost" className="h-7" onClick={() => copy(zip.targetSupabaseUrl)}>
                    <Copy className="w-3 h-3" />
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={zip.needsUrlSwap ? "destructive" : "secondary"} className="text-[10px]">
                    URL local
                  </Badge>
                  <Input readOnly value={zip.targetSupabaseUrl} className="h-7 text-[10px] font-mono" onFocus={(e) => e.currentTarget.select()} />
                </div>
                {zip.needsUrlSwap && (
                  <div className="text-[10px] text-amber-500">
                    ⚠️ Extensão aponta para nuvem — será convertida para offline.
                  </div>
                )}
                <Button onClick={pickZip} variant="ghost" size="sm" className="text-[11px] h-7">Trocar arquivo</Button>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border/60 bg-card/40 p-3 space-y-2">
            <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">Converter</div>
            <Button onClick={doInject} disabled={!zip || busy} className="w-full gap-2">
              <Syringe className="w-4 h-4" />
              {busy ? "Convertendo…" : "Converter zip selecionado para offline"}
            </Button>
            {(busy || progress > 0) && (
              <div className="space-y-1">
                <Progress value={progress} />
                <div className="text-[11px] text-muted-foreground">{step} — {progress}%</div>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border/60 bg-black/40 p-2">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> Log
              </div>
              {log.length > 0 && (
                <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setLog([])}>limpar</Button>
              )}
            </div>
            <div ref={logRef} className="h-32 overflow-y-auto font-mono text-[10px] text-muted-foreground whitespace-pre-wrap">
              {log.length === 0 ? <span className="italic">Aguardando…</span> : log.join("\n")}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
