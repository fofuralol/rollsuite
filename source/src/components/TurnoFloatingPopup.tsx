import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useDkDashTurno } from "@/hooks/useDkDashTurno";
import { Button } from "@/components/ui/button";
import {
  Bell, BellOff, Loader2, RefreshCw, Users, X, ListOrdered,
  LogIn, LogOut, ChevronUp, ChevronDown, Eye, EyeOff, History, RotateCw,
} from "lucide-react";

const HIDDEN_ROUTES_KEY = "turno_popup_hidden_routes_v1";
const DEFAULT_HIDDEN = ["/monitor"];
const POSITION_KEY = "turno_popup_position_y_v1"; // 0..1 (fração da altura)

function readHidden(): string[] {
  try {
    const raw = localStorage.getItem(HIDDEN_ROUTES_KEY);
    if (raw === null) return [...DEFAULT_HIDDEN];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return [...DEFAULT_HIDDEN]; }
}
function writeHidden(list: string[]) {
  try { localStorage.setItem(HIDDEN_ROUTES_KEY, JSON.stringify(list)); } catch {}
}
function readPositionY(): number {
  try {
    const raw = localStorage.getItem(POSITION_KEY);
    if (raw === null) return 0.5;
    const v = parseFloat(raw);
    if (Number.isFinite(v) && v >= 0 && v <= 1) return v;
  } catch {}
  return 0.5;
}

export default function TurnoFloatingPopup() {
  const turno = useDkDashTurno("montante");
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [hiddenRoutes, setHiddenRoutes] = useState<string[]>(() => readHidden());
  const [posY, setPosY] = useState<number>(() => readPositionY());
  const [autoHidden, setAutoHidden] = useState(false);
  const [closing, setClosing] = useState(false);
  const inactivityTimeoutRef = useRef<number | null>(null);
  const closeAnimTimeoutRef = useRef<number | null>(null);

  const clearInactivityTimer = () => {
    if (inactivityTimeoutRef.current !== null) {
      window.clearTimeout(inactivityTimeoutRef.current);
      inactivityTimeoutRef.current = null;
    }
  };

  const armInactivityTimer = () => {
    clearInactivityTimer();
    if (!open || closing) return;
    inactivityTimeoutRef.current = window.setTimeout(() => {
      setClosing(true);
      if (closeAnimTimeoutRef.current !== null) window.clearTimeout(closeAnimTimeoutRef.current);
      closeAnimTimeoutRef.current = window.setTimeout(() => {
        setAutoHidden(true);
        setOpen(false);
        setClosing(false);
        closeAnimTimeoutRef.current = null;
      }, 350);
    }, 5000);
  };

  const registerInteraction = () => {
    if (closing) return;
    setAutoHidden(false);
    armInactivityTimer();
  };

  useEffect(() => {
    armInactivityTimer();
    return () => clearInactivityTimer();
  }, [open, turno.minhaPosicao, closing]);

  const dragRef = useRef<{ dragging: boolean; moved: boolean; startY: number; startPos: number }>({
    dragging: false, moved: false, startY: 0, startPos: 0.5,
  });

  const hiddenHere = useMemo(() => hiddenRoutes.includes(pathname), [hiddenRoutes, pathname]);

  // Auto-abre quando for a sua vez (mesmo em rotas ocultas)
  useEffect(() => {
    if (turno.minhaPosicao === 0) setOpen(true);
  }, [turno.minhaPosicao]);

  const toggleHidden = () => {
    const next = hiddenHere
      ? hiddenRoutes.filter((r) => r !== pathname)
      : [...hiddenRoutes, pathname];
    setHiddenRoutes(next);
    writeHidden(next);
    if (!hiddenHere) setOpen(false);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    dragRef.current = { dragging: true, moved: false, startY: e.clientY, startPos: posY };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current.dragging) return;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.abs(dy) > 3) dragRef.current.moved = true;
    const h = window.innerHeight;
    const next = Math.max(0.02, Math.min(0.98, dragRef.current.startPos + dy / h));
    setPosY(next);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragRef.current.dragging) return;
    const moved = dragRef.current.moved;
    dragRef.current.dragging = false;
    if (moved) {
      try { localStorage.setItem(POSITION_KEY, String(posY)); } catch {}
      e.preventDefault();
      e.stopPropagation();
    }
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  };
  const handleClick = (cb: () => void) => (e: React.MouseEvent) => {
    if (dragRef.current.moved) { e.preventDefault(); e.stopPropagation(); dragRef.current.moved = false; return; }
    cb();
  };

  const positionStyle = { top: `${posY * 100}%`, transform: "translateY(-50%)" } as const;

  const isMyTurn = turno.minhaPosicao === 0;
  const total = turno.fila.length;

  // Quando oculto, mostra apenas um sliver minúsculo para reabrir
  if (hiddenHere && !isMyTurn && !open) {
    return (
      <button
        type="button"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={handleClick(toggleHidden)}
        title="Mostrar Ordem de Turno aqui (arraste para mover)"
        style={positionStyle}
        className="fixed right-0 z-30 w-1.5 h-10 rounded-l bg-primary/30 hover:bg-primary/60 transition-colors touch-none cursor-grab active:cursor-grabbing"
      />
    );
  }

  return (
    <>
      <button
        type="button"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={handleClick(() => setOpen((v) => !v))}
        onMouseEnter={() => { if (open) registerInteraction(); }}
        onMouseMove={() => { if (open) registerInteraction(); }}
        title="Ordem de Turno (arraste para mover)"
        style={positionStyle}
        className={`fixed right-0 z-40 flex flex-col items-center gap-1 px-1.5 py-2 rounded-l-lg border border-r-0 shadow-lg transition-colors duration-500 touch-none cursor-grab active:cursor-grabbing ${
          isMyTurn
            ? "bg-emerald-500/90 border-emerald-400 text-white animate-pulse"
            : "bg-primary/90 border-primary/60 text-primary-foreground hover:bg-primary"
        } ${autoHidden && !isMyTurn && !open ? "opacity-20 translate-x-[60%] hover:opacity-100 hover:translate-x-0" : "opacity-100"}`}
      >

        <Users className="w-4 h-4" />
        <span className="text-[10px] font-bold leading-none rounded-full bg-background/30 min-w-[18px] h-[18px] flex items-center justify-center px-1">
          {total}
        </span>
      </button>


      {open && (
        <>
          
          <div
            onMouseEnter={registerInteraction}
            onMouseMove={registerInteraction}
            onPointerDown={registerInteraction}
            onWheel={registerInteraction}
            className={`fixed right-3 top-1/2 -translate-y-1/2 z-50 w-72 rounded-lg border shadow-2xl bg-card origin-right ${
              isMyTurn ? "border-emerald-500/60" : "border-primary/40"
            } ${closing ? "animate-shrink-to-toggle pointer-events-none" : ""}`}
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-border/60">
              <div className="flex items-center gap-1.5">
                <ListOrdered className="w-3.5 h-3.5 text-primary" />
                <span className="text-[11px] font-bold uppercase tracking-wider">Ordem de Turno</span>
              </div>
              <div className="flex items-center gap-0.5">
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={toggleHidden} title={hiddenHere ? "Mostrar nesta página" : "Ocultar nesta página"}>
                  {hiddenHere ? <EyeOff className="w-3 h-3 text-muted-foreground" /> : <Eye className="w-3 h-3" />}
                </Button>
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={turno.toggleEnabled} title={turno.enabled ? "Desativar notificação" : "Ativar notificação"}>
                  {turno.enabled ? <Bell className="w-3 h-3 text-emerald-400" /> : <BellOff className="w-3 h-3 text-muted-foreground" />}
                </Button>
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={turno.reload} disabled={turno.loading}>
                  {turno.loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                </Button>
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setOpen(false)}>
                  <X className="w-3 h-3" />
                </Button>
              </div>
            </div>

            <RodadasBar
              rodadasHoje={turno.rodadasHoje}
              fetchHistorico={turno.fetchHistoricoHoje}
            />


            <div className="p-2 max-h-[50vh] overflow-y-auto">
              {turno.fila.length === 0 ? (
                <p className="text-[11px] text-muted-foreground text-center py-3">Fila vazia.</p>
              ) : (
                <div className="space-y-1">
                  {turno.fila.map((e, idx) => {
                    const isMe = e.username === turno.myUsername;
                    return (
                      <div
                        key={e.username}
                        className={`flex items-center gap-1 px-2 py-1.5 rounded text-xs border ${
                          idx === 0
                            ? isMe
                              ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-300 font-bold"
                              : "bg-amber-500/15 border-amber-500/40 text-amber-300 font-bold"
                            : isMe
                              ? "bg-primary/15 border-primary/40 text-primary font-semibold"
                              : "bg-muted/40 border-border/40"
                        }`}
                      >
                        <span className="opacity-60 w-5 text-center">{idx + 1}º</span>
                        <span className="flex-1 truncate">{e.nome}</span>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <Button
                            size="icon" variant="ghost" className="h-5 w-5"
                            onClick={() => turno.mover(e.username, "cima")}
                            disabled={idx === 0 || turno.loading}
                            title="Subir"
                          >
                            <ChevronUp className="w-3 h-3" />
                          </Button>
                          <Button
                            size="icon" variant="ghost" className="h-5 w-5"
                            onClick={() => turno.mover(e.username, "baixo")}
                            disabled={idx === turno.fila.length - 1 || turno.loading}
                            title="Descer"
                          >
                            <ChevronDown className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="p-2 border-t border-border/60 space-y-1.5">
              <div className="grid grid-cols-2 gap-1.5">
                {turno.naFila ? (
                  <Button
                    variant="outline" className="h-9 gap-1.5 text-xs text-destructive hover:text-destructive"
                    onClick={turno.sair}
                    disabled={turno.loading}
                  >
                    <LogOut className="w-3 h-3" /> Sair
                  </Button>
                ) : (
                  <Button
                    variant="outline" className="h-9 gap-1.5 text-xs"
                    onClick={turno.entrar}
                    disabled={turno.loading}
                  >
                    <LogIn className="w-3 h-3" /> Entrar
                  </Button>
                )}
                <Button
                  className="h-9 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs"
                  onClick={turno.passarVez}
                  disabled={!isMyTurn || turno.loading}
                >
                  Passar a vez
                </Button>
              </div>
              <p className="text-[9px] text-muted-foreground text-center">
                {turno.enabled ? "Notificação ON" : "Notificação OFF"}
                {hiddenHere && " · oculto nesta página"}
              </p>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function RodadasBar({
  rodadasHoje,
  fetchHistorico,
}: {
  rodadasHoje: number;
  fetchHistorico: () => Promise<Array<{ rotated_username: string; created_at: string }>>;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Array<{ rotated_username: string; created_at: string }>>([]);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next) {
      setLoading(true);
      try { setItems(await fetchHistorico()); } finally { setLoading(false); }
    }
  };

  return (
    <div className="px-3 py-1.5 border-b border-border/60 bg-muted/20">
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center justify-between gap-2 text-[11px] hover:text-primary transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <RotateCw className="w-3 h-3 text-primary" />
          <span className="font-semibold">Rodadas hoje:</span>
          <span className="font-bold text-primary tabular-nums">{rodadasHoje}</span>
        </span>
        <span className="flex items-center gap-1 text-muted-foreground">
          <History className="w-3 h-3" />
          {open ? "ocultar" : "histórico"}
        </span>
      </button>
      {open && (
        <div className="mt-1.5 max-h-32 overflow-y-auto rounded border border-border/40 bg-background/60">
          {loading ? (
            <p className="text-[10px] text-muted-foreground text-center py-2">Carregando…</p>
          ) : items.length === 0 ? (
            <p className="text-[10px] text-muted-foreground text-center py-2">Nenhuma rodada registrada hoje.</p>
          ) : (
            <ul className="divide-y divide-border/30">
              {items.map((it, i) => (
                <li key={i} className="flex items-center justify-between px-2 py-1 text-[10px]">
                  <span className="truncate">{it.rotated_username}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {new Date(it.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
