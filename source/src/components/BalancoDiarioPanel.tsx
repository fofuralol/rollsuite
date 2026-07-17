import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarIcon, Loader2, Wallet, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { getBancoColor } from "@/lib/bancoColors";

type TaskRow = {
  id: string;
  completed_at: string | null;
  pix_keys: Array<{ banco?: string }> | null;
  operation_data: { rows?: Array<{ saque?: number }>; dk_synced?: boolean } | null;
};

type BancoAgg = { banco: string; saque: number; saques: number; tarefas: number; times: { time: string; valor: number }[] };

// Dia "lógico" começa às 05:00 da manhã.
// Se a data selecionada for hoje e ainda não deu 5h, considera o ciclo anterior.
function startEndOfDay(d: Date) {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 5, 0, 0, 0);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function logicalToday() {
  const now = new Date();
  if (now.getHours() < 5) now.setDate(now.getDate() - 1);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export default function BalancoDiarioPanel() {
  const { user } = useAuth();
  const [date, setDate] = useState<Date>(() => logicalToday());
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<TaskRow[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  async function syncWithDk() {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("dkdash-lucros", { body: { action: "sync-task-times" } });
      if (error) { toast.error(error.message); return; }
      if (!data?.ok) { toast.error(data?.error || "Falhou"); return; }
      toast.success(`${data.updated} tarefa(s) sincronizada(s) · ${data.skipped?.length || 0} ignorada(s)`);
      console.log("sync-task-times →", data);
      setReloadKey((k) => k + 1);
    } catch (e: any) {
      toast.error(e?.message || "Erro");
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    if (!user) return;
    let cancel = false;
    (async () => {
      setLoading(true);
      const { start, end } = startEndOfDay(date);
      const { data } = await supabase
        .from("wa_tasks")
        .select("id, completed_at, pix_keys, operation_data")
        .eq("status", "done")
        .gte("completed_at", start)
        .lte("completed_at", end);
      if (!cancel) {
        setRows((data ?? []) as unknown as TaskRow[]);
        setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [user, date, reloadKey]);

  const { agg, total, totalSaques, totalTarefas } = useMemo(() => {
    const map = new Map<string, BancoAgg>();
    let total = 0;
    let totalSaques = 0;
    const tarefasComSaque = new Set<string>();
    for (const t of rows) {
      if (!t.operation_data?.dk_synced) continue;
      const keys = Array.isArray(t.pix_keys) ? t.pix_keys : [];
      const ops = Array.isArray(t.operation_data?.rows) ? t.operation_data!.rows! : [];
      const n = Math.max(keys.length, ops.length);
      let taskHasSaque = false;
      const completedAt = t.completed_at ? new Date(t.completed_at) : null;
      const hhmm = completedAt
        ? completedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
        : "--:--";
      for (let i = 0; i < n; i++) {
        const saque = Number(ops[i]?.saque || 0);
        if (saque <= 0) continue;
        const banco = (keys[i]?.banco || "Sem banco").trim() || "Sem banco";
        const cur = map.get(banco) || { banco, saque: 0, saques: 0, tarefas: 0, times: [] };
        cur.saque += saque;
        cur.saques += 1;
        cur.times.push({ time: hhmm, valor: saque });
        map.set(banco, cur);
        total += saque;
        totalSaques += 1;
        taskHasSaque = true;
      }
      if (taskHasSaque) tarefasComSaque.add(t.id);
    }
    // contar tarefas únicas por banco
    for (const t of rows) {
      if (!t.operation_data?.dk_synced) continue;
      const keys = Array.isArray(t.pix_keys) ? t.pix_keys : [];
      const ops = Array.isArray(t.operation_data?.rows) ? t.operation_data!.rows! : [];
      const n = Math.max(keys.length, ops.length);
      const bancosNaTarefa = new Set<string>();
      for (let i = 0; i < n; i++) {
        const saque = Number(ops[i]?.saque || 0);
        if (saque <= 0) continue;
        bancosNaTarefa.add((keys[i]?.banco || "Sem banco").trim() || "Sem banco");
      }
      for (const b of bancosNaTarefa) {
        const cur = map.get(b);
        if (cur) cur.tarefas += 1;
      }
    }
    const agg = [...map.values()]
      .map((b) => ({ ...b, times: [...b.times].sort((a, z) => a.time.localeCompare(z.time)) }))
      .sort((a, b) => b.saque - a.saque);
    return { agg, total, totalSaques, totalTarefas: tarefasComSaque.size };
  }, [rows]);

  const isToday = useMemo(() => {
    return logicalToday().toDateString() === date.toDateString();
  }, [date]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2">
            <Wallet className="w-4 h-4 text-primary" />
            Balanço do dia · Saques por banco
          </h1>
          <p className="text-xs text-muted-foreground">
            Soma dos saques das tarefas concluídas no dia selecionado.
            <span className="ml-1 opacity-70">(tarefas ficam disponíveis por 7 dias)</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn("justify-start text-left font-normal gap-2", !date && "text-muted-foreground")}
              >
                <CalendarIcon className="w-3.5 h-3.5" />
                {format(date, "dd/MM/yyyy · EEE", { locale: ptBR })}
                {isToday && <span className="text-[10px] text-emerald-500 ml-1">(hoje)</span>}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                selected={date}
                onSelect={(d) => d && setDate(d)}
                disabled={(d) => d > new Date()}
                initialFocus
                locale={ptBR}
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
          {!isToday && (
            <Button size="sm" variant="ghost" onClick={() => setDate(logicalToday())}>
              Hoje
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={syncWithDk}
            disabled={syncing}
            className="gap-1.5"
            title="Buscar horários reais dos ciclos no DK Dash e corrigir as tarefas concluídas"
          >
            {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Sincronizar DK
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Card className="p-3">
          <p className="text-[10px] uppercase text-muted-foreground tracking-wider">Total sacado</p>
          <p className="text-xl font-bold text-emerald-500 tabular-nums">{formatBRL(total)}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[10px] uppercase text-muted-foreground tracking-wider">Bancos</p>
          <p className="text-xl font-bold tabular-nums">{agg.length}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[10px] uppercase text-muted-foreground tracking-wider">Saques · Tarefas</p>
          <p className="text-xl font-bold tabular-nums">
            {totalSaques}
            <span className="text-muted-foreground mx-1 text-base">/</span>
            {totalTarefas}
          </p>
        </Card>
      </div>

      {loading ? (
        <Card className="p-8 flex items-center justify-center text-muted-foreground gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Carregando…</span>
        </Card>
      ) : agg.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Nenhum saque registrado nesse dia.
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">Banco</th>
                <th className="text-right px-3 py-2 w-24">Saques</th>
                <th className="text-right px-3 py-2 w-24">Tarefas</th>
                <th className="text-right px-3 py-2 w-32">Total</th>
                <th className="text-right px-3 py-2 w-20">% do dia</th>
              </tr>
            </thead>
            <tbody>
              {agg.map((b) => {
                const c = getBancoColor(b.banco);
                const pct = total > 0 ? (b.saque / total) * 100 : 0;
                return (
                  <tr key={b.banco} className="border-t border-border/60 hover:bg-muted/20">
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1">
                        <span
                          className={cn(
                            "inline-flex w-fit items-center px-2 py-0.5 rounded-md border text-xs font-semibold",
                            c.bg, c.text, c.border,
                          )}
                        >
                          {b.banco}
                        </span>
                        {b.times.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {b.times.map((tt, i) => (
                              <span
                                key={i}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted/40 border border-border/40 text-[10px] tabular-nums text-muted-foreground"
                                title={`${tt.time} · ${formatBRL(tt.valor)}`}
                              >
                                <span className="font-mono">{tt.time}</span>
                                <span className="text-emerald-500/80">{formatBRL(tt.valor)}</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{b.saques}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{b.tarefas}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-500">
                      {formatBRL(b.saque)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {pct.toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-muted/30 border-t border-border">
              <tr>
                <td className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground">Total</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{totalSaques}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{totalTarefas}</td>
                <td className="px-3 py-2 text-right tabular-nums font-bold text-emerald-500">{formatBRL(total)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">100%</td>
              </tr>
            </tfoot>
          </table>
        </Card>
      )}
    </div>
  );
}
