import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { X, ExternalLink, FileText, Paperclip, ThumbsUp, Check, SkipForward } from "lucide-react";
import { toast } from "sonner";
import {
  useComprovantePopups,
  dismissComprovantePopup,
  updateComprovantePopup,
  type ComprovantePopup,
} from "@/lib/comprovantePopups";
import { useDkDashTurno } from "@/hooks/useDkDashTurno";

const CARD_W = 460;
const CARD_H = 500;

function PopupItem({ item, index, total, isMyTurn, passarVez, hasTurno }: { item: ComprovantePopup; index: number; total: number; isMyTurn: boolean; passarVez: () => Promise<void> | void; hasTurno: boolean }) {
  // Posição inicial: centralizado, com pequeno offset se houver vários empilhados
  const initialPos = () => {
    if (typeof window === "undefined") return { x: 24, y: 24 };
    const cx = Math.max(0, (window.innerWidth - CARD_W) / 2);
    const cy = Math.max(0, (window.innerHeight - CARD_H) / 2);
    const offset = (index - (total - 1) / 2) * 32;
    return {
      x: Math.max(12, Math.min(window.innerWidth - CARD_W - 12, cx + offset)),
      y: Math.max(12, Math.min(window.innerHeight - 200, cy + offset)),
    };
  };

  const [pos, setPos] = useState(initialPos);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const dragOffset = useRef<{ dx: number; dy: number } | null>(null);
  const draggedRef = useRef(false);
  const [preview, setPreview] = useState(false);
  const [reacting, setReacting] = useState(false);
  const [skipping, setSkipping] = useState(false);

  const clampPosition = useCallback((x: number, y: number) => {
    const rect = cardRef.current?.getBoundingClientRect();
    const w = rect?.width || CARD_W;
    const h = rect?.height || CARD_H;
    return {
      x: Math.max(0, Math.min(Math.max(0, window.innerWidth - w), x)),
      y: Math.max(0, Math.min(Math.max(0, window.innerHeight - h), y)),
    };
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest("a,input,textarea,select,button,[data-nodrag]")) return;
      draggedRef.current = false;
      dragOffset.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [pos]
  );
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragOffset.current) return;
    draggedRef.current = true;
    setPos(clampPosition(e.clientX - dragOffset.current.dx, e.clientY - dragOffset.current.dy));
  }, [clampPosition]);
  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragOffset.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
  }, []);

  const isImage = item.mediaMime.startsWith("image/");
  const isPdf = item.mediaMime === "application/pdf";

  const openExternal = () => {
    if (!item.mediaDataUrl) return;
    try {
      const w = window.open();
      if (w) {
        w.document.write(
          isImage
            ? `<title>${item.mediaFilename || "Comprovante"}</title><body style="margin:0;background:#111;display:flex;align-items:center;justify-content:center;min-height:100vh;"><img src="${item.mediaDataUrl}" style="max-width:100%;max-height:100vh;"/></body>`
            : `<title>${item.mediaFilename || "Comprovante"}</title><iframe src="${item.mediaDataUrl}" style="border:0;width:100vw;height:100vh;"></iframe>`
        );
      }
    } catch {}
  };

  const reactThumbsUp = async () => {
    const api = (window as any).electronAPI;
    if (!api?.waReact) {
      toast.error("Reação disponível apenas no app desktop");
      return;
    }
    if (!item.msgId || !item.chatId) {
      toast.error("Sem referência da mensagem para reagir");
      return;
    }
    setReacting(true);
    try {
      const res = await api.waReact({ chat_id: item.chatId, msg_id: item.msgId, emoji: "👍" });
      if (res?.error) {
        toast.error(res.error.message || "Falha ao reagir");
      } else {
        updateComprovantePopup(item.id, { reactedEmoji: "👍" });
        toast.success("Reagiu com 👍");
      }
    } catch (e: any) {
      toast.error(e?.message || "Falha ao reagir");
    } finally {
      setReacting(false);
    }
  };

  const initials = (item.autor || "C")
    .split(" ")
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div
      ref={cardRef}
      className="fixed z-[10000] w-[420px] rounded-3xl border border-border/60 bg-card/95 shadow-2xl ring-1 ring-black/5 animate-scale-in overflow-hidden"
      style={{ left: pos.x, top: pos.y }}
      role="dialog"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* Drag handle bar */}
      <div className="flex items-center justify-between px-5 pt-4 pb-2 cursor-move select-none">
        <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          <Paperclip className="w-3.5 h-3.5" />
          Novo comprovante
        </div>
        <button
          data-nodrag
          onClick={() => dismissComprovantePopup(item.id)}
          className="h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
          title="Fechar"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Header: avatar + nome */}
      <div className="px-5 pb-4 flex items-center gap-3 cursor-move select-none">
        <div className="h-11 w-11 rounded-full bg-gradient-to-br from-primary/80 to-primary flex items-center justify-center text-primary-foreground font-semibold text-sm shrink-0">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-foreground truncate leading-tight">
            {item.autor || "Cliente"}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {item.grupo ? item.grupo : item.telefone || "WhatsApp"}
          </div>
        </div>
      </div>

      {/* Mensagem opcional */}
      {item.mensagem && (
        <div className="mx-5 mb-3 rounded-2xl bg-muted/60 px-3.5 py-2.5 text-[13px] text-foreground/90 whitespace-pre-wrap break-words max-h-20 overflow-auto">
          {item.mensagem}
        </div>
      )}

      {/* Preview do anexo */}
      <div className="mx-5 mb-4 rounded-2xl bg-muted/40 overflow-hidden">
        {item.mediaDataUrl ? (
          isImage ? (
            <button
              type="button"
              data-nodrag
              className="w-full block"
              onClick={() => {
                if (draggedRef.current) return;
                setPreview((p) => !p);
              }}
              title={preview ? "Reduzir" : "Ampliar"}
            >
              <img
                src={item.mediaDataUrl}
                alt="Comprovante"
                className={preview ? "w-full max-h-[55vh] object-contain" : "w-full max-h-56 object-cover"}
              />
            </button>
          ) : isPdf ? (
            <div className="p-6 flex flex-col items-center gap-2">
              <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center">
                <FileText className="w-7 h-7 text-primary" />
              </div>
              <span className="text-xs text-muted-foreground truncate max-w-full">
                {item.mediaFilename || "comprovante.pdf"}
              </span>
            </div>
          ) : (
            <div className="p-5 text-xs text-muted-foreground text-center">
              {item.mediaFilename || "anexo"}
            </div>
          )
        ) : (
          <div className="p-5 text-xs text-muted-foreground italic text-center">
            (mídia não pôde ser carregada)
          </div>
        )}
      </div>

      {/* Ações */}
      <div data-nodrag className="px-5 pb-4 flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          className="h-9 rounded-full flex-1 min-w-0 text-xs font-medium px-2"
          onClick={reactThumbsUp}
          disabled={reacting || !!item.reactedEmoji}
          title="Reagir com 👍 no WhatsApp"
        >
          {item.reactedEmoji ? (
            <><Check className="w-3.5 h-3.5 mr-1.5 text-emerald-500" /> Reagido</>
          ) : (
            <><ThumbsUp className="w-3.5 h-3.5 mr-1.5" /> Reagir</>
          )}
        </Button>
        {item.mediaDataUrl && (
          <Button
            size="sm"
            variant="ghost"
            className="h-9 rounded-full flex-1 min-w-0 text-xs font-medium px-2"
            onClick={openExternal}
          >
            <ExternalLink className="w-3.5 h-3.5 mr-1.5" /> Abrir
          </Button>
        )}
        {hasTurno && (
          <Button
            size="sm"
            variant="outline"
            className="h-9 rounded-full flex-1 min-w-0 text-xs font-medium px-2"
            disabled={!isMyTurn || skipping}
            onClick={async () => {
              setSkipping(true);
              try { await passarVez(); } finally { setSkipping(false); }
            }}
            title={isMyTurn ? "Passar a vez no turno" : "Não é a sua vez"}
          >
            <SkipForward className="w-3.5 h-3.5 mr-1.5" /> Passar vez
          </Button>
        )}
        <Button
          size="sm"
          className="h-9 rounded-full px-4 text-xs font-semibold shrink-0"
          onClick={() => dismissComprovantePopup(item.id)}
        >
          OK
        </Button>
      </div>
    </div>
  );
}

export default function ComprovantePopupsHost() {
  const items = useComprovantePopups();
  const { fila, myUsername, passarVez } = useDkDashTurno("montante");
  const isMyTurn = !!(myUsername && fila[0]?.username === myUsername);
  const hasTurno = fila.length > 0;
  if (!items.length || typeof document === "undefined") return null;
  return createPortal(
    <>
      {/* Backdrop dimmer + blur, como o TurnoAlert. Não fecha ao clicar (evita fechar por engano com drag). */}
      <div className="fixed inset-0 z-[9998] bg-black/50 animate-in fade-in pointer-events-none" />
      {items.map((it, i) => (
        <PopupItem key={it.id} item={it} index={i} total={items.length} isMyTurn={isMyTurn} passarVez={passarVez} hasTurno={hasTurno} />
      ))}
    </>,
    document.body
  );
}
