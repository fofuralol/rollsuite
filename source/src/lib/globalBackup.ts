import { supabase } from "@/integrations/supabase/client";
import { IS_DESKTOP } from "@/lib/runtime";

const MAGIC = "ROLLSSUITE-BACKUP-V1";

const BASE_TABLES = [
  "slot_mapping_codes",
  "slots_catalog",
  "platform_mappings",
  "chaves_pix",
  "pix_bank_priorities",
  "wa_tasks",
] as const;

const DESKTOP_TABLES = ["wa_live_messages"] as const;
const TABLES = [...BASE_TABLES, ...(IS_DESKTOP ? DESKTOP_TABLES : [])] as const;

type TableName = (typeof TABLES)[number];

const STRIP_ON_IMPORT = new Set(["user_id"]);

export type BackupFile = {
  magic: string;
  version: 1;
  exported_at: string;
  counts: Record<string, number>;
  data: Record<string, unknown[]>;
};

export async function buildBackupJson(): Promise<{ content: string; total: number; counts: Record<string, number> }> {
  const data: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  for (const table of TABLES) {
    const { data: rows, error } = await (supabase as any).from(table as TableName).select("*");
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
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { content, total, counts };
}

export async function importBackupJson(text: string): Promise<{ total: number; perTable: Record<string, number>; fileCounts: Record<string, number> }> {
  const lines = text.split(/\r?\n/);
  const header = (lines[0] || "").trim();
  if (header !== MAGIC) throw new Error("Arquivo inválido (cabeçalho não reconhecido)");
  const parsed = JSON.parse(lines.slice(1).join("\n")) as BackupFile;
  if (!parsed?.data) throw new Error("Arquivo sem seção 'data'");

  const { data: u } = await supabase.auth.getUser();
  const userId = u.user?.id;
  if (!userId) throw new Error("Não autenticado");

  const fileCounts: Record<string, number> = {};
  for (const table of TABLES) {
    fileCounts[table] = Array.isArray(parsed.data[table]) ? (parsed.data[table] as unknown[]).length : 0;
  }
  console.log("[restore] arquivo contém:", fileCounts);

  let total = 0;
  const perTable: Record<string, number> = {};
  for (const table of TABLES) {
    const rows = Array.isArray(parsed.data[table]) ? parsed.data[table] : [];
    perTable[table] = 0;
    if (rows.length === 0) {
      console.warn(`[restore] tabela "${table}" vazia no backup — preservando dados locais`);
      continue;
    }
    const { error: delErr } = await (supabase as any).from(table as TableName).delete().eq("user_id", userId);
    if (delErr) throw new Error(`Limpar ${table}: ${delErr.message}`);
    const cleaned = rows.map((r) => {
      const o: Record<string, unknown> = { ...(r as Record<string, unknown>) };
      for (const k of STRIP_ON_IMPORT) delete o[k];
      o.user_id = userId;
      return o;
    });
    const CHUNK = 200;
    for (let i = 0; i < cleaned.length; i += CHUNK) {
      const batch = cleaned.slice(i, i + CHUNK);
      const { error: insErr } = await (supabase as any).from(table as TableName).insert(batch as never);
      if (insErr) throw new Error(`Inserir ${table}: ${insErr.message}`);
      total += batch.length;
      perTable[table] += batch.length;
    }
    console.log(`[restore] ${table}: ${perTable[table]} inseridas`);
  }
  return { total, perTable, fileCounts };
}

export const BACKUP_TABLES = TABLES;
