import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export type EditCicloValues = {
  nome_ciclo: string;
  deposito: number;
  saque: number;
  blogueiro: number;
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: EditCicloValues | null;
  onSave: (v: EditCicloValues) => void;
  onReset?: () => void;
};

const parse = (s: string) => {
  const n = parseFloat(String(s).replace(/\./g, "").replace(",", "."));
  return isFinite(n) ? n : 0;
};
const fmt = (n: number) => (n ? String(n) : "");

export default function EditCicloDialog({ open, onOpenChange, initial, onSave, onReset }: Props) {
  const [nome, setNome] = useState("");
  const [dep, setDep] = useState("");
  const [saq, setSaq] = useState("");
  const [blog, setBlog] = useState("");

  useEffect(() => {
    if (!open || !initial) return;
    setNome(initial.nome_ciclo || "");
    setDep(fmt(initial.deposito));
    setSaq(fmt(initial.saque));
    setBlog(fmt(initial.blogueiro));
  }, [open, initial]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar montante</DialogTitle>
          <DialogDescription className="text-xs">
            Edição local — não sincroniza com o DK Dash.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Nome</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">Depósito</Label>
              <Input inputMode="decimal" value={dep} onChange={(e) => setDep(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Saque</Label>
              <Input inputMode="decimal" value={saq} onChange={(e) => setSaq(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Blogueiro</Label>
              <Input inputMode="decimal" value={blog} onChange={(e) => setBlog(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          {onReset && (
            <Button variant="ghost" size="sm" onClick={() => { onReset(); onOpenChange(false); }}>
              Restaurar original
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button size="sm" onClick={() => {
            onSave({ nome_ciclo: nome.trim(), deposito: parse(dep), saque: parse(saq), blogueiro: parse(blog) });
            onOpenChange(false);
          }}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
