import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useChavesPix } from "@/hooks/useChavesPix";
import { useBankPriorities } from "@/hooks/useBankPriorities";
import { getBancoColor } from "@/lib/bancoColors";

export default function BankPriorityPanel() {
  const [open, setOpen] = useState(false);
  const { chaves } = useChavesPix();
  const { priorities, setLevel, loading } = useBankPriorities();

  const banks = useMemo(() => {
    const set = new Set<string>();
    for (const c of chaves) {
      const b = (c.banco || "").trim();
      if (b) set.add(b);
    }
    return [...set].sort((a, b) => {
      const pa = priorities[a] ?? 9999;
      const pb = priorities[b] ?? 9999;
      if (pa !== pb) return pa - pb;
      return a.localeCompare(b);
    });
  }, [chaves, priorities]);

  const prioritizedCount = Object.keys(priorities).length;

  return (
    <div className="mb-4 rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 p-3 text-left"
      >
        <div className="flex items-center gap-2">
          <Star className="w-4 h-4 text-amber-500" />
          <span className="text-sm font-bold">Prioridade por banco</span>
          {prioritizedCount > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 font-bold">
              {prioritizedCount} configurado(s)
            </span>
          )}
        </div>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2">
          <p className="text-[11px] text-muted-foreground">
            Defina um nível por banco. Nível <b>1</b> é usado primeiro até esgotar pro link,
            depois nível <b>2</b>, e assim por diante. Bancos sem nível entram por último.
          </p>
          {loading && <p className="text-[11px] text-muted-foreground">Carregando…</p>}
          {!loading && banks.length === 0 && (
            <p className="text-[11px] text-muted-foreground">Nenhum banco cadastrado nas chaves.</p>
          )}
          <div className="space-y-1.5">
            {banks.map((banco) => {
              const color = getBancoColor(banco);
              const lvl = priorities[banco];
              return (
                <div key={banco} className={`flex items-center gap-2 p-2 rounded-lg border ${color.border} ${color.bg}`}>
                  <span className={`text-xs font-bold flex-1 truncate ${color.text}`}>{banco}</span>
                  <span className="text-[10px] text-muted-foreground">Nível</span>
                  <Input
                    type="number"
                    min={1}
                    value={lvl ?? ""}
                    placeholder="—"
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "") return;
                      const n = parseInt(v, 10);
                      if (Number.isFinite(n) && n > 0) setLevel(banco, n);
                    }}
                    className="h-7 w-16 text-xs text-center"
                  />
                  {lvl !== undefined && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => setLevel(banco, null)}
                      title="Remover prioridade"
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
