import { supabase } from "@/integrations/supabase/client";
import type { PixKeyRef } from "@/hooks/useWaTasks";
import { extractLinkDomainKey } from "@/lib/linkDomain";

const CURSOR_KEY = "pix_bank_cursor_v2";

type BankCursor = { bankIdx: number; perBank: Record<string, number> };

async function readCursor(userId: string): Promise<BankCursor> {
  const { data } = await supabase
    .from("app_settings").select("value")
    .eq("user_id", userId).eq("key", CURSOR_KEY).maybeSingle();
  try {
    const parsed = JSON.parse(data?.value ?? "{}");
    return {
      bankIdx: Number.isFinite(parsed.bankIdx) ? Math.max(0, Math.floor(parsed.bankIdx)) : 0,
      perBank: parsed.perBank && typeof parsed.perBank === "object" ? parsed.perBank : {},
    };
  } catch {
    return { bankIdx: 0, perBank: {} };
  }
}

async function writeCursor(userId: string, state: BankCursor) {
  const value = JSON.stringify(state);
  await supabase.from("app_settings").upsert(
    { user_id: userId, key: CURSOR_KEY, value },
    { onConflict: "user_id,key" }
  );
}

function pickKeysOnePerBank(
  allKeys: PixKeyRef[],
  n: number,
  state: BankCursor,
): { picked: PixKeyRef[]; next: BankCursor } {
  if (allKeys.length === 0 || n <= 0) return { picked: [], next: state };
  const byBank = new Map<string, PixKeyRef[]>();
  const banks: string[] = [];
  for (const k of allKeys) {
    const b = k.banco || "Sem banco";
    if (!byBank.has(b)) { byBank.set(b, []); banks.push(b); }
    byBank.get(b)!.push(k);
  }
  const totalBanks = banks.length;
  const perBank: Record<string, number> = { ...state.perBank };
  const picked: PixKeyRef[] = [];
  let bankIdx = ((state.bankIdx % totalBanks) + totalBanks) % totalBanks;
  for (let i = 0; i < n; i++) {
    const bank = banks[bankIdx];
    const list = byBank.get(bank)!;
    const idx = ((perBank[bank] ?? 0) % list.length + list.length) % list.length;
    picked.push(list[idx]);
    perBank[bank] = idx + 1;
    bankIdx = (bankIdx + 1) % totalBanks;
  }
  return { picked, next: { bankIdx, perBank } };
}

const PRIORITY_UNRANKED = 9999;

export async function generatePixKeysForTask(opts: {
  count: number;
  link?: string | null;
  taskId?: string | null;
}): Promise<PixKeyRef[]> {
  const { count, link, taskId } = opts;
  if (count <= 0) return [];

  const { data: u } = await supabase.auth.getUser();
  const userId = u.user?.id;
  if (!userId) return [];

  const [keysRes, prioRes, cursor, usedRes] = await Promise.all([
    supabase
      .from("chaves_pix")
      .select("id, banco, tipo_chave, chave, titular, ordem")
      .order("ordem", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("pix_bank_priorities")
      .select("banco, nivel"),
    readCursor(userId),
    (async () => {
      const domainKey = extractLinkDomainKey(link ?? null);
      if (!domainKey) return new Set<string>();
      const { data } = await supabase
        .from("wa_tasks")
        .select("id, link, pix_keys")
        .eq("user_id", userId)
        .ilike("link", `%${domainKey}%`);
      const used = new Set<string>();
      for (const t of (data ?? []) as any[]) {
        if (taskId && t.id === taskId) continue;
        if (extractLinkDomainKey(t.link) !== domainKey) continue;
        for (const k of (t.pix_keys ?? [])) {
          if (k && k.id) used.add(k.id);
        }
      }
      return used;
    })()
  ]);

  const allKeys: PixKeyRef[] = (keysRes.data ?? []).map((r: any) => ({
    id: r.id, banco: r.banco, tipo_chave: r.tipo_chave, chave: r.chave, titular: r.titular,
  }));
  if (allKeys.length === 0) return [];

  const prioMap: Record<string, number> = {};
  for (const r of (prioRes.data ?? []) as any[]) {
    prioMap[r.banco] = r.nivel;
  }

  // Pool sem as já usadas pro link
  const fresh = allKeys.filter((k) => !usedRes.has(k.id));

  // Agrupa o pool fresh por nível
  const byLevel = new Map<number, PixKeyRef[]>();
  for (const k of fresh) {
    const lvl = prioMap[k.banco] ?? PRIORITY_UNRANKED;
    if (!byLevel.has(lvl)) byLevel.set(lvl, []);
    byLevel.get(lvl)!.push(k);
  }
  const levelsSorted = [...byLevel.keys()].sort((a, b) => a - b);

  let cursorState = cursor;
  const result: PixKeyRef[] = [];
  for (const lvl of levelsSorted) {
    if (result.length >= count) break;
    const need = count - result.length;
    const { picked, next } = pickKeysOnePerBank(byLevel.get(lvl)!, need, cursorState);
    result.push(...picked);
    cursorState = next;
  }

  // Fallback: se ainda faltar (todas já usadas no link), libera tudo agrupado por prioridade também
  if (result.length < count) {
    const need = count - result.length;
    const byLevelAll = new Map<number, PixKeyRef[]>();
    for (const k of allKeys) {
      const lvl = prioMap[k.banco] ?? PRIORITY_UNRANKED;
      if (!byLevelAll.has(lvl)) byLevelAll.set(lvl, []);
      byLevelAll.get(lvl)!.push(k);
    }
    const levelsAll = [...byLevelAll.keys()].sort((a, b) => a - b);
    let remaining = need;
    for (const lvl of levelsAll) {
      if (remaining <= 0) break;
      const { picked, next } = pickKeysOnePerBank(byLevelAll.get(lvl)!, remaining, cursorState);
      result.push(...picked);
      cursorState = next;
      remaining = count - result.length;
    }
  }

  await writeCursor(userId, cursorState);
  return result.slice(0, count);
}
