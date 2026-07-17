import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Upload, RotateCcw, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  DEFAULTS,
  fileToDataUrl,
  loadMontanteSettings,
  saveMontanteSettings,
  type MontanteSettings,
} from "@/lib/montanteSettings";
import coinsSound from "@/assets/coins.mp3.asset.json";
import wastedSound from "@/assets/wasted.mp3.asset.json";

type Props = { open: boolean; onOpenChange: (v: boolean) => void };

function resolveBuiltinUrl(rawUrl: string) {
  if (rawUrl.startsWith("http") || rawUrl.startsWith("data:")) return rawUrl;
  if (typeof window !== "undefined" && window.location.protocol === "file:") {
    return `https://calculadora-de-roll.lovable.app${rawUrl}`;
  }
  return rawUrl;
}

export default function MontanteSettingsDialog({ open, onOpenChange }: Props) {
  const [s, setS] = useState<MontanteSettings>(DEFAULTS);
  const lucroInputRef = useRef<HTMLInputElement>(null);
  const prejuizoInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (open) setS(loadMontanteSettings());
    return () => {
      if (previewRef.current) {
        try { previewRef.current.pause(); } catch {}
      }
    };
  }, [open]);

  const update = (patch: Partial<MontanteSettings>) => {
    setS((prev) => {
      const next = { ...prev, ...patch };
      saveMontanteSettings(next);
      return next;
    });
  };

  const handleUpload = async (kind: "lucro" | "prejuizo", file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("audio/") && !file.name.toLowerCase().endsWith(".mp3")) {
      toast.error("Arquivo deve ser .mp3 / áudio");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      toast.error("Arquivo muito grande (máx 4MB)");
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      update({ customAudio: { ...s.customAudio, [kind]: dataUrl } });
      toast.success(`Áudio de ${kind} atualizado`);
    } catch {
      toast.error("Falha ao ler arquivo");
    }
  };

  const previewAudio = (kind: "lucro" | "prejuizo") => {
    if (previewRef.current) { try { previewRef.current.pause(); } catch {} }
    const custom = s.customAudio[kind];
    const fallback = kind === "lucro" ? coinsSound.url : wastedSound.url;
    const src = custom ?? resolveBuiltinUrl(fallback);
    const audio = new Audio(src);
    audio.volume = s.volume;
    previewRef.current = audio;
    audio.play().catch((err) => toast.error("Falha ao reproduzir: " + err.message));
    window.setTimeout(() => { try { audio.pause(); } catch {} }, s.durationMs);
  };

  const resetAudio = (kind: "lucro" | "prejuizo") => {
    update({ customAudio: { ...s.customAudio, [kind]: null } });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Configurações de Lucro/Prejuízo</DialogTitle>
          <DialogDescription>Som e animação do overlay (somente desktop).</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Animations toggle */}
          <div className="flex items-center justify-between">
            <Label className="text-sm">Animações habilitadas</Label>
            <Switch
              checked={s.animationsEnabled}
              onCheckedChange={(v) => update({ animationsEnabled: v })}
            />
          </div>

          {/* Volume */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Volume</Label>
              <span className="text-xs text-muted-foreground">{Math.round(s.volume * 100)}%</span>
            </div>
            <Slider
              min={0}
              max={1}
              step={0.05}
              value={[s.volume]}
              onValueChange={(v) => update({ volume: v[0] })}
            />
          </div>

          {/* Duration */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Duração</Label>
              <span className="text-xs text-muted-foreground">{(s.durationMs / 1000).toFixed(1)}s</span>
            </div>
            <Slider
              min={500}
              max={10000}
              step={250}
              value={[s.durationMs]}
              onValueChange={(v) => update({ durationMs: v[0] })}
            />
          </div>

          {/* Custom audio - Lucro */}
          <div className="space-y-2 p-3 rounded-md border border-emerald-500/30 bg-emerald-500/5">
            <div className="flex items-center justify-between">
              <Label className="text-sm text-emerald-400">Áudio Lucro</Label>
              <span className="text-[10px] text-muted-foreground truncate max-w-[150px]">
                {s.customAudio.lucro ? "Personalizado" : "Padrão (coins.mp3)"}
              </span>
            </div>
            <Input
              ref={lucroInputRef}
              type="file"
              accept="audio/*,.mp3"
              className="hidden"
              onChange={(e) => handleUpload("lucro", e.target.files?.[0])}
            />
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" className="h-7 text-xs flex-1" onClick={() => lucroInputRef.current?.click()}>
                <Upload className="w-3 h-3 mr-1" /> Trocar
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => previewAudio("lucro")}>
                <Play className="w-3 h-3" />
              </Button>
              {s.customAudio.lucro && (
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => resetAudio("lucro")}>
                  <RotateCcw className="w-3 h-3" />
                </Button>
              )}
            </div>
          </div>

          {/* Custom audio - Prejuizo */}
          <div className="space-y-2 p-3 rounded-md border border-red-500/30 bg-red-500/5">
            <div className="flex items-center justify-between">
              <Label className="text-sm text-red-400">Áudio Prejuízo</Label>
              <span className="text-[10px] text-muted-foreground truncate max-w-[150px]">
                {s.customAudio.prejuizo ? "Personalizado" : "Padrão (wasted.mp3)"}
              </span>
            </div>
            <Input
              ref={prejuizoInputRef}
              type="file"
              accept="audio/*,.mp3"
              className="hidden"
              onChange={(e) => handleUpload("prejuizo", e.target.files?.[0])}
            />
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" className="h-7 text-xs flex-1" onClick={() => prejuizoInputRef.current?.click()}>
                <Upload className="w-3 h-3 mr-1" /> Trocar
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => previewAudio("prejuizo")}>
                <Play className="w-3 h-3" />
              </Button>
              {s.customAudio.prejuizo && (
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => resetAudio("prejuizo")}>
                  <RotateCcw className="w-3 h-3" />
                </Button>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              saveMontanteSettings(DEFAULTS);
              setS(DEFAULTS);
              toast.success("Padrões restaurados");
            }}
          >
            <Trash2 className="w-3 h-3 mr-1" /> Restaurar padrões
          </Button>
          <Button size="sm" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
