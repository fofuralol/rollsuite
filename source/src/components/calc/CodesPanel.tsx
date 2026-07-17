import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Trash2, ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export interface CodeEntry { name: string; code: string }
export interface SlotGroup { id: string; slot_name: string; codes: CodeEntry[] }

interface Props {
  groups: SlotGroup[];
  onDeleteCode: (slotId: string, idx: number) => void;
  onDeleteSlot: (slotId: string) => void;
}

export const CodesPanel = ({ groups, onDeleteCode, onDeleteSlot }: Props) => {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return groups;
    return groups
      .map((g) => ({
        ...g,
        codes: g.codes.filter(
          (c) => c.name.toLowerCase().includes(t) || c.code.toLowerCase().includes(t)
        ),
      }))
      .filter((g) => g.slot_name.toLowerCase().includes(t) || g.codes.length > 0);
  }, [groups, q]);

  return (
    <aside className="bg-card border border-border rounded-xl flex flex-col overflow-hidden">
      <div className="p-3 border-b border-border">
        <h2 className="text-sm font-semibold mb-2">Códigos cadastrados</h2>
        <div className="relative">
          <Search className="size-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar..."
            className="pl-8 h-9"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {filtered.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-6">Nenhum código.</p>
        )}
        {filtered.map((g) => (
          <Collapsible key={g.id} defaultOpen className="border border-border rounded-lg bg-background/50">
            <div className="flex items-center justify-between px-2 py-1.5">
              <CollapsibleTrigger className="flex items-center gap-1.5 text-sm font-medium text-primary flex-1 text-left">
                <ChevronDown className="size-3.5 transition-transform [&[data-state=closed]]:-rotate-90" />
                {g.slot_name}
                <span className="text-xs text-muted-foreground font-normal">({g.codes.length})</span>
              </CollapsibleTrigger>
              <button
                onClick={() => onDeleteSlot(g.id)}
                className="text-muted-foreground hover:text-destructive p-1"
                aria-label="Excluir slot"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
            <CollapsibleContent>
              <ul className="px-2 pb-2 space-y-1">
                {g.codes.map((c, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 text-xs bg-muted/40 rounded px-2 py-1.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{c.name}</p>
                      <p className="truncate text-muted-foreground font-mono">{c.code}</p>
                    </div>
                    <button
                      onClick={() => onDeleteCode(g.id, i)}
                      className="text-muted-foreground hover:text-destructive shrink-0"
                      aria-label="Remover"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        ))}
      </div>
    </aside>
  );
};
