import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ClipboardList, Tag } from "lucide-react";
import { usePlatformMappings } from "@/hooks/usePlatformMappings";

export type ManualTaskData = {
  link: string;
  valor: string;
  grupo?: string;
  chat_id?: string;
};

export type ManualTaskGroup = { chat_id: string; grupo: string };

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (data: ManualTaskData) => void;
  /** Grupos conhecidos (opcional). Se vazio, cai no usePlatformMappings. */
  groups?: ManualTaskGroup[];
};

export default function ManualTaskDialog({ open, onOpenChange, onConfirm, groups = [] }: Props) {
  const [link, setLink] = useState("");
  const [valor, setValor] = useState("");
  const [grupo, setGrupo] = useState("");
  const { lookup, platformNames } = usePlatformMappings();

  const suggestions = useMemo(() => {
    const fromProps = groups.map((g) => g.grupo).filter(Boolean);
    return Array.from(new Set([...fromProps, ...platformNames])).sort((a, b) => a.localeCompare(b));
  }, [groups, platformNames]);

  const suggestedGrupo = useMemo(() => (link ? lookup(link) : ""), [link, lookup]);

  useEffect(() => {
    if (open) { setLink(""); setValor(""); setGrupo(""); }
  }, [open]);

  // Sugere o grupo ao digitar/colar link (só se o campo ainda estiver vazio).
  useEffect(() => {
    if (!open) return;
    if (!grupo && suggestedGrupo) setGrupo(suggestedGrupo);
  }, [open, suggestedGrupo, grupo]);

  const listId = "manual-task-grupo-suggestions";

  const submit = () => {
    if (!link.trim()) return;
    const g = grupo.trim();
    const match = groups.find((x) => x.grupo === g);
    onConfirm({
      link: link.trim(),
      valor: valor.trim(),
      grupo: g || undefined,
      chat_id: match?.chat_id,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mx-auto w-10 h-10 rounded-full bg-amber-500/15 flex items-center justify-center mb-1">
            <ClipboardList className="w-5 h-5 text-amber-400" />
          </div>
          <DialogTitle className="text-center">Nova tarefa manual</DialogTitle>
          <DialogDescription className="text-center">
            Adicione uma tarefa que não veio pelo WhatsApp.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Link *</Label>
            <Input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://..."
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Valor do montante</Label>
            <Input
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              placeholder="Ex: 1500 ou 2.5k"
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1.5">
              <Tag className="w-3 h-3 text-muted-foreground" />
              Grupo de ciclos (opcional)
              {suggestedGrupo && suggestedGrupo === grupo && (
                <span className="text-[10px] text-emerald-400 font-normal">· sugerido pelo domínio</span>
              )}
            </Label>
            <Input
              list={listId}
              value={grupo}
              onChange={(e) => setGrupo(e.target.value)}
              placeholder="Ex: W1, OKOK, 888EQUIPE…"
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            />
            <datalist id={listId}>
              {suggestions.map((n) => <option key={n} value={n} />)}
            </datalist>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            className="bg-amber-500 text-amber-950 hover:bg-amber-500/90 font-bold"
            onClick={submit}
            disabled={!link.trim()}
          >
            Adicionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
