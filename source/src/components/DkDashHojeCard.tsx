import { useEffect, useMemo, useState } from "react";
import { useDkDashLucros, type DkDashCiclo } from "@/hooks/useDkDashLucros";
import { formatBRL } from "@/lib/format";
import { ChevronLeft, ChevronRight, Loader2, Search, Pencil, Trash2, Tag, Percent, TrendingUp } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import LiquidoFlip from "@/components/LiquidoFlip";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { tierPctFor, loadFixedPromoRate, saveFixedPromoRate } from "@/lib/promoTiers";

const PROMO_KEY = "dkdash:promo-dates";
const NORMAL_RATE_KEY = "dkdash:normal-rate";
const DEFAULT_NORMAL_RATE = 0.20;
const PROMO_WINDOWS_KEY = "monitor_promo_windows";
function loadPromos(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(PROMO_KEY) || "[]")); }
  catch { return new Set(); }
}
function savePromos(s: Set<string>) {
  try { localStorage.setItem(PROMO_KEY, JSON.stringify([...s])); } catch {}
}
function loadNormalRate(): number {
  try {
    const v = Number(localStorage.getItem(NORMAL_RATE_KEY));
    if (Number.isFinite(v) && v > 0 && v < 1) return v;
  } catch {}
  return DEFAULT_NORMAL_RATE;
}
function saveNormalRate(v: number) {
  try { localStorage.setItem(NORMAL_RATE_KEY, String(v)); } catch {}
}
type PromoWindow = { start: string; end: string | null };
function loadPromoWindows(): PromoWindow[] {
  try {
    const raw = localStorage.getItem(PROMO_WINDOWS_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.filter((w) => w && typeof w.start === "string");
    }
    const oldActive = localStorage.getItem("monitor_promo_active") === "1";
    const oldAt = localStorage.getItem("monitor_promo_activated_at");
    if (oldAt) return [{ start: oldAt, end: oldActive ? null : new Date().toISOString() }];
  } catch {}
  return [];
}
// Faixas compartilhadas via @/lib/promoTiers
function promoTierPct(n: number | null | undefined): number | undefined {
  return tierPctFor(n);
}


import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";

// Mirror exato do DK Dash (montante.html): META = depósito × 0.84
const META_RATIO = 0.84;

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtLabel(dateKey: string) {
  if (dateKey === todayKey()) return "Hoje";
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y) return dateKey;
  return new Date(y, m - 1, d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmtHora(iso?: string) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

function shortName(s: string) {
  if (!s) return "—";
  return s.length > 28 ? s.slice(0, 28) + "…" : s;
}

type EditingCiclo = {
  ciclo: DkDashCiclo;
  nome: string;
  deposito: string;
  saque: string;
  blogueiro: string;
  bonusPerc: number;
};

export default function DkDashHojeCard({ showMontantes = true }: { showMontantes?: boolean } = {}) {
  const { dias, loading, reload } = useDkDashLucros();
  const [idx, setIdx] = useState(0);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<EditingCiclo | null>(null);
  const [deleting, setDeleting] = useState<DkDashCiclo | null>(null);
  const [busy, setBusy] = useState(false);

  const ordered = useMemo(() => [...dias].sort((a, b) => (a.data < b.data ? 1 : -1)), [dias]);
  const dia = ordered[idx];

  const ciclos = useMemo(() => {
    return [...(dia?.ciclos ?? [])].sort((a, b) => {
      const ta = a.data_criacao ? new Date(a.data_criacao).getTime() : 0;
      const tb = b.data_criacao ? new Date(b.data_criacao).getTime() : 0;
      return tb - ta;
    });
  }, [dia]);

  const [promoDates, setPromoDates] = useState<Set<string>>(() => loadPromos());
  const [normalRate, setNormalRate] = useState<number>(() => loadNormalRate());
  const [promoRate, setPromoRate] = useState<number>(() => loadFixedPromoRate());
  const [rateEditOpen, setRateEditOpen] = useState(false);
  const [rateInput, setRateInput] = useState<string>(() => (loadNormalRate() * 100).toString());
  const [promoRateEditOpen, setPromoRateEditOpen] = useState(false);
  const [promoRateInput, setPromoRateInput] = useState<string>(() => (loadFixedPromoRate() * 100).toString());
  const [promoWindows, setPromoWindows] = useState<PromoWindow[]>(() => loadPromoWindows());
  const isPromo = !!dia && promoDates.has(dia.data);
  const rate = isPromo ? promoRate : normalRate;
  const ratePct = `${(rate * 100).toFixed(rate * 100 % 1 === 0 ? 0 : 2)}%`;

  function isPromoFor(createdAt?: string | null) {
    if (!createdAt || promoWindows.length === 0) return false;
    const createdTs = new Date(createdAt).getTime();
    if (!Number.isFinite(createdTs)) return false;
    return promoWindows.some((w) => {
      const startTs = new Date(w.start).getTime();
      const endTs = w.end ? new Date(w.end).getTime() : Infinity;
      if (!Number.isFinite(startTs)) return false;
      return createdTs >= startTs && createdTs <= endTs;
    });
  }

  function resolveCiclo(c: DkDashCiclo) {
    const dep = Number(c.deposito ?? c.investido ?? 0);
    // Bônus de rollover (2.5x => 4% ; 3x => 10%) é aplicado SOBRE O DEPÓSITO e vira
    // "blogueiro extra" no DK Dash — soma no retorno, NÃO altera a % de comissão.
    const bonusPerc = Number((c as any).bonus_perc ?? 0);
    const bonusExtra = dep * (bonusPerc / 100);
    const criado = ((c as any).created_at || (c as any).data_criacao || (c as any).data_ciclo || null) as string | null;
    const tier = isPromoFor(criado) ? promoTierPct(dep) : undefined;
    if (tier != null) {
      return { effPct: tier, blog: dep * tier, dep, bonusPerc, bonusExtra };
    }
    if (isPromo && dep >= 400) {
      return { effPct: promoRate, blog: dep * promoRate, dep, bonusPerc, bonusExtra };
    }
    return { effPct: normalRate, blog: Number(c.blogueiro ?? 0), dep, bonusPerc, bonusExtra };
  }

  function togglePromo() {
    if (!dia) return;
    const next = new Set(promoDates);
    if (next.has(dia.data)) next.delete(dia.data);
    else next.add(dia.data);
    setPromoDates(next);
    savePromos(next);
  }

  function commitRate() {
    const v = Number(rateInput.replace(",", ".")) / 100;
    if (!Number.isFinite(v) || v <= 0 || v >= 1) {
      toast.error("Informe uma porcentagem entre 0 e 100.");
      return;
    }
    setNormalRate(v);
    saveNormalRate(v);
    setRateEditOpen(false);
    toast.success(`Taxa padrão definida em ${(v * 100).toFixed(2)}%`);
  }

  function commitPromoRate() {
    const v = Number(promoRateInput.replace(",", ".")) / 100;
    if (!Number.isFinite(v) || v <= 0 || v >= 1) {
      toast.error("Informe uma porcentagem entre 0 e 100.");
      return;
    }
    setPromoRate(v);
    saveFixedPromoRate(v);
    setPromoRateEditOpen(false);
    toast.success(`Taxa de promoção definida em ${(v * 100).toFixed(2)}%`);
  }

  // sync entre abas + evento local ao invés de polling
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === PROMO_KEY) setPromoDates(loadPromos());
      if (e.key === NORMAL_RATE_KEY) setNormalRate(loadNormalRate());
      if (e.key === "dkdash:promo-rate") setPromoRate(loadFixedPromoRate());
      if (e.key === PROMO_WINDOWS_KEY || e.key === "monitor_promo_active" || e.key === "monitor_promo_activated_at") {
        setPromoWindows(loadPromoWindows());
      }
    };
    const onFixedChange = () => setPromoRate(loadFixedPromoRate());
    const onPromoWindowsChange = () => {
      setPromoWindows((prev) => {
        const next = loadPromoWindows();
        return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
      });
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("promo-fixed-rate:changed", onFixedChange);
    window.addEventListener("promo-windows:changed", onPromoWindowsChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("promo-fixed-rate:changed", onFixedChange);
      window.removeEventListener("promo-windows:changed", onPromoWindowsChange);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ciclos;
    return ciclos.filter((c) => (c.nome_ciclo || "").toLowerCase().includes(q));
  }, [ciclos, query]);

  // Stats do dia. Taxa DK = blog * effPct. Retorno inclui bônus extra (rollover 2.5x/3x).
  const investido = ciclos.reduce((s, c) => s + Number(c.deposito ?? c.investido ?? 0), 0);
  const retornado = ciclos.reduce((s, c) => {
    const { blog, bonusExtra } = resolveCiclo(c);
    return s + Number(c.saque ?? 0) + blog + bonusExtra;
  }, 0);
  const comissao = ciclos.reduce((s, c) => {
    const { blog, effPct } = resolveCiclo(c);
    return s + blog * effPct;
  }, 0);
  const liquido = retornado - investido - comissao;




  async function handleDelete() {
    if (!deleting) return;
    const usuario_dono = String((deleting as any).usuario_dono || (deleting as any).usuario_id || "");
    const sk = String((deleting as any).sk || "");
    if (!usuario_dono || !sk) {
      toast.error("Ciclo sem identificador (sk).");
      setDeleting(null);
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("dkdash-lucros", {
        body: { action: "delete-ciclo", usuario_dono, sk },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Montante excluído.");
      setDeleting(null);
      window.dispatchEvent(new Event("dkdash-lucros:changed"));
      await reload();
    } catch (e: any) {
      toast.error(e?.message || "Falha ao excluir.");
    } finally {
      setBusy(false);
    }
  }

  async function handleEditSave() {
    if (!editing) return;
    const usuario_dono = String((editing.ciclo as any).usuario_dono || (editing.ciclo as any).usuario_id || "");
    const sk = String((editing.ciclo as any).sk || "");
    if (!usuario_dono || !sk) {
      toast.error("Ciclo sem identificador (sk).");
      return;
    }
    const nome = editing.nome.trim();
    if (!nome) { toast.error("Nome obrigatório."); return; }
    const deposito = Number(editing.deposito.replace(",", ".")) || 0;
    const saque = Number(editing.saque.replace(",", ".")) || 0;
    const blogueiro = Number(editing.blogueiro.replace(",", ".")) || 0;

    setBusy(true);
    try {
      // DK Dash não tem PUT — edição = delete + create
      const del = await supabase.functions.invoke("dkdash-lucros", {
        body: { action: "delete-ciclo", usuario_dono, sk },
      });
      if (del.error) throw del.error;
      if ((del.data as any)?.error) throw new Error((del.data as any).error);

      const cre = await supabase.functions.invoke("dkdash-lucros", {
        body: {
          action: "create-montante",
          nome,
          deposito,
          saque,
          blogueiro,
          qtd_contas: Number((editing.ciclo as any).qtd_contas || 1),
          bonus_perc: Number(editing.bonusPerc || 0),
        },
      });
      if (cre.error) throw cre.error;
      if ((cre.data as any)?.error) throw new Error((cre.data as any).error);

      toast.success("Montante atualizado.");
      setEditing(null);
      window.dispatchEvent(new Event("dkdash-lucros:changed"));
      await reload();
    } catch (e: any) {
      toast.error(e?.message || "Falha ao atualizar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 space-y-3">
      {/* Header: navegação + 4 stats */}
      <div className="rounded-xl border border-border bg-card/40 p-3 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-background/60 px-1 py-1">
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0"
            onClick={() => setIdx((i) => Math.min(ordered.length - 1, i + 1))}
            disabled={idx >= ordered.length - 1}>
            <ChevronLeft className="w-3.5 h-3.5" />
          </Button>
          <span className="text-xs font-semibold px-2 min-w-[88px] text-center">
            {dia ? fmtLabel(dia.data) : "—"}
          </span>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0"
            onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx <= 0}>
            <ChevronRight className="w-3.5 h-3.5" />
          </Button>
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <Button
              variant={isPromo ? "default" : "outline"}
              size="sm"
              className={`h-7 px-2.5 text-[11px] gap-1.5 ${isPromo ? "bg-fuchsia-500 hover:bg-fuchsia-600 text-white border-fuchsia-500" : ""}`}
              onClick={togglePromo}
              disabled={!dia}
              title={`Aplica ${(promoRate * 100).toFixed(promoRate * 100 % 1 === 0 ? 0 : 2)}% (blogueiro e taxa) apenas neste dia`}
            >
              <Tag className="w-3 h-3" />
              Promoção {(promoRate * 100).toFixed(promoRate * 100 % 1 === 0 ? 0 : 2)}%{isPromo ? " (ativa)" : ""}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              onClick={() => { setPromoRateInput((promoRate * 100).toString()); setPromoRateEditOpen(true); }}
              title="Editar % da promoção"
            >
              <Pencil className="w-3 h-3" />
            </Button>
          </div>

          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2.5 text-[11px] gap-1.5"
            onClick={() => { setRateInput((normalRate * 100).toString()); setRateEditOpen(true); }}
            title="Altera a taxa padrão (aplicada a todo o histórico, exceto dias com promoção)"
          >
            <Percent className="w-3 h-3" />
            Taxa padrão {(normalRate * 100).toFixed(normalRate * 100 % 1 === 0 ? 0 : 2)}%
          </Button>
        </div>




        <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-2 min-w-[260px]">
          <StatBox label="INVESTIDO" value={investido} tone="text-sky-400" border="border-sky-500/40" />
          <StatBox label="RETORNADO" value={retornado} tone="text-amber-400" border="border-amber-500/40" />
          <StatBox label="COMISSÃO" value={comissao} tone="text-fuchsia-300" border="border-fuchsia-500/40" />
          <StatBoxLiquido
            label="LÍQUIDO"
            liquido={liquido}
            bruto={retornado - investido}
            tone={liquido >= 0 ? "text-emerald-400" : "text-red-400"}
            border={liquido >= 0 ? "border-emerald-500/40" : "border-red-500/40"}
          />
        </div>

        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
      </div>

      {showMontantes && (
      <>
      {/* Tabela: Montantes do Dia */}
      <div className="rounded-xl border border-border bg-card/40 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border/60 flex-wrap">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold">Montantes do Dia</h3>
            <span className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full bg-sky-500/20 text-sky-300 text-[11px] font-semibold">
              {ciclos.length}
            </span>
          </div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nome..."
              className="h-8 pl-7 w-[220px] text-xs bg-background/60" />
          </div>
        </div>

        {ciclos.length === 0 ? (
          <p className="text-xs text-muted-foreground px-4 py-6 text-center">Sem ciclos registrados.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="text-left font-medium px-4 py-2">Hora</th>
                  <th className="text-left font-medium px-3 py-2">Nome</th>
                  <th className="text-right font-medium px-3 py-2">Depósito</th>
                  <th className="text-right font-medium px-3 py-2">Saque</th>
                  <th className="text-right font-medium px-3 py-2">Blogueiro</th>
                  <th className="text-right font-medium px-3 py-2">Líquido</th>
                  <th className="text-right font-medium px-3 py-2">% Aplicada</th>
                  <th className="text-right font-medium px-3 py-2 pr-4">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, i) => {
                  const saque = Number(c.saque ?? 0);
                  const { dep, blog, effPct, bonusPerc, bonusExtra } = resolveCiclo(c);
                  const taxa = blog * effPct;
                  const liq = saque + blog + bonusExtra - dep - taxa;



                  const meta = dep * META_RATIO;
                  const sk = String((c as any).sk || "");

                  return (
                    <tr key={sk || `${c.nome_ciclo}-${i}`} className="border-t border-border/40 hover:bg-muted/20">
                      <td className="px-4 py-3 text-muted-foreground tabular-nums align-top">{fmtHora(c.data_criacao)}</td>
                      <td className="px-3 py-3 font-medium max-w-[220px] truncate align-top" title={c.nome_ciclo || ""}>
                        {shortName(c.nome_ciclo || "—")}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-sky-400 font-semibold align-top">{formatBRL(dep)}</td>
                      <td className="px-3 py-3 text-right tabular-nums align-top">
                        <div className="text-amber-400 font-semibold">{formatBRL(saque)}</div>
                        <div className="text-[9px] uppercase tracking-wider text-muted-foreground/70">META: {formatBRL(meta)}</div>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-sky-400 align-top">
                        <div>{formatBRL(blog)}</div>
                        {bonusExtra > 0 && (
                          <div className="text-[9px] font-bold text-fuchsia-300">+{formatBRL(bonusExtra)}</div>
                        )}
                      </td>
                      <td className={`px-3 py-3 text-right tabular-nums font-semibold align-top ${liq >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {liq < 0 ? "-" : ""}{formatBRL(Math.abs(liq))}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums align-top">
                        {(() => {
                          const pctNum = effPct * 100;
                          const isPromoRow = !bonusPerc && pctNum < normalRate * 100;
                          const pctLabel = `${pctNum.toFixed(pctNum % 1 === 0 ? 0 : 2)}%`;
                          const rolloverLabel = bonusPerc === 10 ? "3x" : bonusPerc === 4 ? "2.5x" : bonusPerc ? `+${bonusPerc}%` : null;
                          return (
                            <div className="flex flex-col items-end leading-tight">
                              {bonusPerc > 0 ? (
                                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${bonusPerc >= 10 ? "bg-fuchsia-500/20 text-fuchsia-300" : "bg-amber-500/20 text-amber-300"}`}>
                                  <TrendingUp className="w-2.5 h-2.5" />
                                  {rolloverLabel}
                                </span>
                              ) : null}
                              {isPromoRow ? (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 text-[10px] font-semibold">
                                  <TrendingUp className="w-2.5 h-2.5" />
                                  {pctLabel}
                                </span>
                              ) : (
                                <span className="text-[10px] font-semibold text-muted-foreground">{pctLabel}</span>
                              )}
                              <span className="text-fuchsia-300 font-semibold mt-0.5">{formatBRL(taxa)}</span>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-3 pr-4 align-top">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-sky-400 hover:text-sky-300"
                            onClick={() => setEditing({
                              ciclo: c,
                              nome: c.nome_ciclo || "",
                              deposito: String(dep),
                              saque: String(saque),
                              blogueiro: String(blog),
                              bonusPerc: Number((c as any).bonus_perc ?? 0),
                            })}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-400 hover:text-red-300"
                            onClick={() => setDeleting(c)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </>
      )}

      {/* Editar */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar Montante</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Nome</Label>
                <Input value={editing.nome} onChange={(e) => setEditing({ ...editing, nome: e.target.value })} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-xs">Depósito</Label>
                  <Input inputMode="decimal" value={editing.deposito}
                    onChange={(e) => setEditing({ ...editing, deposito: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">Saque</Label>
                  <Input inputMode="decimal" value={editing.saque}
                    onChange={(e) => setEditing({ ...editing, saque: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">Blogueiro</Label>
                  <Input inputMode="decimal" value={editing.blogueiro}
                    onChange={(e) => setEditing({ ...editing, blogueiro: e.target.value })} />
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">
                A edição é feita removendo o ciclo anterior e recriando com os novos valores no DK Dash.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={busy}>Cancelar</Button>
            <Button onClick={handleEditSave} disabled={busy}>
              {busy && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Editar taxa padrão */}
      <Dialog open={rateEditOpen} onOpenChange={setRateEditOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Taxa padrão DK</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">Porcentagem (%)</Label>
            <Input
              inputMode="decimal"
              value={rateInput}
              onChange={(e) => setRateInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") commitRate(); }}
              placeholder="20"
              autoFocus
            />
            <p className="text-[10px] text-muted-foreground">
              Aplica em todo o histórico. Dias marcados com Promoção continuam em 17%.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRateEditOpen(false)}>Cancelar</Button>
            <Button onClick={commitRate}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Editar % da promoção fixa (botão "Promoção XX%") */}
      <Dialog open={promoRateEditOpen} onOpenChange={setPromoRateEditOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>% da Promoção</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">Porcentagem (%)</Label>
            <Input
              inputMode="decimal"
              value={promoRateInput}
              onChange={(e) => setPromoRateInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") commitPromoRate(); }}
              placeholder="17"
              autoFocus
            />
            <p className="text-[10px] text-muted-foreground">
              Aplicada nos dias marcados como Promoção (regras inalteradas, só muda a %).
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPromoRateEditOpen(false)}>Cancelar</Button>
            <Button onClick={commitPromoRate}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* Excluir */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir montante?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.nome_ciclo
                ? <>O montante <strong>{deleting.nome_ciclo}</strong> será removido do DK Dash. Esta ação não pode ser desfeita.</>
                : "Este montante será removido do DK Dash."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={busy}
              className="bg-red-500 hover:bg-red-600 text-white">
              {busy && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function StatBox({ label, value, tone, border }: { label: string; value: number; tone: string; border: string }) {
  return (
    <div className={`rounded-lg border ${border} bg-background/40 px-3 py-2 flex flex-col justify-center`}>
      <p className="text-[9px] font-bold tracking-[0.15em] text-muted-foreground">{label}</p>
      <p className={`text-sm font-bold tabular-nums ${tone}`}>{formatBRL(value)}</p>
    </div>
  );
}

function StatBoxLiquido({ label, liquido, bruto, tone, border }: { label: string; liquido: number; bruto: number; tone: string; border: string }) {
  return (
    <div className={`rounded-lg border ${border} bg-background/40 px-3 py-2 flex flex-col justify-center`}>
      <LiquidoFlip
        liquido={liquido}
        bruto={bruto}
        format={formatBRL}
        valueClassName={`text-sm font-bold tabular-nums ${tone}`}
        liquidoLabel={label}
        brutoLabel="BRUTO"
        showLabel
      />
    </div>
  );
}
