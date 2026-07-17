import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Play, Tag } from "lucide-react";
import { usePlatformMappings } from "@/hooks/usePlatformMappings";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultLink?: string;
  defaultMontante?: string;
  onConfirm: (data: { link: string; montante: string; grupo: string }) => void;
};

export default function OperarPromptDialog({ open, onOpenChange, defaultLink, defaultMontante, onConfirm }: Props) {
  const [link, setLink] = useState("");
  const [montante, setMontante] = useState("");
  const [grupo, setGrupo] = useState("");
  const { lookup, platformNames } = usePlatformMappings();

  // Resolve o grupo já mapeado pra esse link (por URL exata ou domínio-base).
  const suggestedGrupo = useMemo(() => (link ? lookup(link) : ""), [link, lookup]);

  useEffect(() => {
    if (!open) return;
    const initialLink = defaultLink ?? "";
    setLink(initialLink);
    setMontante(defaultMontante ?? "");
    setGrupo(initialLink ? lookup(initialLink) : "");
    // Roda só quando o dialog abre — não podemos depender de defaultLink/lookup
    // porque eles mudam de referência a cada render do pai e apagariam o input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Atualiza sugestão do grupo quando o usuário edita o link.
  useEffect(() => {
    if (!open) return;
    if (!grupo && suggestedGrupo) setGrupo(suggestedGrupo);
  }, [open, suggestedGrupo, grupo]);

  const listId = "operar-grupo-suggestions";

  const submit = () => {
    if (!link.trim()) return;
    onConfirm({ link: link.trim(), montante: montante.trim(), grupo: grupo.trim() });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mx-auto w-10 h-10 rounded-full bg-emerald-500/15 flex items-center justify-center mb-1">
            <Play className="w-5 h-5 text-emerald-400" />
          </div>
          <DialogTitle className="text-center">Confirmar operação</DialogTitle>
          <DialogDescription className="text-center">
            Revise o link, o valor do montante e o grupo. Edite se precisar e confirme.
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
              value={montante}
              onChange={(e) => setMontante(e.target.value)}
              placeholder="Ex: 1500 ou 2.5k"
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1.5">
              <Tag className="w-3 h-3 text-muted-foreground" />
              Grupo
              {suggestedGrupo && suggestedGrupo === grupo && (
                <span className="text-[10px] text-emerald-400 font-normal">· sugerido pelo domínio</span>
              )}
            </Label>
            <Input
              list={listId}
              value={grupo}
              onChange={(e) => setGrupo(e.target.value)}
              placeholder="Ex: W1, OKOK, Onde…"
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            />
            <datalist id={listId}>
              {platformNames.map((n) => <option key={n} value={n} />)}
            </datalist>
            <p className="text-[10px] text-muted-foreground">
              Ao confirmar, o link fica atribuído a esse grupo e é reutilizado em análises futuras.
            </p>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            className="bg-emerald-500 text-emerald-950 hover:bg-emerald-500/90 font-bold"
            onClick={submit}
            disabled={!link.trim()}
          >
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
