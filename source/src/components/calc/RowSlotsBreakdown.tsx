import { Input } from "@/components/ui/input";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RowSlotAssignment } from "./RowSlotsPicker";

interface Props {
  slots: RowSlotAssignment[];
  deposito: number;
  rolloverTotal: number;
  onChange: (next: RowSlotAssignment[]) => void;
  onCopy: (rolls: number, key: string) => void;
  copiedKey: string | null;
  copyKeyPrefix: string;
}

const parseBet = (s: string) => {
  const n = parseFloat(String(s).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

export default function RowSlotsBreakdown({
  slots,
  deposito,
  rolloverTotal,
  onChange,
  onCopy,
  copiedKey,
  copyKeyPrefix,
}: Props) {
  const totalPeso = slots.reduce((a, s) => a + (s.peso > 0 ? s.peso : 0), 0) || 1;

  const updateSlot = (idx: number, patch: Partial<RowSlotAssignment>) => {
    onChange(slots.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };
  const removeSlot = (idx: number) => {
    onChange(slots.filter((_, i) => i !== idx));
  };

  return (
    <div className="mt-2 rounded-md border border-primary/30 bg-primary/5 p-1.5">
      <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1 px-0.5">
        Divisão por slot ({slots.length})
      </div>
      <div
        className="grid gap-1"
        style={{
          gridTemplateColumns: `repeat(${Math.min(slots.length, 4)}, minmax(0, 1fr))`,
        }}
      >

        {slots.map((s, idx) => {
          const frac = (s.peso > 0 ? s.peso : 0) / totalPeso;
          const rollSlot = rolloverTotal * frac;
          const avSlot = deposito * rollSlot;
          const rolls = s.bet > 0 ? Math.ceil(avSlot / s.bet) : 0;
          const key = `${copyKeyPrefix}-slot-${s.slot_id}-${idx}`;
          const wasCopied = copiedKey === key;
          // Tonalidades distintas de amarelo/âmbar por slot
          const yellowPalette = [
            { h: 48, s: 95 },   // amarelo dourado
            { h: 36, s: 92 },   // âmbar
            { h: 54, s: 88 },   // amarelo claro
            { h: 28, s: 90 },   // laranja-âmbar
            { h: 42, s: 85 },   // mostarda
            { h: 60, s: 75 },   // amarelo pálido
          ];
          const tone = yellowPalette[idx % yellowPalette.length];
          const slotStyle = {
            backgroundColor: `hsl(${tone.h} ${tone.s}% 50% / 0.07)`,
            borderColor: `hsl(${tone.h} ${tone.s}% 50% / 0.45)`,
          } as React.CSSProperties;
          const btnStyle = rolls
            ? {
                backgroundColor: `hsl(${tone.h} ${tone.s}% 50% / 0.22)`,
                borderColor: `hsl(${tone.h} ${tone.s}% 55% / 0.7)`,
                color: `hsl(${tone.h} ${tone.s}% 70%)`,
              }
            : undefined;
          return (
            <div
              key={`${s.slot_id}-${idx}`}
              style={slotStyle}
              className="rounded border px-1.5 py-1 flex items-center gap-1"
            >
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-[11px] font-semibold leading-tight truncate" title={s.nome}>
                  {s.nome}
                </span>
                <span className="text-[8px] text-muted-foreground tabular-nums leading-tight">
                  {rollSlot.toFixed(2).replace(".", ",")}x
                </span>
              </div>
              <Input
                value={String(s.bet).replace(".", ",")}
                onChange={(e) => updateSlot(idx, { bet: parseBet(e.target.value) })}
                inputMode="decimal"
                title="Bet"
                className="h-6 w-12 px-1 text-[11px] tabular-nums text-center"
              />
              <Input
                type="number"
                min={0}
                step="0.1"
                value={s.peso}
                onChange={(e) => updateSlot(idx, { peso: parseBet(e.target.value) })}
                title="Peso"
                className="h-6 w-9 px-1 text-[11px] tabular-nums text-center"
              />
              <button
                type="button"
                onClick={() => onCopy(rolls, key)}
                disabled={!rolls}
                style={btnStyle}
                title="Copiar giros"
                className={cn(
                  "h-6 min-w-[44px] px-1.5 rounded border flex items-center justify-center text-xs font-black tabular-nums transition-colors",
                  rolls
                    ? "hover:brightness-110 active:scale-95"
                    : "bg-muted/20 border-border/40 text-muted-foreground/50 cursor-not-allowed"
                )}
              >
                {wasCopied ? <Check className="w-3 h-3" /> : (rolls || "—")}
              </button>
              <button
                type="button"
                onClick={() => removeSlot(idx)}
                className="w-4 h-4 flex items-center justify-center rounded text-muted-foreground hover:text-destructive"
                title="Remover slot"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}

      </div>
    </div>
  );
}
