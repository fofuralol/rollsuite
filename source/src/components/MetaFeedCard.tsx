import { Button } from "@/components/ui/button";
import { Target, Trash2, ExternalLink, Volume2, Eraser, TestTube } from "lucide-react";
import { useMetaEvents } from "@/hooks/useMetaEvents";
import { cn } from "@/lib/utils";
import { useMemo } from "react";

export interface MetaDeposit {
  rolls: number;
  dep: number;
}

interface Props {
  /** Lista ordenada de depósitos (na mesma ordem mostrada na calculadora). */
  deposits?: MetaDeposit[];
  /** Compat: set apenas com os rolls (sem comparação de saldo). */
  rollsSet?: Set<number>;
}

function fmtMoney(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const MetaFeedCard = ({ deposits, rollsSet }: Props) => {
  const { events, diagnostics, removeEvent, clearAll, playMetaSound, testMetaEvent } = useMetaEvents();

  // Map rolls → primeiro depósito com aquele rolls (+ índice na lista)
  const depByRolls = useMemo(() => {
    const m = new Map<number, { dep: number; order: number }>();
    if (deposits) {
      deposits.forEach((d, i) => {
        if (d.rolls > 0 && !m.has(d.rolls)) m.set(d.rolls, { dep: d.dep, order: i });
      });
    } else if (rollsSet) {
      let i = 0;
      rollsSet.forEach((r) => { if (!m.has(r)) m.set(r, { dep: 0, order: i++ }); });
    }
    return m;
  }, [deposits, rollsSet]);

  // Ordena: primeiro os matched (pela ordem da lista de depósitos),
  // depois os não-matched (por data desc)
  const sortedEvents = useMemo(() => {
    const list = [...events];
    list.sort((a, b) => {
      const ma = a.target != null ? depByRolls.get(a.target) : undefined;
      const mb = b.target != null ? depByRolls.get(b.target) : undefined;
      if (ma && mb) return ma.order - mb.order;
      if (ma) return -1;
      if (mb) return 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    return list;
  }, [events, depByRolls]);

  const hasMatches = events.length > 0;

  return (
    <div className="rounded-lg border border-emerald-500/40 bg-gradient-to-br from-emerald-500/10 via-amber-500/5 to-emerald-900/10 p-3 flex flex-col max-h-[420px]">
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Target className="w-4 h-4 text-emerald-400 shrink-0" />
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-300/90 truncate">
            Metas atingidas
          </div>
          {hasMatches && (
            <span className="text-[10px] text-amber-300/80 font-bold">· {events.length}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-emerald-300/70 hover:text-emerald-200" onClick={() => testMetaEvent()} title="Testar notificação de meta">
            <TestTube className="w-3.5 h-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-emerald-300/70 hover:text-emerald-200" onClick={() => playMetaSound()} title="Testar som">
            <Volume2 className="w-3.5 h-3.5" />
          </Button>
          {hasMatches && (
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive" onClick={() => clearAll()} title="Limpar tudo">
              <Eraser className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>

      {!hasMatches ? (
        <div className="space-y-2 py-3">
          <div className="text-[11px] text-emerald-200/60 italic text-center">Sem metas visíveis neste PC.</div>
          {diagnostics.mismatchedTokenCount > 0 && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-100">
              <div className="font-semibold">Metas chegaram, mas com outro token.</div>
              <div className="mt-1 text-amber-100/80">
                Este PC está usando <span className="font-mono">{diagnostics.localToken?.slice(0, 12) || "(sem token)"}…</span>,
                mas o backend recebeu {diagnostics.mismatchedTokenCount} evento(s) recentes com
                <span className="font-mono"> {diagnostics.lastRejectedToken?.slice(0, 12) || "outro token"}…</span>.
              </div>
            </div>
          )}
          {diagnostics.missingTokenCount > 0 && (
            <div className="rounded-md border border-border/50 bg-background/40 px-2.5 py-2 text-[11px] text-muted-foreground">
              {diagnostics.missingTokenCount} evento(s) antigo(s) sem token de origem foram ignorados.
            </div>
          )}
        </div>
      ) : (
        <ul className="overflow-y-auto space-y-1.5 pr-1">
          {sortedEvents.map((ev) => {
            const matchInfo = ev.target != null ? depByRolls.get(ev.target) : undefined;
            const matched = !!matchInfo;
            const dep = matchInfo?.dep ?? 0;
            const bal = ev.balance;
            // Cor:
            //  - matched + balance < dep → COMBO (verde + vermelho juntos)
            //  - matched (sem balance OU balance >= dep) → verde
            //  - sem match → sem glow
            let glowClass = "";
            if (matched) {
              if (bal != null && dep > 0 && bal < dep) glowClass = "meta-mismatch-glow border-red-400/80";
              else glowClass = "meta-match-glow border-emerald-400/80";
            }
            return (
              <li key={ev.id} className={cn("rounded-md border border-emerald-500/30 bg-emerald-950/30 p-2 text-xs group", glowClass)}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm">🎯</span>
                      <span className="font-bold text-emerald-200 truncate" title={ev.title || ""}>{ev.title || "Meta atingida"}</span>
                      <span className="text-[10px] text-emerald-300/70 shrink-0">
                        {new Date(ev.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-3 flex-wrap">
                      {ev.steps != null && ev.target != null && (
                        <span className="font-bold text-amber-300 tabular-nums">
                          {ev.steps} <span className="text-emerald-300/60">/</span> {ev.target}
                        </span>
                      )}
                      {bal != null && (
                        <span className={cn(
                          "font-bold tabular-nums",
                          matched && dep > 0
                            ? (bal >= dep ? "text-emerald-300" : "text-red-300")
                            : "text-amber-200"
                        )}>
                          💰 {fmtMoney(bal)}
                          {matched && dep > 0 && (
                            <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                              / {fmtMoney(dep)}
                            </span>
                          )}
                        </span>
                      )}
                      {bal == null && ev.balance_raw && (
                        <span className="text-[10px] text-amber-200/70">💰 {ev.balance_raw}</span>
                      )}
                      {matched && (
                        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300 bg-emerald-500/20 px-1.5 py-0.5 rounded">
                          match depósito
                        </span>
                      )}
                      {ev.url && (
                        <a href={ev.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-emerald-300 hover:text-emerald-200 underline-offset-2 hover:underline truncate max-w-[260px]" title={ev.url}>
                          <ExternalLink className="w-3 h-3 shrink-0" />
                          <span className="truncate">{ev.url}</span>
                        </a>
                      )}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive opacity-0 group-hover:opacity-100 transition" onClick={() => removeEvent(ev.id)} title="Remover">
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default MetaFeedCard;
