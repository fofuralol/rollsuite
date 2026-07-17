import { createContext, memo, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Send, Reply, X, FileText, Download, Smile, Copy, Forward, Pin, Trash2, Star, Settings, FolderOpen, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useWhatsApp, type WaMessage } from "@/hooks/useWhatsApp";
import { IS_DESKTOP } from "@/lib/runtime";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from "@/components/ui/context-menu";
import { toast } from "sonner";

const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

type ReplyTarget = { id: string; source_msg_id: string; autor: string; preview: string };

const MAX_HISTORY_PER_GROUP = 20;
const MAX_TOTAL_PER_GROUP = 200;

const ChatBoundaryContext = createContext<HTMLElement | null>(null);


function fmtTime(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function colorFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 70% 45%)`;
}

function sortAsc(list: WaMessage[]) {
  return [...list].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

function rawIdentity(raw: any) {
  return raw?.source_msg_id ? `srcmsg:${raw.source_msg_id}` : String(raw?.id || `raw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

function rawToMessage(raw: any): WaMessage | null {
  if (!raw?.grupo) return null;
  return {
    id: rawIdentity(raw),
    autor: raw.autor || "",
    telefone: raw.telefone || "",
    grupo: raw.grupo,
    mensagem: raw.mensagem || "",
    matched: Array.isArray(raw.matched) ? raw.matched : [],
    created_at: raw.created_at || raw.horario || new Date().toISOString(),
    source_chat_id: raw.source_chat_id || raw.grupo_id || "",
    source_msg_id: raw.source_msg_id || "",
    source_author_id: raw.source_author_id || "",
    from_me: !!raw.from_me,
    media_data_url: raw.media_data_url || "",
    media_mime: raw.media_mime || "",
    media_filename: raw.media_filename || "",
    media_kind: raw.media_kind || "",
    quoted_msg_id: raw.quoted_msg_id || "",
    quoted_body: raw.quoted_body || "",
  } as WaMessage;
}

export function LiveGroupChatCard() {
  const { messages } = useWhatsApp();
  const seededRef = useRef(false);
  const [groups, setGroups] = useState<Record<string, WaMessage[]>>({});
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  // reactionsBySrc[source_msg_id][senderId] = emoji ("" remove)
  const [reactionsBySrc, setReactionsBySrc] = useState<Record<string, Record<string, string>>>({});

  // Seed with the last 20 msgs per group once messages become available.
  useEffect(() => {
    if (seededRef.current) return;
    if (!messages || messages.length === 0) return;
    const filtered = messages.filter((m) => !!m.grupo);
    if (filtered.length === 0) return;

    const byGroup: Record<string, WaMessage[]> = {};
    for (const m of sortAsc(filtered)) {
      const g = m.grupo!;
      (byGroup[g] ||= []).push(m);
      seenIdsRef.current.add(m.id);
      if (m.source_msg_id) seenIdsRef.current.add(`srcmsg:${m.source_msg_id}`);
    }
    for (const g of Object.keys(byGroup)) {
      byGroup[g] = byGroup[g].slice(-MAX_HISTORY_PER_GROUP);
    }
    setGroups(byGroup);
    seededRef.current = true;
    const first = Object.keys(byGroup)[0] || null;
    setActiveGroup((prev) => prev ?? first);
  }, [messages]);

  // Live-append new messages (feed filtrado por keyword).
  useEffect(() => {
    if (!seededRef.current) return;
    if (!messages || messages.length === 0) return;
    const incoming = messages.filter((m) => {
      if (!m.grupo) return false;
      if (seenIdsRef.current.has(m.id)) return false;
      if (m.source_msg_id && seenIdsRef.current.has(`srcmsg:${m.source_msg_id}`)) return false;
      return true;
    });
    if (incoming.length === 0) return;
    for (const m of incoming) {
      seenIdsRef.current.add(m.id);
      if (m.source_msg_id) seenIdsRef.current.add(`srcmsg:${m.source_msg_id}`);
    }

    setGroups((prev) => {
      const next = { ...prev };
      for (const m of sortAsc(incoming)) {
        const g = m.grupo!;
        // Remove qualquer versão anterior (raw ou não) com o mesmo source_msg_id.
        const src = m.source_msg_id;
        const base = next[g]
          ? next[g].filter((x) => {
              if (x.id === m.id) return false;
              if (src && x.source_msg_id === src) return false;
              return true;
            })
          : [];
        next[g] = sortAsc([...base, m]).slice(-MAX_TOTAL_PER_GROUP);
      }
      return next;
    });
  }, [messages]);


  // Raw feed (todas as mensagens dos grupos, sem filtro de keyword).
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.onWaRawMessage) return;
    const unsub = api.onWaRawMessage((raw: any) => {
      // Dedup: se já veio pelo feed principal (com id normal), ignora raw.
      const rawKey = rawIdentity(raw);
      const src = raw?.source_msg_id ? String(raw.source_msg_id) : "";
      if (seenIdsRef.current.has(rawKey)) return;
      if (src && seenIdsRef.current.has(`srcmsg:${src}`)) return;
      seenIdsRef.current.add(rawKey);
      if (src) seenIdsRef.current.add(`srcmsg:${src}`);
      const msg = rawToMessage(raw);
      if (!msg) return;
      setGroups((prev) => {
        const g = raw.grupo as string;
        const next = { ...prev };
        const base = next[g]
          ? next[g].filter((x) => {
              if (x.id === msg.id) return false;
              if (src && x.source_msg_id === src) return false;
              return true;
            })
          : [];
        next[g] = sortAsc([...base, msg]).slice(-MAX_TOTAL_PER_GROUP);
        return next;
      });
      // Marca aba ativa se ainda não houver.
      setActiveGroup((prev) => prev ?? raw.grupo);
      // Se ainda não seedou pelo feed principal, considera seedado agora.
      if (!seededRef.current) seededRef.current = true;
    });

    return () => { try { unsub?.(); } catch {} };
  }, []);

  // Reabre o app já com o histórico raw salvo localmente e dispara uma varredura
  // depois que o listener IPC acima está montado, para recuperar mensagens anteriores.
  useEffect(() => {
    if (!IS_DESKTOP) return;
    const api = (window as any).electronAPI;
    if (!api?.dbQuery) return;
    let cancelled = false;

    const mergeMessages = (list: WaMessage[]) => {
      if (!list.length || cancelled) return;
      const fresh: WaMessage[] = [];
      for (const msg of sortAsc(list)) {
        const key = msg.source_msg_id ? `srcmsg:${msg.source_msg_id}` : msg.id;
        if (seenIdsRef.current.has(key)) continue;
        seenIdsRef.current.add(key);
        if (msg.source_msg_id) seenIdsRef.current.add(msg.source_msg_id);
        fresh.push({ ...msg, id: key });
      }
      if (!fresh.length) return;
      setGroups((prev) => {
        const next = { ...prev };
        for (const msg of fresh) {
          const g = msg.grupo!;
          next[g] = sortAsc([...(next[g] || []), msg]).slice(-MAX_TOTAL_PER_GROUP);
        }
        return next;
      });
      setActiveGroup((prev) => prev ?? fresh[fresh.length - 1]?.grupo ?? null);
      seededRef.current = true;
    };

    (async () => {
      try {
        const res = await api.dbQuery({
          table: "wa_live_messages",
          action: "select",
          order: { col: "created_at", ascending: false },
          limit: 1000,
        });
        const rows = Array.isArray(res?.data) ? res.data : [];
        const parsed = rows.map(rawToMessage).filter(Boolean) as WaMessage[];
        // Dedup defensivo por source_msg_id / (grupo+autor+texto+segundo).
        const seenKeys = new Set<string>();
        const unique: WaMessage[] = [];
        for (const m of sortAsc(parsed)) {
          const ts = String(m.created_at || "").slice(0, 19);
          const key = m.source_msg_id
            ? `s|${m.grupo}|${m.source_msg_id}`
            : `f|${m.grupo}|${m.autor}|${m.mensagem}|${ts}`;
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
          unique.push(m);
        }
        mergeMessages(unique);
      } catch (e: any) {
        console.warn("[live-chat] histórico local indisponível", e?.message || e);
      }

      setTimeout(() => {
        try { api.waBackfill?.({ hours: 24, perChat: 100 }); } catch {}
      }, 300);
    })();

    return () => { cancelled = true; };
  }, []);

  // Reações em mensagens (feed raw).
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.onWaRawReaction) return;
    const unsub = api.onWaRawReaction((r: any) => {
      const src = r?.source_msg_id;
      if (!src) return;
      const sender = r.sender_id || "anon";
      const emoji = String(r.emoji || "");
      setReactionsBySrc((prev) => {
        const next = { ...prev };
        const forMsg = { ...(next[src] || {}) };
        if (!emoji) delete forMsg[sender];
        else forMsg[sender] = emoji;
        next[src] = forMsg;
        return next;
      });
    });
    return () => { try { unsub?.(); } catch {} };
  }, []);

  const groupNames = useMemo(() => {
    return Object.keys(groups).sort((a, b) => {
      const la = groups[a]?.[groups[a].length - 1];
      const lb = groups[b]?.[groups[b].length - 1];
      const ta = la ? new Date(la.created_at).getTime() : 0;
      const tb = lb ? new Date(lb.created_at).getTime() : 0;
      return tb - ta;
    });
  }, [groups]);

  useEffect(() => {
    if (activeGroup && groups[activeGroup]) return;
    if (groupNames.length > 0) setActiveGroup(groupNames[0]);
  }, [groupNames, activeGroup, groups]);

  const boundaryRef = useRef<HTMLElement | null>(null);
  const [boundaryEl, setBoundaryEl] = useState<HTMLElement | null>(null);
  useEffect(() => { setBoundaryEl(boundaryRef.current); }, []);

  return (
    <ChatBoundaryContext.Provider value={boundaryEl}>
    <section
      ref={boundaryRef}
      className="relative overflow-hidden rounded-2xl border border-border/60 bg-card"
    >
      <div className="relative p-2 sm:p-3">
        <div className="absolute top-1.5 right-1.5 z-10">
          <ChatSettingsButton />
        </div>





        {groupNames.length === 0 ? (
          <div className="h-[240px] flex items-center justify-center text-xs text-muted-foreground text-center px-4 rounded-xl bg-background/40 border border-border/40">
            Aguardando mensagens dos grupos monitorados…
          </div>
        ) : (
          <Tabs
            value={activeGroup ?? groupNames[0]}
            onValueChange={setActiveGroup}
            className="w-full"
          >
            <TabsList className="w-full h-auto flex flex-nowrap justify-start gap-1 overflow-x-auto bg-background/40 border border-border/40 p-1 scrollbar-thin">
              {groupNames.map((g) => (
                <TabsTrigger
                  key={g}
                  value={g}
                  className="shrink-0 text-[10px] px-1.5 py-0.5 max-w-[110px] truncate data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-300"
                  title={g}
                >
                  <span className="truncate">{g}</span>
                  <span className="ml-1 text-[9px] text-muted-foreground">
                    {groups[g]?.length ?? 0}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>

            {groupNames.map((g) => {
              const list = groups[g] || [];
              const chatId =
                [...list].reverse().find((m) => m.source_chat_id)?.source_chat_id || "";
              return (
                <TabsContent key={g} value={g} className="mt-2">
                  <GroupThread
                    list={list}
                    chatId={chatId}
                    groupName={g}
                    reactionsBySrc={reactionsBySrc}
                    onLocalSend={(msg) => {
                      seenIdsRef.current.add(msg.id);
                      setGroups((prev) => {
                        const next = { ...prev };
                        next[g] = [...(next[g] || []), msg].slice(-MAX_TOTAL_PER_GROUP);
                        return next;
                      });
                    }}
                  />
                </TabsContent>
              );
            })}
          </Tabs>
        )}
      </div>
    </section>
    </ChatBoundaryContext.Provider>
  );

}

function GroupThread({
  list,
  chatId,
  groupName,
  reactionsBySrc,
  onLocalSend,
}: {
  list: WaMessage[];
  chatId: string;
  groupName: string;
  reactionsBySrc: Record<string, Record<string, string>>;
  onLocalSend: (msg: WaMessage) => void;
}) {
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  return (
    <>
      <GroupMessages
        messages={list}
        reactionsBySrc={reactionsBySrc}
        onReply={setReplyTo}
      />
      <Composer
        chatId={chatId}
        groupName={groupName}
        replyTo={replyTo}
        clearReply={() => setReplyTo(null)}
        onLocalSend={onLocalSend}
      />
    </>
  );
}

function GroupMessages({
  messages,
  reactionsBySrc,
  onReply,
}: {
  messages: WaMessage[];
  reactionsBySrc: Record<string, Record<string, string>>;
  onReply: (r: ReplyTarget) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [hasNew, setHasNew] = useState(false);

  const scrollToBottom = (smooth = true) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  };

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAtBottom(near);
    if (near) setHasNew(false);
  };

  useEffect(() => {
    if (atBottom) {
      scrollToBottom(false);
    } else {
      setHasNew(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 64,
    overscan: 8,
    measureElement: (el) => el.getBoundingClientRect().height,
    getItemKey: (i) => messages[i]?.id ?? i,
  });

  return (
    <div className="relative">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-[240px] overflow-y-auto rounded-xl border border-border/40 p-3"
        style={{
          backgroundColor: "#0b141a",
          backgroundImage:
            "radial-gradient(rgba(255,255,255,0.025) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
          contain: "strict",
        }}
      >
        <div
          style={{
            height: virtualizer.getTotalSize(),
            width: "100%",
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((vi) => {
            const m = messages[vi.index];
            if (!m) return null;
            const prev = messages[vi.index - 1];
            const sameAuthor =
              prev && (prev.autor || prev.telefone) === (m.autor || m.telefone);
            const reactions = (m.source_msg_id && reactionsBySrc[m.source_msg_id]) || {};
            return (
              <div
                key={vi.key}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${vi.start}px)`,
                  contentVisibility: "auto",
                  containIntrinsicSize: "64px",
                } as React.CSSProperties}
              >
                <MessageBubble
                  message={m}
                  groupedWithPrev={!!sameAuthor}
                  reactions={reactions}
                  onReply={onReply}
                />
              </div>
            );
          })}
        </div>
      </div>
      {!atBottom && (
        <button
          type="button"
          onClick={() => scrollToBottom(true)}
          className="absolute bottom-3 right-3 flex items-center gap-1 rounded-full bg-primary text-primary-foreground shadow-lg px-3 py-1.5 text-xs font-medium hover:opacity-90 transition"
          aria-label="Ir para a última mensagem"
        >
          {hasNew && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
          <ChevronDown className="w-4 h-4" />
          {hasNew ? "Novas mensagens" : "Descer"}
        </button>
      )}
    </div>
  );
}

function MessageBubbleBase({
  message,
  groupedWithPrev,
  reactions,
  onReply,
}: {
  message: WaMessage;
  groupedWithPrev: boolean;
  reactions: Record<string, string>;
  onReply: (r: ReplyTarget) => void;
}) {
  const autor = message.autor || message.telefone || "Desconhecido";
  const color = colorFor(autor);
  const time = fmtTime(message.created_at);
  const canReply = !!message.source_msg_id;
  const fromMe = !!(message as any).from_me || !!(message as any).fromMe;
  const bubbleBg = fromMe ? "#005c4b" : "#202c33";
  const mediaKind = message.media_kind || "";
  const boundaryEl = useContext(ChatBoundaryContext);
  const mediaUrl = message.media_data_url || "";
  const mediaMime = message.media_mime || "";
  const mediaFilename = message.media_filename || "";
  const quoted = message.quoted_body || "";

  // Aglomera reações por emoji.
  const reactionSummary = Object.values(reactions || {}).reduce<Record<string, number>>((acc, e) => {
    if (!e) return acc;
    acc[e] = (acc[e] || 0) + 1;
    return acc;
  }, {});
  const reactionEntries = Object.entries(reactionSummary);

  async function doReact(emoji: string) {
    if (!message.source_msg_id) {
      toast.error("Reação disponível apenas em mensagens do WhatsApp");
      return;
    }
    const api = (window as any).electronAPI;
    if (!api?.waReact) {
      toast.error("Reações disponíveis apenas no app desktop");
      return;
    }
    const res = await api.waReact({ msg_id: message.source_msg_id, emoji });
    if (res?.error) toast.error(res.error.message || "Falha ao reagir");
  }

  function doCopy() {
    try {
      navigator.clipboard.writeText(message.mensagem || "");
      toast.success("Mensagem copiada");
    } catch {
      toast.error("Não foi possível copiar");
    }
  }

  async function doDownload() {
    if (!mediaUrl) return;
    const api = (window as any).electronAPI;
    if (api?.chatSaveMedia) {
      const res = await api.chatSaveMedia({
        dataUrl: mediaUrl,
        filename: mediaFilename,
        mime: mediaMime,
      });
      if (res?.error) {
        toast.error(res.error.message || "Falha ao salvar");
        return;
      }
      toast.success("Arquivo salvo");
      return;
    }
    // fallback (web)
    const a = document.createElement("a");
    a.href = mediaUrl;
    a.download = mediaFilename || `midia-${Date.now()}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function openMedia() {
    if (!mediaUrl) return;
    const api = (window as any).electronAPI;
    if (api?.chatOpenMedia) {
      const res = await api.chatOpenMedia({
        dataUrl: mediaUrl,
        filename: mediaFilename,
        mime: mediaMime,
      });
      if (res?.error) toast.error(res.error.message || "Falha ao abrir");
      return;
    }
    window.open(mediaUrl, "_blank");
  }


  const bubbleContent = (
    <div
      className="relative max-w-[85%] rounded-lg pl-2.5 pr-2 pt-1 pb-1 shadow-sm select-text"
      style={{ backgroundColor: bubbleBg }}
    >
      {!groupedWithPrev && (
        fromMe ? (
          <span
            className="absolute -right-1.5 top-0 w-0 h-0"
            style={{ borderTop: `8px solid ${bubbleBg}`, borderRight: "8px solid transparent" }}
            aria-hidden
          />
        ) : (
          <span
            className="absolute -left-1.5 top-0 w-0 h-0"
            style={{ borderTop: `8px solid ${bubbleBg}`, borderLeft: "8px solid transparent" }}
            aria-hidden
          />
        )
      )}

      {!groupedWithPrev && (
        <div
          className="text-[12px] font-semibold leading-tight mb-0.5"
          style={{ color }}
        >
          {autor}
        </div>
      )}

      {quoted && (
        <div className="mb-1 rounded-md bg-black/25 border-l-2 border-emerald-400 px-2 py-1">
          <div className="text-[11px] text-[#e9edef]/80 truncate">{quoted}</div>
        </div>
      )}

      {mediaKind === "image" && mediaUrl && (
        <img
          src={mediaUrl}
          alt={mediaFilename || "imagem"}
          className="mb-1 max-h-56 rounded-md cursor-pointer"
          onClick={openMedia}
        />
      )}
      {mediaKind === "video" && mediaUrl && (
        <video
          src={mediaUrl}
          controls
          className="mb-1 max-h-56 rounded-md"
        />
      )}
      {mediaKind === "audio" && mediaUrl && (
        <audio src={mediaUrl} controls className="mb-1 w-full min-w-[220px]" />
      )}
      {mediaKind === "document" && mediaUrl && (
        <button
          type="button"
          onClick={openMedia}
          className="mb-1 flex items-center gap-2 rounded-md bg-black/25 px-2 py-1.5 text-[12px] text-[#e9edef] hover:bg-black/40 w-full text-left"
        >
          <FileText className="w-4 h-4 shrink-0 text-emerald-300" />
          <span className="truncate flex-1">{mediaFilename || mediaMime || "arquivo"}</span>
          <Download className="w-3.5 h-3.5 shrink-0 opacity-70" />
        </button>
      )}

      {message.mensagem && (
        <div className="text-[13px] text-[#e9edef] whitespace-pre-wrap break-words leading-snug pr-10">
          {message.mensagem}
        </div>
      )}
      <div className="absolute right-2 bottom-0.5 text-[10px] text-[#e9edef]/60 leading-none">
        {time}
      </div>

      {reactionEntries.length > 0 && (
        <div className={`absolute -bottom-2 ${fromMe ? "right-2" : "left-2"} flex gap-0.5 rounded-full bg-[#2a3942] border border-black/40 px-1.5 py-0.5 shadow`}>
          {reactionEntries.map(([emoji, count]) => (
            <span key={emoji} className="text-[11px] leading-none">
              {emoji}{count > 1 ? <span className="text-[9px] text-[#e9edef]/80 ml-0.5">{count}</span> : null}
            </span>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className={`group flex ${fromMe ? "justify-end" : "justify-start"} ${groupedWithPrev ? "mt-0.5" : "mt-2"} ${reactionEntries.length > 0 ? "mb-2" : ""}`}>
      {fromMe && canReply && (
        <button
          type="button"
          onClick={() =>
            onReply({
              id: message.id,
              source_msg_id: message.source_msg_id || "",
              autor,
              preview: (message.mensagem || "[mídia]").slice(0, 120),
            })
          }
          className="opacity-0 group-hover:opacity-100 transition-opacity mr-1 self-center p-1 rounded hover:bg-white/10 text-[#e9edef]/70"
          title="Responder"
        >
          <Reply className="w-3.5 h-3.5" />
        </button>
      )}
      <ContextMenu>
        <ContextMenuTrigger asChild>{bubbleContent}</ContextMenuTrigger>
        <ContextMenuContent
          className="w-52"
          collisionBoundary={boundaryEl ? [boundaryEl] : undefined}
          collisionPadding={8}
        >
          <ContextMenuItem
            disabled={!canReply}
            onSelect={() =>
              onReply({
                id: message.id,
                source_msg_id: message.source_msg_id || "",
                autor,
                preview: (message.mensagem || "[mídia]").slice(0, 120),
              })
            }
          >
            <Reply className="w-3.5 h-3.5 mr-2" /> Responder
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger disabled={!canReply}>
              <Smile className="w-3.5 h-3.5 mr-2" /> Reagir
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <div className="flex gap-1 p-1">
                {REACTION_EMOJIS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => doReact(e)}
                    className="text-lg leading-none px-1.5 py-1 rounded hover:bg-accent"
                  >
                    {e}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => doReact("")}
                  className="text-xs leading-none px-1.5 py-1 rounded hover:bg-accent text-muted-foreground"
                  title="Remover reação"
                >
                  ✕
                </button>
              </div>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuItem onSelect={doCopy} disabled={!message.mensagem}>
            <Copy className="w-3.5 h-3.5 mr-2" /> Copiar
          </ContextMenuItem>
          {mediaUrl && (
            <ContextMenuItem onSelect={doDownload}>
              <Download className="w-3.5 h-3.5 mr-2" /> Baixar mídia
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem disabled>
            <Forward className="w-3.5 h-3.5 mr-2" /> Encaminhar
          </ContextMenuItem>
          <ContextMenuItem disabled>
            <Star className="w-3.5 h-3.5 mr-2" /> Favoritar
          </ContextMenuItem>
          <ContextMenuItem disabled>
            <Pin className="w-3.5 h-3.5 mr-2" /> Fixar
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem disabled className="text-destructive focus:text-destructive">
            <Trash2 className="w-3.5 h-3.5 mr-2" /> Apagar
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {!fromMe && canReply && (
        <button
          type="button"
          onClick={() =>
            onReply({
              id: message.id,
              source_msg_id: message.source_msg_id || "",
              autor,
              preview: (message.mensagem || "[mídia]").slice(0, 120),
            })
          }
          className="opacity-0 group-hover:opacity-100 transition-opacity ml-1 self-center p-1 rounded hover:bg-white/10 text-[#e9edef]/70"
          title="Responder"
        >
          <Reply className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

const MessageBubble = memo(MessageBubbleBase, (prev, next) =>
  prev.message.id === next.message.id &&
  prev.groupedWithPrev === next.groupedWithPrev &&
  prev.reactions === next.reactions
);

function Composer({
  chatId,
  groupName,
  replyTo,
  clearReply,
  onLocalSend,
}: {
  chatId: string;
  groupName: string;
  replyTo: ReplyTarget | null;
  clearReply: () => void;
  onLocalSend: (msg: WaMessage) => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSend() {
    const value = text.trim();
    if (!value) return;
    if (!chatId) {
      toast.error("Aguardando mensagens do grupo para identificar o chat");
      return;
    }
    const api = (window as any).electronAPI;
    if (!api?.waSendNow) {
      toast.error("Envio disponível apenas no app desktop");
      return;
    }
    setSending(true);
    try {
      const res = await api.waSendNow({
        chat_id: chatId,
        quoted_msg_id: replyTo?.source_msg_id || "",
        text: value,
      });
      if (res?.error) {
        toast.error(res.error.message || "Falha ao enviar");
      } else {
        const sent = res?.data || {};
        const localMsg: WaMessage = {
          id: sent.source_msg_id ? `srcmsg:${sent.source_msg_id}` : `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          autor: "Você",
          telefone: "",
          grupo: groupName,
          mensagem: value,
          matched: [],
          created_at: sent.created_at || new Date().toISOString(),
          source_chat_id: sent.source_chat_id || chatId,
          source_msg_id: sent.source_msg_id || "",
          source_author_id: "",
          from_me: true,
        } as WaMessage;
        onLocalSend(localMsg);
        setText("");
        clearReply();
      }
    } catch (e: any) {
      toast.error(e?.message || "Falha ao enviar");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-2 rounded-xl border border-border/40 bg-background/40 p-2">
      {replyTo && (
        <div className="mb-1 flex items-start gap-2 rounded-md bg-emerald-500/10 border-l-2 border-emerald-500 px-2 py-1">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold text-emerald-400 truncate">
              Respondendo a {replyTo.autor}
            </div>
            <div className="text-[11px] text-muted-foreground truncate">
              {replyTo.preview}
            </div>
          </div>
          <button
            type="button"
            onClick={clearReply}
            className="shrink-0 p-1 rounded hover:bg-white/10 text-muted-foreground"
            title="Cancelar resposta"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={replyTo ? `Responder a ${replyTo.autor}` : `Mensagem para ${groupName}`}
          rows={1}
          className="flex-1 resize-none bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none px-2 py-1.5 max-h-24"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={sending || !text.trim()}
          className="shrink-0 h-8 w-8 rounded-full flex items-center justify-center bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
          title="Enviar"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function ChatSettingsButton() {
  const [stats, setStats] = useState<{ count: number; bytes: number; dir?: string } | null>(null);
  const [open, setOpen] = useState(false);

  const api = (typeof window !== "undefined" ? (window as any).electronAPI : null);
  const isDesktop = !!api?.chatMediaStats;

  async function refresh() {
    if (!api?.chatMediaStats) return;
    const res = await api.chatMediaStats();
    if (res?.data) setStats(res.data);
  }
  useEffect(() => { if (open) refresh(); }, [open]);

  function fmtBytes(b: number) {
    if (!b) return "0 B";
    const u = ["B", "KB", "MB", "GB"];
    let i = 0; let v = b;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
  }

  async function clearAll() {
    if (!api?.chatClearMedia) return;
    if (!confirm("Limpar todos os arquivos baixados do chat?")) return;
    const res = await api.chatClearMedia();
    if (res?.error) { toast.error(res.error.message || "Falha ao limpar"); return; }
    toast.success(`${res.data?.count ?? 0} arquivo(s) removido(s)`);
    refresh();
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Configurações do chat">
          <Settings className="w-3.5 h-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3 space-y-3" align="end">
        <div className="text-xs font-semibold">Mídias do chat</div>
        {!isDesktop ? (
          <div className="text-[11px] text-muted-foreground">
            Disponível apenas no app desktop.
          </div>
        ) : (
          <>
            <div className="text-[11px] text-muted-foreground">
              {stats ? `${stats.count} arquivo(s) · ${fmtBytes(stats.bytes)}` : "Carregando…"}
            </div>
            <div className="flex flex-col gap-1.5">
              <Button size="sm" variant="outline" className="h-7 text-[11px] justify-start" onClick={() => api.chatOpenMediaDir?.()}>
                <FolderOpen className="w-3.5 h-3.5 mr-1.5" /> Abrir pasta
              </Button>
              <Button size="sm" variant="destructive" className="h-7 text-[11px] justify-start" onClick={clearAll}>
                <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Limpar todos os arquivos
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
