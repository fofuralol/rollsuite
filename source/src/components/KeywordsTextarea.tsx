import { useEffect, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Save, Copy } from "lucide-react";
import { toast } from "sonner";
import type { WaKeyword } from "@/hooks/useWhatsApp";
import { IS_DESKTOP } from "@/lib/runtime";

type Props = {
  keywords: WaKeyword[];
  onSave: (lines: string[]) => void | Promise<void>;
  rows?: number;
};

export default function KeywordsTextarea({ keywords, onSave, rows = 8 }: Props) {
  const joined = keywords.map((k) => k.palavra).join("\n");
  const [text, setText] = useState(joined);
  const [saving, setSaving] = useState(false);
  const [autoSaved, setAutoSaved] = useState(false);

  // Sync when keywords change externally (and user hasn't edited)
  useEffect(() => {
    setText(joined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined]);

  const dirty = text !== joined;

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(text.split(/\r?\n/));
      setAutoSaved(true);
      setTimeout(() => setAutoSaved(false), 1400);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!IS_DESKTOP || !dirty || saving) return;
    const id = window.setTimeout(() => {
      handleSave();
    }, 900);
    return () => window.clearTimeout(id);
  }, [dirty, text, saving]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(joined);
      toast.success(`${keywords.length} palavra(s) copiada(s)`);
    } catch {
      toast.error("Falha ao copiar");
    }
  };

  return (
    <div className="space-y-2">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={rows}
        placeholder="Uma palavra-chave por linha&#10;Ex:&#10;200&#10;201&#10;202"
        className="font-mono text-xs resize-y"
        spellCheck={false}
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] text-muted-foreground">
          Uma por linha. {keywords.length} salva(s).
          {saving && <span className="text-primary font-semibold"> · salvando...</span>}
          {!saving && dirty && <span className="text-amber-500 font-semibold"> · aguardando autosave</span>}
          {!dirty && autoSaved && <span className="text-primary font-semibold"> · salvo</span>}
        </p>
        <div className="flex gap-2">
          {keywords.length > 0 && (
            <Button size="sm" variant="ghost" onClick={handleCopy} className="h-7 gap-1">
              <Copy className="w-3 h-3" /> Copiar
            </Button>
          )}
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!dirty || saving}
            className="h-7 gap-1"
          >
            <Save className="w-3 h-3" /> Salvar
          </Button>
        </div>
      </div>
    </div>
  );
}
