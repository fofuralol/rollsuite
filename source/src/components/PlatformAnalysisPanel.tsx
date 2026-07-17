import React, { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, RefreshCw, Tag, Loader2, Globe, ArrowUpDown, Wand2, Trash2, Pencil } from "lucide-react";
import { useDkDashLucros } from "@/hooks/useDkDashLucros";
import { usePlatformMappings } from "@/hooks/usePlatformMappings";
import { normalizeUrl, extractHost } from "@/lib/platformUrl";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import RenameGroupDialog from "@/components/RenameGroupDialog";

type Periodo = "hoje" | "7d" | "30d" | "mes" | "tudo" | "custom";
type SortBy = "lucro" | "roi" | "retencao" | "ciclos" | "investido" | "margem";

const UNASSIGNED = "__unassigned__";

// Detecta se o host contém o nome de algum grupo já cadastrado.
// Usa bordas não-alfanuméricas (ou início/fim) pra evitar falso positivo
// tipo "w1" casando dentro de "w10". Se casar múltiplos, prefere o mais longo.
function matchPlatformName(host: string, names: string[]): string {
  const h = String(host || "").toLowerCase();
  if (!h) return "";
  let best = "";
  for (const name of names) {
    const n = String(name || "").toLowerCase().trim();
    if (!n) continue;
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, "i");
    if (re.test(h) && n.length > best.length) best = name;
  }
  return best;
}

function fmtBRL(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtPct(n: number) {
  if (!isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function periodRange(p: Periodo, customFrom?: string, customTo?: string): [number | undefined, number | undefined] {
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  if (p === "hoje") return [startOfDay(now), endOfDay(now)];
  if (p === "7d") return [startOfDay(new Date(now.getTime() - 6 * 86400000)), endOfDay(now)];
  if (p === "30d") return [startOfDay(new Date(now.getTime() - 29 * 86400000)), endOfDay(now)];
  if (p === "mes") return [new Date(now.getFullYear(), now.getMonth(), 1).getTime(), endOfDay(now)];
  if (p === "custom") {
    const f = customFrom ? new Date(customFrom + "T00:00:00").getTime() : undefined;
    const t = customTo ? new Date(customTo + "T23:59:59").getTime() : undefined;
    return [f, t];
  }
  return [undefined, undefined];
}

type CicloItem = {
  data: string;
  nome_ciclo: string;
  lucro: number;
  investido: number;
  saque: number;
  retorno: number;
  taxa_dk: number;
  blogueiro: number;
};

type UrlBucket = {
  url_norm: string;
  url_display: string;
  ciclos: number;
  lucro: number;
  investido: number;
  saque: number;
  retorno: number;
  taxa_dk: number;
  blogueiro: number;
  items: CicloItem[];
};

type PlatformBucket = {
  platform: string; // "" = não classificada
  display: string;
  urls: UrlBucket[];
  ciclos: number;
  lucro: number;
  investido: number;
  saque: number;
  retorno: number;
  taxa_dk: number;
  blogueiro: number;
};

export default function PlatformAnalysisPanel() {
  const { dias, loading, reload } = useDkDashLucros();
  const { lookup, setMapping, bulkAssign, deleteGroup, renameGroup, platformNames } = usePlatformMappings();

  const [periodo, setPeriodo] = useState<Periodo>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [groupMode, setGroupMode] = useState<"url" | "host">("host");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [minCiclos, setMinCiclos] = useState<number>(5);
  const [sortBy, setSortBy] = useState<SortBy>("lucro");
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [expandedUrls, setExpandedUrls] = useState<Set<string>>(new Set());
  const toggleUrl = (key: string) => {
    setExpandedUrls((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });
  };


  const retencao = (p: PlatformBucket | UrlBucket) => {
    const margem = p.blogueiro - p.taxa_dk;
    if (margem <= 0) return 0;
    return (p.lucro - p.taxa_dk) / margem;
  };

  const [from, to] = periodRange(periodo, customFrom, customTo);

  const platforms = useMemo<PlatformBucket[]>(() => {
    const urlMap = new Map<string, UrlBucket>();
    for (const d of dias) {
      const [y, m, day] = d.data.split("-").map(Number);
      const ts = (y && m && day) ? new Date(y, m - 1, day).getTime() : 0;
      if (from !== undefined && ts < from) continue;
      if (to !== undefined && ts >= to) continue;
      for (const c of d.ciclos || []) {
        const raw = String((c as any).nome_ciclo || "").trim();
        if (!raw) continue;
        const norm = groupMode === "host" ? extractHost(raw) : normalizeUrl(raw);
        if (!norm) continue;
        let b = urlMap.get(norm);
        if (!b) {
          b = { url_norm: norm, url_display: norm, ciclos: 0, lucro: 0, investido: 0, saque: 0, retorno: 0, taxa_dk: 0, blogueiro: 0, items: [] };
          urlMap.set(norm, b);
        }
        const lucro = Number((c as any).lucro || 0);
        const investido = Number((c as any).investido || 0);
        const saque = Number((c as any).saque || 0);
        const retorno = Number((c as any).retorno || 0);
        const taxa_dk = Number((c as any).taxa_dk || 0);
        const blogueiro = Number((c as any).blogueiro || 0);
        b.ciclos += 1;
        b.lucro += lucro;
        b.investido += investido;
        b.saque += saque;
        b.retorno += retorno;
        b.taxa_dk += taxa_dk;
        b.blogueiro += blogueiro;
        b.items.push({
          data: d.data,
          nome_ciclo: raw,
          lucro, investido, saque, retorno, taxa_dk, blogueiro,
        });
      }
    }
    const platMap = new Map<string, PlatformBucket>();
    for (const u of urlMap.values()) {
      const platName = lookup(u.url_norm);
      const key = platName || UNASSIGNED;
      let p = platMap.get(key);
      if (!p) {
        p = {
          platform: platName,
          display: platName || "Sem grupo definido",
          urls: [],
          ciclos: 0, lucro: 0, investido: 0, saque: 0, retorno: 0, taxa_dk: 0, blogueiro: 0,
        };
        platMap.set(key, p);
      }
      p.urls.push(u);
      p.ciclos += u.ciclos;
      p.lucro += u.lucro;
      p.investido += u.investido;
      p.saque += u.saque;
      p.retorno += u.retorno;
      p.taxa_dk += u.taxa_dk;
      p.blogueiro += u.blogueiro;
    }
    const arr = Array.from(platMap.values());
    arr.forEach((p) => p.urls.sort((a, b) => b.lucro - a.lucro));
    arr.sort((a, b) => {
      const aUn = !a.platform;
      const bUn = !b.platform;
      if (aUn && !bUn) return -1;
      if (!aUn && bUn) return 1;
      switch (sortBy) {
        case "lucro": return (b.lucro - b.taxa_dk) - (a.lucro - a.taxa_dk);
        case "roi": {
          const aRoi = a.investido > 0 ? (a.lucro - a.taxa_dk) / a.investido : -Infinity;
          const bRoi = b.investido > 0 ? (b.lucro - b.taxa_dk) / b.investido : -Infinity;
          return bRoi - aRoi;
        }
        case "retencao": return retencao(b) - retencao(a);
        case "ciclos": return b.ciclos - a.ciclos;
        case "investido": return b.investido - a.investido;
        case "margem": {
          const aMargem = a.blogueiro - a.taxa_dk;
          const bMargem = b.blogueiro - b.taxa_dk;
          return bMargem - aMargem;
        }
        default: return 0;
      }
    });
    return arr;
  }, [dias, from, to, groupMode, lookup, sortBy]);

  const totals = useMemo(() => {
    return platforms.reduce(
      (acc, p) => ({
        ciclos: acc.ciclos + p.ciclos,
        lucro: acc.lucro + p.lucro,
        investido: acc.investido + p.investido,
        taxa_dk: acc.taxa_dk + p.taxa_dk,
      }),
      { ciclos: 0, lucro: 0, investido: 0, taxa_dk: 0 }
    );
  }, [platforms]);

  const classificados = platforms.filter((p) => p.platform);
  const elegiveis = classificados.filter((p) => p.ciclos >= minCiclos);
  const maisLucrativo = classificados.slice().sort((a, b) => (b.lucro - b.taxa_dk) - (a.lucro - a.taxa_dk))[0];
  const melhorRoi = elegiveis
    .filter((p) => p.investido > 0)
    .slice()
    .sort((a, b) => ((b.lucro - b.taxa_dk) / b.investido) - ((a.lucro - a.taxa_dk) / a.investido))[0];
  const maisSegura = elegiveis
    .filter((p) => p.blogueiro - p.taxa_dk > 0)
    .slice()
    .sort((a, b) => retencao(b) - retencao(a))[0];

  const toggle = (key: string) => {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try { await reload(); }
    finally { setRefreshing(false); }
  };

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Período</span>
            <Select value={periodo} onValueChange={(v) => setPeriodo(v as Periodo)}>
              <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="hoje">Hoje</SelectItem>
                <SelectItem value="7d">Últimos 7 dias</SelectItem>
                <SelectItem value="30d">Últimos 30 dias</SelectItem>
                <SelectItem value="mes">Mês atual</SelectItem>
                <SelectItem value="tudo">Tudo</SelectItem>
                <SelectItem value="custom">Personalizado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {periodo === "custom" && (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">De</span>
                <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-8 w-[140px] text-xs" />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Até</span>
                <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-8 w-[140px] text-xs" />
              </div>
            </>
          )}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Agrupar por</span>
            <Select value={groupMode} onValueChange={(v) => setGroupMode(v as "url" | "host")}>
              <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="host">Domínio (recomendado)</SelectItem>
                <SelectItem value="url">URL completa</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Mín. ciclos (ROI)</span>
            <Input
              type="number"
              min={1}
              value={minCiclos}
              onChange={(e) => setMinCiclos(Math.max(1, Number(e.target.value) || 1))}
              className="h-8 w-[90px] text-xs"
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Ordenar por</span>
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
              <SelectTrigger className="h-8 w-[160px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="lucro">Lucro líquido</SelectItem>
                <SelectItem value="roi">ROI</SelectItem>
                <SelectItem value="retencao">Retenção</SelectItem>
                <SelectItem value="ciclos">Ciclos</SelectItem>
                <SelectItem value="investido">Investido</SelectItem>
                <SelectItem value="margem">Margem blogueiro</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleRefresh} disabled={refreshing || loading} className="h-8 gap-1.5">
              {(refreshing || loading) ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Atualizar
            </Button>
          </div>
        </div>
      </Card>

      {/* Resumo */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <SummaryCard label="Lucro total" value={fmtBRL(totals.lucro - totals.taxa_dk)} accent={totals.lucro - totals.taxa_dk >= 0 ? "good" : "bad"} sub={`bruto ${fmtBRL(totals.lucro)} · taxa ${fmtBRL(totals.taxa_dk)}`} />
        <SummaryCard label="Investido" value={fmtBRL(totals.investido)} sub={`${totals.ciclos} ciclos`} />
        <SummaryCard
          label="Mais lucrativo"
          value={maisLucrativo?.display || "—"}
          sub={maisLucrativo ? `${fmtBRL(maisLucrativo.lucro - maisLucrativo.taxa_dk)} · ${maisLucrativo.ciclos} ciclos` : ""}
          accent={maisLucrativo ? "good" : "neutral"}
        />
        <SummaryCard
          label={`Melhor ROI (≥${minCiclos} ciclos)`}
          value={melhorRoi?.display || "—"}
          sub={melhorRoi ? `ROI ${fmtPct((melhorRoi.lucro - melhorRoi.taxa_dk) / melhorRoi.investido)} · ${fmtBRL(melhorRoi.lucro - melhorRoi.taxa_dk)}` : "—"}
          accent={melhorRoi ? "good" : "neutral"}
        />
        <SummaryCard
          label={`Mais segura (≥${minCiclos} ciclos)`}
          value={maisSegura?.display || "—"}
          sub={maisSegura ? `retém ${fmtPct(retencao(maisSegura))} da margem · ${fmtBRL(maisSegura.blogueiro - maisSegura.taxa_dk)} disp.` : "—"}
          accent={maisSegura ? "good" : "neutral"}
        />
      </div>

      {/* Lista de plataformas */}
      <Card className="overflow-hidden">
        <div className="px-3 py-2 border-b border-border/60 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Por grupo</h3>
          <span className="text-[10px] text-muted-foreground">{platforms.length} grupo(s)</span>
        </div>
        {platforms.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">Nenhum ciclo no período selecionado.</div>
        ) : (
          <div className="divide-y divide-border/60">
            {platforms.map((p) => {
              const liquido = p.lucro - p.taxa_dk;
              const roi = p.investido > 0 ? liquido / p.investido : 0;
              const key = p.platform || UNASSIGNED;
              const isOpen = expanded.has(key) || !p.platform;
              const isUnassigned = !p.platform;
              return (
                <div key={key} className={cn("transition-colors", isUnassigned && "bg-amber-500/5")}>
                  <button
                    type="button"
                    onClick={() => toggle(key)}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent/40 text-left"
                  >
                    {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={cn("text-sm font-medium truncate", isUnassigned && "text-amber-500")}>{p.display}</span>
                        <Badge variant="secondary" className="h-4 text-[10px]">{p.urls.length} plataforma(s)</Badge>
                        <Badge variant="secondary" className="h-4 text-[10px]">{p.ciclos} ciclo(s)</Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <div className="text-right">
                        <div className={cn("text-sm font-semibold tabular-nums", liquido >= 0 ? "text-emerald-400" : "text-red-400")}>
                          {fmtBRL(liquido)}
                        </div>
                        <div className="text-[10px] text-muted-foreground tabular-nums">
                          ROI {fmtPct(roi)} · Retém {p.blogueiro - p.taxa_dk > 0 ? fmtPct(retencao(p)) : "—"}
                        </div>
                      </div>
                      {!isUnassigned && (
                        <>
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation();
                              setRenameTarget(p.platform || "");
                            }}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}
                            className="p-1.5 rounded hover:bg-primary/15 text-muted-foreground hover:text-primary transition-colors cursor-pointer"
                            title="Renomear grupo"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </span>
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!confirm(`Desfazer grupo "${p.display}"? As ${p.urls.length} plataforma(s) voltam para "Sem grupo".`)) return;
                              deleteGroup(p.platform!).then(() => toast.success(`Grupo "${p.display}" desfeito`)).catch((err: Error) => toast.error(err.message || "Falha"));
                            }}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}
                            className="p-1.5 rounded hover:bg-destructive/15 text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
                            title="Desfazer grupo"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </span>
                        </>
                      )}
                    </div>
                  </button>

                  {isOpen && (
                    <div className="px-3 pb-3 pl-9 space-y-2">
                      {isUnassigned && (
                        <p className="text-[11px] text-amber-500/80">
                          Defina o nome do grupo responsável por essas plataformas. O nome fica salvo e é aplicado automaticamente em ciclos futuros com a mesma URL.
                        </p>
                      )}
                      {isUnassigned && (
                        <AutoAssignByHostBar
                          urls={p.urls.map((u) => ({ url_norm: u.url_norm, url_display: u.url_display }))}
                          platformNames={platformNames}
                          onApply={async (byName) => {
                            const entries = Object.entries(byName);
                            for (const [name, list] of entries) {
                              await bulkAssign(list, name);
                            }
                            const total = entries.reduce((n, [, l]) => n + l.length, 0);
                            toast.success(`${total} plataforma(s) atribuídas automaticamente em ${entries.length} grupo(s)`);
                          }}
                        />
                      )}
                      {isUnassigned && (
                        <AutoDetectByFetchBar
                          urls={p.urls.map((u) => ({ url_norm: u.url_norm, url_display: u.url_display }))}
                          platformNames={platformNames}
                          onApply={async (byName) => {
                            const entries = Object.entries(byName);
                            for (const [name, list] of entries) {
                              await bulkAssign(list, name);
                            }
                            const total = entries.reduce((n, [, l]) => n + l.length, 0);
                            toast.success(`${total} plataforma(s) atribuídas via inspeção do site em ${entries.length} grupo(s)`);
                          }}
                        />
                      )}
                      <div className="rounded border border-border/60 overflow-hidden">
                        <table className="w-full text-xs">
                          <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                            <tr>
                              <th className="text-left px-2 py-1.5 font-medium">Plataforma (URL)</th>
                              <th className="text-right px-2 py-1.5 font-medium">Ciclos</th>
                              <th className="text-right px-2 py-1.5 font-medium">Investido</th>
                              <th className="text-right px-2 py-1.5 font-medium" title="blogueiro − taxa DK">Margem</th>
                              <th className="text-right px-2 py-1.5 font-medium">Líquido</th>
                              <th className="text-right px-2 py-1.5 font-medium" title="% da margem que sobreviveu à banca">Retém</th>
                              <th className="text-left px-2 py-1.5 font-medium w-[220px]">Grupo</th>
                            </tr>
                          </thead>
                          <tbody>
                            {p.urls.map((u) => {
                              const uliq = u.lucro - u.taxa_dk;
                              const umargem = u.blogueiro - u.taxa_dk;
                              const uret = umargem > 0 ? uliq / umargem : null;
                              const urlKey = `${key}::${u.url_norm}`;
                              const urlOpen = expandedUrls.has(urlKey);
                              const hasMulti = u.items.length > 1;
                              return (
                                <React.Fragment key={u.url_norm}>
                                <tr className="border-t border-border/40">
                                  <td className="px-2 py-1.5 max-w-[260px]">
                                    <div className="flex items-center gap-1 min-w-0">
                                      {hasMulti ? (
                                        <button
                                          type="button"
                                          onClick={() => toggleUrl(urlKey)}
                                          className="shrink-0 p-0.5 rounded hover:bg-accent/40"
                                          title={urlOpen ? "Recolher ciclos" : "Ver ciclos individuais"}
                                        >
                                          {urlOpen
                                            ? <ChevronDown className="h-3 w-3 text-muted-foreground" />
                                            : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                                        </button>
                                      ) : (
                                        <span className="inline-block w-4 shrink-0" />
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const api = (window as any).electronAPI;
                                          if (api?.openUrl) api.openUrl(u.url_display);
                                          else {
                                            const href = /^https?:\/\//i.test(u.url_display) ? u.url_display : `https://${u.url_display}`;
                                            window.open(href, "_blank", "noopener,noreferrer");
                                          }
                                        }}
                                        className="flex items-center gap-1.5 min-w-0 hover:text-primary hover:underline text-left flex-1"
                                        title={`Abrir ${u.url_display}`}
                                      >
                                        <Globe className="h-3 w-3 text-muted-foreground shrink-0" />
                                        <span className="truncate">{u.url_display}</span>
                                      </button>
                                    </div>
                                  </td>
                                  <td className="px-2 py-1.5 text-right tabular-nums">{u.ciclos}</td>
                                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtBRL(u.investido)}</td>
                                  <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground" title={`blogueiro ${fmtBRL(u.blogueiro)} − taxa ${fmtBRL(u.taxa_dk)}`}>{fmtBRL(umargem)}</td>
                                  <td className={cn("px-2 py-1.5 text-right tabular-nums font-medium", uliq >= 0 ? "text-emerald-400" : "text-red-400")}>{fmtBRL(uliq)}</td>
                                  <td className={cn("px-2 py-1.5 text-right tabular-nums font-medium", uret == null ? "text-muted-foreground" : uret >= 1 ? "text-emerald-400" : uret >= 0.5 ? "text-amber-400" : "text-red-400")}>
                                    {uret == null ? "—" : fmtPct(uret)}
                                  </td>
                                  <td className="px-2 py-1.5">
                                    <PlatformNameInput
                                      currentName={lookup(u.url_norm)}
                                      suggestions={platformNames}
                                      onSave={async (name) => {
                                        await setMapping(u.url_norm, name);
                                        toast.success(name ? `"${u.url_display}" → ${name}` : "Removido");
                                      }}
                                    />
                                  </td>
                                </tr>
                                {urlOpen && u.items.map((it, i) => {
                                  const iliq = it.lucro - it.taxa_dk;
                                  const imargem = it.blogueiro - it.taxa_dk;
                                  const iret = imargem > 0 ? iliq / imargem : null;
                                  return (
                                    <tr key={u.url_norm + "::" + i} className="border-t border-border/30 bg-muted/20">
                                      <td className="px-2 py-1 pl-8 text-[11px] text-muted-foreground">
                                        <span className="tabular-nums mr-2">{it.data}</span>
                                        <span className="truncate">{it.nome_ciclo}</span>
                                      </td>
                                      <td className="px-2 py-1 text-right tabular-nums text-[11px] text-muted-foreground">1</td>
                                      <td className="px-2 py-1 text-right tabular-nums text-[11px]">{fmtBRL(it.investido)}</td>
                                      <td className="px-2 py-1 text-right tabular-nums text-[11px] text-muted-foreground" title={`blogueiro ${fmtBRL(it.blogueiro)} − taxa ${fmtBRL(it.taxa_dk)}`}>{fmtBRL(imargem)}</td>
                                      <td className={cn("px-2 py-1 text-right tabular-nums text-[11px] font-medium", iliq >= 0 ? "text-emerald-400" : "text-red-400")}>{fmtBRL(iliq)}</td>
                                      <td className={cn("px-2 py-1 text-right tabular-nums text-[11px] font-medium", iret == null ? "text-muted-foreground" : iret >= 1 ? "text-emerald-400" : iret >= 0.5 ? "text-amber-400" : "text-red-400")}>
                                        {iret == null ? "—" : fmtPct(iret)}
                                      </td>
                                      <td className="px-2 py-1"></td>
                                    </tr>
                                  );
                                })}
                                </React.Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      {isUnassigned && p.urls.length > 1 && (
                        <BulkAssignBar
                          urls={p.urls.map((u) => u.url_norm)}
                          suggestions={platformNames}
                          onApply={async (name) => {
                            await bulkAssign(p.urls.map((u) => u.url_norm), name);
                            toast.success(`${p.urls.length} plataforma(s) atribuídas ao grupo "${name}"`);
                          }}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
      <RenameGroupDialog
        open={renameTarget !== null}
        onOpenChange={(v) => { if (!v) setRenameTarget(null); }}
        currentName={renameTarget || ""}
        onConfirm={(to) => {
          const from = renameTarget;
          if (!from) return;
          renameGroup(from, to)
            .then(() => toast.success(`Grupo renomeado para "${to}"`))
            .catch((err: Error) => toast.error(err.message || "Falha"));
        }}
      />
    </div>
  );
}

function SummaryCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: "good" | "bad" | "neutral" }) {
  return (
    <Card className="p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn(
        "text-base font-semibold mt-1 truncate tabular-nums",
        accent === "good" && "text-emerald-400",
        accent === "bad" && "text-red-400"
      )} title={value}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5 truncate" title={sub}>{sub}</div>}
    </Card>
  );
}

function PlatformNameInput({ currentName, suggestions, onSave }: { currentName: string; suggestions: string[]; onSave: (name: string) => Promise<void> }) {
  const [val, setVal] = useState(currentName);
  const [saving, setSaving] = useState(false);
  const listId = useMemo(() => "pl-" + Math.random().toString(36).slice(2, 8), []);
  const dirty = val.trim() !== currentName.trim();
  const handleSave = async () => {
    if (!dirty) return;
    setSaving(true);
    try { await onSave(val.trim()); } finally { setSaving(false); }
  };
  return (
    <div className="flex items-center gap-1">
      <Input
        list={listId}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={handleSave}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        placeholder="Nome do grupo"
        className="h-7 text-xs"
        disabled={saving}
      />
      <datalist id={listId}>
        {suggestions.map((s) => <option key={s} value={s} />)}
      </datalist>
    </div>
  );
}

function BulkAssignBar({ urls, suggestions, onApply }: { urls: string[]; suggestions: string[]; onApply: (name: string) => Promise<void> }) {
  const [val, setVal] = useState("");
  const [saving, setSaving] = useState(false);
  const listId = useMemo(() => "blk-" + Math.random().toString(36).slice(2, 8), []);
  const apply = async () => {
    const name = val.trim();
    if (!name) return;
    setSaving(true);
    try { await onApply(name); setVal(""); } finally { setSaving(false); }
  };
  return (
    <div className="flex items-center gap-2 pt-1">
      <Tag className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-[11px] text-muted-foreground">Atribuir as {urls.length} plataformas ao grupo:</span>
      <Input
        list={listId}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") apply(); }}
        placeholder="Nome do grupo"
        className="h-7 text-xs max-w-[200px]"
        disabled={saving}
      />
      <datalist id={listId}>
        {suggestions.map((s) => <option key={s} value={s} />)}
      </datalist>
      <Button size="sm" className="h-7 text-xs" onClick={apply} disabled={saving || !val.trim()}>Aplicar</Button>
    </div>
  );
}

function AutoAssignByHostBar({
  urls,
  platformNames,
  onApply,
}: {
  urls: { url_norm: string; url_display: string }[];
  platformNames: string[];
  onApply: (byName: Record<string, string[]>) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const suggestions = useMemo(() => {
    const byName: Record<string, string[]> = {};
    for (const u of urls) {
      const host = u.url_display || u.url_norm;
      const name = matchPlatformName(host, platformNames);
      if (!name) continue;
      (byName[name] ||= []).push(u.url_norm);
    }
    return byName;
  }, [urls, platformNames]);
  const names = Object.keys(suggestions);
  const total = names.reduce((n, k) => n + suggestions[k].length, 0);
  if (total === 0) return null;
  const apply = async () => {
    setSaving(true);
    try { await onApply(suggestions); } finally { setSaving(false); }
  };
  return (
    <div className="flex items-center gap-2 rounded border border-emerald-500/40 bg-emerald-500/5 px-2 py-1.5">
      <Wand2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
      <span className="text-[11px] text-emerald-300 flex-1">
        Detectei <b>{total}</b> plataforma(s) que casam com <b>{names.length}</b> grupo(s) existente(s) pelo nome no domínio ({names.slice(0, 4).join(", ")}{names.length > 4 ? "…" : ""}).
      </span>
      <Button
        size="sm"
        className="h-7 text-xs bg-emerald-600 hover:bg-emerald-500"
        onClick={apply}
        disabled={saving}
      >
        {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Wand2 className="h-3 w-3 mr-1" />}
        Auto-atribuir {total}
      </Button>
    </div>
  );
}

type DetectResult = {
  url: string;
  host: string;
  group: string;
  confidence: number;
  source: string;
  snippet?: string;
  candidates?: { name: string; count: number }[];
};

function AutoDetectByFetchBar({
  urls,
  platformNames,
  onApply,
}: {
  urls: { url_norm: string; url_display: string }[];
  platformNames: string[];
  onApply: (byName: Record<string, string[]>) => Promise<void>;
}) {
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<DetectResult[] | null>(null);
  // Estado editável do nome sugerido por URL (chave = url retornada pelo main)
  const [names, setNames] = useState<Record<string, string>>({});
  // URLs já aplicadas nesta sessão (some da lista após "Aplicar")
  const [done, setDone] = useState<Set<string>>(new Set());

  const api = typeof window !== "undefined" ? (window as any).electronAPI : null;
  const isDesktop = !!api?.detectPlatformGroup;
  if (!isDesktop) return null;

  // Mapa url_display -> url_norm pra aplicar no banco
  const displayToNorm = useMemo(
    () => new Map(urls.map((u) => [(u.url_display || u.url_norm), u.url_norm])),
    [urls]
  );

  const startScan = async () => {
    setScanning(true);
    setProgress({ done: 0, total: urls.length });
    setResults(null);
    setDone(new Set());
    const off = api.onPlatformDetectProgress?.((p: { done: number; total: number }) => {
      setProgress({ done: p.done, total: p.total });
    });
    try {
      const res = await api.detectPlatformGroup({
        urls: urls.map((u) => u.url_display || u.url_norm),
        knownGroups: platformNames,
      });
      if (res?.error) {
        toast.error("Falha: " + res.error.message);
        setResults([]);
      } else {
        const list = (res?.data as DetectResult[]) || [];
        setResults(list);
        // Pré-preenche o nome sugerido: prioriza SEMPRE um grupo existente.
        // 1) match direto (r.group). 2) candidato cujo nome bate com algum grupo
        //    já cadastrado. 3) 1º candidato detectado no site.
        const knownLower = new Set(platformNames.map((n) => n.toLowerCase()));
        const seed: Record<string, string> = {};
        for (const r of list) {
          const knownCand = r.candidates?.find((c) => knownLower.has(c.name.toLowerCase()))?.name;
          seed[r.url] = r.group || knownCand || r.candidates?.[0]?.name || "";
        }
        setNames(seed);

      }
    } catch (e: any) {
      toast.error("Falha: " + String(e?.message || e));
      setResults([]);
    } finally {
      try { off?.(); } catch {}
      setScanning(false);
    }
  };

  const applyOne = async (r: DetectResult) => {
    const name = (names[r.url] || "").trim();
    if (!name) { toast.error("Digite um nome de grupo"); return; }
    const norm = displayToNorm.get(r.url) || r.url;
    await onApply({ [name]: [norm] });
    setDone((prev) => new Set(prev).add(r.url));
  };

  const applyAllWithSuggestion = async () => {
    if (!results) return;
    const byName: Record<string, string[]> = {};
    const applied: string[] = [];
    for (const r of results) {
      if (done.has(r.url)) continue;
      const name = (names[r.url] || "").trim();
      if (!name) continue;
      const norm = displayToNorm.get(r.url) || r.url;
      (byName[name] ||= []).push(norm);
      applied.push(r.url);
    }
    if (!applied.length) { toast.error("Nenhum nome preenchido"); return; }
    await onApply(byName);
    setDone((prev) => {
      const n = new Set(prev);
      for (const u of applied) n.add(u);
      return n;
    });
  };

  const pending = (results || []).filter((r) => !done.has(r.url));
  const totalPreenchidos = pending.filter((r) => (names[r.url] || "").trim()).length;

  return (
    <div className="rounded border border-sky-500/40 bg-sky-500/5 px-2 py-1.5 space-y-1.5">
      <div className="flex items-center gap-2">
        <Globe className="h-3.5 w-3.5 text-sky-400 shrink-0" />
        <span className="text-[11px] text-sky-300 flex-1">
          Inspecionar o site (<code>/home/notice</code>, título, meta tags) pra detectar o grupo de cada plataforma. Você pode editar o nome sugerido e aplicar linha por linha.
        </span>
        <Button
          size="sm"
          className="h-7 text-xs bg-sky-600 hover:bg-sky-500"
          onClick={startScan}
          disabled={scanning || urls.length === 0}
        >
          {scanning ? (
            <><Loader2 className="h-3 w-3 animate-spin mr-1" /> {progress.done}/{progress.total}</>
          ) : (
            <><Wand2 className="h-3 w-3 mr-1" /> Inspecionar {urls.length}</>
          )}
        </Button>
      </div>
      {results && pending.length > 0 && (
        <div className="rounded border border-border/60 overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-2 py-1 bg-muted/40">
            <span className="text-[11px] text-muted-foreground">
              {pending.length} plataforma(s) · {totalPreenchidos} com nome preenchido
            </span>
            <Button
              size="sm"
              className="h-6 text-[11px] bg-emerald-600 hover:bg-emerald-500"
              onClick={applyAllWithSuggestion}
              disabled={totalPreenchidos === 0}
            >
              Aplicar todos ({totalPreenchidos})
            </Button>
          </div>
          <ul className="text-[11px] divide-y divide-border/40 max-h-72 overflow-auto">
            {pending.map((r) => {
              const detectedLabel = r.group
                ? `casou com grupo "${r.group}" (${r.confidence}%)`
                : r.candidates?.length
                  ? `candidatos: ${r.candidates.slice(0, 3).map((c) => c.name).join(", ")}`
                  : r.source === "fetch-failed"
                    ? "site não respondeu"
                    : "sem sinais claros";
              const listId = `dl-${r.url.replace(/[^a-z0-9]/gi, "").slice(0, 20)}`;
              return (
                <li key={r.url} className="flex items-center gap-2 px-2 py-1.5">
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-foreground">{r.host || r.url}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{detectedLabel}</div>
                  </div>
                  <Input
                    list={listId}
                    value={names[r.url] ?? ""}
                    onChange={(e) => setNames((s) => ({ ...s, [r.url]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === "Enter") applyOne(r); }}
                    placeholder="Nome do grupo"
                    className="h-7 text-xs w-[160px]"
                  />
                  <datalist id={listId}>
                    {[...new Set([
                      ...platformNames,
                      ...(r.candidates || []).map((c) => c.name),
                      ...(r.group ? [r.group] : []),
                    ])].map((s) => <option key={s} value={s} />)}
                  </datalist>
                  <Button
                    size="sm"
                    className="h-7 text-[11px] bg-emerald-600 hover:bg-emerald-500"
                    onClick={() => applyOne(r)}
                    disabled={!(names[r.url] || "").trim()}
                  >
                    Aplicar
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {results && pending.length === 0 && !scanning && (
        <div className="text-[11px] text-emerald-300 px-1">Tudo atribuído nesta rodada ✔</div>
      )}
    </div>
  );
}
