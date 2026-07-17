import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Layers, Settings2, CopyPlus } from "lucide-react";
import { useSlotsCatalog } from "@/hooks/useSlotsCatalog";

export interface RowSlotAssignment {
  slot_id: string;
  nome: string;
  bet: number;
  peso: number;
}

interface Props {
  value: RowSlotAssignment[];
  onChange: (next: RowSlotAssignment[]) => void;
  onManage: () => void;
  onApplyToAll?: (slots: RowSlotAssignment[]) => void;
}

export default function RowSlotsPicker({ value, onChange, onManage, onApplyToAll }: Props) {
  const { items } = useSlotsCatalog();
  const selectedIds = new Set(value.map((s) => s.slot_id));

  const toggle = (id: string) => {
    if (selectedIds.has(id)) {
      onChange(value.filter((s) => s.slot_id !== id));
    } else {
      const it = items.find((i) => i.id === id);
      if (!it) return;
      onChange([
        ...value,
        { slot_id: it.id, nome: it.nome, bet: it.bet_default || 0, peso: 1 },
      ]);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="h-6 px-2 rounded-md border border-border/60 bg-muted/40 hover:bg-muted/70 text-[10px] font-bold uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1 transition-colors"
          title="Escolher slots para dividir o rollover"
        >
          <Layers className="w-3 h-3" />
          Slots {value.length > 0 && <span className="text-primary">({value.length})</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="end">
        <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-border/60">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Escolher slots
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={onManage}
            title="Gerenciar slots"
          >
            <Settings2 className="w-3.5 h-3.5" />
          </Button>
        </div>

        {items.length === 0 ? (
          <div className="text-center py-3">
            <p className="text-xs text-muted-foreground mb-2">Nenhum slot cadastrado.</p>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onManage}>
              Cadastrar agora
            </Button>
          </div>
        ) : (
          <div className="max-h-56 overflow-y-auto space-y-0.5">
            {items.map((it) => (
              <label
                key={it.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer"
              >
                <Checkbox
                  checked={selectedIds.has(it.id)}
                  onCheckedChange={() => toggle(it.id)}
                />
                <span className="text-sm flex-1 truncate" title={it.nome}>{it.nome}</span>
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {it.bet_default.toString().replace(".", ",")}
                </span>
              </label>
            ))}
          </div>
        )}

        {onApplyToAll && value.length > 0 && (
          <div className="mt-2 pt-2 border-t border-border/60">
            <Button
              size="sm"
              variant="outline"
              className="w-full h-7 text-[11px] gap-1.5"
              onClick={() => onApplyToAll(value)}
              title="Aplicar a mesma seleção de slots em todas as linhas deste grupo"
            >
              <CopyPlus className="w-3.5 h-3.5" />
              Aplicar a todas as linhas do grupo
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
