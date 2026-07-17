import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { parseList } from "@/lib/format";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onConfirm: (values: number[]) => void;
}

export const PasteListDialog = ({ open, onOpenChange, onConfirm }: Props) => {
  const [text, setText] = useState("");

  const handleConfirm = () => {
    const values = parseList(text);
    if (values.length) onConfirm(values);
    setText("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Colar lista de depósitos</DialogTitle>
          <DialogDescription>
            Cole uma coluna de valores (um por linha). Aceita formato BR (vírgula) e remove R$/espaços.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          placeholder={"100,00\n250,50\nR$ 1.000,00"}
          className="font-mono"
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleConfirm}>Aplicar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
