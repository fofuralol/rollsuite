import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBR, parseBR } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface CalcRow {
  id: string;
  ordem: number;
  deposito: number;
  rollover: number;
  aposta: number;
  saque: number;
}

export type FieldKey = "deposito" | "rollover" | "aposta" | "saque";
const FIELDS: FieldKey[] = ["deposito", "rollover", "aposta", "saque"];

interface Props {
  row: CalcRow;
  index: number;
  onChange: (id: string, field: FieldKey, value: number) => void;
  onDelete: (id: string) => void;
  onEnter: (rowId: string, field: FieldKey) => void;
  registerInput: (rowId: string, field: FieldKey, el: HTMLInputElement | null) => void;
}

const NumCell = ({
  value, onCommit, onEnter, refCb,
}: {
  value: number;
  onCommit: (n: number) => void;
  onEnter: () => void;
  refCb: (el: HTMLInputElement | null) => void;
}) => {
  const [text, setText] = useState(value === 0 ? "" : formatBR(value));
  const [focus, setFocus] = useState(false);

  useEffect(() => {
    if (!focus) setText(value === 0 ? "" : formatBR(value));
  }, [value, focus]);

  return (
    <input
      ref={refCb}
      inputMode="decimal"
      value={text}
      onFocus={(e) => { setFocus(true); e.target.select(); }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        setFocus(false);
        const n = parseBR(text);
        onCommit(n);
        setText(n === 0 ? "" : formatBR(n));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
          onEnter();
        }
      }}
      placeholder="0,00"
      className="w-full bg-transparent border border-transparent focus:border-primary/60 focus:bg-background rounded px-2 py-1.5 text-sm text-right outline-none transition-colors"
    />
  );
};

export const CalcRowItem = ({ row, index, onChange, onDelete, onEnter, registerInput }: Props) => {
  const result = row.saque + (row.rollover - row.aposta) - row.deposito;

  return (
    <tr className="border-b border-border/60 hover:bg-muted/20 transition-colors">
      <td className="px-2 py-1 text-xs text-muted-foreground text-center w-10">{index + 1}</td>
      {FIELDS.map((f) => (
        <td key={f} className="px-1 py-0.5">
          <NumCell
            value={row[f]}
            onCommit={(n) => onChange(row.id, f, n)}
            onEnter={() => onEnter(row.id, f)}
            refCb={(el) => registerInput(row.id, f, el)}
          />
        </td>
      ))}
      <td className={cn(
        "px-2 py-1 text-sm text-right font-semibold tabular-nums",
        result >= 0 ? "text-success" : "text-destructive"
      )}>
        {formatBR(result)}
      </td>
      <td className="px-1 py-1 w-10 text-center">
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-destructive"
          onClick={() => onDelete(row.id)}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </td>
    </tr>
  );
};
