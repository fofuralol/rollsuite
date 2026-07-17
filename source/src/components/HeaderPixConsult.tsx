import { useState } from "react";
import { KeyRound, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useChavesPix, type ChavePix } from "@/hooks/useChavesPix";
import { BANCO_COLORS } from "@/lib/bancoColors";

const normalizeChave = (s: string): string =>
  (s || "").toLowerCase().trim().replace(/[\s.\-/()+]/g, "");

export default function HeaderPixConsult() {
  const { chaves } = useChavesPix();
  const [q, setQ] = useState("");
  const [result, setResult] = useState<ChavePix | null | undefined>(undefined);

  const buscar = () => {
    const n = normalizeChave(q);
    if (!n) { setResult(undefined); toast.error("Digite uma chave"); return; }
    const found = chaves.find((c) => normalizeChave(c.chave) === n)
      || chaves.find((c) => normalizeChave(c.chave).includes(n))
      || null;
    setResult(found);
    if (!found) toast.error("Chave não cadastrada");
  };

  const colors = result
    ? BANCO_COLORS[(result.banco || "").toUpperCase().trim()] || { bg: "bg-muted", text: "text-foreground" }
    : null;

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <div className="relative w-[150px] sm:w-[180px]">
        <KeyRound className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); buscar(); } }}
          placeholder="Consultar chave Pix..."
          className="h-7 text-[11px] pl-7 font-mono"
        />
      </div>
      <Button size="sm" className="h-7 px-2 text-[11px] gap-1" onClick={buscar}>
        <Search className="w-3 h-3" />
        <span className="hidden md:inline">Consultar</span>
      </Button>
      {result && colors && (
        <span
          onClick={() => { navigator.clipboard.writeText(result.chave); toast.success("Chave copiada!"); }}
          className={`${colors.bg} ${colors.text} px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap cursor-pointer hover:opacity-80 max-w-[180px] truncate`}
          title={`Copiar: ${result.chave}`}
        >
          {result.banco || "Sem banco"} · {result.titular || "—"}
        </span>
      )}
      {result === null && (
        <span className="text-[10px] text-destructive whitespace-nowrap">Não cadastrada</span>
      )}
    </div>
  );
}
