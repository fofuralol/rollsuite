import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Trash2, Plus, Check, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { useSlotsCatalog, type SlotCatalogItem } from "@/hooks/useSlotsCatalog";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const parseBet = (s: string) => {
  const n = parseFloat(String(s).replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export default function SlotsCatalogDialog({ open, onOpenChange }: Props) {
  const { items, add, update, remove } = useSlotsCatalog();
  const [novoNome, setNovoNome] = useState("");
  const [novaBet, setNovaBet] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNome, setEditNome] = useState("");
  const [editBet, setEditBet] = useState("");

  const handleAdd = async () => {
    const nome = novoNome.trim();
    const bet = parseBet(novaBet);
    if (!nome) { toast.error("Informe o nome do slot"); return; }
    if (bet <= 0) { toast.error("Informe a bet padrão"); return; }
    setSaving(true);
    try {
      await add(nome, bet);
      setNovoNome(""); setNovaBet("");
      toast.success(`Slot "${nome}" criado`);
    } catch (e: any) {
      toast.error(e.message || "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (s: SlotCatalogItem) => {
    setEditingId(s.id);
    setEditNome(s.nome);
    setEditBet(String(s.bet_default).replace(".", ","));
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const nome = editNome.trim();
    const bet = parseBet(editBet);
    if (!nome || bet <= 0) { toast.error("Preencha nome e bet"); return; }
    try {
      await update(editingId, { nome, bet_default: bet });
      setEditingId(null);
      toast.success("Slot atualizado");
    } catch (e: any) {
      toast.error(e.message || "Erro ao atualizar");
    }
  };

  const handleDelete = async (s: SlotCatalogItem) => {
    if (!confirm(`Remover o slot "${s.nome}"?`)) return;
    try {
      await remove(s.id);
      toast.success("Slot removido");
    } catch (e: any) {
      toast.error(e.message || "Erro ao remover");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Meus Slots</DialogTitle>
          <DialogDescription>
            Cadastre os slots e a bet padrão de cada um. Eles ficam disponíveis nas linhas da calculadora pra dividir o rollover.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border border-border/60 bg-muted/30 p-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
              Novo slot
            </div>
            <div className="grid grid-cols-[1fr_90px_auto] gap-1.5">
              <Input
                placeholder="Nome (ex: Fortune Tiger)"
                value={novoNome}
                onChange={(e) => setNovoNome(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
                className="h-9 text-sm"
              />
              <Input
                placeholder="Bet"
                value={novaBet}
                onChange={(e) => setNovaBet(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
                inputMode="decimal"
                className="h-9 text-sm tabular-nums"
              />
              <Button size="sm" className="h-9" onClick={handleAdd} disabled={saving}>
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          <div className="max-h-72 overflow-y-auto space-y-1">
            {items.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-6">
                Nenhum slot cadastrado ainda.
              </p>
            )}
            {items.map((s) => {
              const isEditing = editingId === s.id;
              return (
                <div
                  key={s.id}
                  className="flex items-center gap-1.5 rounded-md border border-border/60 bg-background/60 px-2 py-1.5"
                >
                  {isEditing ? (
                    <>
                      <Input
                        value={editNome}
                        onChange={(e) => setEditNome(e.target.value)}
                        className="h-8 text-sm flex-1"
                      />
                      <Input
                        value={editBet}
                        onChange={(e) => setEditBet(e.target.value)}
                        inputMode="decimal"
                        className="h-8 text-sm w-20 tabular-nums"
                      />
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={saveEdit} title="Salvar">
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => setEditingId(null)} title="Cancelar">
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="text-sm font-medium flex-1 truncate" title={s.nome}>{s.nome}</span>
                      <span className="text-xs text-muted-foreground tabular-nums w-16 text-right">
                        bet {s.bet_default.toString().replace(".", ",")}
                      </span>
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-primary" onClick={() => startEdit(s)} title="Editar">
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(s)} title="Remover">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
