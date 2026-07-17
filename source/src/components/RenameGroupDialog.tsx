import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Pencil } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  currentName: string;
  onConfirm: (newName: string) => void;
};

export default function RenameGroupDialog({ open, onOpenChange, currentName, onConfirm }: Props) {
  const [name, setName] = useState("");

  useEffect(() => {
    if (open) setName(currentName || "");
  }, [open, currentName]);

  const submit = () => {
    const v = name.trim();
    if (!v || v === currentName) { onOpenChange(false); return; }
    onConfirm(v);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="mx-auto w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center mb-1">
            <Pencil className="w-5 h-5 text-primary" />
          </div>
          <DialogTitle className="text-center">Renomear grupo</DialogTitle>
          <DialogDescription className="text-center">
            Digite o novo nome para "{currentName}".
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label className="text-xs">Novo nome</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            className="bg-emerald-500 text-emerald-950 hover:bg-emerald-500/90 font-bold"
            onClick={submit}
            disabled={!name.trim() || name.trim() === currentName}
          >
            Renomear
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
