import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Link2 } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (link: string) => void;
};

export default function LinkPromptDialog({ open, onOpenChange, onConfirm }: Props) {
  const [link, setLink] = useState("");

  useEffect(() => {
    if (open) setLink("");
  }, [open]);

  const submit = () => {
    const v = link.trim();
    if (!v) return;
    onConfirm(v);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="mx-auto w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center mb-1">
            <Link2 className="w-5 h-5 text-primary" />
          </div>
          <DialogTitle className="text-center">Link da tarefa</DialogTitle>
          <DialogDescription className="text-center">
            Esta tarefa não tem link. Cole o link abaixo para continuar.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label className="text-xs">URL</Label>
          <Input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://..."
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button className="bg-emerald-500 text-emerald-950 hover:bg-emerald-500/90 font-bold" onClick={submit} disabled={!link.trim()}>
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
