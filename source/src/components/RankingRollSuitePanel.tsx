import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Trophy, Medal, Award, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useDkDashLucros } from "@/hooks/useDkDashLucros";
import { formatBRL } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { IS_DESKTOP } from "@/lib/runtime";
import { createClient } from "@supabase/supabase-js";

type RankingRow = {
  user_id: string | null;
  nickname: string;
  total_hoje: number;
  total_mes: number;
  total_geral: number;
  updated_at: string;
};

type Periodo = "hoje" | "mes" | "geral";

const PERIODO_LABEL: Record<Periodo, string> = {
  hoje: "Hoje",
  mes: "Mês atual",
  geral: "Tudo",
};

function startOfDayTs(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

function startOfMonthTs(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

const CLOUD_URL = import.meta.env.VITE_SUPABASE_URL as string;
const CLOUD_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

const cloud =
  CLOUD_URL && CLOUD_KEY
    ? createClient(CLOUD_URL, CLOUD_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;

function normalizeNick(n: string) {
  const nick = (n || "")
    .trim()
    .replace(/@rolls\.local$/i, "")
    .replace(/@local$/i, "")
    .replace(/^@+/, "")
    .toLowerCase();

  // Correção permanente do apelido digitado errado: qualquer cache/localStorage
  // antigo que ainda mande "fofuralo" passa a sincronizar na linha correta.
  if (nick === "fofuralo") return "fofuralol";
  return nick;
}

function mergeRankingRows(rows: RankingRow[]): RankingRow[] {
  const map = new Map<string, RankingRow>();

  for (const row of rows) {
    const nickname = normalizeNick(row.nickname);
    if (!nickname) continue;

    const current = map.get(nickname);
    if (!current) {
      map.set(nickname, { ...row, nickname });
      continue;
    }

    map.set(nickname, {
      ...current,
      nickname,
      total_hoje: Math.max(Number(current.total_hoje || 0), Number(row.total_hoje || 0)),
      total_mes: Math.max(Number(current.total_mes || 0), Number(row.total_mes || 0)),
      total_geral: Math.max(Number(current.total_geral || 0), Number(row.total_geral || 0)),
      updated_at:
        new Date(row.updated_at).getTime() > new Date(current.updated_at).getTime()
          ? row.updated_at
          : current.updated_at,
    });
  }

  return Array.from(map.values());
}

export default function RankingRollSuitePanel() {
  const { user } = useAuth();
  const { dias, sumLiquido } = useDkDashLucros();
  const [rows, setRows] = useState<RankingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [periodo, setPeriodo] = useState<Periodo>(() => {
    if (typeof window === "undefined") return "hoje";
    const saved = window.localStorage.getItem("ranking_periodo");
    return (saved === "hoje" || saved === "mes" || saved === "geral") ? saved : "hoje";
  });
  useEffect(() => {
    try { window.localStorage.setItem("ranking_periodo", periodo); } catch {}
  }, [periodo]);

  // Usa só o dk_username real (vem do edge function dkdash-lucros). No desktop,
  // user.email é FAKE_USER ("fofuralol@local") pra TODO mundo, então não dá pra
  // confiar nele como nickname — senão o pomponet sobrescreve a linha do fofuralol.
  const nickname = useMemo(() => {
    // DESKTOP: prioriza monitor_sync_email — diferencia PCs distintos que
    // compartilham o mesmo login do DkDash. Fallback: dkdash_username.
    if (IS_DESKTOP) {
      const syncEmail = localStorage.getItem("monitor_sync_email") || "";
      const fromSync = normalizeNick(syncEmail);
      if (fromSync) return fromSync;
      const dkNick = localStorage.getItem("dkdash_username") || "";
      return normalizeNick(dkNick);
    }
    // WEB: usa dkdash_username (login DkDash), fallback user.email.
    const dkNick = (typeof localStorage !== "undefined" && localStorage.getItem("dkdash_username")) || "";
    if (dkNick) {
      const normalized = normalizeNick(dkNick);
      if (normalized && normalized !== dkNick) {
        try { localStorage.setItem("dkdash_username", normalized); } catch {}
      }
      return normalized;
    }
    return normalizeNick(user?.email || "") || "";
  }, [user?.email, dias]);


  const db: any = cloud ?? (supabase as any);

  const load = async () => {
    setLoading(true);
    const { data, error } = await db
      .from("dkdash_ranking")
      .select("*")
      .order("total_geral", { ascending: false });
    if (!error && data) setRows(mergeRankingRows(data as unknown as RankingRow[]));
    setLoading(false);
  };

  // Push do faturamento usando apelido como chave — sem login
  useEffect(() => {
    const hoje = startOfDayTs();
    const mes = startOfMonthTs();
    const amanha = hoje + 24 * 60 * 60 * 1000;
    const total_hoje = sumLiquido(hoje, amanha);
    const total_mes = sumLiquido(mes, amanha);
    const total_geral = sumLiquido();

    if (!nickname) {
      load();
      return;
    }

    // Não sobrescreve a linha com zeros se o DkDash ainda não carregou.
    if (dias.length === 0 && total_hoje === 0 && total_mes === 0 && total_geral === 0) {
      load();
      return;
    }


    (async () => {
      const { error } = await db.from("dkdash_ranking").upsert(
        {
          nickname,
          total_hoje,
          total_mes,
          total_geral,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "nickname" }
      );
      if (error) console.error("[ranking] upsert error", error);
      load();
    })();
  }, [dias, nickname, sumLiquido]);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  const sortedRows = useMemo(() => {
    const key =
      periodo === "hoje" ? "total_hoje" :
      periodo === "mes" ? "total_mes" : "total_geral";
    return [...rows].sort((a, b) => (b[key] as number) - (a[key] as number));
  }, [rows, periodo]);



  const getValor = (r: RankingRow) =>
    periodo === "hoje" ? r.total_hoje :
    periodo === "mes" ? r.total_mes : r.total_geral;

  const podioIcon = (pos: number) => {
    if (pos === 0) return <Trophy className="w-5 h-5 text-yellow-400" />;
    if (pos === 1) return <Medal className="w-5 h-5 text-slate-300" />;
    if (pos === 2) return <Award className="w-5 h-5 text-amber-600" />;
    return <span className="text-sm text-muted-foreground w-5 text-center">{pos + 1}</span>;
  };

  return (
    <Card className="p-4 md:p-6">
      <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Trophy className="w-5 h-5 text-yellow-400" /> Ranking RollSuite
          </h2>
          <p className="text-xs text-muted-foreground">
            Faturamento líquido de todos os usuários do app
          </p>
        </div>
        <div className="flex items-center gap-1">
          {(Object.keys(PERIODO_LABEL) as Periodo[]).map((p) => (
            <Button
              key={p}
              size="sm"
              variant={periodo === p ? "default" : "outline"}
              className="h-7 text-xs"
              onClick={() => setPeriodo(p)}
            >
              {PERIODO_LABEL[p]}
            </Button>
          ))}
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={load} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {sortedRows.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          Sem dados ainda. Aguardando primeiro sync…
        </p>
      ) : (
        <div className="space-y-2">
          {sortedRows.map((r, idx) => {
            const isMe = normalizeNick(r.nickname) === nickname;
            const valor = getValor(r);
            return (
              <div
                key={r.nickname}
                className={`flex items-center gap-3 p-3 rounded-lg border transition ${
                  isMe ? "border-primary/50 bg-primary/5" : "border-border bg-card/50"
                }`}
              >
                <div className="w-7 flex items-center justify-center shrink-0">
                  {podioIcon(idx)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{r.nickname}</span>
                    {isMe && (
                      <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-primary/20 text-primary">
                        você
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    atualizado {new Date(r.updated_at).toLocaleString("pt-BR")}
                  </p>
                </div>
                <div
                  className={`text-right tabular-nums font-semibold ${
                    valor >= 0 ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {periodo === "geral" && !isMe ? (
                    <span className="text-muted-foreground tracking-widest">•••••</span>
                  ) : (
                    formatBRL(valor)
                  )}
                </div>

              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
