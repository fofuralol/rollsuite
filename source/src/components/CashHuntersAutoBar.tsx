import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Zap, Settings2, Crosshair, Loader2 } from "lucide-react";

type Point = { x: number; y: number; relX: number | null; relY: number | null; found?: boolean };
type Coords = Partial<Record<
  "qty" | "deps" | "depsArea" | "depsSave" | "url" | "pixTab" | "pixAdd" | "pixArea" | "pixSave" | "pixOk" | "inicioTab" | "playButton",
  Point
>>;
type Config = { title: string; coords: Coords; delays?: Record<string, number> };

const FIELDS: { key: keyof Coords; label: string; hint: string }[] = [
  { key: "qty", label: "1. Campo Quantidade de Contas", hint: "limpa e cola a quantidade" },
  { key: "deps", label: "2. Botão Personalizar Depósitos", hint: "abre o modal de depósitos" },
  { key: "depsArea", label: "2a. Área de texto modal Depósitos", hint: "clica pra focar antes de colar (abra o modal!)" },
  { key: "depsSave", label: "2b. Salvar modal Depósitos", hint: "botão Salvar do modal" },
  { key: "url", label: "3. Campo URL da tarefa", hint: "limpa e cola o link" },
  { key: "pixTab", label: "4. Aba Chaves PIX", hint: "clica para trocar de aba" },
  { key: "pixAdd", label: "4a. Botão Adicionar PIX", hint: "abre o modal de PIX" },
  { key: "pixArea", label: "4b. Área de texto modal PIX", hint: "clica pra focar antes de colar (abra o modal!)" },
  { key: "pixSave", label: "4c. Salvar modal PIX", hint: "botão Salvar do modal" },
  { key: "pixOk", label: "4d. OK confirmação PIX", hint: "popup 'X chaves adicionadas' — clica OK" },
  { key: "inicioTab", label: "5. Aba Início", hint: "volta pra aba inicial" },
  { key: "playButton", label: "5b. Botão Play / Iniciar", hint: "dispara o Cash Hunter" },
];

const api = (typeof window !== "undefined" ? (window as any).electronAPI : null) as
  | {
      chGetCursorPos: (title?: string) => Promise<{ data: Point | null; error: any }>;
      chConfigGet: () => Promise<{ data: Config | null; error: any }>;
      chConfigSet: (cfg: Config) => Promise<{ data: Config | null; error: any }>;
      chRun: (args: {
        title: string;
        coords: Coords;
        payload: { qty: string; depsText: string; url: string; pixText: string };
        delays?: Record<string, number>;
      }) => Promise<{ data: any; error: any }>;
    }
  | null;

export function CashHuntersAutoBar(props: {
  qty: string;
  depsText: string;
  url: string;
  pixText: string;
  depsCount: number;
  pixCount: number;
}) {
  const [cfg, setCfg] = useState<Config>({ title: "DK MONTANTE", coords: {} });
  const [titleDraft, setTitleDraft] = useState("DK MONTANTE");
  const [open, setOpen] = useState(false);
  const [capturing, setCapturing] = useState<keyof Coords | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!api) return;
    api.chConfigGet().then((r) => {
      if (r?.data) {
        setCfg(r.data);
        setTitleDraft(r.data.title || "DK MONTANTE");
      }
    });
  }, []);

  if (!api) return null;

  const allCalibrated = FIELDS.every((f) => {
    const p = cfg.coords[f.key];
    return p && p.relX != null && p.relY != null;
  });

  async function refreshConfig() {
    const r = await api!.chConfigGet();
    if (r?.data) {
      setCfg(r.data);
      setTitleDraft(r.data.title || "DK MONTANTE");
      return r.data;
    }
    return cfg;
  }

  async function saveTitle(title: string) {
    const cleanTitle = title.trim() || "DK MONTANTE";
    let live: Config = cfg;
    try {
      const r = await api!.chConfigGet();
      if (r?.data) live = r.data;
    } catch {}
    const next = { ...live, title: cleanTitle };
    setCfg(next);
    setTitleDraft(cleanTitle);
    await api!.chConfigSet(next);
    return next;
  }

  async function capture(key: keyof Coords) {
    const active = await saveTitle(titleDraft);
    const activeTitle = active.title || "DK MONTANTE";
    setCapturing(key);
    for (let i = 3; i > 0; i--) {
      setCountdown(i);
      await new Promise((r) => setTimeout(r, 1000));
    }
    setCountdown(0);
    const r = await api!.chGetCursorPos(activeTitle);
    setCapturing(null);
    if (r?.error || !r?.data) {
      toast.error("Falha ao capturar posição");
      return;
    }
    if (!r.data.found || r.data.relX == null) {
      toast.error(`Janela "${activeTitle}" não encontrada — abra o app antes`);
      return;
    }
    const next = { ...active, coords: { ...active.coords, [key]: r.data } };
    setCfg(next);
    await api!.chConfigSet(next);
    toast.success(`Capturado (rel): ${r.data.relX}, ${r.data.relY}`);
  }

  async function execute() {
    // SEMPRE recarrega do disco antes de rodar — evita usar título/coords stale
    // (vários cards renderizam essa barra; cada um tem cfg local que pode estar desatualizado)
    let live: Config = cfg;
    try {
      const r = await api!.chConfigGet();
      if (r?.data) {
        live = r.data;
        setCfg(r.data);
      }
    } catch {}

    const liveCalibrated = FIELDS.every((f) => {
      const p = live.coords[f.key];
      return p && p.relX != null && p.relY != null;
    });
    if (!liveCalibrated) {
      toast.error("Calibre todas as posições antes");
      setOpen(true);
      return;
    }
    setRunning(true);
    try {
      const r = await api!.chRun({
        title: live.title || "DK MONTANTE",
        coords: live.coords,
        payload: {
          qty: props.qty,
          depsText: props.depsText,
          url: props.url,
          pixText: props.pixText,
        },
        delays: live.delays,
      });
      if (r?.error) throw new Error(r.error.message);
      toast.success(`Cash Hunter iniciado em "${live.title}"`);
    } catch (e: any) {
      toast.error("Falha: " + (e?.message || e));
    } finally {
      setRunning(false);
    }
  }


  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1.5">
      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300/90 mr-1">
        🎯 Cash Hunters
      </span>
      <Button
        size="sm"
        disabled={running || !props.qty}
        onClick={execute}
        className="h-6 px-2 gap-1 text-[10px] bg-emerald-500 hover:bg-emerald-500/90 text-emerald-950 font-bold"
        title={allCalibrated ? "Auto-enviar e iniciar" : "Calibre primeiro"}
      >
        {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
        {running ? "Enviando…" : "Automatizar"}
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        className="h-6 px-2 gap-1 text-[10px] border-amber-500/40"
      >
        <Settings2 className="h-3 w-3" />
        {allCalibrated ? "Recalibrar" : "Calibrar"}
      </Button>

      <Dialog open={open} onOpenChange={(v) => {
        setOpen(v);
        if (v) refreshConfig();
      }}>

        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Calibrar Cash Hunters</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div>
              <Label className="text-xs">Título da janela (busca por substring)</Label>
              <Input
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={(e) => saveTitle(e.target.value.trim())}
                placeholder="DK MONTANTE"
                className="h-8 mt-1"
              />
              <div className="text-[10px] text-muted-foreground mt-1">
                Atual salvo: <span className="font-mono">{cfg.title || "—"}</span>
              </div>

            </div>
            <div className="text-xs text-muted-foreground">
              Coordenadas são <b>relativas à janela</b> (se você mover a janela, continuam funcionando).
              Pra cada item: deixe o DK MONTANTE visível no estado certo (aba certa, modal aberto, etc),
              clique em <b>Capturar</b>, posicione o mouse e aguarde o countdown.
            </div>
            <div className="space-y-1.5">
              {FIELDS.map((f) => {
                const p = cfg.coords[f.key];
                const isCapt = capturing === f.key;
                return (
                  <div
                    key={f.key}
                    className="flex items-center gap-2 rounded border border-border/50 px-2 py-1.5"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">{f.label}</div>
                      <div className="text-[10px] text-muted-foreground truncate">{f.hint}</div>
                    </div>
                    <div className="text-[10px] font-mono w-16 text-right">
                      {p && p.relX != null ? `${p.relX},${p.relY}` : "—"}
                    </div>
                    <Button
                      size="sm"
                      variant={isCapt ? "default" : "outline"}
                      disabled={!!capturing && !isCapt}
                      onClick={() => capture(f.key)}
                      className="h-7 px-2 gap-1 text-[10px]"
                    >
                      {isCapt ? (countdown > 0 ? `${countdown}…` : "📍") : <><Crosshair className="h-3 w-3" /> Capturar</>}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
