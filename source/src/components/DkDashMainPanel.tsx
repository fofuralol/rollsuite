import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Trophy, Medal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import LiquidoFlip from "@/components/LiquidoFlip";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Area,
  AreaChart,
  PieChart,
  Pie,
  Cell,
} from "recharts";

type Conta = { PK: string; deposito: number; saque: number; blogueiro: number; lucro: number; taxa_comissao?: number | null; data_logica?: string; data_criacao?: string };
type Ciclo = { PK: string; investido: number; retorno: number; lucro: number; blogueiro: number; taxa_comissao?: number | null; data_logica?: string; data_ciclo?: string };


type DashData = {
  username: string;
  filial_id: string;
  nome?: string;
  role?: string;
  categoria?: string;
  comissao?: number;
  contas: Conta[];
  ciclos: Ciclo[];
  meta: number;
  ranking: { top_montante?: string; top_conta?: string };
  financeiro?: Record<string, any> | null;
};

const pickNum = (obj: any, ...keys: string[]): number | null => {
  if (!obj || typeof obj !== "object") return null;
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && !Number.isNaN(Number(v))) return Number(v);
  }
  return null;
};


const fmtMoeda = (n: number) =>
  "R$ " + (Number(n) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const pegarDataStr = (d: any, tipo: "conta" | "ciclo"): string | null => {
  if (d.data_logica) return d.data_logica;
  if (tipo === "conta" && d.data_criacao) return String(d.data_criacao).split("T")[0];
  if (tipo === "ciclo" && d.data_ciclo) return d.data_ciclo;
  return null;
};

export default function DkDashMainPanel() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DashData | null>(null);
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [metaInput, setMetaInput] = useState("");
  const [savingMeta, setSavingMeta] = useState(false);

  const load = async (di = inicio, df = fim) => {
    setLoading(true);
    try {
      const { data: r, error } = await supabase.functions.invoke("dkdash-lucros", {
        body: { action: "main-dashboard", filial_id: "filial01", inicio: di, fim: df },
      });
      console.log("[DkDashMainPanel] load resp:", { error, r });
      if (error) throw new Error(error.message);
      if ((r as any)?.error) throw new Error((r as any).error);
      const dd = r as DashData;
      console.log("[DkDashMainPanel] parsed:", {
        username: dd?.username,
        contas: dd?.contas?.length,
        ciclos: dd?.ciclos?.length,
        sample_PK: dd?.contas?.[0]?.PK || dd?.ciclos?.[0]?.PK,
      });
      console.log("[DkDashMainPanel] financeiro_path:", (dd as any)?.financeiro_path, "probe:", (dd as any)?.financeiro_probe);
      console.log("[DkDashMainPanel] financeiro:", (dd as any)?.financeiro);

      setData(dd);
      setMetaInput(String(dd.meta || ""));

    } catch (e: any) {
      console.error("[DkDashMainPanel] load erro:", e);
      toast.error(e.message || "Erro ao carregar dashboard");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load("", ""); /* eslint-disable-next-line */ }, []);

  const salvarMeta = async () => {
    setSavingMeta(true);
    try {
      const valor = parseFloat(metaInput.replace(",", ".")) || 0;
      const { data: r, error } = await supabase.functions.invoke("dkdash-lucros", {
        body: { action: "set-meta", filial_id: "filial01", valor },
      });
      if (error) throw new Error(error.message);
      if ((r as any)?.error) throw new Error((r as any).error);
      toast.success("Meta atualizada!");
      if (data) setData({ ...data, meta: valor });
    } catch (e: any) {
      toast.error(e.message || "Erro ao salvar meta");
    } finally {
      setSavingMeta(false);
    }
  };

  const setFiltroRapido = (tipo: "hoje" | "7dias" | "tudo") => {
    const f = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const dFim = new Date();
    const dIni = new Date();
    if (tipo === "7dias") dIni.setDate(dFim.getDate() - 6);
    else if (tipo === "tudo") dIni.setFullYear(2020, 0, 1);
    setInicio(f(dIni));
    setFim(f(dFim));
    load(f(dIni), f(dFim));
  };

  const limpar = () => {
    setInicio("");
    setFim("");
    load("", "");
  };

  // ============ Cálculos ============
  const meuUser = (data?.username || "").trim().toLowerCase();
  const taxa = Number(data?.comissao ?? 30);
  const fator = taxa / 100;

  const filtrados = useMemo(() => {
    if (!data) return { contas: [] as Conta[], ciclos: [] as Ciclo[] };
    let contas = data.contas;
    let ciclos = data.ciclos;
    if (!inicio && !fim) {
      const hoje = new Date();
      const anoMes = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
      contas = contas.filter((c) => { const d = pegarDataStr(c, "conta"); return d && d.startsWith(anoMes); });
      ciclos = ciclos.filter((c) => { const d = pegarDataStr(c, "ciclo"); return d && d.startsWith(anoMes); });
    } else {
      const filt = (c: any, tipo: "conta" | "ciclo") => {
        const d = pegarDataStr(c, tipo);
        if (!d) return false;
        if (inicio && d < inicio) return false;
        if (fim && d > fim) return false;
        return true;
      };
      contas = contas.filter((c) => filt(c, "conta"));
      ciclos = ciclos.filter((c) => filt(c, "ciclo"));
    }
    return { contas, ciclos };
  }, [data, inicio, fim]);

  // Espelha fórmula EXATA do site DK (src/pages/dashboard.js):
  // taxaOperacao = dado.taxa_comissao se vier no item, senão taxa do perfil (30%).
  // comissaoItem = (tipo === 'conta') ? lucro*fator : blogueiro*fator
  // lucroLiquido = lucro - comissaoItem
  const cards = useMemo(() => {
    let investido = 0, retorno = 0, lucro = 0, comissao = 0;
    for (const c of filtrados.contas) {
      const op = (c.PK || "").replace("USER#", "").trim().toLowerCase();
      if (op !== meuUser) continue;
      investido += Number(c.deposito || 0);
      retorno += Number(c.saque || 0) + Number(c.blogueiro || 0);
      const taxaOp = c.taxa_comissao != null ? Number(c.taxa_comissao) : taxa;
      const f = taxaOp / 100;
      const com = Number(c.lucro || 0) * f;
      comissao += com;
      lucro += Number(c.lucro || 0) - com;
    }
    for (const c of filtrados.ciclos) {
      const op = (c.PK || "").replace("USER#", "").trim().toLowerCase();
      if (op !== meuUser) continue;
      investido += Number(c.investido || 0);
      retorno += Number(c.retorno || 0);
      const taxaOp = c.taxa_comissao != null ? Number(c.taxa_comissao) : taxa;
      const f = taxaOp / 100;
      const com = Number(c.blogueiro || 0) * f;
      comissao += com;
      lucro += Number(c.lucro || 0) - com;
    }
    return { investido, retorno, lucro, comissao };
  }, [filtrados, meuUser, taxa]);



  // Gráfico mensal & meta diária — sempre baseado no mês atual (igual ao site)
  const mensal = useMemo(() => {
    if (!data) return { dias: [] as { dia: string; valor: number }[], totalMes: 0, mediaDia: 0, diasOperados: 0, diasPositivos: 0, hojeValor: 0, projecaoMes: 0 };
    const hoje = new Date();
    const ano = hoje.getFullYear();
    const mes = String(hoje.getMonth() + 1).padStart(2, "0");
    const prefixo = `${ano}-${mes}`;
    const hojeStr = `${prefixo}-${String(hoje.getDate()).padStart(2, "0")}`;
    const ultimoDia = new Date(ano, hoje.getMonth() + 1, 0).getDate();
    const mapa: Record<string, number> = {};
    for (let i = 1; i <= ultimoDia; i++) mapa[`${prefixo}-${String(i).padStart(2, "0")}`] = 0;

    let lucroMes = 0, hojeValor = 0;
    const ativos = new Set<string>();

    const acum = (d: any, tipo: "conta" | "ciclo") => {
      const op = (d.PK || "").replace("USER#", "").trim().toLowerCase();
      if (op !== meuUser) return;
      const ds = pegarDataStr(d, tipo);
      if (!ds) return;
      const bruto = Number(d.lucro || 0);
      const taxaOp = d.taxa_comissao != null ? Number(d.taxa_comissao) : taxa;
      const f = taxaOp / 100;
      const com = tipo === "conta" ? bruto * f : Number(d.blogueiro || 0) * f;
      const liq = bruto - com;

      if (ds === hojeStr) hojeValor += liq;
      if (ds.startsWith(prefixo)) {
        lucroMes += liq;
        if (mapa[ds] !== undefined) { mapa[ds] += liq; ativos.add(ds); }
      }
    };
    data.contas.forEach((c) => acum(c, "conta"));
    data.ciclos.forEach((c) => acum(c, "ciclo"));

    const dias = Object.keys(mapa).sort().map((k) => ({ dia: k.slice(8) + "/" + k.slice(5, 7), valor: mapa[k] }));
    const diasOperados = ativos.size;
    const mediaDia = diasOperados > 0 ? lucroMes / diasOperados : 0;
    const diasPositivos = dias.filter((d) => d.valor > 0).length;
    const projecaoMes = mediaDia * ultimoDia;
    return { dias, totalMes: lucroMes, mediaDia, diasOperados, diasPositivos, hojeValor, projecaoMes };
  }, [data, meuUser, taxa]);

  const topMontante = data?.ranking?.top_montante;
  const topConta = data?.ranking?.top_conta;


  const meta = Number(data?.meta || 0);
  const atingido = Math.max(0, mensal.hojeValor);
  const restante = Math.max(0, meta - atingido);
  const percentual = meta > 0 ? Math.min(100, Math.round((atingido / meta) * 100)) : (atingido > 0 ? 100 : 0);
  const corAtingido = percentual >= 100 ? "#22c55e" : "#eab308";

  const lucroPositivo = cards.lucro >= 0;
  const sangue = "text-red-600";

  return (
    <div className="space-y-6 dark">
      {/* Header de filtros */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Controle Financeiro</h1>
          <p className="text-xs text-muted-foreground">Performance consolidada</p>
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={() => setFiltroRapido("hoje")}>Hoje</Button>
          <Button size="sm" variant="outline" onClick={() => setFiltroRapido("7dias")}>7 Dias</Button>
          <Button size="sm" variant="outline" onClick={() => setFiltroRapido("tudo")}>Tudo</Button>
          <div className="flex flex-col">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Data Inicial</label>
            <Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className="h-8 w-36" />
          </div>
          <div className="flex flex-col">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Data Final</label>
            <Input type="date" value={fim} onChange={(e) => setFim(e.target.value)} className="h-8 w-36" />
          </div>
          <Button size="sm" onClick={() => load(inicio, fim)} disabled={loading}>
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Filtrar"}
          </Button>
          <Button size="sm" variant="outline" onClick={limpar}>Limpar</Button>
        </div>
      </div>

      {/* 4 cards topo */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card className="p-4 border-l-4 border-l-red-600 min-w-0 [container-type:inline-size]">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground truncate">Resultado Operacional Global</p>
          <p className={`text-xs font-semibold mt-1 ${lucroPositivo ? "text-green-500" : sangue}`}>
            {lucroPositivo ? "Positivo (Líquido Real)" : "Negativo (Líquido Real)"}
          </p>
          <LiquidoFlip
            liquido={cards.lucro}
            bruto={cards.retorno - cards.investido}
            format={fmtMoeda}
            className="mt-2 block"
            valueClassName={`font-black ${lucroPositivo ? "text-green-500" : sangue}`}
          />

        </Card>
        <Card className="p-4 min-w-0 [container-type:inline-size]">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground truncate">Total Investido (Depósito)</p>
          <p className="font-bold text-blue-400 mt-6 whitespace-nowrap" style={{ fontSize: "clamp(0.9rem, 10cqi, 1.5rem)" }}>{fmtMoeda(cards.investido)}</p>
        </Card>
        <Card className="p-4 min-w-0 [container-type:inline-size]">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground truncate">Total Retornado (Saque + Blog)</p>
          <p className="font-bold text-yellow-500 mt-6 whitespace-nowrap" style={{ fontSize: "clamp(0.9rem, 10cqi, 1.5rem)" }}>{fmtMoeda(cards.retorno)}</p>
        </Card>
        <Card className="p-4 min-w-0 [container-type:inline-size]">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground truncate">Total de Comissões</p>
          <p className="text-[11px] text-muted-foreground mt-1">Taxas dinâmicas ({taxa}%)</p>
          <p className="font-bold text-purple-400 mt-1 whitespace-nowrap" style={{ fontSize: "clamp(0.9rem, 10cqi, 1.5rem)" }}>{fmtMoeda(cards.comissao)}</p>
        </Card>
      </div>

      {/* Ranking Top 1 */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Trophy className="w-4 h-4 text-yellow-500" />
          <h2 className="text-sm font-bold">Ranking do Mês Atual</h2>
          <span className="text-xs text-muted-foreground">(Top 1 por categoria)</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Card className="p-4 border border-yellow-500/40 flex items-center justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-bold">Top 1 · Montante</p>
              <p className="text-xl font-bold text-yellow-500 mt-1">
                {topMontante && topMontante !== "Nenhum" ? `@${topMontante}` : "—"}
              </p>
            </div>
            <Trophy className="w-7 h-7 text-yellow-500" />
          </Card>
          <Card className="p-4 border border-blue-500/40 flex items-center justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-bold">Top 1 · Contas</p>
              <p className="text-xl font-bold text-blue-400 mt-1">
                {topConta && topConta !== "Nenhum" ? `@${topConta}` : "—"}
              </p>
            </div>
            <Medal className="w-7 h-7 text-blue-400" />
          </Card>
        </div>
      </div>


      {/* Histórico mensal + Meta diária */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card className="p-4 md:col-span-2 space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold uppercase tracking-widest">Histórico Mensal</h3>
            <span className="text-xs text-muted-foreground">(Desconsidera Filtro)</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="border border-border rounded p-2 min-w-0 [container-type:inline-size]">
              <p className="text-[10px] uppercase text-muted-foreground truncate">Total do Mês</p>
              <p className={`font-bold whitespace-nowrap ${mensal.totalMes >= 0 ? "text-green-500" : sangue}`} style={{ fontSize: "clamp(0.75rem, 9cqi, 1.125rem)" }}>{fmtMoeda(mensal.totalMes)}</p>
            </div>
            <div className="border border-border rounded p-2 min-w-0 [container-type:inline-size]">
              <p className="text-[10px] uppercase text-muted-foreground truncate">Média Diária</p>
              <p className={`font-bold whitespace-nowrap ${mensal.mediaDia >= 0 ? "text-green-500" : sangue}`} style={{ fontSize: "clamp(0.75rem, 9cqi, 1.125rem)" }}>{fmtMoeda(mensal.mediaDia)}</p>
            </div>
            <div className="border border-yellow-500/40 rounded p-2 min-w-0 [container-type:inline-size]" title="Projeção do mês inteiro com base na média diária atual">
              <p className="text-[10px] uppercase text-muted-foreground truncate">Projeção Mensal</p>
              <p className={`font-bold whitespace-nowrap ${mensal.projecaoMes >= 0 ? "text-yellow-400" : sangue}`} style={{ fontSize: "clamp(0.75rem, 9cqi, 1.125rem)" }}>{fmtMoeda(mensal.projecaoMes)}</p>
            </div>
            <div className="border border-border rounded p-2 min-w-0 [container-type:inline-size]">
              <p className="text-[10px] uppercase text-muted-foreground truncate">Dias de Operação</p>
              <p className="font-bold text-blue-400 whitespace-nowrap" style={{ fontSize: "clamp(0.75rem, 9cqi, 1.125rem)" }}>{mensal.diasPositivos}/{mensal.diasOperados}</p>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={mensal.dias} margin={{ left: 0, right: 0, top: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradLucro" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#eab308" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#eab308" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="dia" stroke="#9ca3af" fontSize={10} />
                <YAxis stroke="#9ca3af" fontSize={10} />
                <Tooltip
                  contentStyle={{ background: "#0a0a0a", border: "1px solid #333", fontSize: 12 }}
                  formatter={(v: any) => fmtMoeda(Number(v))}
                />
                <Area type="monotone" dataKey="valor" stroke="#eab308" strokeWidth={2} fill="url(#gradLucro)" dot={{ r: 2, fill: "#eab308" }} activeDot={{ r: 5 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-widest">Sua Meta Diária</h3>
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-muted-foreground">R$</span>
              <Input
                type="number"
                step="0.01"
                value={metaInput}
                onChange={(e) => setMetaInput(e.target.value)}
                onBlur={salvarMeta}
                disabled={savingMeta}
                className="h-7 w-24 text-sm"
              />
            </div>
          </div>
          <div className="relative h-48 flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={[
                    { name: "Atingido", value: percentual >= 100 ? 100 : atingido },
                    { name: "Restante", value: percentual >= 100 ? 0 : restante },
                  ]}
                  innerRadius="80%"
                  outerRadius="100%"
                  dataKey="value"
                  startAngle={90}
                  endAngle={-270}
                  stroke="none"
                >
                  <Cell fill={corAtingido} />
                  <Cell fill="#374151" />
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-3xl font-black" style={{ color: corAtingido }}>{percentual}%</span>
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Atingido</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between bg-muted/30 rounded p-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Atingido Hoje</span>
              </div>
              <span className="text-sm font-bold text-green-500">{fmtMoeda(atingido)}</span>
            </div>
            <div className="flex items-center justify-between bg-muted/30 rounded p-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-gray-400" />
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Restante</span>
              </div>
              <span className="text-sm font-bold">{fmtMoeda(restante)}</span>
            </div>
          </div>
        </Card>
      </div>

      <div className="flex justify-end">
        <Button size="sm" variant="ghost" onClick={() => load(inicio, fim)} disabled={loading}>
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
          Atualizar dashboard
        </Button>
      </div>
    </div>
  );
}

function RankingCard({
  titulo,
  cor,
  icon,
  lista,
  meuUser,
}: {
  titulo: string;
  cor: "yellow" | "blue";
  icon: React.ReactNode;
  lista: { user: string; valor: number }[];
  meuUser: string;
}) {
  const borda = cor === "yellow" ? "border-yellow-500/40" : "border-blue-500/40";
  const medalhas = ["🥇", "🥈", "🥉"];
  return (
    <Card className={`p-4 border ${borda} space-y-2 min-w-0`}>
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-bold">Top 5 · {titulo}</p>
        {icon}
      </div>
      {lista.length === 0 ? (
        <p className="text-xs text-muted-foreground py-3 text-center">Sem dados no mês</p>
      ) : (
        <ul className="space-y-1">
          {lista.map((r, i) => {
            const mine = r.user === meuUser;
            return (
              <li
                key={r.user}
                className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded text-sm ${
                  mine ? "bg-primary/15 border border-primary/40" : "bg-muted/30"
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-base w-5 text-center">{medalhas[i] || `${i + 1}.`}</span>
                  <span className={`truncate font-semibold ${mine ? "text-primary" : ""}`}>@{r.user}</span>
                </div>
                <span className={`font-bold whitespace-nowrap ${r.valor >= 0 ? "text-green-500" : "text-red-500"}`}>
                  {fmtMoeda(r.valor)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
