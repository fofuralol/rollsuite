import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KeyRound, Copy, Check, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type DbRow = {
  id: string;
  banco: string;
  tipo_chave: string;
  chave: string;
  titular: string;
  ordem: number;
};

export type PixItem = {
  id: string;
  banco: string;
  tipo_chave: string;
  chave: string;
  titular: string;
};

const CURSOR_KEY = "pix_list_cursor";

const formatChaveValue = (chave: string, tipo: string) => {
  const t = (tipo || "").toLowerCase();
  const isNumeric = t === "telefone" || t === "cpf" || t === "cnpj";
  return isNumeric ? (chave || "").replace(/\D/g, "") : (chave || "").trim();
};

async function readCursor(userId: string): Promise<number> {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("user_id", userId)
    .eq("key", CURSOR_KEY)
    .maybeSingle();
  const n = Number(data?.value ?? 0);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

async function writeCursor(userId: string, value: number) {
  const existing = await supabase
    .from("app_settings")
    .select("id")
    .eq("user_id", userId)
    .eq("key", CURSOR_KEY)
    .maybeSingle();
  if (existing.data?.id) {
    await supabase.from("app_settings").update({ value: String(value) }).eq("id", existing.data.id);
  } else {
    await supabase.from("app_settings").insert({ user_id: userId, key: CURSOR_KEY, value: String(value) });
  }
}

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultCount?: number | null;
  onChange?: (items: PixItem[]) => void;
};

export default function PixListDialog({ open, onOpenChange, defaultCount, onChange }: Props) {
  const [phase, setPhase] = useState<"count" | "list">("count");
  const [count, setCount] = useState<string>("");
  const [allKeys, setAllKeys] = useState<PixItem[]>([]);
  const [items, setItems] = useState<PixItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPhase("count");
    setItems([]);
    setCopied(false);
    setCount(defaultCount && defaultCount > 0 ? String(defaultCount) : "");
    (async () => {
      setLoading(true);
      const { data: u } = await supabase.auth.getUser();
      setUserId(u.user?.id ?? null);
      const { data } = await supabase
        .from("chaves_pix")
        .select("id, banco, tipo_chave, chave, titular, ordem")
        .order("ordem", { ascending: true })
        .order("created_at", { ascending: true });
      const rows = (data ?? []) as DbRow[];
      setAllKeys(rows.map((r) => ({
        id: r.id, banco: r.banco, tipo_chave: r.tipo_chave,
        chave: r.chave, titular: r.titular,
      })));
      setLoading(false);
    })();
  }, [open, defaultCount]);

  const handleConfirmCount = async () => {
    const n = parseInt(count, 10);
    if (!n || n <= 0) { toast.error("Informe uma quantidade válida"); return; }
    if (allKeys.length === 0) { toast.error("Nenhuma chave Pix cadastrada"); return; }
    if (!userId) { toast.error("Não autenticado"); return; }
    const total = allKeys.length;
    const cursor = await readCursor(userId);
    const start = ((cursor % total) + total) % total;
    const picked: PixItem[] = [];
    for (let i = 0; i < n; i++) {
      picked.push(allKeys[(start + i) % total]);
    }
    const nextCursor = (start + n) % total;
    await writeCursor(userId, nextCursor);
    setItems(picked);
    onChange?.(picked);
    setPhase("list");
  };

  const replaceItem = (idx: number, newId: string) => {
    const found = allKeys.find((k) => k.id === newId);
    if (!found) return;
    setItems((prev) => {
      const next = prev.map((it, i) => (i === idx ? found : it));
      onChange?.(next);
      return next;
    });
  };

  const copyList = async () => {
    const text = items
      .map((it) => formatChaveValue(it.chave, it.tipo_chave))
      .filter(Boolean)
      .join("\n");
    if (!text) { toast.error("Lista vazia"); return; }
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch { ok = false; }
    if (!ok) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      try { ok = document.execCommand("copy"); } finally { document.body.removeChild(ta); }
    }
    if (!ok) { toast.error("Falha ao copiar"); return; }
    setCopied(true);
    toast.success(`${items.length} chave(s) copiada(s)`);
    setTimeout(() => setCopied(false), 1500);
  };

  const optionsByBanco = useMemo(() => {
    const groups = new Map<string, PixItem[]>();
    for (const k of allKeys) {
      const b = k.banco || "Sem banco";
      if (!groups.has(b)) groups.set(b, []);
      groups.get(b)!.push(k);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [allKeys]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="mx-auto w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center mb-1">
            <KeyRound className="w-5 h-5 text-primary" />
          </div>
          <DialogTitle className="text-center">
            {phase === "count" ? "Quantidade de contas" : "Chaves Pix da tarefa"}
          </DialogTitle>
          <DialogDescription className="text-center">
            {phase === "count"
              ? "Quantas contas serão usadas nesta tarefa?"
              : `${items.length} chave(s) selecionada(s) sequencialmente.`}
          </DialogDescription>
        </DialogHeader>

        {phase === "count" ? (
          <>
            <div className="space-y-1.5">
              <Label className="text-xs">Quantidade</Label>
              <Input
                type="number"
                min={1}
                value={count}
                onChange={(e) => setCount(e.target.value)}
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") handleConfirmCount(); }}
                placeholder="Ex: 5"
              />
              {loading && <p className="text-[10px] text-muted-foreground">Carregando chaves…</p>}
              {!loading && allKeys.length > 0 && (
                <p className="text-[10px] text-muted-foreground">
                  {allKeys.length} chave(s) disponíveis no total.
                </p>
              )}
            </div>
            <DialogFooter className="gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button
                className="bg-primary text-primary-foreground hover:bg-primary/90 font-bold"
                onClick={handleConfirmCount}
                disabled={loading}
              >
                Gerar lista
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
              {items.map((it, idx) => (
                <div key={`${it.id}-${idx}`} className="flex items-center gap-2 p-2 rounded-lg border border-border bg-card">
                  <div className="text-xs font-mono w-6 text-muted-foreground text-right">{idx + 1}.</div>
                  <div className="flex-1 min-w-0">
                    <Select value={it.id} onValueChange={(v) => replaceItem(idx, v)}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="max-h-[280px]">
                        {optionsByBanco.map(([banco, list]) => (
                          <div key={banco}>
                            <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                              {banco}
                            </div>
                            {list.map((k) => (
                              <SelectItem key={k.id} value={k.id} className="text-xs">
                                <span className="font-mono">{k.chave}</span>
                                <span className="text-muted-foreground"> · {k.tipo_chave}</span>
                                {k.titular && <span className="text-muted-foreground"> · {k.titular}</span>}
                              </SelectItem>
                            ))}
                          </div>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
                      <span className="font-bold text-foreground">{it.banco}</span> · {it.tipo_chave}
                      {it.titular && ` · ${it.titular}`} ·{" "}
                      <span className="font-mono">{formatChaveValue(it.chave, it.tipo_chave)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <DialogFooter className="gap-2">
              <Button variant="ghost" onClick={() => setPhase("count")} className="gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" /> Nova qtd
              </Button>
              <Button
                className="bg-emerald-500 text-emerald-950 hover:bg-emerald-500/90 font-bold gap-1.5"
                onClick={copyList}
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                Copiar lista
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
