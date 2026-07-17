import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Upload, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const MAGIC = "ROLLSSUITE-PIX-V1";

type Row = {
  banco: string;
  tipo_chave: string;
  chave: string;
  titular: string;
  ordem: number;
};

export default function PixImportExportButtons() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"export" | "import" | null>(null);

  const handleExport = async () => {
    try {
      setBusy("export");
      const { data, error } = await supabase
        .from("chaves_pix")
        .select("banco, tipo_chave, chave, titular, ordem")
        .order("ordem", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as Row[];
      if (rows.length === 0) {
        toast.error("Nenhuma chave Pix para exportar");
        return;
      }
      const content =
        MAGIC +
        "\n" +
        JSON.stringify(
          { exported_at: new Date().toISOString(), count: rows.length, keys: rows },
          null,
          2
        );
      const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      a.download = `chaves-pix-${stamp}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`${rows.length} chave(s) exportada(s)`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro ao exportar";
      toast.error(msg);
    } finally {
      setBusy(null);
    }
  };

  const handleFile = async (file: File) => {
    try {
      setBusy("import");
      const text = await file.text();
      const lines = text.split(/\r?\n/);
      const header = (lines[0] || "").trim();
      if (header !== MAGIC) {
        throw new Error("Arquivo inválido (cabeçalho não reconhecido)");
      }
      const json = lines.slice(1).join("\n").trim();
      const parsed = JSON.parse(json);
      const keys: Row[] = Array.isArray(parsed?.keys) ? parsed.keys : [];
      if (keys.length === 0) throw new Error("Nenhuma chave no arquivo");

      const { data: u } = await supabase.auth.getUser();
      const userId = u.user?.id;
      if (!userId) throw new Error("Não autenticado");

      // Find current max ordem to append after
      const { data: existing } = await supabase
        .from("chaves_pix")
        .select("ordem")
        .order("ordem", { ascending: false })
        .limit(1);
      const baseOrdem =
        existing && existing.length > 0 ? (existing[0] as { ordem: number }).ordem + 1 : 0;

      const toInsert = keys.map((k, i) => ({
        user_id: userId,
        banco: String(k.banco ?? ""),
        tipo_chave: String(k.tipo_chave ?? "CPF"),
        chave: String(k.chave ?? ""),
        titular: String(k.titular ?? ""),
        ordem: baseOrdem + i,
      }));

      const { error } = await supabase.from("chaves_pix").insert(toInsert);
      if (error) throw error;
      toast.success(`${toInsert.length} chave(s) importada(s)`);
      window.dispatchEvent(new CustomEvent("pix:reload"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro ao importar";
      toast.error(msg);
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="flex items-center gap-2">
      <input
        ref={fileRef}
        type="file"
        accept=".txt,text/plain"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
      <Button
        variant="outline"
        size="sm"
        onClick={handleExport}
        disabled={busy !== null}
        className="gap-1.5"
      >
        {busy === "export" ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Download className="w-3.5 h-3.5" />
        )}
        Exportar
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => fileRef.current?.click()}
        disabled={busy !== null}
        className="gap-1.5"
      >
        {busy === "import" ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Upload className="w-3.5 h-3.5" />
        )}
        Importar
      </Button>
    </div>
  );
}
