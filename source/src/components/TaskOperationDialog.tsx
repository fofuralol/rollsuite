import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calculator, Dices, Save, Send, Loader2, Plus, Trash2, Copy, Check, KeyRound, ClipboardPaste, Shuffle } from "lucide-react";
import { PasteListDialog } from "@/components/calc/PasteListDialog";
import { formatBR, parseBR } from "@/lib/format";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { OperationData, OperationRow, PixKeyRef } from "@/hooks/useWaTasks";
import { getBancoColor } from "@/lib/bancoColors";
import { extractLinkDomainKey } from "@/lib/linkDomain";
import { divisorDkDash } from "@/lib/divisorDkDash";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  taskId: string | null;
  taskName: string;
  taskLink?: string | null;
  defaultCount?: number | null;
  targetTotal?: number | null;
  defaultBlogueiroPercent?: number;
  initial?: OperationData | null;
  initialPixKeys?: PixKeyRef[];
  onSave: (data: OperationData) => void | Promise<void>;
  onChangePixKeys?: (keys: PixKeyRef[]) => void | Promise<void>;
  taskHue?: number | null;
};

const CURSOR_KEY = "pix_bank_cursor_v2";

type BankCursor = { bankIdx: number; perBank: Record<string, number> };

// Gera n inteiros únicos somando exatamente `total`, com alta diversidade
// (replica o padrão do gerador do DK Dash: piso ~75% da média + distribuição
// por pesos aleatórios do restante, teto ~150% da média).
function genDepositsSum(n: number, total: number): number[] {
  if (n <= 1 || total <= 0) return [Math.max(0, Math.round(total))];
  const base = total / n;
  const floor = Math.max(1, Math.floor(base * 0.75));
  const ceil = Math.max(floor + n, Math.ceil(base * 1.5));

  for (let attempt = 0; attempt < 200; attempt++) {
    // 1) pesos aleatórios (Dirichlet-like via uniform + normalize)
    const weights = Array.from({ length: n }, () => Math.random() + 0.15);
    const wSum = weights.reduce((a, b) => a + b, 0);
    const remainder = total - floor * n;
    if (remainder < 0) break;

    // 2) distribui o restante proporcional aos pesos
    const raw = weights.map((w) => floor + (w / wSum) * remainder);

    // 3) arredonda mantendo soma exata (largest-remainder)
    const floors = raw.map((x) => Math.floor(x));
    let diff = total - floors.reduce((a, b) => a + b, 0);
    const fracs = raw
      .map((x, i) => ({ i, f: x - Math.floor(x) }))
      .sort((a, b) => b.f - a.f);
    const arr = [...floors];
    for (let k = 0; k < diff; k++) arr[fracs[k % n].i] += 1;

    // 4) clamp para [floor, ceil] redistribuindo excesso
    let needFix = false;
    for (let i = 0; i < n; i++) {
      if (arr[i] < floor || arr[i] > ceil) { needFix = true; break; }
    }
    if (needFix) {
      // empurra valores fora dos limites trocando 1 unidade com vizinhos
      for (let pass = 0; pass < 200; pass++) {
        let changed = false;
        for (let i = 0; i < n; i++) {
          if (arr[i] > ceil) {
            for (let j = 0; j < n; j++) {
              if (i !== j && arr[j] < ceil) { arr[i]--; arr[j]++; changed = true; break; }
            }
          } else if (arr[i] < floor) {
            for (let j = 0; j < n; j++) {
              if (i !== j && arr[j] > floor) { arr[i]++; arr[j]--; changed = true; break; }
            }
          }
        }
        if (!changed) break;
      }
    }

    // 5) garantir unicidade ajustando ±1 entre pares duplicados
    const seen = new Map<number, number>();
    arr.forEach((v, i) => seen.set(v, (seen.get(v) ?? 0) + 1));
    if ([...seen.values()].some((c) => c > 1)) {
      for (let pass = 0; pass < 100; pass++) {
        const counts = new Map<number, number[]>();
        arr.forEach((v, i) => {
          const list = counts.get(v) ?? [];
          list.push(i);
          counts.set(v, list);
        });
        let dupIdx = -1;
        for (const [, idxs] of counts) if (idxs.length > 1) { dupIdx = idxs[1]; break; }
        if (dupIdx === -1) break;
        // tenta deslocar +1 ou -1 trocando com outro
        const tryShift = (delta: number) => {
          for (let j = 0; j < n; j++) {
            if (j === dupIdx) continue;
            const newDup = arr[dupIdx] + delta;
            const newOther = arr[j] - delta;
            if (newDup >= floor && newDup <= ceil && newOther >= floor && newOther <= ceil &&
                !arr.some((v, k) => k !== dupIdx && k !== j && (v === newDup || v === newOther)) &&
                newDup !== newOther) {
              arr[dupIdx] = newDup; arr[j] = newOther; return true;
            }
          }
          return false;
        };
        if (!tryShift(1) && !tryShift(-1)) break;
      }
    }

    // valida
    const finalSum = arr.reduce((a, b) => a + b, 0);
    const unique = new Set(arr).size === n;
    const inRange = arr.every((v) => v >= floor && v <= ceil);
    if (finalSum === total && unique && inRange) {
      return arr.sort((a, b) => a - b);
    }
  }

  // fallback: split incremental
  const baseInt = Math.floor(total / n);
  const arr = Array.from({ length: n }, (_, i) => baseInt + i - Math.floor(n / 2));
  let diff = total - arr.reduce((a, b) => a + b, 0);
  let i = 0;
  while (diff !== 0) {
    arr[i % n] += diff > 0 ? 1 : -1;
    diff += diff > 0 ? -1 : 1;
    i++;
  }
  return arr.sort((a, b) => a - b);
}

const formatChaveCopy = (chave: string, tipo: string) => {
  const t = (tipo || "").toLowerCase();
  const isNumeric = t === "telefone" || t === "cpf" || t === "cnpj";
  return isNumeric ? (chave || "").replace(/\D/g, "") : (chave || "").trim();
};

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
  const existing = await supabase
    .from("app_settings").select("id")
    .eq("user_id", userId).eq("key", CURSOR_KEY).maybeSingle();
  if (existing.data?.id) {
    await supabase.from("app_settings").update({ value }).eq("id", existing.data.id);
  } else {
    await supabase.from("app_settings").insert({ user_id: userId, key: CURSOR_KEY, value });
  }
}

// Picks n keys: 1 per bank, advancing the bank cursor so subsequent
// generations don't repeat banks until the full bank list cycles.
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

export default function TaskOperationDialog({
  open, onOpenChange, taskId, taskName, taskLink, defaultCount, targetTotal, defaultBlogueiroPercent, initial,
  initialPixKeys, onSave, onChangePixKeys, taskHue,
}: Props) {
  const [count, setCount] = useState<string>("");
  const [rows, setRows] = useState<OperationRow[]>([]);
  const [blogPct, setBlogPct] = useState<string>("20");
  const [sending, setSending] = useState(false);

  const [allKeys, setAllKeys] = useState<PixKeyRef[]>([]);
  const [pixKeys, setPixKeys] = useState<PixKeyRef[]>([]);
  const [usedKeyIds, setUsedKeyIds] = useState<Set<string>>(new Set());
  const [domainUsedIds, setDomainUsedIds] = useState<Set<string>>(new Set());
  const [userId, setUserId] = useState<string | null>(null);
  const [keysReady, setKeysReady] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const skipAutoSave = useRef(true);

  const domainKey = useMemo(() => extractLinkDomainKey(taskLink), [taskLink]);

  // load all chaves + auth + history of pix keys used for this domain
  useEffect(() => {
    if (!open) return;
    setKeysReady(false);
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      setUserId(u.user?.id ?? null);
      const { data } = await supabase
        .from("chaves_pix")
        .select("id, banco, tipo_chave, chave, titular, ordem")
        .order("ordem", { ascending: true })
        .order("created_at", { ascending: true });
      setAllKeys((data ?? []).map((r: any) => ({
        id: r.id, banco: r.banco, tipo_chave: r.tipo_chave, chave: r.chave, titular: r.titular,
      })));

      // collect pix_keys ids already used in other tasks with the same domain
      const used = new Set<string>();
      if (domainKey) {
        const { data: tasks } = await supabase
          .from("wa_tasks")
          .select("id, link, pix_keys")
          .ilike("link", `%${domainKey}%`);
        for (const t of (tasks ?? []) as any[]) {
          if (taskId && t.id === taskId) continue;
          if (extractLinkDomainKey(t.link) !== domainKey) continue;
          for (const k of (t.pix_keys ?? [])) {
            if (k && k.id) used.add(k.id);
          }
        }
      }
      setDomainUsedIds(used);
      setKeysReady(true);
    })();
  }, [open, domainKey, taskId]);

  // initial state on open
  useEffect(() => {
    if (!open) return;
    const initRows = initial?.rows ?? [];
    const dc = defaultCount && defaultCount > 0 ? defaultCount : 1;
    const tt = targetTotal && targetTotal > 0 ? targetTotal : dc * 200;
    if (initRows.length > 0) {
      // já existem rows salvos — não tocar nem disparar auto-save
      skipAutoSave.current = true;
      setRows(initRows);
      setCount(String(initRows.length));
    } else {
      // gerar do divisor e PERMITIR auto-save para persistir os depósitos
      const tot = Math.floor(tt);
      const arr = divisorDkDash(tot, dc, 0);
      skipAutoSave.current = false;
      setRows(arr.map((d) => ({ deposito: d, saque: 0 })));
      setCount(String(dc));
    }
    setBlogPct(String(Math.round((initial?.blogueiroPercent ?? defaultBlogueiroPercent ?? 0.20) * 100)));
    setPixKeys(initialPixKeys ?? []);
    setUsedKeyIds(new Set((initialPixKeys ?? []).map((k) => k.id)));
    setCopiedAll(false);
  }, [open, defaultCount, targetTotal, defaultBlogueiroPercent, initial, initialPixKeys]);

  // auto-persist edits so reopening keeps the data
  useEffect(() => {
    if (!open) return;
    if (skipAutoSave.current) { skipAutoSave.current = false; return; }
    const t = setTimeout(() => {
      onSave({
        rows,
        blogueiroPercent: (parseFloat(blogPct.replace(",", ".")) || 0) / 100,
        savedAt: new Date().toISOString(),
      });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, blogPct, open]);

  // auto-generate pix keys if none yet, once chaves loaded
  useEffect(() => {
    if (!open || !keysReady || !userId) return;
    if (pixKeys.length > 0) return;
    if (allKeys.length === 0) return;
    const n = rows.length;
    if (n <= 0) return;
    (async () => {
      const cursor = await readCursor(userId);
      // Excluir chaves já usadas em tarefas anteriores do mesmo domínio
      let pool = allKeys.filter((k) => !domainUsedIds.has(k.id));
      if (pool.length < n) pool = allKeys; // fallback se não houver chaves livres suficientes
      const { picked, next } = pickKeysOnePerBank(pool, n, cursor);
      await writeCursor(userId, next);
      setPixKeys(picked);
      setUsedKeyIds((prev) => { const s = new Set(prev); picked.forEach((p) => s.add(p.id)); return s; });
      onChangePixKeys?.(picked);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, keysReady, userId, allKeys.length, rows.length, domainUsedIds]);

  const totals = useMemo(() => {
    const dep = rows.reduce((s, r) => s + (Number(r.deposito) || 0), 0);
    const saq = rows.reduce((s, r) => s + (Number(r.saque) || 0), 0);
    const pct = (parseFloat(blogPct.replace(",", ".")) || 0) / 100;
    // Blogueiro paga X% do montante ao operador no início (entra como receita).
    const blogueiro = dep * pct;
    // Taxa DK acompanha o mesmo % do blogueiro.
    const taxaDk = blogueiro * pct;
    // Lucro = saque − depósito + recebido do blogueiro − taxa DK
    const lucro = (saq - dep) + blogueiro - taxaDk;
    return { dep, saq, blogueiro, taxaDk, lucro };
  }, [rows, blogPct]);

  const [rowsVersion, setRowsVersion] = useState(0);

  // divisorDkDash importado de "@/lib/divisorDkDash" (ver topo do arquivo)

  const regenerate = () => {
    const n = Math.max(1, parseInt(count, 10) || 1);
    const tt = targetTotal && targetTotal > 0 ? targetTotal : n * 200;
    const deps = divisorDkDash(Math.floor(tt), n, 0);
    setRows(deps.map((d, i) => ({ deposito: d, saque: rows[i]?.saque ?? 0 })));
    setRowsVersion((v) => v + 1);
  };

  const applyPaste = (values: number[]) => {
    const ints = values.map((v) => Math.round(v));
    setRows(ints.map((d, i) => ({ deposito: d, saque: rows[i]?.saque ?? 0 })));
    setCount(String(ints.length));
    setRowsVersion((v) => v + 1);
    toast.success(`${ints.length} depósito(s) aplicado(s)`);
  };

  const copyDeposits = async () => {
    const text = rows.map((r) => String(Math.round(r.deposito || 0))).filter((v) => v !== "0").join("\n");
    if (!text) { toast.error("Lista vazia"); return; }
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${rows.length} depósito(s) copiado(s)`);
    } catch { toast.error("Falha ao copiar"); }
  };

  const updateRow = (idx: number, field: "deposito" | "saque", value: string) => {
    const n = Math.round(parseBR(value));
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: n } : r)));
  };
  const addRow = () => { setRows((prev) => [...prev, { deposito: 200, saque: 0 }]); setRowsVersion((v) => v + 1); };
  const removeRow = (idx: number) => { setRows((prev) => prev.filter((_, i) => i !== idx)); setRowsVersion((v) => v + 1); };

  const replacePix = (idx: number, newId: string) => {
    const found = allKeys.find((k) => k.id === newId);
    if (!found) return;
    setPixKeys((prev) => {
      const next = prev.map((k, i) => (i === idx ? found : k));
      onChangePixKeys?.(next);
      return next;
    });
    setUsedKeyIds((prev) => { const s = new Set(prev); s.add(newId); return s; });
  };

  const shufflePix = (idx: number) => {
    const currentIds = new Set(pixKeys.map((k) => k.id));
    let pool = allKeys.filter((k) => !usedKeyIds.has(k.id) && !currentIds.has(k.id) && !domainUsedIds.has(k.id));
    if (pool.length === 0) {
      // fallback: ignora histórico do domínio se já esgotou
      pool = allKeys.filter((k) => !usedKeyIds.has(k.id) && !currentIds.has(k.id));
    }
    if (pool.length === 0) { toast.info("Todas as chaves já foram usadas"); return; }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    setPixKeys((prev) => {
      const next = prev.map((k, i) => (i === idx ? pick : k));
      onChangePixKeys?.(next);
      return next;
    });
    setUsedKeyIds((prev) => { const s = new Set(prev); s.add(pick.id); return s; });
  };

  const copyKey = async (chave: string, tipo: string) => {
    const text = formatChaveCopy(chave, tipo);
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Chave copiada");
    } catch {
      toast.error("Falha ao copiar");
    }
  };

  const copyAllKeys = async () => {
    const text = pixKeys.map((k) => formatChaveCopy(k.chave, k.tipo_chave)).filter(Boolean).join("\n");
    if (!text) { toast.error("Lista vazia"); return; }
    try {
      await navigator.clipboard.writeText(text);
      setCopiedAll(true);
      toast.success(`${pixKeys.length} chave(s) copiada(s)`);
      setTimeout(() => setCopiedAll(false), 1500);
    } catch { toast.error("Falha ao copiar"); }
  };

  const optionsByBanco = useMemo(() => {
    const groups = new Map<string, PixKeyRef[]>();
    for (const k of allKeys) {
      const b = k.banco || "Sem banco";
      if (!groups.has(b)) groups.set(b, []);
      groups.get(b)!.push(k);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [allKeys]);

  const buildData = (): OperationData => ({
    rows,
    blogueiroPercent: (parseFloat(blogPct.replace(",", ".")) || 0) / 100,
    savedAt: new Date().toISOString(),
  });

  const handleSave = async () => {
    await onSave(buildData());
    if (onChangePixKeys) await onChangePixKeys(pixKeys);
    toast.success("Operação salva");
    onOpenChange(false);
  };

  const hueStyle = taskHue != null
    ? ({
        ["--task-hue" as never]: String(taskHue),
        borderColor: `hsl(${taskHue} 80% 55% / 0.6)`,
        boxShadow: `0 0 0 1px hsl(${taskHue} 80% 55% / 0.45), 0 0 40px -10px hsl(${taskHue} 80% 55% / 0.45)`,
      } as React.CSSProperties)
    : undefined;
  const tintedRow = taskHue != null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[92vh] overflow-y-auto" style={hueStyle}>
        <DialogHeader className="sr-only">
          <DialogTitle>Operação da tarefa</DialogTitle>
          <DialogDescription>{taskName || "—"}</DialogDescription>
        </DialogHeader>

        <div className="flex items-end gap-2">
          <div className="space-y-1.5 w-14">
            <Label className="text-xs">Qtd. contas</Label>
            <Input type="number" min={1} value={count} onChange={(e) => setCount(e.target.value)} placeholder="Ex: 5" className="text-center" />
          </div>
          <div className="space-y-1.5 w-16">
            <Label className="text-xs">Blog. %</Label>
            <Input inputMode="decimal" value={blogPct} onChange={(e) => setBlogPct(e.target.value)} className="text-center" />
          </div>
          <Button variant="outline" onClick={regenerate} className="gap-1.5 h-10">
            <Dices className="w-4 h-4" /> Gerar
          </Button>
        </div>

        {/* Chaves Pix */}
        <div className="rounded-lg border border-border bg-muted/10">
          <div className="px-3 py-2 flex items-center justify-between border-b border-border/60">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <KeyRound className="w-3.5 h-3.5" /> Chaves Pix ({pixKeys.length})
            </div>
            <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={copyAllKeys} disabled={pixKeys.length === 0}>
              {copiedAll ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} Copiar lista
            </Button>
          </div>
          {pixKeys.length === 0 ? (
            <div className="p-3 text-[11px] text-muted-foreground text-center">
              {keysReady && allKeys.length === 0 ? "Nenhuma chave Pix cadastrada." : "Carregando chaves…"}
            </div>
          ) : (
            <div className="p-1.5 space-y-1 max-h-[22vh] overflow-y-auto">
              {pixKeys.map((k, idx) => {
                const c = getBancoColor(k.banco);
                return (
                  <div key={`${k.id}-${idx}`} className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono w-4 text-right text-muted-foreground">{idx + 1}.</span>
                    <button
                      type="button"
                      onClick={() => copyKey(k.chave, k.tipo_chave)}
                      title={`${k.banco} · ${k.tipo_chave}${k.titular ? " · " + k.titular : ""} · clique para copiar`}
                      className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md border shrink-0 hover:brightness-125 active:scale-95 ${c.bg} ${c.text} ${c.border}`}
                    >
                      {k.banco || "?"}
                    </button>
                    <Select value={k.id} onValueChange={(v) => replacePix(idx, v)}>
                      <SelectTrigger className="h-6 text-[11px] w-full max-w-[180px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="max-h-[260px]">
                        {optionsByBanco.map(([banco, list]) => (
                          <div key={banco}>
                            <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground font-bold">{banco}</div>
                            {list.map((opt) => (
                              <SelectItem key={opt.id} value={opt.id} className="text-[11px]">
                                <span className="font-mono">{opt.chave}</span>
                                <span className="text-muted-foreground"> · {opt.tipo_chave}</span>
                                {opt.titular && <span className="text-muted-foreground"> · {opt.titular}</span>}
                              </SelectItem>
                            ))}
                          </div>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 shrink-0"
                      title="Trocar por outra chave aleatória (sem repetir)"
                      onClick={() => shufflePix(idx)}
                      disabled={allKeys.filter((x) => !usedKeyIds.has(x.id) && !pixKeys.some((p) => p.id === x.id)).length === 0}
                    >
                      <Shuffle className="w-3 h-3" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-lg border overflow-hidden" style={tintedRow ? { borderColor: `hsl(${taskHue} 80% 55% / 0.6)` } : undefined}>
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-1 py-1 w-6">#</th>
                <th className="px-1 py-1 text-right w-[100px]">
                  <div className="inline-flex items-center gap-1">
                    <span>Depósito</span>
                    <button
                      type="button"
                      onClick={() => setPasteOpen(true)}
                      title="Colar lista de depósitos"
                      className="p-0.5 rounded hover:bg-muted/60 hover:text-foreground transition-colors"
                    >
                      <ClipboardPaste className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={copyDeposits}
                      title="Copiar lista de depósitos"
                      className="p-0.5 rounded hover:bg-muted/60 hover:text-foreground transition-colors"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                </th>
                <th className="px-1 py-1 text-right w-[100px]">Saque</th>
                <th className="px-1 py-1 text-right">Res.</th>
                <th className="w-6" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const res = (Number(r.saque) || 0) - (Number(r.deposito) || 0);
                return (
                  <tr key={`${rowsVersion}-${i}`} className="border-t border-border/60">
                    <td className="px-2 py-1 text-center text-xs text-muted-foreground">{i + 1}</td>
                    <td className="px-1 py-1">
                      <Input
                        inputMode="numeric"
                        value={r.deposito ? String(Math.round(r.deposito)) : ""}
                        onChange={(e) => updateRow(i, "deposito", e.target.value)}
                        className="h-7 text-right text-xs max-w-[100px] ml-auto"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <Input
                        inputMode="numeric"
                        value={r.saque ? String(Math.round(r.saque)) : ""}
                        onChange={(e) => updateRow(i, "saque", e.target.value)}
                        className="h-7 text-right text-xs max-w-[100px] ml-auto"
                        placeholder="0"
                      />
                    </td>
                    <td className={`px-2 py-1 text-right text-xs font-bold tabular-nums ${res >= 0 ? "text-emerald-400" : "text-destructive"}`}>
                      {Math.round(res).toLocaleString("pt-BR")}
                    </td>
                    <td className="px-1">
                      <Button variant="ghost" size="icon" className="size-6 text-muted-foreground hover:text-destructive" onClick={() => removeRow(i)}>
                        <Trash2 className="size-3" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-2 py-1.5 border-t border-border/60 bg-muted/20 flex justify-end">
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={addRow}>
              <Plus className="w-3 h-3" /> Linha
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex justify-between rounded-md border border-border/60 bg-muted/20 px-3 py-2">
            <span className="text-muted-foreground">Depósito total</span>
            <span className="font-bold tabular-nums">R$ {formatBR(totals.dep)}</span>
          </div>
          <div className="flex justify-between rounded-md border border-border/60 bg-muted/20 px-3 py-2">
            <span className="text-muted-foreground">Saque total</span>
            <span className="font-bold tabular-nums">R$ {formatBR(totals.saq)}</span>
          </div>
          <div className="flex justify-between rounded-md border border-border/60 bg-muted/20 px-3 py-2">
            <span className="text-muted-foreground">Recebido do blog. ({Math.round(((parseFloat(blogPct.replace(",", ".")) || 0)))}%)</span>
            <span className="font-bold tabular-nums text-emerald-400">+R$ {formatBR(totals.blogueiro)}</span>
          </div>
          <div className="flex justify-between rounded-md border border-border/60 bg-muted/20 px-3 py-2">
            <span className="text-muted-foreground">Taxa DK ({Math.round(((parseFloat(blogPct.replace(",", ".")) || 0)))}% do blog.)</span>
            <span className="font-bold tabular-nums text-amber-400">−R$ {formatBR(totals.taxaDk)}</span>
          </div>
          <div className={`flex justify-between rounded-md border px-3 py-2 ${totals.lucro >= 0 ? "border-emerald-500/40 bg-emerald-500/10" : "border-destructive/40 bg-destructive/10"}`}>
            <span className="text-muted-foreground">Lucro / Perda</span>
            <span className={`font-black tabular-nums ${totals.lucro >= 0 ? "text-emerald-400" : "text-destructive"}`}>
              R$ {formatBR(totals.lucro)}
            </span>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={sending}>Cancelar</Button>
          <Button onClick={handleSave} disabled={sending || !taskId} className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 font-bold">
            <Save className="w-3.5 h-3.5" /> Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
      <PasteListDialog open={pasteOpen} onOpenChange={setPasteOpen} onConfirm={applyPaste} />
    </Dialog>
  );
}
