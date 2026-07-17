import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RefreshCw, Trash2, ScrollText, Stethoscope, Eye, EyeOff } from "lucide-react";
import { IS_DESKTOP } from "@/lib/runtime";
import { toast } from "sonner";

export default function WhatsAppDebugLog() {
  const [text, setText] = useState("");
  const [auto, setAuto] = useState(true);
  const [hasIpc, setHasIpc] = useState(true);
  const [visible, setVisible] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);

  const load = async () => {
    if (!IS_DESKTOP) return;
    const api = (window as any).electronAPI;
    if (typeof api?.waReadLog !== "function") { setHasIpc(false); return; }
    const res = await api.waReadLog();
    if (res?.data !== undefined) {
      setText(res.data || "");
      setTimeout(() => {
        if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
      }, 0);
    }
  };

  const clear = async () => {
    const api = (window as any).electronAPI;
    await api?.waClearLog?.();
    setText("");
    toast.success("Log limpo");
  };

  useEffect(() => {
    if (!visible) return;
    load();
    if (!auto) return;
    const id = setInterval(load, 2000);
    return () => clearInterval(id);
  }, [auto, visible]);

  if (!IS_DESKTOP) return null;

  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <ScrollText className="w-4 h-4 text-primary" />
          Log do listener
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant={visible ? "secondary" : "outline"} className="h-7 text-xs gap-1" onClick={() => setVisible((v) => !v)}>
            {visible ? <><EyeOff className="w-3.5 h-3.5" /> Ocultar</> : <><Eye className="w-3.5 h-3.5" /> Mostrar dados</>}
          </Button>
          {visible && (
            <>
              <label className="text-xs text-muted-foreground flex items-center gap-1 mx-2">
                <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
                auto
              </label>
              <Button size="sm" variant="ghost" onClick={async () => {
                const api = (window as any).electronAPI;
                if (typeof api?.waDiagnostics !== "function") { toast.error("App antigo — atualize o .exe"); return; }
                const res = await api.waDiagnostics();
                const d = res?.data;
                if (!d) { toast.error("Falha no diagnóstico"); return; }
                const runtime = [
                  `uiDesktop: ${String(IS_DESKTOP)}`,
                  `hasElectronAPI: ${String(!!api)}`,
                  `hasWaDiagnostics: ${String(typeof api?.waDiagnostics === "function")}`,
                ].join(" | ");
                const msg =
                  `${runtime}\n` +
                  `dataDir: ${d.dataDir}\n` +
                  `disco: ${d.disk?.path}\n` +
                  `  existe: ${d.disk?.exists} | count: ${d.disk?.count}\n` +
                  `  sample: ${JSON.stringify(d.disk?.sample)}\n` +
                  `memória: count=${d.memoryCount} sample=${JSON.stringify(d.memorySample)}`;
                setText((t) => t + "\n----- DIAGNÓSTICO -----\n" + msg + "\n-----------------------\n");
                setTimeout(() => { if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight; }, 0);
              }} title="Diagnóstico de palavras-chave">
                <Stethoscope className="w-3.5 h-3.5" />
              </Button>
              <Button size="sm" variant="ghost" onClick={load}>
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>
              <Button size="sm" variant="ghost" onClick={clear}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>
      {visible && (
        <pre
          ref={preRef}
          className="text-[11px] leading-snug font-mono bg-muted/40 rounded p-2 h-64 overflow-auto whitespace-pre-wrap break-all"
        >
          {!hasIpc
            ? "Esta versão do app não tem suporte ao log embutido. Instale a versão nova do .exe (clicar em Atualizar não basta — o main process mudou)."
            : (text || "(vazio — envie uma mensagem no grupo para gerar logs)")}
        </pre>
      )}
    </Card>
  );
}
