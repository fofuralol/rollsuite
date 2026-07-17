import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  slots: string[];
  onSave: (slot: string, name: string, code: string) => Promise<void> | void;
}

export const AddCodeDialog = ({ open, onOpenChange, slots, onSave }: Props) => {
  const [slotChoice, setSlotChoice] = useState<string>("__new__");
  const [newSlot, setNewSlot] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setSlotChoice(slots[0] ?? "__new__");
      setNewSlot("");
      setName("");
      setCode("");
    }
  }, [open, slots]);

  const handle = async () => {
    const slot = slotChoice === "__new__" ? newSlot.trim() : slotChoice;
    if (!slot || !name.trim() || !code.trim()) return;
    setBusy(true);
    await onSave(slot, name.trim(), code.trim());
    setBusy(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar código</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Slot</Label>
            <Select
              value={slotChoice}
              onValueChange={(v) => {
                setSlotChoice(v);
                setTimeout(() => { document.body.style.pointerEvents = ""; }, 0);
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {slots.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                <SelectItem value="__new__">+ Novo slot</SelectItem>
              </SelectContent>
            </Select>
            {slotChoice === "__new__" && (
              <Input
                autoFocus
                placeholder="Nome do novo slot"
                value={newSlot}
                onChange={(e) => setNewSlot(e.target.value)}
              />
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Nome do código</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: bônus boas-vindas" />
          </div>
          <div className="space-y-1.5">
            <Label>Valor / código</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Ex: ABC123" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handle} disabled={busy}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
