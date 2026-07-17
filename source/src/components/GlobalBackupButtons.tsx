import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Upload, Download, Loader2, DatabaseBackup } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const MAGIC = "ROLLSSUITE-BACKUP-V1";

// Tabelas incluídas no backup global. Ordem de import respeita dependências (nenhuma FK entre elas, mas mantemos consistente).
const TABLES = [
  "slot_mapping_codes",
  "slots_catalog",
  "platform_mappings",
  "chaves_pix",
  "pix_bank_priorities",
  "wa_tasks",
] as const;

type TableName = (typeof TABLES)[number];

// Colunas que NÃO devem ser reimportadas (serão regeradas ou sobrescritas pelo user_id atual).
const STRIP_ON_IMPORT = new Set(["user_id"]);

type BackupFile = {
  magic: string;
  version: 1;
  exported_at: string;
  counts: Record<string, number>;
  data: Record<string, unknown[]>;
};

export default function GlobalBackupButtons({ collapsed = false }: { collapsed?: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"export" | "import" | null>(null);

  const handleExport = async () => {
    try {
      setBusy("export");
      const data: Record<string, unknown[]> = {};
      const counts: Record<string, number> = {};

      for (const table of TABLES) {
        const { data: rows, error } = await supabase.from(table as TableName).select("*");
        if (error) throw new Error(`${table}: ${error.message}`);
        data[table] = rows ?? [];
        counts[table] = rows?.length ?? 0;
      }

      const payload: BackupFile = {
        magic: MAGIC,
        version: 1,
        exported_at: new Date().toISOString(),
        counts,
        data,
      };

      const content = MAGIC + "\n" + JSON.stringify(payload, null, 2);
      const blob = new Blob([content], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      a.download = `rollsuite-backup-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      toast.success(`Backup exportado (${total} registros em ${TABLES.length} tabelas)`);
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
      if (header !== MAGIC) throw new Error("Arquivo inválido (cabeçalho não reconhecido)");
      const parsed = JSON.parse(lines.slice(1).join("\n")) as BackupFile;
      if (!parsed?.data) throw new Error("Arquivo sem seção 'data'");

      const { data: u } = await supabase.auth.getUser();
      const userId = u.user?.id;
      if (!userId) throw new Error("Não autenticado");

      const confirmMsg =
        "Isso irá SUBSTITUIR seus dados atuais destas tabelas pelos dados do arquivo:\n\n" +
        TABLES.map((t) => `• ${t} (${parsed.counts?.[t] ?? 0} registros)`).join("\n") +
        "\n\nDeseja continuar?";
      if (!window.confirm(confirmMsg)) {
        setBusy(null);
        return;
      }

      let totalImported = 0;
      for (const table of TABLES) {
        const rows = Array.isArray(parsed.data[table]) ? parsed.data[table] : [];

        // Apaga apenas os registros do usuário atual (RLS já garante isso, mas explícito é melhor).
        const { error: delErr } = await supabase
          .from(table as TableName)
          .delete()
          .eq("user_id", userId);
        if (delErr) throw new Error(`Limpar ${table}: ${delErr.message}`);

        if (rows.length === 0) continue;

        // Reatribui user_id ao usuário atual; remove colunas que não devem vir do arquivo.
        const cleaned = rows.map((r) => {
          const o: Record<string, unknown> = { ...(r as Record<string, unknown>) };
          for (const k of STRIP_ON_IMPORT) delete o[k];
          o.user_id = userId;
          return o;
        });

        // Insere em chunks para evitar payloads gigantes.
        const CHUNK = 200;
        for (let i = 0; i < cleaned.length; i += CHUNK) {
          const batch = cleaned.slice(i, i + CHUNK);
          const { error: insErr } = await supabase.from(table as TableName).insert(batch as never);
          if (insErr) throw new Error(`Inserir ${table}: ${insErr.message}`);
          totalImported += batch.length;
        }
      }

      toast.success(`Backup importado (${totalImported} registros)`);
      // Notifica painéis que ouvem eventos para recarregar.
      window.dispatchEvent(new CustomEvent("pix:reload"));
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro ao importar";
      toast.error(msg);
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json,.txt,text/plain"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
      <Button
        variant="ghost"
        size="sm"
        onClick={handleExport}
        disabled={busy !== null}
        className="w-full justify-start gap-2 text-muted-foreground"
        title="Exportar backup global (todos os dados)"
      >
        {busy === "export" ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <DatabaseBackup className="w-4 h-4" />
        )}
        {!collapsed && <span>Exportar Backup</span>}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => fileRef.current?.click()}
        disabled={busy !== null}
        className="w-full justify-start gap-2 text-muted-foreground"
        title="Importar backup global (substitui dados atuais)"
      >
        {busy === "import" ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Upload className="w-4 h-4" />
        )}
        {!collapsed && <span>Importar Backup</span>}
      </Button>
    </>
  );
}
