import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { triggerMontanteResult } from "@/components/MontanteResultOverlay";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultNome: string;
  defaultDeposito?: number;
  defaultSaque?: number;
  defaultBlogueiro?: number;
  defaultQtdContas?: number;
  defaultMultiplier?: number; // 1 | 1.04 | 1.10
  onSaved?: () => void | Promise<void>;
};

const fmt = (n: number) => {
  if (!n || !isFinite(n)) return "";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const normalizeMultiplier = (value?: number) => {
  if (!value || !isFinite(value) || value <= 1) return 1;
  if (Math.abs(value - 3) < 0.001 || Math.abs(value - 1.1) < 0.001 || Math.abs(value - 1.10) < 0.001) return 1.10;
  if (Math.abs(value - 2.5) < 0.001 || Math.abs(value - 1.04) < 0.001) return 1.04;
  return 1;
};

export default function MontanteDialog({
  open, onOpenChange, defaultNome,
  defaultDeposito, defaultSaque, defaultBlogueiro, defaultQtdContas,
  defaultMultiplier,
  onSaved,
}: Props) {
  const [nome, setNome] = useState(defaultNome);
  const [deposito, setDeposito] = useState("");
  const [saque, setSaque] = useState("");
  const [blogueiro, setBlogueiro] = useState("");
  const [mult, setMult] = useState<number>(1);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setNome(defaultNome);
      setDeposito(defaultDeposito ? fmt(defaultDeposito) : "");
      setSaque(defaultSaque ? fmt(defaultSaque) : "");
      setBlogueiro(defaultBlogueiro ? fmt(defaultBlogueiro) : "");
      setMult(normalizeMultiplier(defaultMultiplier));
    }
  }, [open, defaultNome, defaultDeposito, defaultSaque, defaultBlogueiro, defaultMultiplier]);

  const parse = (v: string) => {
    const n = parseFloat(v.replace(/\./g, "").replace(",", "."));
    return isNaN(n) ? 0 : n;
  };

  const bonusPercFromMult = (value: number) => {
    const normalized = normalizeMultiplier(value);
    return normalized === 1.10 ? 10 : normalized === 1.04 ? 4 : 0;
  };

  const applyBonusToBlogueiro = (nextDepValue: string, nextMult: number, currentBlogValue: string, currentMult: number) => {
    const currentTotal = parse(currentBlogValue);
    if (!currentBlogValue.trim() && currentTotal <= 0) return currentBlogValue;

    const currentDep = parse(deposito);
    const currentExtra = currentDep * (bonusPercFromMult(currentMult) / 100);
    const baseBlog = Math.max(0, currentTotal - currentExtra);
    const nextDep = parse(nextDepValue);
    const nextExtra = nextDep * (bonusPercFromMult(nextMult) / 100);
    return fmt(baseBlog + nextExtra);
  };

  // bonus_perc = pontos percentuais de bônus (2.5x => 4, 3x => 10).
  // O DK Dash espera o blogueiro CHEIO (valor digitado pelo operador) + bonus_perc separado.
  // Confirmado via captura do payload original: { blogueiro: 145, bonus_perc: 10, ... }.
  const bonusPerc = bonusPercFromMult(mult);
  const depNum = parse(deposito);
  const sqNum = parse(saque);
  const blRaw = parse(blogueiro);
  // Líquido (sem comissão, modelado no card): saque + blogueiro_total − depósito.
  const liquido = sqNum + blRaw - depNum;
  // % Aplicada = blogueiro_total/depósito.
  const pctAplicada = depNum > 0 ? (blRaw / depNum) * 100 : 0;

  const handleSave = async () => {
    if (!nome.trim()) { toast.error("Nome do Montante é obrigatório"); return; }
    setSaving(true);
    try {
      const dep = depNum;
      const sq = sqNum;
      const bl = blRaw; // valor cheio — idêntico ao que o DK Dash front envia
      const qtd = Math.max(1, defaultQtdContas && defaultQtdContas > 0 ? defaultQtdContas : Math.floor(dep / 200) || 1);
      const { data, error } = await supabase.functions.invoke("dkdash-lucros", {
        body: {
          action: "create-montante",
          nome: nome.trim(),
          deposito: dep,
          saque: sq,
          blogueiro: bl,
          qtd_contas: qtd,
          bonus_perc: bonusPerc,
        },
      });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Montante salvo no DK Dash");
      if (liquido > 0) triggerMontanteResult("lucro");
      else if (liquido < 0) triggerMontanteResult("prejuizo");
      onOpenChange(false);
      await onSaved?.();
    } catch (e: any) {
      toast.error(e.message || "Erro ao salvar montante");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Novo Montante</DialogTitle>
          <DialogDescription className="sr-only">Será salvo no DK Dash ao concluir a tarefa.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Nome do Montante</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Depósito <span className="text-muted-foreground font-normal">(Saída)</span></Label>
              <Input
                inputMode="decimal"
                value={deposito}
                onChange={(e) => {
                  const nextDeposito = e.target.value;
                  setDeposito(nextDeposito);
                  setBlogueiro((prev) => applyBonusToBlogueiro(nextDeposito, mult, prev, mult));
                }}
                placeholder="0"
              />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Saque <span className="text-muted-foreground font-normal">(Entrada)</span></Label>
              <Input inputMode="decimal" value={saque} onChange={(e) => setSaque(e.target.value)} placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Blogueiro <span className="text-muted-foreground font-normal">(Total Pg)</span></Label>
              <Input inputMode="decimal" value={blogueiro} onChange={(e) => setBlogueiro(e.target.value)} placeholder="0" />
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-border/40">
            <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Bônus de rollover aplicado no total?
            </Label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={mult === 1.04 ? "default" : "outline"}
                className={`h-9 text-xs font-bold ${mult === 1.04 ? "bg-amber-500 text-amber-950 hover:bg-amber-500/90" : ""}`}
                onClick={() => {
                  const nextMult = mult === 1.04 ? 1 : 1.04;
                  setBlogueiro((prev) => applyBonusToBlogueiro(deposito, nextMult, prev, mult));
                  setMult(nextMult);
                }}
              >
                2.5x (4%)
              </Button>
              <Button
                type="button"
                variant={mult === 1.10 ? "default" : "outline"}
                className={`h-9 text-xs font-bold ${mult === 1.10 ? "bg-fuchsia-500 text-fuchsia-950 hover:bg-fuchsia-500/90" : ""}`}
                onClick={() => {
                  const nextMult = mult === 1.10 ? 1 : 1.10;
                  setBlogueiro((prev) => applyBonusToBlogueiro(deposito, nextMult, prev, mult));
                  setMult(nextMult);
                }}
              >
                3.0x (10%)
              </Button>
            </div>
          </div>

          {(depNum > 0 || blRaw > 0) && (
            <div className="rounded-md border border-border/40 bg-muted/30 px-3 py-2 space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Blogueiro</span>
                <span className="font-mono font-bold text-foreground">R$ {fmt(blRaw)}</span>
              </div>
              {bonusPerc > 0 && (
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">
                    Blogueiro Extra <span className="text-[10px] text-fuchsia-400">(+{bonusPerc}% do depósito)</span>
                  </span>
                  <span className="font-mono font-bold text-fuchsia-300">R$ {fmt(depNum * (bonusPerc / 100))}</span>
                </div>
              )}
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Líquido</span>
                <span className={`font-mono font-bold ${liquido >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  R$ {fmt(liquido)}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">% Aplicada</span>
                <span className="font-mono font-bold text-foreground">{pctAplicada.toFixed(2)}%</span>
              </div>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button className="bg-red-600 hover:bg-red-600/90 text-white font-bold" onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}
            Salvar Montante
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
