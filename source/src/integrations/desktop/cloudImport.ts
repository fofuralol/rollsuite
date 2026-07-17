// Importador one-shot da nuvem (Supabase real) → DB local do Electron.
// Usado para puxar dados que existem na conta do browser para o app desktop.
import { createClient } from "@supabase/supabase-js";
import { supabase as localSupabase } from "@/integrations/supabase/client";

const URL = import.meta.env.VITE_SUPABASE_URL as string;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

const nickToEmail = (n: string) => {
  const t = n.trim();
  if (t.includes("@")) return t.toLowerCase();
  return `${t.toLowerCase().replace(/[^a-z0-9_]/g, "")}@rolls.local`;
};

export async function importSlotCodesFromCloud(nicknameOrEmail: string, password: string) {
  if (!URL || !KEY) throw new Error("Supabase env ausente");
  const cloud = createClient(URL, KEY, { auth: { persistSession: false } });
  const email = nickToEmail(nicknameOrEmail);
  const { data: auth, error: authErr } = await cloud.auth.signInWithPassword({ email, password });
  if (authErr || !auth.user) throw new Error(authErr?.message || `Login falhou (${email})`);

  try {
    // ---- slot_mapping_codes ----
    const { data: codeRows, error: codeErr } = await cloud
      .from("slot_mapping_codes")
      .select("slot_name, codes")
      .eq("user_id", auth.user.id);
    if (codeErr) throw new Error(codeErr.message);

    let totalCodes = 0;
    let slots = 0;
    if (codeRows && codeRows.length) {
      await (localSupabase as any).from("slot_mapping_codes").delete().neq("id", "__never__");
      const payload = codeRows.map((r: any) => {
        const codes = Array.isArray(r.codes) ? r.codes : [];
        totalCodes += codes.length;
        return { slot_name: r.slot_name, codes, user_id: "fofuralol-local" };
      });
      const { error: insErr } = await (localSupabase as any).from("slot_mapping_codes").insert(payload);
      if (insErr) throw new Error(insErr.message);
      slots = codeRows.length;
    }

    // ---- wa_tasks (histórico) ----
    const { data: taskRows, error: taskErr } = await cloud
      .from("wa_tasks")
      .select("*")
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: false });
    if (taskErr) throw new Error(taskErr.message);

    let tasks = 0;
    if (taskRows && taskRows.length) {
      await (localSupabase as any).from("wa_tasks").delete().neq("id", "__never__");
      const payload = taskRows.map((r: any) => ({ ...r, user_id: "fofuralol-local" }));
      const { error: insErr } = await (localSupabase as any).from("wa_tasks").insert(payload);
      if (insErr) throw new Error(insErr.message);
      tasks = taskRows.length;
    }

    // ---- chaves_pix ----
    const { data: pixRows, error: pixErr } = await cloud
      .from("chaves_pix")
      .select("*")
      .eq("user_id", auth.user.id);
    if (pixErr) throw new Error(pixErr.message);

    let pix = 0;
    if (pixRows && pixRows.length) {
      await (localSupabase as any).from("chaves_pix").delete().neq("id", "__never__");
      const payload = pixRows.map((r: any) => ({ ...r, user_id: "fofuralol-local" }));
      const { error: insErr } = await (localSupabase as any).from("chaves_pix").insert(payload);
      if (insErr) throw new Error(insErr.message);
      pix = pixRows.length;
    }

    return { imported: totalCodes, slots, tasks, pix };
  } finally {
    try { await cloud.auth.signOut(); } catch {}
  }
}

// ---------------------------------------------------------------------------
// Sync bidirecional do histórico de tarefas entre desktop (local) e nuvem.
// Regra de merge por id: vence o registro com maior (completed_at || created_at).
// ---------------------------------------------------------------------------
function taskActivityScore(t: any): number {
  const v = t?.completed_at || t?.updated_at || t?.created_at || 0;
  const ts = typeof v === "string" ? Date.parse(v) : Number(v) || 0;
  return isFinite(ts) ? ts : 0;
}

export async function syncTasksBidirectional(nicknameOrEmail: string, password: string) {
  if (!URL || !KEY) throw new Error("Supabase env ausente");
  const cloud = createClient(URL, KEY, { auth: { persistSession: false } });
  const email = nickToEmail(nicknameOrEmail);
  const { data: auth, error: authErr } = await cloud.auth.signInWithPassword({ email, password });
  if (authErr || !auth.user) throw new Error(authErr?.message || `Login falhou (${email})`);
  const cloudUserId = auth.user.id;

  try {
    const [cloudRes, localRes] = await Promise.all([
      cloud.from("wa_tasks").select("*").eq("user_id", cloudUserId),
      (localSupabase as any).from("wa_tasks").select("*"),
    ]);
    if (cloudRes.error) throw new Error(cloudRes.error.message);
    if (localRes.error) throw new Error(localRes.error.message);

    const cloudRows = (cloudRes.data || []) as any[];
    const localRows = (localRes.data || []) as any[];

    const byId = new Map<string, { row: any; from: "cloud" | "local" }>();
    for (const r of cloudRows) byId.set(r.id, { row: r, from: "cloud" });
    for (const r of localRows) {
      const prev = byId.get(r.id);
      if (!prev) {
        byId.set(r.id, { row: r, from: "local" });
      } else if (taskActivityScore(r) > taskActivityScore(prev.row)) {
        byId.set(r.id, { row: r, from: "local" });
      }
    }

    const merged = Array.from(byId.values()).map((v) => v.row);

    const toCloud: any[] = [];
    const toLocal: any[] = [];
    const cloudIds = new Set(cloudRows.map((r) => r.id));
    const localIds = new Set(localRows.map((r) => r.id));

    for (const m of merged) {
      const cloudHas = cloudIds.has(m.id);
      const localHas = localIds.has(m.id);
      const cloudRow = cloudHas ? cloudRows.find((r) => r.id === m.id) : null;
      const localRow = localHas ? localRows.find((r) => r.id === m.id) : null;

      if (!cloudHas || (cloudRow && taskActivityScore(cloudRow) < taskActivityScore(m))) {
        toCloud.push({ ...m, user_id: cloudUserId });
      }
      if (!localHas || (localRow && taskActivityScore(localRow) < taskActivityScore(m))) {
        toLocal.push({ ...m, user_id: "fofuralol-local" });
      }
    }

    let pushed = 0;
    let pulled = 0;
    // chunk para evitar payloads gigantes
    const chunk = <T,>(arr: T[], n: number) => {
      const out: T[][] = [];
      for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
      return out;
    };

    // Colunas existentes na tabela wa_tasks da nuvem (sem updated_at, que só existe no DB local)
    const CLOUD_COLS = [
      "id","user_id","autor","grupo","mensagem","matched","status",
      "created_at","completed_at","telefone","link","nome_tarefa",
      "pix_keys","operation_data","source_msg_id","source_chat_id",
      "source_author_id","image_urls",
    ];
    const pickCloud = (row: any) => {
      const o: any = {};
      for (const k of CLOUD_COLS) if (row[k] !== undefined) o[k] = row[k];
      return o;
    };

    for (const batch of chunk(toCloud, 200)) {
      const payload = batch.map(pickCloud);
      const { error } = await cloud.from("wa_tasks").upsert(payload, { onConflict: "id" });
      if (error) throw new Error("Cloud upsert: " + error.message);
      pushed += batch.length;
    }
    for (const batch of chunk(toLocal, 200)) {
      const { error } = await (localSupabase as any)
        .from("wa_tasks")
        .upsert(batch, { onConflict: "id" });
      if (error) throw new Error("Local upsert: " + error.message);
      pulled += batch.length;
    }

    return { pushed, pulled, total: merged.length };
  } finally {
    try { await cloud.auth.signOut(); } catch {}
  }
}

// Sync para o browser: usuário já está logado na sessão atual, então
// recebe o user_id direto e sincroniza com um peer local (que NÃO existe no
// browser). No browser este helper na prática só é usado quando o usuário
// quer empurrar tarefas locais (importadas via Electron) — não aplicável aqui.
