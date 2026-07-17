import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { ListOrdered, Bell, BellOff, RefreshCw, Loader2, Volume2, PlayCircle, Settings, ArrowLeft, MessageCircle, Sparkles, Crown, Copy, Trash2, FileText, RotateCcw, Play, CheckCircle2, ClipboardList, History, Undo2, ChevronLeft, ChevronRight, Eye, LayoutPanelLeft, Send, ChevronUp, ChevronDown, LogIn, LogOut, SkipForward, KeyRound, Calculator, Pencil, CheckCheck, Smile, Paperclip, Mic, X } from "lucide-react";
import { useSplitView } from "@/hooks/useSplitView";


import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useDkDashTurno, speakTurno, getStoredVolume, setStoredVolume } from "@/hooks/useDkDashTurno";
import { useWhatsApp } from "@/hooks/useWhatsApp";
import { useWaTasks, type WaTask } from "@/hooks/useWaTasks";
import { useAuth } from "@/hooks/useAuth";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { supabase } from "@/integrations/supabase/client";
import { formatBR, formatBRInt, formatBRL } from "@/lib/format";
import { useDkDashHojeStats } from "@/hooks/useDkDashHojeStats";

import MontanteDialog from "@/components/MontanteDialog";
import { CashHuntersAutoBar } from "@/components/CashHuntersAutoBar";
import OperarPromptDialog from "@/components/OperarPromptDialog";
import PixListDialog from "@/components/PixListDialog";
import TaskOperationDialog from "@/components/TaskOperationDialog";
import TaskImagePaste from "@/components/TaskImagePaste";
import ManualTaskDialog from "@/components/ManualTaskDialog";
import DkDashHojeCard from "@/components/DkDashHojeCard";
import IOSInstallDialog from "@/components/IOSInstallDialog";
import { getBancoColor } from "@/lib/bancoColors";
import { divisorDkDash } from "@/lib/divisorDkDash";
import { tierPctFor, loadPromoTiers, savePromoTiers, type PromoTier } from "@/lib/promoTiers";
import { Input } from "@/components/ui/input";
import { Plus, MessagesSquare } from "lucide-react";
import { LiveGroupChatCard } from "@/components/LiveGroupChatCard";
import { generatePixKeysForTask } from "@/lib/pixGen";
import { usePlatformMappings } from "@/hooks/usePlatformMappings";
import WaHeaderButton from "@/components/WaHeaderButton";
import { IS_DESKTOP } from "@/lib/runtime";
import appLogo from "@/assets/app-logo.png";
import MessageTimer, { getTimerMinutes, setTimerMinutes, getTimerVolume, setTimerVolume, getTimerAutoStart, setTimerAutoStart } from "@/components/MessageTimer";
import MessageTimerExtraSettings from "@/components/MessageTimerExtraSettings";
import { useLiveChatEnabled } from "@/hooks/useLiveChatEnabled";

const formatChaveCopy = (chave: string, tipo: string) => {
  const t = (tipo || "").toLowerCase();
  const isNumeric = t === "telefone" || t === "cpf" || t === "cnpj";
  return isNumeric ? (chave || "").replace(/\D/g, "") : (chave || "").trim();
};

function contasFromMessage(matched: string[] | undefined, mensagem: string | undefined): number | null {
  if (!matched || !mensagem) return null;
  const n = extractNumeric(matched, mensagem);
  if (n == null) return null;
  const c = Math.floor(n / 200);
  return c > 0 ? c : null;
}

async function ensureTaskPixKeys(
  task: WaTask,
  updatePixKeys: (id: string, keys: any[]) => Promise<void>,
) {
  if (task.pix_keys && task.pix_keys.length > 0) return task;
  const dc = (task.operation_data?.rows?.length) || contasFromMessage(task.matched, task.mensagem) || 1;
  const pixKeys = await generatePixKeysForTask({ count: dc, link: task.link, taskId: task.id });
  if (pixKeys.length > 0) {
    await updatePixKeys(task.id, pixKeys);
    return { ...task, pix_keys: pixKeys };
  }
  return task;
}

// Faixas configuráveis em src/lib/promoTiers.ts (editáveis via UI no dialog "Ativar Promoção").
function promoTierPct(n: number | null | undefined): number | undefined {
  return tierPctFor(n);
}

async function findOriginMessage(t: { autor?: string; grupo?: string; mensagem?: string; created_at?: string }) {
  // Tenta achar a mensagem original na tabela wa_messages para preencher chat_id quando a tarefa foi criada antes do listener v2
  try {
    let q = supabase
      .from("wa_messages")
      .select("source_chat_id, source_msg_id, source_author_id, created_at")
      .not("source_chat_id", "is", null)
      .neq("source_chat_id", "")
      .order("created_at", { ascending: false })
      .limit(1);
    if (t.autor) q = q.eq("autor", t.autor);
    if (t.grupo) q = q.eq("grupo", t.grupo);
    if (t.mensagem) q = q.eq("mensagem", t.mensagem);
    const { data } = await q.maybeSingle();
    return data as { source_chat_id: string; source_msg_id: string; source_author_id: string } | null;
  } catch { return null; }
}

function getOriginalWaMessageId(messageLike: { id?: string; source_msg_id?: string }) {
  const sourceMsgId = String(messageLike?.source_msg_id || "").trim();
  if (sourceMsgId) return sourceMsgId;
  return String(messageLike?.id || "").trim();
}

function isLikelyWaMessageId(value?: string) {
  const raw = String(value || "").trim();
  return !!raw && (raw.includes("_") || raw.includes("@") || raw.includes("false_") || raw.includes("true_"));
}

function resolvePrivateChatId(authorId?: string, _phone?: string) {
  // Usa SEMPRE o ID original do WhatsApp (@lid, @c.us, @s.whatsapp.net).
  // Nunca converter manualmente — quebra "Responder em Particular".
  const rawAuthorId = String(authorId || "").trim();
  if (!rawAuthorId) return "";
  if (rawAuthorId.endsWith("@g.us")) return ""; // não é privado
  return rawAuthorId;
}

const URL_RE = /\bhttps?:\/\/[^\s]+/i;
function extractUrl(text: string): string | null {
  const m = text?.match(URL_RE);
  return m ? m[0] : null;
}

function normalizeNumericString(s: string): string {
  // Se só tem vírgula(s) e os grupos pós-vírgula têm exatamente 3 dígitos,
  // tratar vírgula como separador de milhar (ex: "1,500" => 1500, "1,500,000" => 1500000).
  if (!s.includes(".") && s.includes(",")) {
    const parts = s.split(",");
    const allThousands = parts.slice(1).every((p) => /^\d{3}$/.test(p)) && /^\d{1,3}$/.test(parts[0]);
    if (allThousands) return s.replace(/,/g, "");
  }
  return s.replace(/\./g, "").replace(",", ".");
}

function parseNumberToken(raw: string): number | null {
  const t = raw.trim().toLowerCase();
  const kMatch = t.match(/^([\d.,]+)\s*([kmb])$/);
  if (kMatch) {
    const cleaned = normalizeNumericString(kMatch[1]);
    const n = parseFloat(cleaned);
    if (!isNaN(n) && isFinite(n)) {
      const mult = kMatch[2] === "k" ? 1000 : kMatch[2] === "m" ? 1000000 : 1000000000;
      return n * mult;
    }
  }
  if (/^[\d.,]+$/.test(t)) {
    const cleaned = normalizeNumericString(t);
    const n = parseFloat(cleaned);
    if (!isNaN(n) && isFinite(n)) return n;
  }
  return null;
}

// Limite plausível para "montante" — acima disso é quase certo um ID de link, telefone, etc.
const MAX_PLAUSIBLE_MONTANTE = 10_000_000;

function stripUrlsAndIds(text: string): string {
  return (text || "")
    // URLs com protocolo
    .replace(/\bhttps?:\/\/\S+/gi, " ")
    // URLs sem protocolo (ex: 91-taperedpg.com/?id=847910594)
    .replace(/\b[\w-]+\.(?:com|net|org|io|br|co|gg|me|app|dev|xyz|info|tv|live|site|online|store|link)(?:\/\S*)?/gi, " ")
    // qualquer "id=NUMERO" remanescente
    .replace(/\bid\s*[:=]\s*\d+/gi, " ")
    // sequências de 8+ dígitos puros (telefones, ids) — preserva números com pontos/vírgulas
    .replace(/\b\d{8,}\b/g, " ");
}

function extractNumeric(matched: string[], mensagem: string): number | null {
  const limpo = stripUrlsAndIds(mensagem);
  // Importante: NÃO permitir espaço entre o número e o sufixo k/m/b,
  // senão "1.500 montante" vira "1.500 m" e parseNumberToken lê 1.5 bilhões.
  const tokens = limpo.match(/\d[\d.,]*[kKmMbB]?(?![\w])/g) || [];

  // Para cada keyword matched, procuramos o token completo na mensagem que
  // a contenha (ex.: matched="500" deve virar 1500 quando a mensagem tem "1.500").
  for (const m of matched) {
    const mTrim = m.trim();
    if (!mTrim) continue;
    const direct = parseNumberToken(mTrim);
    // procura o maior token da mensagem (plausível) que "contém" essa keyword
    let best: number | null = null;
    for (const tk of tokens) {
      if (tk.replace(/\s+/g, "").includes(mTrim)) {
        const n = parseNumberToken(tk);
        if (n != null && n <= MAX_PLAUSIBLE_MONTANTE && (best == null || n > best)) best = n;
      }
    }
    if (best != null) return best;
    if (direct != null && direct <= MAX_PLAUSIBLE_MONTANTE) return direct;
  }
  // fallback: varre a mensagem por tokens tipo "1k", "2.5k", "1500"
  for (const tk of tokens) {
    const n = parseNumberToken(tk);
    if (n != null && n >= 100 && n <= MAX_PLAUSIBLE_MONTANTE) return n;
  }
  return null;
}

function buildTemplate(xxx: string, yyy: string, www: string, contas: number | null, _percent?: number) {
  const palavra = contas === 1 ? "conta" : "contas";
  return `📌 PIX CELULAR\n💠 24988087916\n🏷️ GABRIEL MAX\n━━━━━━━━━━━━━━━\n🔸 Montante: ${xxx}\n💸 Valor: R$ ${yyy}\n📊 Até ${www} ${palavra}\n━━━━━━━━━━━━━━━\n⚡ Envio após confirmação do pagamento\n📩 Envie o comprovante para dar continuidade\n⚠️ Montante alto feito em apenas uma conta, será feito vários depósitos até atingir o valor total`;
}

function bonusPpFromMult(mult: number): number {
  if (Math.abs(mult - 1.10) < 0.001) return 0.10;
  if (Math.abs(mult - 1.04) < 0.001) return 0.04;
  return 0;
}

function templateFromMessage(matched: string[] | undefined, mensagem: string | undefined, basePercent: number = 0.20, promoActive: boolean = false, valueMultiplier: number = 1): string {
  const n = matched && mensagem ? extractNumeric(matched, mensagem) : null;
  if (n == null) return buildTemplate("xxx", "yyy", "www", null);
  const contas = Math.floor(n / 200);
  const tier = promoActive ? promoTierPct(n) : undefined;
  const eff = (tier ?? basePercent) + bonusPpFromMult(valueMultiplier);
  return buildTemplate(formatBRInt(n), formatBRInt(n * eff), String(contas), contas);
}

// Substitui apenas as linhas dinâmicas (Montante / Valor / contas) num modelo
// já editado pelo usuário, preservando cabeçalho, nome, chave, etc.
function applyValuesToEditedTemplate(
  skeleton: string,
  matched: string[] | undefined,
  mensagem: string | undefined,
  basePercent: number = 0.20,
  promoActive: boolean = false,
  valueMultiplier: number = 1,
): string {
  if (!skeleton) return skeleton;
  const n = matched && mensagem ? extractNumeric(matched, mensagem) : null;
  let xxx = "xxx", yyy = "yyy", www = "www";
  let contas: number | null = null;
  if (n != null) {
    contas = Math.floor(n / 200);
    const tier = promoActive ? promoTierPct(n) : undefined;
    const eff = (tier ?? basePercent) + bonusPpFromMult(valueMultiplier);
    xxx = formatBRInt(n);
    yyy = formatBRInt(n * eff);
    www = String(contas);
  }
  const palavra = contas === 1 ? "conta" : "contas";
  return skeleton
    .split("\n")
    .map((line) => {
      // Montante: <valor>
      if (/montante\s*:/i.test(line)) {
        return line.replace(/(montante\s*:\s*).*/i, `$1${xxx}`);
      }
      // Valor: R$ <valor>  (também aceita "Valor:" sem R$)
      if (/valor\s*:/i.test(line)) {
        return line.replace(/(valor\s*:\s*)(r\$\s*)?.*/i, (_m, p1, p2) => `${p1}${p2 ?? "R$ "}${yyy}`);
      }
      // Até <num> conta(s)
      if (/at[ée]\s+/i.test(line) && /contas?/i.test(line)) {
        return line.replace(/(at[ée]\s+)\S+(\s+)contas?/i, `$1${www}$2${palavra}`);
      }
      return line;
    })
    .join("\n");
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

const MonitorPage = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { secondary, setSecondary } = useSplitView();
  const isSecondaryPane = secondary === "/monitor" && location.pathname !== "/monitor";
  useEffect(() => {
    if (!authLoading && !user) navigate("/auth", { replace: true });
  }, [authLoading, user, navigate]);
  const turno = useDkDashTurno("montante");
  const { messages, removeMessage } = useWhatsApp();
  const { tasks, pending, inProgress, active, done, addTask, updatePixKeys, updateOperation, updateImages, start, complete, reopen, remove: removeTask, reload } = useWaTasks();
  const { mappings: platformMappings, bulkAssign: assignPlatformGroup } = usePlatformMappings();
  const push = usePushNotifications();
  const [iosInstallOpen, setIosInstallOpen] = useState(false);
  const hojeStats = useDkDashHojeStats();


  const [voiceVolume, setVoiceVolume] = useState<number>(() => getStoredVolume());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importEmail, setImportEmail] = useState(() => {
    try { return localStorage.getItem("monitor_sync_email") || ""; } catch { return ""; }
  });
  const [importPwd, setImportPwd] = useState(() => {
    try { return localStorage.getItem("monitor_sync_pwd") || ""; } catch { return ""; }
  });
  useEffect(() => { try { localStorage.setItem("monitor_sync_email", importEmail); } catch {} }, [importEmail]);
  useEffect(() => { try { localStorage.setItem("monitor_sync_pwd", importPwd); } catch {} }, [importPwd]);
  const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pushEnabling, setPushEnabling] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(() => {
    try { return localStorage.getItem("monitor_push_forward_enabled") === "1"; } catch { return false; }
  });
  const isDesktop = typeof window !== "undefined" && !!(window as any).electronAPI;

  const handleEnablePush = async () => {
    if (!importEmail || !importPwd) { toast.error("Informe email e senha"); return; }
    setPushEnabling(true);
    try {
      const { activatePushForward } = await import("@/integrations/desktop/pushForward");
      await activatePushForward(importEmail, importPwd);
      setPushEnabled(true);
      toast.success("Push ativado — mensagens serão enviadas pro navegador/celular");
    } catch (e: any) {
      toast.error(e?.message || "Falha ao ativar push");
    } finally {
      setPushEnabling(false);
    }
  };
  const handleDisablePush = async () => {
    const { deactivatePushForward } = await import("@/integrations/desktop/pushForward");
    deactivatePushForward();
    setPushEnabled(false);
    toast.success("Push desativado");
  };
  const handleImportFromCloud = async () => {
    if (!importEmail || !importPwd) { toast.error("Informe email e senha"); return; }
    setImporting(true);
    try {
      const { importSlotCodesFromCloud } = await import("@/integrations/desktop/cloudImport");
      const r = await importSlotCodesFromCloud(importEmail, importPwd);
      toast.success(`Importado: ${r.tasks} tarefas, ${r.slots} slots (${r.imported} códigos), ${r.pix} chaves PIX`);
      setImportOpen(false);
      reload();
    } catch (e: any) {
      toast.error(e?.message || "Falha ao importar");
    } finally {
      setImporting(false);
    }
  };
  const handleSyncTasks = async () => {
    if (!importEmail || !importPwd) { toast.error("Informe email e senha"); return; }
    setSyncing(true);
    try {
      const { syncTasksBidirectional } = await import("@/integrations/desktop/cloudImport");
      const r = await syncTasksBidirectional(importEmail, importPwd);
      toast.success(`Sincronizado: ${r.pushed} enviadas, ${r.pulled} recebidas (total ${r.total})`);
      setImportOpen(false);
      reload();
    } catch (e: any) {
      toast.error(e?.message || "Falha ao sincronizar");
    } finally {
      setSyncing(false);
    }
  };
  const [manualTaskOpen, setManualTaskOpen] = useState(false);
  const [msgIdx, setMsgIdx] = useState(0);
  const [panelsOpen, setPanelsOpen] = useState(false);
  const [visiblePanels, setVisiblePanels] = useState(() => {
    try {
      const raw = localStorage.getItem("monitor-visible-panels-v1");
      if (raw) {
        const p = JSON.parse(raw);
        return { turno: p.turno !== false, whatsapp: p.whatsapp !== false, tasks: p.tasks !== false, template: p.template !== false, liveChat: p.liveChat !== false, montantes: p.montantes !== false };
      }
    } catch {}
    return { turno: true, whatsapp: true, tasks: true, template: true, liveChat: true, montantes: true };
  });
  const liveChatEnabled = useLiveChatEnabled();
  // Substitui a chave `liveChat` pela combinação com o toggle global; se o
  // usuário desativou o chat ao vivo nas configurações, ele some do Monitor
  // e o card volta a ser apenas o Modelo PIX.
  const effectiveVisible = { ...visiblePanels, liveChat: visiblePanels.liveChat && liveChatEnabled };
  useEffect(() => {
    try { localStorage.setItem("monitor-visible-panels-v1", JSON.stringify(visiblePanels)); } catch {}
  }, [visiblePanels]);
  const DEFAULT_PANEL_ORDER = ["whatsapp", "template", "liveChat", "tasks", "dkdash"] as const;
  type PanelKey = typeof DEFAULT_PANEL_ORDER[number];
  const [panelOrder, setPanelOrder] = useState<PanelKey[]>(() => {
    try {
      const raw = localStorage.getItem("monitor-panel-order-v1");
      if (raw) {
        const arr = JSON.parse(raw) as PanelKey[];
        const filtered = arr.filter((k) => (DEFAULT_PANEL_ORDER as readonly string[]).includes(k)) as PanelKey[];
        for (const k of DEFAULT_PANEL_ORDER) if (!filtered.includes(k)) filtered.push(k);
        return filtered;
      }
    } catch {}
    return [...DEFAULT_PANEL_ORDER];
  });
  useEffect(() => {
    try { localStorage.setItem("monitor-panel-order-v1", JSON.stringify(panelOrder)); } catch {}
  }, [panelOrder]);
  const orderOf = (k: PanelKey) => panelOrder.indexOf(k);
  const movePanel = (k: PanelKey, dir: -1 | 1) => {
    setPanelOrder((prev) => {
      const i = prev.indexOf(k);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };
  const [montanteTask, setMontanteTask] = useState<WaTask | null>(null);
  const [mergedTab, setMergedTab] = useState<"pix" | "chat">(() => {
    try { return (localStorage.getItem("monitor-merged-tab-v1") as "pix" | "chat") || "pix"; } catch { return "pix"; }
  });
  useEffect(() => { try { localStorage.setItem("monitor-merged-tab-v1", mergedTab); } catch {} }, [mergedTab]);
  const [operarPrompt, setOperarPrompt] = useState<any | null>(null);
  const [pixDialog, setPixDialog] = useState<{ open: boolean; defaultCount: number | null; taskId: string | null }>({ open: false, defaultCount: null, taskId: null });
  const [opDialog, setOpDialog] = useState<{ open: boolean; task: WaTask | null }>({ open: false, task: null });
  const [narrationOpen, setNarrationOpen] = useState(false);
  const [narration, setNarration] = useState(() => {
    try {
      const raw = localStorage.getItem("wa-narration-settings-v1");
      if (raw) {
        const p = JSON.parse(raw);
        return { enabled: p.enabled !== false, volume: typeof p.volume === "number" ? p.volume : 1 };
      }
    } catch {}
    return { enabled: true, volume: 1 };
  });
  const saveNarration = (next: { enabled: boolean; volume: number }) => {
    setNarration(next);
    try { localStorage.setItem("wa-narration-settings-v1", JSON.stringify(next)); } catch {}
  };
  const ehSuaVez = turno.minhaPosicao === 0 && turno.fila.length > 0;

  // Auto-abre o prompt de Operar quando o usuário vem do WhatsApp Page (V2)
  useEffect(() => {
    if (!messages.length) return;
    let pendingId: string | null = null;
    try { pendingId = sessionStorage.getItem("wa_operar_msg_id"); } catch {}
    if (!pendingId) return;
    const target = messages.find((m) => m.id === pendingId);
    if (target) {
      setOperarPrompt(target);
      try { sessionStorage.removeItem("wa_operar_msg_id"); } catch {}
    }
  }, [messages]);


  const navMessages = useMemo(
    () => messages.filter((m) => (m.matched?.length ?? 0) > 0),
    [messages]
  );

  useEffect(() => { setMsgIdx(0); }, [navMessages[0]?.id]);
  useEffect(() => {
    if (msgIdx > navMessages.length - 1) setMsgIdx(Math.max(0, navMessages.length - 1));
  }, [navMessages.length, msgIdx]);

  const last = navMessages[msgIdx];


  const handleRemoveMsg = async (id: string) => {
    await removeMessage(id);
    setMsgIdx((i) => Math.max(0, Math.min(i, navMessages.length - 2)));
  };

  // Janelas históricas da promoção: [{start, end?}]. Cada ativação abre uma
  // nova janela; cada desativação fecha a janela atual. Tarefas criadas dentro
  // de QUALQUER janela continuam sendo elegíveis pra sempre — desativar não
  // "desfaz" o passado, e reativar não invalida mensagens da janela anterior.
  type PromoWindow = { start: string; end: string | null };
  const PROMO_WINDOWS_KEY = "monitor_promo_windows";
  const loadPromoWindows = (): PromoWindow[] => {
    try {
      const raw = localStorage.getItem(PROMO_WINDOWS_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return arr.filter((w) => w && typeof w.start === "string");
      }
      // Migração das chaves antigas
      const oldActive = localStorage.getItem("monitor_promo_active") === "1";
      const oldAt = localStorage.getItem("monitor_promo_activated_at");
      if (oldAt) {
        return [{ start: oldAt, end: oldActive ? null : new Date().toISOString() }];
      }
    } catch {}
    return [];
  };
  const [promoWindows, setPromoWindows] = useState<PromoWindow[]>(() => loadPromoWindows());
  const promoActive = promoWindows.length > 0 && promoWindows[promoWindows.length - 1].end == null;
  useEffect(() => {
    try {
      localStorage.setItem(PROMO_WINDOWS_KEY, JSON.stringify(promoWindows));
      // Mantém chaves antigas em sync pra compatibilidade (DkDashHojeCard etc.)
      localStorage.setItem("monitor_promo_active", promoActive ? "1" : "0");
      const lastOpen = promoWindows.find((w) => w.end == null);
      if (lastOpen) localStorage.setItem("monitor_promo_activated_at", lastOpen.start);
      else localStorage.removeItem("monitor_promo_activated_at");
      window.dispatchEvent(new CustomEvent("promo-windows:changed"));
    } catch {}
  }, [promoWindows, promoActive]);
  const activatePromo = () => {
    setPromoWindows((prev) => {
      if (prev.length > 0 && prev[prev.length - 1].end == null) return prev;
      return [...prev, { start: new Date().toISOString(), end: null }];
    });
  };
  const deactivatePromo = () => {
    setPromoWindows((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.end != null) return prev;
      return [...prev.slice(0, -1), { ...last, end: new Date().toISOString() }];
    });
  };
  const isPromoFor = (createdAt?: string | null) => {
    if (!createdAt || promoWindows.length === 0) return false;
    return promoWindows.some((w) => createdAt >= w.start && (w.end == null || createdAt <= w.end));
  };
  const [dispoOpen, setDispoOpen] = useState(false);
  const [liveGroups, setLiveGroups] = useState<{ chat_id: string; grupo: string }[]>([]);
  useEffect(() => {
    if (!dispoOpen) return;
    const api = (window as any).electronAPI;
    if (!api?.waListGroups) return;
    api.waListGroups().then((res: any) => {
      if (Array.isArray(res?.data)) setLiveGroups(res.data);
    }).catch(() => {});
  }, [dispoOpen]);
  const DEFAULT_DISPO_MSG = "🚨 ATENÇÃO🚨\n\n💰Estou com disponibilidade no momento para SERVIÇO DE MONTANTE 💰\n\nSe alguém tiver interesse ou estiver precisando, pode responder aqui no grupo que já organizamos tudo. Trabalho com, agilidade e compromisso.\n\nFico à disposição 🤝";
  const [dispoMsg, setDispoMsg] = useState<string>(() => {
    try { return localStorage.getItem("monitor_dispo_msg") || DEFAULT_DISPO_MSG; } catch { return DEFAULT_DISPO_MSG; }
  });
  useEffect(() => { try { localStorage.setItem("monitor_dispo_msg", dispoMsg); } catch {} }, [dispoMsg]);
  const groupOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of messages) {
      const chatId = m.source_chat_id || "";
      if (!chatId.endsWith("@g.us")) continue;
      if (!map.has(chatId)) map.set(chatId, m.grupo || chatId);
    }
    return Array.from(map.entries()).map(([chat_id, grupo]) => ({ chat_id, grupo }))
      .sort((a, b) => a.grupo.localeCompare(b.grupo));
  }, [messages]);
  const sendDispo = async (chat_id: string, grupo: string) => {
    if (!user) { toast.error("Faça login"); return; }
    const api = (window as any).electronAPI;
    if (isDesktop && api?.waSendNow) {
      const res = await api.waSendNow({ chat_id, quoted_msg_id: "", text: dispoMsg });
      if (res?.error) { console.error("[wa:send-now] dispo error", res.error); toast.error(res.error.message || "Falha ao enviar disponibilidade"); }
      else { console.log("[wa:send-now] dispo OK"); toast.success(`Disponibilidade enviada para ${grupo}`); setDispoOpen(false); }
      return;
    }
    console.log("[outbox] dispo →", { user_id: user.id, chat_id, grupo, text: dispoMsg.slice(0, 60) });
    const { error } = await supabase.from("wa_outbox").insert({
      user_id: user.id, chat_id, quoted_msg_id: "", text: dispoMsg,
    });
    if (error) { console.error("[outbox] dispo insert error", error); toast.error(error.message); }
    else { console.log("[outbox] dispo enfileirado OK"); toast.success(`Disponibilidade enviada para ${grupo}`); setDispoOpen(false); }
  };
  const [promoOpen, setPromoOpen] = useState(false);
  const [promoTiersDraft, setPromoTiersDraft] = useState<PromoTier[]>(() => loadPromoTiers());
  // Recarrega draft das faixas quando abre o dialog (e quando outras instâncias alteram)
  useEffect(() => {
    if (promoOpen) setPromoTiersDraft(loadPromoTiers());
  }, [promoOpen]);
  useEffect(() => {
    const onChange = () => setPromoTiersDraft(loadPromoTiers());
    window.addEventListener("promo-tiers:changed", onChange);
    return () => window.removeEventListener("promo-tiers:changed", onChange);
  }, []);
  const [editOpen, setEditOpen] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  const DEFAULT_CONCLUSION = "Serviço concluído!✅\n\nAguarde entre 10 e 30 minutos para constar em seu painel.";
  const [conclusionTemplate, setConclusionTemplate] = useState<string>(DEFAULT_CONCLUSION);
  const [conclusionEditOpen, setConclusionEditOpen] = useState(false);
  const [conclusionDraft, setConclusionDraft] = useState<string>(DEFAULT_CONCLUSION);
  const conclusionHydratedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    conclusionHydratedRef.current = false;
    (async () => {
      if (!user?.id) { conclusionHydratedRef.current = true; return; }
      try {
        const { data } = await supabase
          .from("app_settings")
          .select("value")
          .eq("user_id", user.id)
          .eq("key", "monitor_conclusion_template")
          .maybeSingle();
        if (!cancelled && data?.value) setConclusionTemplate(data.value);
      } catch {}
      finally { if (!cancelled) conclusionHydratedRef.current = true; }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const saveConclusionTemplate = async (val: string) => {
    setConclusionTemplate(val);
    if (!user?.id) return;
    const { error } = await supabase.from("app_settings").upsert(
      [{ user_id: user.id, key: "monitor_conclusion_template", value: val }],
      { onConflict: "user_id,key" }
    );
    if (error) toast.error("Falha ao salvar modelo");
    else toast.success("Modelo de conclusão salvo");
  };
  // Template segue o estado ATUAL da promo (não o histórico da mensagem):
  // desativar promo volta o template ao % padrão imediatamente.
  const lastPromoEligible = promoActive;
  // Multiplicador opcional no valor (botões 2.5x / 3x) por tarefa.
  // 1 = sem bônus, 1.04 = +4%, 1.10 = +10%.
  const [valueMultByTask, setValueMultByTask] = useState<Record<string, number>>({});
  const currentMult = last?.id ? (valueMultByTask[last.id] ?? 1) : 1;
  const autoTemplate = useMemo(
    () => templateFromMessage(last?.matched, last?.mensagem, 0.20, lastPromoEligible, currentMult),
    [last?.id, lastPromoEligible, currentMult]
  );
  const [template, setTemplate] = useState<string>(autoTemplate);
  const [edited, setEdited] = useState(false);
  const [editedSkeleton, setEditedSkeleton] = useState<string>("");
  const templatePrefsHydratedRef = useRef(false);
  const templatePrefsSaveTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (user?.id) templatePrefsHydratedRef.current = false;
    const loadTemplatePrefs = async () => {
      if (!user?.id) {
        templatePrefsHydratedRef.current = true;
        return;
      }
      try {
        const { data, error } = await supabase
          .from("app_settings")
          .select("key, value")
          .eq("user_id", user.id)
          .in("key", ["monitor_pix_template_edited", "monitor_pix_template_skeleton"]);
        if (error) throw error;
        if (cancelled) return;
        const editedValue = data?.find((row) => row.key === "monitor_pix_template_edited")?.value;
        const skeletonValue = data?.find((row) => row.key === "monitor_pix_template_skeleton")?.value ?? "";
        const isEdited = editedValue === "true" && !!skeletonValue.trim();
        setEdited(isEdited);
        setEditedSkeleton(isEdited ? skeletonValue : "");
      } catch {
      } finally {
        if (!cancelled) templatePrefsHydratedRef.current = true;
      }
    };
    loadTemplatePrefs();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!edited) {
      setTemplate(autoTemplate);
    } else {
      setTemplate(
        applyValuesToEditedTemplate(
          editedSkeleton,
          last?.matched,
          last?.mensagem,
          0.20,
          lastPromoEligible,
          currentMult,
        ),
      );
    }
  }, [autoTemplate, edited, editedSkeleton, last?.id, lastPromoEligible, currentMult]);

  // Aplica o multiplicador escolhido na tarefa atual, atualizando também a %
  // do blogueiro armazenada em operation_data (somente pra essa tarefa).
  const applyValueMultiplier = useCallback(async (mult: number) => {
    if (!last?.id) return;
    setValueMultByTask((prev) => ({ ...prev, [last.id]: mult }));
    const n = extractNumeric(last.matched ?? [], last.mensagem ?? "");
    const tier = lastPromoEligible ? promoTierPct(n) : undefined;
    const basePct = tier ?? 0.20;
    const newPct = basePct + bonusPpFromMult(mult);
    const relatedIds = new Set([last.id, (last as any).source_msg_id].filter(Boolean));
    const relatedTask = active.find((t) => relatedIds.has(t.source_msg_id || ""))
      || done.find((t) => relatedIds.has(t.source_msg_id || ""));
    if (!relatedTask) return;
    const prevOp = (relatedTask.operation_data as any) || {};
    try {
      await updateOperation(relatedTask.id, { ...prevOp, blogueiroPercent: newPct, valueMultiplier: mult });
    } catch {}
  }, [last, lastPromoEligible, active, done, updateOperation]);



  useEffect(() => {
    if (!templatePrefsHydratedRef.current || !user?.id) return;
    if (templatePrefsSaveTimeoutRef.current) window.clearTimeout(templatePrefsSaveTimeoutRef.current);
    templatePrefsSaveTimeoutRef.current = window.setTimeout(async () => {
      const payload = [
        { user_id: user.id, key: "monitor_pix_template_edited", value: edited ? "true" : "false" },
        { user_id: user.id, key: "monitor_pix_template_skeleton", value: edited ? editedSkeleton : "" },
      ];
      const { error } = await supabase.from("app_settings").upsert(payload, { onConflict: "user_id,key" });
      if (error) console.error("Failed to save monitor template prefs", error);
    }, 150);

    return () => {
      if (templatePrefsSaveTimeoutRef.current) {
        window.clearTimeout(templatePrefsSaveTimeoutRef.current);
        templatePrefsSaveTimeoutRef.current = null;
      }
    };
  }, [user?.id, edited, editedSkeleton]);

  const copy = async (text: string) => {
    const ok = await copyText(text);
    if (ok) toast.success("Copiado"); else toast.error("Falha ao copiar");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/40 text-foreground flex flex-col">
      <header className="sticky top-0 z-20 bg-card/40">
        <div className="relative h-14 px-3 sm:px-5 flex items-center gap-3 max-w-6xl mx-auto w-full border-b border-border">
          <Button asChild variant="ghost" size="sm" className="h-9 px-2">
            <Link to="/"><ArrowLeft className="w-4 h-4" /></Link>
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary/30 to-emerald-500/30 flex items-center justify-center ring-1 ring-primary/30 shrink-0 overflow-hidden">
                <img src={appLogo} alt="" className="w-4 h-4 object-contain" />
              </div>
              {IS_DESKTOP ? (
                <WaHeaderButton />
              ) : (
                <>
                  <h1 className="text-sm sm:text-base font-bold tracking-tight">Monitor</h1>
                  <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground hidden sm:inline">Turno · WhatsApp</span>
                </>
              )}
            </div>
          </div>

          <div className="hidden lg:flex items-center gap-2 shrink-0 absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-auto">
            <div className="flex items-center gap-1.5 rounded-md border border-fuchsia-500/40 bg-background/40 px-2 py-1">
              <span className="text-[9px] font-bold tracking-[0.15em] text-muted-foreground">COMISSÃO</span>
              <span className="text-xs font-bold tabular-nums text-fuchsia-300">{formatBRL(hojeStats.comissao)}</span>
            </div>
            <div className="flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-background/40 px-2 py-1">
              <span className="text-[9px] font-bold tracking-[0.15em] text-muted-foreground">LÍQUIDO</span>
              <span className={`text-xs font-bold tabular-nums ${hojeStats.liquido >= 0 ? "text-emerald-400" : "text-red-400"}`}>{formatBRL(hojeStats.liquido)}</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {!IS_DESKTOP && push.supported && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 px-2"
                onClick={() => (push.enabled ? push.disable() : push.enable())}
                disabled={push.busy}
                title={push.enabled ? "Push ativo (celular bloqueado)" : "Ativar push (celular bloqueado)"}
              >
                {push.busy ? <Loader2 className="w-4 h-4 animate-spin" /> : push.enabled ? <Bell className="w-4 h-4 text-primary" /> : <BellOff className="w-4 h-4 text-muted-foreground" />}
              </Button>
            )}
            {!push.supported && push.needsIOSInstall && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 px-2"
                onClick={() => setIosInstallOpen(true)}
                title="Instalar app para ativar notificações no iPhone"
              >
                <BellOff className="w-4 h-4 text-amber-400" />
              </Button>
            )}

            {!IS_DESKTOP && (
              <>
                <Button variant="ghost" size="sm" className="h-9 px-2" onClick={turno.toggleEnabled} title={turno.enabled ? "Notif. ativas" : "Notif. desligadas"}>
                  {turno.enabled ? <Bell className="w-4 h-4 text-emerald-400" /> : <BellOff className="w-4 h-4 text-muted-foreground" />}
                </Button>
                <Button variant="ghost" size="sm" className="h-9 px-2" onClick={turno.reload} disabled={turno.loading} title="Atualizar fila">
                  {turno.loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                </Button>
              </>
            )}


            <Button asChild variant="ghost" size="sm" className="h-9 px-2" title="Configurar WhatsApp">
              <Link to="/whatsapp"><Settings className="w-4 h-4" /></Link>
            </Button>
            <Dialog open={panelsOpen} onOpenChange={setPanelsOpen}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="sm" className="h-9 px-2" title="Ocultar painéis">
                  <LayoutPanelLeft className="w-4 h-4" />
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-sm">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Eye className="w-4 h-4" /> Visibilidade dos painéis
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  {[
                    { key: "turno" as const, label: "Ordem de Turno", icon: ListOrdered, orderKey: null },
                    { key: "whatsapp" as const, label: "WhatsApp", icon: MessageCircle, orderKey: "whatsapp" as PanelKey },
                    { key: "tasks" as const, label: "Tarefas", icon: ClipboardList, orderKey: "tasks" as PanelKey },
                    { key: "template" as const, label: "Modelo PIX", icon: FileText, orderKey: "template" as PanelKey },
                    { key: "liveChat" as const, label: "Chat ao vivo", icon: MessagesSquare, orderKey: "liveChat" as PanelKey },
                    { key: "montantes" as const, label: "Montantes do Dia", icon: ListOrdered, orderKey: "dkdash" as PanelKey },
                  ].map((p) => (
                    <div key={p.key} className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm">
                        <p.icon className="w-4 h-4 text-muted-foreground" />
                        <span>{p.label}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        {p.orderKey && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              disabled={orderOf(p.orderKey) <= 0}
                              onClick={() => movePanel(p.orderKey!, -1)}
                              title="Mover para cima"
                            >
                              <ChevronUp className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              disabled={orderOf(p.orderKey) >= panelOrder.length - 1}
                              onClick={() => movePanel(p.orderKey!, 1)}
                              title="Mover para baixo"
                            >
                              <ChevronDown className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                        <Switch
                          checked={visiblePanels[p.key]}
                          onCheckedChange={(v) => setVisiblePanels((prev) => ({ ...prev, [p.key]: v }))}
                        />
                      </div>
                    </div>
                  ))}
                </div>

              </DialogContent>
            </Dialog>
            {isSecondaryPane && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 px-2"
                onClick={() => setSecondary(null)}
                title="Fechar painel"
              >
                <X className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </header>


      <main className="flex-1 px-2 sm:px-5 py-3 sm:py-6 max-w-6xl mx-auto w-full">
        <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 items-stretch">
          {visiblePanels.whatsapp && (
            <section style={{ order: orderOf("whatsapp") }} className="relative overflow-hidden rounded-2xl border border-emerald-400/50 bg-gradient-to-br from-emerald-500/15 via-emerald-500/5 to-transparent shadow-[0_0_60px_-15px_hsl(142_70%_45%/0.4)]">
              <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-emerald-500/20 blur-3xl pointer-events-none" />
              <div className="absolute -bottom-20 -left-20 w-64 h-64 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
              <div className="relative p-3 sm:p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-emerald-500/15 ring-1 ring-emerald-500/30">
                      <MessageCircle className="w-4 h-4 text-emerald-400" />
                    </div>
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">WhatsApp</div>
                      <div className="text-sm font-semibold">Última mensagem</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      onClick={() => setNarrationOpen(true)}
                      title="Configurações de narração"
                    >
                      <Settings className="w-4 h-4" />
                    </Button>
                    <Dialog open={narrationOpen} onOpenChange={setNarrationOpen}>
                      <DialogContent className="max-w-sm">
                        <DialogHeader>
                          <DialogTitle>Narração de mensagens</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4 pt-2">
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="text-sm font-medium">Narrar mensagens</div>
                              <div className="text-[11px] text-muted-foreground">Lê em voz alta as palavras-chave recebidas.</div>
                            </div>
                            <Switch
                              checked={narration.enabled}
                              onCheckedChange={(v) => saveNarration({ ...narration, enabled: v })}
                            />
                          </div>
                          <div className={narration.enabled ? "" : "opacity-50 pointer-events-none"}>
                            <div className="flex items-center justify-between mb-2">
                              <div className="text-sm font-medium">Volume</div>
                              <div className="text-[11px] text-muted-foreground tabular-nums">{Math.round(narration.volume * 100)}%</div>
                            </div>
                            <Slider
                              value={[Math.round(narration.volume * 100)]}
                              min={0}
                              max={100}
                              step={5}
                              onValueChange={([v]) => saveNarration({ ...narration, volume: v / 100 })}
                            />
                          </div>
                          <div className="border-t border-border/40 pt-3">
                            <div className="text-sm font-medium mb-1">Cronômetro da mensagem</div>
                            <div className="text-[11px] text-muted-foreground mb-2">Duração padrão (minutos). Toca um som ao terminar.</div>
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                step="0.5"
                                min="0.1"
                                defaultValue={getTimerMinutes()}
                                className="h-8 w-24 rounded-md border border-input bg-background px-2 text-sm"
                                onBlur={(e) => {
                                  const v = parseFloat(e.target.value.replace(",", "."));
                                  if (isFinite(v) && v > 0) {
                                    setTimerMinutes(v);
                                    toast.success(`Cronômetro: ${v} min`);
                                  } else {
                                    e.target.value = String(getTimerMinutes());
                                  }
                                }}
                                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                              />
                              <span className="text-[11px] text-muted-foreground">min</span>
                            </div>
                            <div className="mt-3">
                              <MessageTimerExtraSettings />
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full"
                            onClick={() => {
                              try {
                                const synth = window.speechSynthesis;
                                synth.cancel();
                                const u = new SpeechSynthesisUtterance("Teste de narração de mensagens.");
                                u.lang = "pt-BR";
                                u.volume = narration.volume;
                                u.pitch = 0.85;
                                const voices = synth.getVoices();
                                const male = voices.find((v) => /pt[-_]BR/i.test(v.lang) && /male|masc|daniel|ricardo|felipe|paulo|antonio|antônio|thiago|bruno|diego|google.*portugu/i.test(v.name) && !/female|fem/i.test(v.name))
                                  || voices.find((v) => /pt[-_]BR/i.test(v.lang) && !/female|fem|maria|luciana|joana|francisca|helena/i.test(v.name))
                                  || voices.find((v) => /pt[-_]BR/i.test(v.lang))
                                  || voices.find((v) => /pt/i.test(v.lang));
                                if (male) u.voice = male;
                                synth.speak(u);
                              } catch {}
                            }}
                          >
                            Testar narração
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                    {last && (
                    <div className="flex items-center gap-2">
                      {navMessages.length > 1 && (
                        <div className="flex items-center gap-0.5">
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={msgIdx >= navMessages.length - 1}
                            onClick={() => setMsgIdx((i) => Math.min(navMessages.length - 1, i + 1))} title="Anterior">
                            <ChevronLeft className="w-4 h-4" />
                          </Button>
                          <span className="text-[10px] text-muted-foreground tabular-nums px-1">{msgIdx + 1}/{navMessages.length}</span>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={msgIdx <= 0}
                            onClick={() => setMsgIdx((i) => Math.max(0, i - 1))} title="Próxima">
                            <ChevronRight className="w-4 h-4" />
                          </Button>
                        </div>
                      )}
                      <div className="text-[10px] text-muted-foreground tabular-nums">
                        {new Date(last.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                  )}
                  </div>
                </div>
                {!last ? (
                  <div className="py-10 text-center">
                    <MessageCircle className="w-8 h-8 mx-auto text-muted-foreground/40 mb-2" />
                    <div className="text-xs text-muted-foreground">Nenhuma mensagem ainda</div>
                    <div className="text-[11px] text-muted-foreground/70 mt-1">
                      Configure as palavras-chave em <Link to="/whatsapp" className="underline hover:text-primary">Monitor WhatsApp</Link>.
                    </div>
                  </div>
                ) : (
                  <div className={`rounded-xl border overflow-hidden transition-colors ${
                    last.pix_sent_at && !last.comprovante_at
                      ? "border-amber-400 bg-amber-400/10 shadow-[0_0_0_1px_hsl(45_100%_55%/0.45),0_0_28px_hsl(45_100%_55%/0.22)] animate-pix-blink"
                      : last.comprovante_at
                        ? "border-emerald-500/70 bg-emerald-500/10"
                        : "border-border/50 bg-background/40"
                  }`}>
                    <div className="px-4 py-3 border-b border-border/40 flex items-center justify-between gap-2 bg-muted/20">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500/30 to-primary/30 flex items-center justify-center text-[10px] font-bold uppercase">
                          {last.autor.slice(0, 2)}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-bold truncate">{last.autor}</div>
                          {last.telefone && <div className="text-[10px] text-muted-foreground truncate">{last.telefone}</div>}
                          {last.grupo && (
                            <div className="mt-0.5 inline-flex items-center gap-1 max-w-full rounded-md bg-emerald-500/15 ring-1 ring-emerald-500/40 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-300 truncate">
                              {last.grupo}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          className="h-7 gap-1 bg-emerald-500 text-emerald-950 hover:bg-emerald-500/90 font-bold text-[11px] px-2"
                          onClick={() => {
                            setOperarPrompt(last);
                          }}
                          title="Operar"
                        >
                          <Play className="w-3 h-3" /> Operar
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => copy(last.mensagem)} title="Copiar">
                          <Copy className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => handleRemoveMsg(last.id)} title="Remover">
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>

                    {last.matched.length > 0 && (
                      <div className="px-4 pt-3 flex flex-wrap gap-1">
                        {last.matched.map((p) => (
                          <Badge key={p} className="bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/20 border-emerald-500/30 text-[10px] h-5 font-bold">
                            {p}
                          </Badge>
                        ))}
                      </div>
                    )}

                    <div className="px-3 sm:px-4 py-3 pb-3 text-sm sm:text-base font-semibold leading-relaxed whitespace-pre-wrap break-words">
                      {last.mensagem}
                    </div>

                    <MessageTimer messageId={last.id} label={last.autor} isLatest={msgIdx === 0} />

                  </div>
                )}
              </div>
            </section>
          )}

          {(visiblePanels.template || effectiveVisible.liveChat) && (
            <div style={{ order: orderOf("liveChat") }} className="flex flex-col gap-2 min-w-0 min-h-[320px]">
              <div className="flex gap-1 p-0.5 rounded-lg bg-card/40 border border-border/40 self-start">
                {visiblePanels.template && (
                  <button
                    type="button"
                    onClick={() => setMergedTab("pix")}
                    className={`px-2 py-0.5 text-[10px] rounded-md transition-colors ${mergedTab === "pix" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    Modelo PIX
                  </button>
                )}
                {effectiveVisible.liveChat && (
                  <button
                    type="button"
                    onClick={() => setMergedTab("chat")}
                    className={`px-2 py-0.5 text-[10px] rounded-md transition-colors ${mergedTab === "chat" ? "bg-emerald-500/20 text-emerald-300" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    Chat
                  </button>
                )}
              </div>

          {visiblePanels.template && (
            <section className={`${mergedTab === "pix" || !effectiveVisible.liveChat ? "" : "hidden"} relative overflow-hidden rounded-2xl border border-border/60 bg-card/60 flex flex-col flex-1 min-h-[300px]`}>
              <div className="absolute inset-0 flex flex-col min-h-0 flex-1">


                <Dialog open={editOpen} onOpenChange={setEditOpen}>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader>
                      <DialogTitle>Editar modelo</DialogTitle>
                    </DialogHeader>
                    <Textarea
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      className="font-mono text-sm min-h-[320px] bg-background/40"
                      autoFocus
                    />
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => setEditOpen(false)}>Cancelar</Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          setEditedSkeleton(editDraft);
                          setEdited(true);
                          setTemplate(
                            applyValuesToEditedTemplate(
                              editDraft,
                              last?.matched,
                              last?.mensagem,
                              0.20,
                              lastPromoEligible,
                            ),
                          );
                          setEditOpen(false);
                          toast.success("Modelo atualizado");
                        }}
                      >
                        Salvar
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
                <Dialog open={dispoOpen} onOpenChange={setDispoOpen}>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>Enviar disponibilidade</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-2">
                      <Textarea
                        value={dispoMsg}
                        onChange={(e) => setDispoMsg(e.target.value)}
                        rows={8}
                        className="text-xs font-mono resize-y"
                        placeholder="Mensagem de disponibilidade"
                      />
                      <div className="flex justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-[11px]"
                          onClick={() => setDispoMsg(DEFAULT_DISPO_MSG)}
                        >
                          Restaurar padrão
                        </Button>
                      </div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground pt-1">Selecione o grupo</div>
                      {(() => {
                        const merged = new Map<string, string>();
                        for (const g of groupOptions) merged.set(g.chat_id, g.grupo);
                        for (const g of liveGroups) if (!merged.has(g.chat_id)) merged.set(g.chat_id, g.grupo);
                        const list = Array.from(merged.entries()).map(([chat_id, grupo]) => ({ chat_id, grupo })).sort((a, b) => a.grupo.localeCompare(b.grupo));
                        if (list.length === 0) return (
                          <div className="text-xs text-muted-foreground p-3 text-center">Nenhum grupo detectado ainda.</div>
                        );
                        return (
                          <div className="max-h-72 overflow-auto flex flex-col gap-1">
                            {list.map((g) => (
                              <Button
                                key={g.chat_id}
                                variant="outline"
                                size="sm"
                                className="justify-start h-9 text-left"
                                onClick={() => sendDispo(g.chat_id, g.grupo)}
                              >
                                <Send className="w-3.5 h-3.5" /> {g.grupo}
                              </Button>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  </DialogContent>
                </Dialog>
                <Dialog open={promoOpen} onOpenChange={setPromoOpen}>
                  <DialogContent className="max-w-sm max-h-[90vh] flex flex-col p-0">
                    <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
                      <DialogTitle>Ativar Promoção</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 text-sm overflow-y-auto px-6 pb-4 flex-1 min-h-0">
                      <div className="text-xs text-muted-foreground">
                        Faixas de montante (edite, adicione ou remova):
                      </div>
                      <div className="rounded-md border bg-muted/40 p-2 space-y-1.5">
                        <div className="grid grid-cols-[1fr_1fr_70px_28px] gap-1 text-[10px] uppercase tracking-wider text-muted-foreground font-bold px-1">
                          <span>Mín.</span>
                          <span>Máx.</span>
                          <span className="text-right">%</span>
                          <span />
                        </div>
                        {promoTiersDraft.map((t, i) => (
                          <div key={i} className="grid grid-cols-[1fr_1fr_70px_28px] gap-1 items-center">
                            <Input
                              type="number"
                              inputMode="numeric"
                              value={String(t.min)}
                              onChange={(e) => {
                                const v = Number(e.target.value) || 0;
                                setPromoTiersDraft((prev) => prev.map((x, k) => (k === i ? { ...x, min: v } : x)));
                              }}
                              className="h-7 text-xs text-right tabular-nums"
                            />
                            <Input
                              type="number"
                              inputMode="numeric"
                              placeholder="∞"
                              value={t.max == null ? "" : String(t.max)}
                              onChange={(e) => {
                                const raw = e.target.value;
                                const v = raw === "" ? null : Number(raw);
                                setPromoTiersDraft((prev) => prev.map((x, k) => (k === i ? { ...x, max: v as any } : x)));
                              }}
                              className="h-7 text-xs text-right tabular-nums"
                            />
                            <div className="flex items-center gap-0.5">
                              <Input
                                type="number"
                                inputMode="decimal"
                                step="0.1"
                                value={String(+(t.pct * 100).toFixed(2))}
                                onChange={(e) => {
                                  const v = (Number(e.target.value) || 0) / 100;
                                  setPromoTiersDraft((prev) => prev.map((x, k) => (k === i ? { ...x, pct: v } : x)));
                                }}
                                className="h-7 text-xs text-right tabular-nums"
                              />
                              <span className="text-[10px] text-muted-foreground">%</span>
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                              onClick={() => setPromoTiersDraft((prev) => prev.filter((_, k) => k !== i))}
                              disabled={promoTiersDraft.length <= 1}
                              title="Remover faixa"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        ))}
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 w-full gap-1 text-[11px] mt-1"
                          onClick={() => {
                            const last = promoTiersDraft[promoTiersDraft.length - 1];
                            const nextMin = last ? (last.max ? Number(last.max) + 1 : Number(last.min) + 500) : 500;
                            setPromoTiersDraft((prev) => [...prev, { min: nextMin, max: null, pct: 0.17 }]);
                          }}
                        >
                          <Plus className="w-3 h-3" /> Adicionar faixa
                        </Button>
                        <div className="text-[10px] text-muted-foreground pt-1 border-t border-border/40">
                          Fora de qualquer faixa → taxa padrão (sem promoção).
                        </div>
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        A Taxa DK acompanha a mesma % do blogueiro (calculada sobre o valor do blogueiro, não do depósito).
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        Só será aplicada em tarefas/mensagens recebidas a partir do momento da ativação.
                      </div>
                      <div className="rounded-md border bg-muted/40 p-2 space-y-1.5">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                          Janelas históricas
                        </div>
                        {promoWindows.length === 0 && (
                          <div className="text-[11px] text-muted-foreground italic">Nenhuma janela registrada.</div>
                        )}
                        {promoWindows.map((w, i) => {
                          const toLocal = (iso: string | null) => {
                            if (!iso) return "";
                            const d = new Date(iso);
                            const pad = (n: number) => String(n).padStart(2, "0");
                            return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                          };
                          const fromLocal = (s: string) => s ? new Date(s).toISOString() : null;
                          return (
                            <div key={i} className="grid grid-cols-[1fr_1fr_28px] gap-1 items-center">
                              <Input
                                type="datetime-local"
                                value={toLocal(w.start)}
                                onChange={(e) => {
                                  const iso = fromLocal(e.target.value);
                                  if (!iso) return;
                                  setPromoWindows((prev) => prev.map((x, k) => k === i ? { ...x, start: iso } : x));
                                }}
                                className="h-7 text-[11px]"
                              />
                              <Input
                                type="datetime-local"
                                placeholder="aberta"
                                value={toLocal(w.end)}
                                onChange={(e) => {
                                  const iso = e.target.value ? fromLocal(e.target.value) : null;
                                  setPromoWindows((prev) => prev.map((x, k) => k === i ? { ...x, end: iso } : x));
                                }}
                                className="h-7 text-[11px]"
                              />
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                onClick={() => setPromoWindows((prev) => prev.filter((_, k) => k !== i))}
                                title="Remover janela"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          );
                        })}
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 w-full gap-1 text-[11px] mt-1"
                          onClick={() => {
                            const start = new Date(2026, 4, 27, 0, 0, 0).toISOString();
                            setPromoWindows((prev) => {
                              // fecha qualquer janela aberta antes de criar a retroativa aberta
                              const closed = prev.map((w) => w.end == null ? { ...w, end: new Date().toISOString() } : w);
                              return [...closed, { start, end: null }];
                            });
                          }}
                        >
                          <Plus className="w-3 h-3" /> Adicionar janela retroativa (desde 27/05)
                        </Button>
                        <div className="text-[10px] text-muted-foreground pt-1 border-t border-border/40">
                          Tarefas criadas dentro de qualquer janela ficam elegíveis pra sempre. Edite as datas pra ajustar o histórico.
                        </div>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 px-6 py-3 border-t border-border/40 shrink-0 bg-background">
                      <Button size="sm" variant="outline" onClick={() => setPromoOpen(false)}>Cancelar</Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          const cleaned = promoTiersDraft
                            .map((t) => ({
                              min: Math.max(0, Math.floor(Number(t.min) || 0)),
                              max: t.max == null || t.max === ("" as any) ? null : Math.floor(Number(t.max)),
                              pct: Math.max(0, Math.min(1, Number(t.pct) || 0)),
                            }))
                            .sort((a, b) => a.min - b.min);
                          savePromoTiers(cleaned);
                          activatePromo();
                          setEdited(false);
                          setPromoOpen(false);
                          toast.success("Promoção ativada");
                        }}
                      >
                        Salvar e Ativar
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
                <div className="relative overflow-hidden bg-[#0b141a] flex-1 flex flex-col min-h-0">
                  {/* WhatsApp chat header */}
                  <div className="flex items-center gap-2 px-2.5 py-1.5 bg-[#202c33] border-b border-black/40">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center text-white font-bold text-[11px] shadow">
                      {(last?.grupo || last?.autor || "PIX").slice(0, 1).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-semibold text-[#e9edef] truncate leading-tight">
                        {last?.grupo || last?.autor || "Preview do modelo"}
                      </div>
                      <div className="text-[10px] text-[#8696a0] truncate leading-tight">
                        {last ? "online" : "pré-visualização"}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={promoActive ? "destructive" : "outline"}
                      className="h-7 gap-1 text-[11px] font-bold uppercase tracking-wide px-2"
                      onClick={() => {
                        if (promoActive) {
                          deactivatePromo();
                          setEdited(false);
                          toast.success("Promoção desativada");
                        } else {
                          setPromoOpen(true);
                        }
                      }}
                      title="Promoção Bônus Relâmpago (19/18/17%)"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      {promoActive ? "PROMO ON" : "Promo"}
                    </Button>
                    <Button
                      size="sm"
                      variant={currentMult === 1.04 ? "default" : "outline"}
                      className={`h-7 text-[11px] font-bold uppercase tracking-wide px-2 ${currentMult === 1.04 ? "bg-amber-500 text-amber-950 hover:bg-amber-500/90" : ""}`}
                      disabled={!last}
                      onClick={() => applyValueMultiplier(currentMult === 1.04 ? 1 : 1.04)}
                      title="Aplica +4% no valor (e na % do blogueiro desta tarefa)"
                    >
                      2,5x
                    </Button>
                    <Button
                      size="sm"
                      variant={currentMult === 1.10 ? "default" : "outline"}
                      className={`h-7 text-[11px] font-bold uppercase tracking-wide px-2 ${currentMult === 1.10 ? "bg-fuchsia-500 text-fuchsia-950 hover:bg-fuchsia-500/90" : ""}`}
                      disabled={!last}
                      onClick={() => applyValueMultiplier(currentMult === 1.10 ? 1 : 1.10)}
                      title="Aplica +10% no valor (e na % do blogueiro desta tarefa)"
                    >
                      3x
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-[#8696a0] hover:text-[#e9edef] hover:bg-white/5"
                      onClick={() => { setEdited(false); setEditedSkeleton(""); setTemplate(autoTemplate); toast.success("Restaurado"); }}
                      title="Restaurar modelo"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 gap-1 px-2 bg-[#3b82f6] text-white hover:bg-[#2563eb] font-bold text-[11px] uppercase tracking-wide"
                      onClick={() => setDispoOpen(true)}
                      title="Enviar disponibilidade"
                    >
                      <Send className="w-3.5 h-3.5" /> Disp.
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-[#8696a0] hover:text-[#e9edef] hover:bg-white/5"
                      onClick={() => copy(template)}
                      title="Copiar modelo"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                  </div>

                  {/* Chat body with WhatsApp doodle background */}
                  <div
                    className="relative px-2.5 py-2 flex-1 min-h-0 overflow-y-auto"




                    style={{
                      backgroundColor: "#0b141a",
                      backgroundImage:
                        "radial-gradient(circle at 20% 30%, rgba(255,255,255,0.025) 0 2px, transparent 2px), radial-gradient(circle at 70% 60%, rgba(255,255,255,0.02) 0 2px, transparent 2px), radial-gradient(circle at 40% 80%, rgba(255,255,255,0.02) 0 2px, transparent 2px)",
                      backgroundSize: "180px 180px, 220px 220px, 160px 160px",
                    }}
                  >
                    <div className="space-y-2">
                      {/* bolha do remetente removida — só o modelo */}

                      <div className="flex justify-end group">
                        <div
                          className="relative max-w-[65%] rounded-lg rounded-tr-none bg-[#005c4b] text-[#e9edef] px-2 py-1 shadow text-[12px] leading-snug whitespace-pre-wrap break-words cursor-pointer hover:ring-1 hover:ring-emerald-300/40 transition"
                          onClick={() => { setEditDraft(template); setEditOpen(true); }}
                          title="Clique para editar"
                        >
                          {template || <span className="italic text-[#8696a0]">(modelo vazio)</span>}
                          <div className="flex items-center justify-end gap-1 mt-0.5 text-[10px] text-[#8696a0] tabular-nums">
                            {new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                            <CheckCheck className="w-3.5 h-3.5 text-sky-400" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* WhatsApp-style input bar */}
                  <div className="flex items-center gap-1.5 px-2 py-1.5 bg-[#202c33] border-t border-black/40">
                    <button className="p-1 text-[#8696a0] hover:text-[#e9edef]" disabled><Smile className="w-4 h-4" /></button>
                    <button className="p-1 text-[#8696a0] hover:text-[#e9edef]" disabled><Paperclip className="w-4 h-4" /></button>
                    <button
                      onClick={() => { setEditDraft(template); setEditOpen(true); }}
                      className="flex-1 text-left h-7 rounded-full bg-[#2a3942] px-3 text-[12px] text-[#8696a0] hover:text-[#e9edef] truncate"
                      title="Editar modelo"
                    >
                      {template ? template.split("\n")[0].slice(0, 60) + (template.length > 60 ? "…" : "") : "Clique para editar o modelo…"}
                    </button>
                    <Button
                      size="icon"
                      className="h-10 w-10 sm:h-8 sm:w-8 rounded-full bg-emerald-500 text-emerald-950 hover:bg-emerald-500/90 shadow-[0_0_20px_hsl(142_70%_45%/0.7)] ring-2 ring-emerald-300/70 animate-pulse sm:animate-none sm:ring-0 sm:shadow-lg"
                      title="Enviar modelo respondendo a mensagem atual"

                      disabled={!last || !user}
                      onClick={async () => {
                        if (!last || !user) { toast.error("Sem mensagem atual"); return; }
                        const api = (window as any).electronAPI;
                        let chatId = last.source_chat_id;
                        let msgId = getOriginalWaMessageId(last);
                        if (!chatId || !isLikelyWaMessageId(msgId)) {
                          const found = await findOriginMessage({
                            autor: last.autor, grupo: last.grupo, mensagem: last.mensagem,
                          });
                          if (found?.source_chat_id) {
                            chatId = found.source_chat_id;
                            msgId = found.source_msg_id || msgId || "";
                          }
                        }
                        if (!chatId) { toast.error("Mensagem sem origem para responder"); return; }
                        if (isDesktop && api?.waSendNow) {
                          const res = await api.waSendNow({
                            chat_id: chatId,
                            quoted_msg_id: msgId || "",
                            text: template,
                          });
                          if (res?.error) toast.error(res.error.message || "Falha ao enviar modelo");
                          else toast.success("Modelo enviado (respondendo)");
                          return;
                        }
                        const { error } = await supabase.from("wa_outbox").insert({
                          user_id: user.id,
                          chat_id: chatId,
                          quoted_msg_id: msgId || "",
                          text: template,
                        });
                        if (error) toast.error(error.message);
                        else toast.success("Modelo enfileirado (respondendo)");
                      }}
                    >
                      <Send className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </section>
          )}


          {effectiveVisible.liveChat && <div className={`${mergedTab === "chat" || !visiblePanels.template ? "flex-1 min-h-[300px]" : "hidden"}`}><LiveGroupChatCard /></div>}
            </div>
          )}



          {visiblePanels.tasks && (
            <section style={{ order: orderOf("tasks") }} className="relative overflow-hidden rounded-2xl border border-border/60 bg-card/60 sm:col-span-2 hidden sm:block">
              <div className="relative p-3 sm:p-5">
                <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-amber-500/15 ring-1 ring-amber-500/30">
                      <ClipboardList className="w-4 h-4 text-amber-400" />
                    </div>
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Tarefas</div>
                      <div className="text-sm font-semibold">
                        Ativas <span className="text-muted-foreground font-normal">({active.length})</span>
                        {inProgress.length > 0 && <span className="ml-2 text-blue-400 font-normal">· {inProgress.length} em andamento</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isDesktop && (

                      <Dialog open={importOpen} onOpenChange={setImportOpen}>
                        <DialogTrigger asChild>
                          <Button size="sm" variant="outline" className="h-8 gap-1" title="Sincronizar tarefas com a nuvem (browser)">
                            <RefreshCw className="w-3.5 h-3.5" /> Sincronizar
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-sm">
                          <DialogHeader>
                            <DialogTitle>Sincronizar com a nuvem</DialogTitle>
                          </DialogHeader>
                          <div className="space-y-3">
                            <p className="text-xs text-muted-foreground">Login com sua conta do navegador. <b>Importar</b> sobrescreve tudo com o que está na nuvem. <b>Sincronizar tarefas</b> mescla nos dois sentidos (id em comum: vence o mais recente).</p>
                            <input className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm" placeholder="Email" type="email" value={importEmail} onChange={(e) => setImportEmail(e.target.value)} />
                            <input className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm" placeholder="Senha" type="password" value={importPwd} onChange={(e) => setImportPwd(e.target.value)} />
                            <Button className="w-full" onClick={handleSyncTasks} disabled={syncing || importing}>
                              {syncing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Sincronizando…</> : "Sincronizar tarefas (2 vias)"}
                            </Button>
                            <Button variant="outline" className="w-full" onClick={handleImportFromCloud} disabled={importing || syncing}>
                              {importing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Importando…</> : "Importar tudo da nuvem (sobrescreve)"}
                            </Button>
                            <div className="pt-3 border-t border-border/60 space-y-2">
                              <p className="text-xs text-muted-foreground">
                                <b>Push para o navegador / celular</b> — encaminha as mensagens do WhatsApp recebidas neste app para a sua conta na nuvem, notificando todos os dispositivos inscritos.
                              </p>
                              {pushEnabled ? (
                                <Button variant="destructive" className="w-full" onClick={handleDisablePush}>
                                  Desativar push para navegador
                                </Button>
                              ) : (
                                <Button variant="default" className="w-full" onClick={handleEnablePush} disabled={pushEnabling}>
                                  {pushEnabling ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Ativando…</> : "Ativar push para navegador/celular"}
                                </Button>
                              )}
                            </div>
                          </div>
                        </DialogContent>
                      </Dialog>
                    )}
                    <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="outline" className="h-8 gap-1">
                          <History className="w-3.5 h-3.5" /> Histórico ({done.length})
                        </Button>
                      </DialogTrigger>
                    <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                      <DialogHeader>
                        <DialogTitle>Histórico de tarefas concluídas</DialogTitle>
                      </DialogHeader>
                      {done.length === 0 ? (
                        <div className="text-sm text-muted-foreground text-center py-8">Nenhuma tarefa concluída ainda.</div>
                      ) : (
                        <div className="space-y-2">
                          {done.map((t) => (
                            <div key={t.id} className="rounded-lg border border-border/50 bg-muted/20 p-3">
                              <div className="flex items-start justify-between gap-2 mb-1">
                                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                                  <span className="font-bold text-sm truncate">{t.autor}</span>
                                  {t.telefone && <span className="text-[10px] text-muted-foreground">{t.telefone}</span>}
                                  {t.matched.map((p) => (
                                    <Badge key={p} variant="outline" className="h-4 text-[9px] px-1">{p}</Badge>
                                  ))}
                                  <span className="text-[10px] text-muted-foreground">
                                    {t.completed_at && new Date(t.completed_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={async () => {
                                    const prevOp = (t.operation_data as any) || {};
                                    if (!prevOp.dk_synced) {
                                      await updateOperation(t.id, { ...prevOp, dk_synced: true });
                                    }
                                    await reopen(t.id);
                                    await start(t.id);
                                  }} title="Reabrir como em andamento (não envia ao DK Dash de novo)">
                                    <Undo2 className="w-3.5 h-3.5" />
                                  </Button>
                                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive" onClick={() => removeTask(t.id)} title="Apagar">
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              </div>
                              <div className="text-xs whitespace-pre-wrap break-words text-muted-foreground">{t.mensagem}</div>
                              {t.pix_keys && t.pix_keys.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {t.pix_keys.filter(Boolean).map((k: any, idx) => {
                                    const c = getBancoColor(k.banco);
                                    return (
                                      <button
                                        key={`${k.id}-${idx}`}
                                        onClick={() => copy(formatChaveCopy(k.chave, k.tipo_chave))}
                                        title={`${k.banco} · ${k.tipo_chave}${k.titular ? " · " + k.titular : ""} · clique para copiar`}
                                        className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border transition-colors hover:brightness-125 active:scale-95 ${c.bg} ${c.text} ${c.border}`}
                                      >
                                        {k.banco || "?"}
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          ))}
                          <p className="text-[10px] text-muted-foreground/60 text-center pt-2">Tarefas são apagadas automaticamente após 7 dias.</p>
                        </div>
                      )}
                    </DialogContent>
                  </Dialog>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1"
                    onClick={async () => {
                      const ok = await copyText(conclusionTemplate);
                      if (ok) toast.success("Copiado"); else toast.error("Falha ao copiar");
                    }}
                  >
                    <Send className="w-3.5 h-3.5" /> Conclusão
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0"
                    title="Editar modelo da mensagem de conclusão"
                    onClick={() => { setConclusionDraft(conclusionTemplate); setConclusionEditOpen(true); }}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 gap-1 bg-amber-500 text-amber-950 hover:bg-amber-500/90 font-bold"
                    onClick={() => setManualTaskOpen(true)}
                  >
                    <ClipboardList className="w-3.5 h-3.5" /> Nova tarefa
                  </Button>
                  </div>



                </div>

                {active.length === 0 ? (
                  <div className="py-8 text-center">
                    <ClipboardList className="w-8 h-8 mx-auto text-muted-foreground/40 mb-2" />
                    <div className="text-xs text-muted-foreground">Nenhuma tarefa ativa</div>
                    <div className="text-[11px] text-muted-foreground/70 mt-1">Marque uma mensagem como <span className="font-bold text-emerald-400">Operar</span> para criar uma tarefa.</div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {active.map((t, idx) => {
                      const running = t.status === "in_progress";
                      const TASK_HUES = [12, 45, 90, 160, 195, 230, 280, 320];
                      const showGlow = active.length >= 2;
                      const hue = TASK_HUES[idx % TASK_HUES.length];
                      return (
                      <div
                        key={t.id}
                        style={showGlow ? ({ ["--task-hue" as never]: String(hue) } as React.CSSProperties) : undefined}
                        className={(() => {
                          const taskMult = Number((t.operation_data as any)?.valueMultiplier) || 1;
                          const multClass = taskMult === 1.10
                            ? " ring-2 ring-fuchsia-500/70 shadow-[0_0_18px_-4px_hsl(295_85%_55%/0.55)]"
                            : taskMult === 1.04
                            ? " ring-2 ring-amber-500/70 shadow-[0_0_18px_-4px_hsl(38_92%_55%/0.55)]"
                            : "";
                          const base = `rounded-xl border p-3 ${
                            showGlow
                              ? "task-glow bg-card/40"
                              : running
                              ? "border-blue-500/50 bg-blue-500/10"
                              : "border-amber-500/30 bg-amber-500/5"
                          }`;
                          return base + multClass;
                        })()}
                      >
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div className="flex items-center gap-2 min-w-0 flex-wrap">
                            {t.link ? (
                              <button
                                type="button"
                                className="font-bold text-sm text-primary underline truncate max-w-[320px] cursor-pointer text-left"
                                title={`${t.link} (clique para copiar)`}
                                onClick={() => copy(t.link)}
                              >
                                {t.nome_tarefa || t.link}
                              </button>
                            ) : (
                              <span className="font-bold text-sm truncate">{t.autor}</span>
                            )}
                            <span className="text-[10px] text-muted-foreground">· {t.autor}</span>
                            {t.telefone && <span className="text-[10px] text-muted-foreground">{t.telefone}</span>}
                            {t.grupo && <span className="text-[10px] text-muted-foreground truncate">· {t.grupo}</span>}
                            {running && (
                              <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/40 h-4 text-[9px] px-1">EM ANDAMENTO</Badge>
                            )}
                            {t.matched.map((p) => (
                              <Badge key={p} className={`${running ? "bg-blue-500/20 text-blue-300 border-blue-500/30" : "bg-amber-500/20 text-amber-300 border-amber-500/30"} h-4 text-[9px] px-1`}>{p}</Badge>
                            ))}
                            <span className="text-[10px] text-muted-foreground">
                              {new Date(t.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button
                              size="sm" variant="ghost"
                              className="h-7 w-7 p-0"
                              onClick={async () => {
                                const task = await ensureTaskPixKeys(t, updatePixKeys);
                                setOpDialog({ open: true, task });
                              }}
                              title="Operação (depósitos / lucro / DK)"
                            >
                              <Calculator className="w-3.5 h-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => {
                              if (!t.pix_keys || t.pix_keys.length === 0) { toast.error("Nenhuma chave Pix"); return; }
                              const text = t.pix_keys
                                .filter(Boolean)
                                .map((k: any) => formatChaveCopy(k.chave, k.tipo_chave))
                                .filter(Boolean)
                                .join("\n");
                              if (!text) { toast.error("Nenhuma chave para copiar"); return; }
                              copy(text);
                            }} title="Copiar chaves Pix">
                              <Copy className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              size="sm" variant="ghost"
                              className="h-7 px-2 gap-1 text-[10px] text-emerald-400 hover:text-emerald-300"
                              title="Enviar conclusão respondendo no GRUPO (cita a mensagem original)"
                              onClick={async () => {
                                const api = (window as any).electronAPI;
                                let chatId = t.source_chat_id;
                                let msgId = getOriginalWaMessageId(t);
                                if (!chatId || !isLikelyWaMessageId(msgId)) {
                                  const found = await findOriginMessage(t);
                                  if (found?.source_chat_id) {
                                    chatId = found.source_chat_id;
                                    msgId = found.source_msg_id || msgId || "";
                                    await supabase.from("wa_tasks").update({
                                      source_chat_id: chatId,
                                      source_msg_id: msgId,
                                      source_author_id: found.source_author_id || "",
                                    }).eq("id", t.id);
                                  }
                                }
                                if (!chatId) { toast.warning("Tarefa manual — não há mensagem original para responder"); return; }
                                const text = conclusionTemplate;
                                if (isDesktop && api?.waSendNow) {
                                  const res = await api.waSendNow({
                                    chat_id: chatId,
                                    quoted_msg_id: msgId || "",
                                    text,
                                  });
                                  if (res?.error) { console.error("[wa:send-now] grupo error", res.error); toast.error(res.error.message || "Falha ao enviar no grupo"); }
                                  else { console.log("[wa:send-now] grupo OK"); toast.success("Conclusão enviada (grupo)"); }
                                  return;
                                }
                                const outboxUserId = user?.id || t.user_id;
                                console.log("[outbox] grupo →", { user_id: outboxUserId, chat_id: chatId, quoted_msg_id: msgId, text: text.slice(0, 60) });
                                const { error } = await supabase.from("wa_outbox").insert({
                                  user_id: outboxUserId,
                                  chat_id: chatId,
                                  quoted_msg_id: msgId || "",
                                  text,
                                });
                                if (error) { console.error("[outbox] grupo insert error", error); toast.error(error.message); }
                                else { console.log("[outbox] grupo enfileirado OK"); toast.success("Conclusão enfileirada (grupo)"); }
                              }}
                            >
                              <Send className="w-3 h-3" /> Grupo
                            </Button>
                            <Button
                              size="sm" variant="ghost"
                              className="h-7 px-2 gap-1 text-[10px] text-cyan-400 hover:text-cyan-300"
                              title="Enviar conclusão + imagens no PRIVADO do autor"
                              onClick={async () => {
                                const api = (window as any).electronAPI;
                                let chatId = t.source_chat_id;
                                let authorId = t.source_author_id;
                                let msgId = t.source_msg_id;
                                // Sempre enriquece se faltar authorId OU msgId
                                if (!authorId || !msgId) {
                                  const found = await findOriginMessage(t);
                                  if (found) {
                                    chatId = chatId || found.source_chat_id;
                                    authorId = authorId || found.source_author_id || "";
                                    msgId = msgId || found.source_msg_id || "";
                                    await supabase.from("wa_tasks").update({
                                      source_chat_id: chatId,
                                      source_msg_id: msgId,
                                      source_author_id: authorId,
                                    }).eq("id", t.id);
                                  }
                                }
                                // NUNCA converter author_id — usa exatamente o ID original (@lid, @c.us, @s.whatsapp.net)
                                const dest = String(authorId || "").trim();
                                if (!dest || dest.endsWith("@g.us")) {
                                  toast.warning("Tarefa manual — não há autor para enviar no privado");
                                  return;
                                }
                                const text = conclusionTemplate;
                                const imgs = t.image_urls ?? [];
                                // "Responder em particular": o destino é o autor, mas o primeiro
                                // envio mantém o ID da mensagem original do grupo. O processo
                                // Electron monta o contextInfo cross-chat usado pelo WhatsApp Web.
                                const quoted = String(msgId || "").trim();
                                if (!quoted) {
                                  toast.warning("Não foi possível localizar a mensagem original para responder em particular");
                                  return;
                                }
                                if (isDesktop && api?.waSendNow) {
                                  const directRows = imgs.length === 0
                                    ? [{
                                        chat_id: dest,
                                        alt_chat_id: chatId || "",
                                        fallback_phone: t.telefone || "",
                                        source_author_id: authorId || "",
                                        quoted_msg_id: quoted,
                                        text,
                                        image_url: "",
                                      }]
                                    : imgs.map((p, i) => ({
                                        chat_id: dest,
                                        alt_chat_id: chatId || "",
                                        fallback_phone: t.telefone || "",
                                        source_author_id: authorId || "",
                                        quoted_msg_id: i === 0 ? quoted : "",
                                        text: i === 0 ? text : "",
                                        image_url: p,
                                      }));
                                  for (let i = 0; i < directRows.length; i++) {
                                    const sent = await api.waSendNow(directRows[i]);
                                    if (sent?.error) {
                                      console.error("[wa:send-now] privado error", sent.error, directRows[i]);
                                      toast.error(sent.error.message || "Falha ao enviar print no privado");
                                      return;
                                    }
                                  }
                                  toast.success(`Privado enviado${imgs.length ? ` + ${imgs.length} print(s)` : ""}`);
                                  return;
                                }
                                const outboxUserId = user?.id || t.user_id;
                                const rows = imgs.length === 0
                                  ? [{ user_id: outboxUserId, chat_id: dest, quoted_msg_id: quoted, text, image_url: "" }]
                                  : imgs.map((p, i) => ({
                                      user_id: outboxUserId,
                                      chat_id: dest,
                                      quoted_msg_id: i === 0 ? quoted : "",
                                      text: i === 0 ? text : "",
                                      image_url: p,
                                    }));
                                console.log("📤 OUTBOX PRIVADO →", JSON.stringify(rows, null, 2));
                                const { error } = await supabase.from("wa_outbox").insert(rows);
                                if (error) { console.error("[outbox] privado insert error", error); toast.error(error.message); }
                                else { console.log("[outbox] privado enfileirado OK", rows.length, "linha(s)"); toast.success(`Privado: dest=${dest.split("@")[1]} quoted=${quoted ? "✓" : "✗"}${imgs.length ? ` +${imgs.length} img` : ""}`); }
                              }}
                            >
                              <Send className="w-3 h-3" /> Privado
                            </Button>
                            {running ? (
                              (t.operation_data as any)?.dk_synced ? (
                                <Button
                                  size="sm"
                                  className="h-7 gap-1 bg-amber-500 text-amber-950 hover:bg-amber-500/90 font-bold text-[11px] px-2"
                                  onClick={async () => {
                                    await complete(t.id);
                                    toast.success("Devolvido ao histórico");
                                  }}
                                  title="Já enviada ao DK Dash — apenas devolver ao histórico"
                                >
                                  <History className="w-3 h-3" /> Arquivar
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  className="h-7 gap-1 bg-emerald-500 text-emerald-950 hover:bg-emerald-500/90 font-bold text-[11px] px-2"
                                  onClick={() => setMontanteTask(t)}
                                  title="Concluir e enviar ao DK Dash"
                                >
                                  <CheckCircle2 className="w-3 h-3" /> Concluir
                                </Button>
                              )
                            ) : (
                              <Button
                                size="sm"
                                className="h-7 gap-1 bg-blue-500 text-blue-950 hover:bg-blue-500/90 font-bold text-[11px] px-2"
                                onClick={async () => {
                                  const hasRows = ((t.operation_data?.rows ?? []) as any[])
                                    .some((r) => Number(r?.deposito) > 0);
                                  await start(t.id);
                                  if (hasRows) {
                                    toast.success("Tarefa iniciada — depósitos enviados para a Calculadora");
                                    return;
                                  }
                                  const task = await ensureTaskPixKeys({ ...t, status: "in_progress" }, updatePixKeys);
                                  setOpDialog({ open: true, task });
                                }}
                                title="Iniciar tarefa"
                              >
                                <Play className="w-3 h-3" /> Iniciar
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => removeTask(t.id)} title="Apagar">
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="text-sm whitespace-pre-wrap break-words font-medium">{t.mensagem}</div>
                          {(() => {
                            const savedRows = (t.operation_data?.rows ?? []).filter((r: any) => Number(r?.deposito) > 0);
                            const total = extractNumeric(t.matched ?? [], t.mensagem ?? "");
                            const hasSaved = savedRows.length > 0;
                            const contas = hasSaved ? savedRows.length : (total != null ? Math.max(1, Math.floor(total / 200)) : 0);
                            if (!hasSaved && (!total || contas < 1)) return null;
                            return (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 px-2 gap-1 text-[10px]"
                                title={hasSaved ? `Copiar ${contas} depósitos da operação` : `Copiar ${contas} depósitos divididos`}
                                onClick={() => {
                                  let deps: number[];
                                  if (hasSaved) {
                                    deps = savedRows.map((r: any) => Number(r.deposito) || 0);
                                  } else {
                                    deps = divisorDkDash(Math.floor(total!), contas, 0);
                                  }
                                  const text = deps.map((d) => String(Math.round(d))).filter((v) => v !== "0").join("\n");
                                  if (!text) { toast.error("Lista vazia"); return; }
                                  copy(text);
                                  toast.success(`${deps.length} depósito(s) copiado(s)`);
                                }}
                              >
                                <Copy className="w-3 h-3" /> {contas}× depósitos
                              </Button>
                            );
                          })()}
                        </div>
                        {running && (() => {
                          const savedRows = (t.operation_data?.rows ?? []).filter((r: any) => Number(r?.deposito) > 0);
                          const total = extractNumeric(t.matched ?? [], t.mensagem ?? "");
                          const hasSaved = savedRows.length > 0;
                          const contas = hasSaved ? savedRows.length : (total != null ? Math.max(1, Math.floor(total / 200)) : 0);
                          const deps: number[] = hasSaved
                            ? savedRows.map((r: any) => Number(r.deposito) || 0)
                            : (total ? divisorDkDash(Math.floor(total), contas, 0) : []);
                          const depsText = deps.map((d) => String(Math.round(d))).filter((v) => v !== "0").join("\n");
                          const pixText = (t.pix_keys ?? [])
                            .filter(Boolean)
                            .map((k: any) => formatChaveCopy(k.chave, k.tipo_chave))
                            .filter(Boolean)
                            .join("\n");
                          const link = t.link || "";
                          return (
                            <div className="space-y-1.5">
                              <CashHuntersAutoBar
                                qty={String(contas || "")}
                                depsText={depsText}
                                url={link}
                                pixText={pixText}
                                depsCount={deps.length}
                                pixCount={(t.pix_keys ?? []).length}
                              />
                            </div>
                          );
                        })()}
                        {t.pix_keys && t.pix_keys.length > 0 && (
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {t.pix_keys.filter(Boolean).map((k: any, idx) => {
                              const c = getBancoColor(k.banco);
                              return (
                                <button
                                  key={`${k.id}-${idx}`}
                                  onClick={() => copy(formatChaveCopy(k.chave, k.tipo_chave))}
                                  title={`${k.banco} · ${k.tipo_chave}${k.titular ? " · " + k.titular : ""} · clique para copiar`}
                                  className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border transition-colors hover:brightness-125 active:scale-95 ${c.bg} ${c.text} ${c.border}`}
                                >
                                  {k.banco || "?"}
                                </button>
                              );
                            })}
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 gap-1 text-[10px]"
                              title="Copiar todas as chaves Pix"
                              onClick={() => {
                                const text = (t.pix_keys ?? [])
                                  .filter(Boolean)
                                  .map((k: any) => formatChaveCopy(k.chave, k.tipo_chave))
                                  .filter(Boolean)
                                  .join("\n");
                                if (!text) { toast.error("Nenhuma chave para copiar"); return; }
                                copy(text);
                                toast.success(`${t.pix_keys!.length} chave(s) copiada(s)`);
                              }}
                            >
                              <Copy className="w-3 h-3" /> Copiar todas
                            </Button>
                          </div>
                        )}
                        {user && (
                          <TaskImagePaste
                            taskId={t.id}
                            userId={user.id}
                            imageUrls={t.image_urls ?? []}
                            onChange={(paths) => updateImages(t.id, paths)}
                          />
                        )}
                      </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          )}

          {visiblePanels.montantes && (
            <div style={{ order: orderOf("dkdash") }} className="sm:col-span-2">
              <DkDashHojeCard showMontantes={true} />
            </div>
          )}
        </div>

        {visiblePanels.turno && (
          <section
            className={`relative overflow-hidden rounded-2xl border transition-colors mt-4 hidden sm:block ${
              ehSuaVez
                ? "border-emerald-400/50 bg-gradient-to-br from-emerald-500/15 via-emerald-500/5 to-transparent shadow-[0_0_60px_-15px_hsl(var(--primary))]"
                : "border-border/60 bg-card/60"
            }`}
          >
            {ehSuaVez && (
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute -top-16 -right-16 w-64 h-64 rounded-full bg-emerald-500/20 blur-3xl animate-pulse" />
                <div className="absolute -bottom-16 -left-16 w-64 h-64 rounded-full bg-emerald-500/10 blur-3xl animate-pulse" />
              </div>
            )}
            <div className="relative p-3 sm:p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center ring-1 ${
                    ehSuaVez ? "bg-emerald-500/25 ring-emerald-400/40" : "bg-muted/50 ring-border"
                  }`}>
                    <ListOrdered className={`w-4 h-4 ${ehSuaVez ? "text-emerald-300" : "text-muted-foreground"}`} />
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Ordem de Turno</div>
                    <div className="text-sm font-semibold">Montante</div>
                  </div>
                </div>
                {ehSuaVez ? (
                  <Badge className="bg-emerald-500 text-emerald-950 hover:bg-emerald-500 font-bold gap-1 animate-pulse">
                    <Crown className="w-3 h-3" /> SUA VEZ
                  </Badge>
                ) : turno.minhaPosicao > 0 ? (
                  <Badge variant="outline" className="font-semibold">
                    Você é o {turno.minhaPosicao + 1}º
                  </Badge>
                ) : turno.myUsername ? (
                  <Badge variant="outline" className="font-semibold text-muted-foreground">
                    Fora da fila
                  </Badge>
                ) : null}
              </div>

              {turno.fila.length === 0 && !turno.naFila ? (
                <div className="py-10 text-center">
                  <div className="text-xs text-muted-foreground">Fila vazia</div>
                  <div className="text-[11px] text-muted-foreground/70 mt-1">Conecte o DK Dash e entre na fila.</div>
                </div>
              ) : (
                <div className="space-y-2">
                  {turno.fila.map((e, idx) => {
                    const isMe = e.username === turno.myUsername;
                    const isFirst = idx === 0;
                    const isLast = idx === turno.fila.length - 1;
                    return (
                      <div
                        key={e.username}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-colors ${
                          isFirst
                            ? isMe
                              ? "bg-emerald-500/20 border-emerald-400/50 text-emerald-100"
                              : "bg-amber-500/15 border-amber-400/40 text-amber-100"
                            : isMe
                              ? "bg-primary/10 border-primary/40 text-primary"
                              : "bg-muted/30 border-border/40"
                        }`}
                      >
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-black tabular-nums ${
                          isFirst
                            ? isMe ? "bg-emerald-500/40 text-emerald-50" : "bg-amber-500/30 text-amber-50"
                            : "bg-background/50 text-muted-foreground"
                        }`}>
                          {idx + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-bold truncate">{e.nome}</div>
                          {isMe && <div className="text-[10px] uppercase tracking-wider opacity-70">Você</div>}
                        </div>
                        {isFirst && <Crown className={`w-4 h-4 ${isMe ? "text-emerald-300" : "text-amber-300"}`} />}
                        <div className="flex flex-col gap-0.5 ml-1">
                          <Button
                            size="sm" variant="ghost"
                            className="h-5 w-6 p-0 hover:bg-background/60"
                            disabled={isFirst}
                            onClick={() => turno.mover(e.username, "cima")}
                            title="Mover para cima"
                          >
                            <ChevronUp className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            size="sm" variant="ghost"
                            className="h-5 w-6 p-0 hover:bg-background/60"
                            disabled={isLast}
                            onClick={() => turno.mover(e.username, "baixo")}
                            title="Mover para baixo"
                          >
                            <ChevronDown className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-4 flex items-center gap-2 flex-wrap">
                {turno.naFila ? (
                  <Button
                    size="sm" variant="outline"
                    className="h-8 gap-1.5 text-[11px] flex-1 min-w-[120px] border-destructive/40 text-destructive hover:bg-destructive/10"
                    onClick={turno.sair}
                  >
                    <LogOut className="w-3.5 h-3.5" /> Sair da fila
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="h-8 gap-1.5 text-[11px] flex-1 min-w-[120px] bg-primary text-primary-foreground hover:bg-primary/90"
                    onClick={turno.entrar}
                  >
                    <LogIn className="w-3.5 h-3.5" /> Entrar na fila
                  </Button>
                )}
                <Button
                  size="sm"
                  className={`h-8 gap-1.5 text-[11px] flex-1 min-w-[140px] font-bold ${
                    ehSuaVez ? "bg-emerald-500 text-emerald-950 hover:bg-emerald-500/90" : "bg-muted text-muted-foreground"
                  }`}
                  disabled={!ehSuaVez}
                  onClick={turno.passarVez}
                >
                  <SkipForward className="w-3.5 h-3.5" /> Passar a Vez
                </Button>
              </div>

              <div className="mt-5 pt-4 border-t border-border/40 flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                  <Volume2 className="w-3 h-3" /> Voz
                </div>
                <div className="flex items-center gap-2 flex-1 min-w-[140px]">
                  <Slider
                    value={[Math.round(voiceVolume * 100)]} min={0} max={100} step={5}
                    onValueChange={(v) => {
                      const val = (v[0] ?? 0) / 100;
                      setVoiceVolume(val); setStoredVolume(val);
                    }}
                  />
                  <span className="text-[10px] tabular-nums text-muted-foreground w-9 text-right">
                    {Math.round(voiceVolume * 100)}%
                  </span>
                </div>
                <Button size="sm" variant="outline" className="h-8 text-[11px] gap-1"
                  onClick={() => { speakTurno("É a sua vez! Teste de notificação do montante.", voiceVolume); toast.info("Tocando teste"); }}
                >
                  <PlayCircle className="w-3.5 h-3.5" /> Testar
                </Button>
              </div>
            </div>
          </section>
        )}

        <p className="text-center text-[10px] text-muted-foreground/60 mt-6">
          Atualização em tempo real · narração automática
        </p>
      </main>

      {(() => {
        const op: any = (montanteTask as any)?.operation_data;
        const rows: any[] = Array.isArray(op?.rows) ? op.rows : [];
        const dep = rows.reduce((s, r) => s + (Number(r?.deposito) || 0), 0);
        const saq = rows.reduce((s, r) => s + (Number(r?.saque) || 0), 0);
        const pct = Number(op?.blogueiroPercent) || 0;
        const blog = dep * pct;
        const qtd = rows.length || (montanteTask?.pix_keys?.length || 0);
        return (
          <MontanteDialog
            open={!!montanteTask}
            onOpenChange={(v) => { if (!v) setMontanteTask(null); }}
            defaultNome={montanteTask?.nome_tarefa || montanteTask?.link || ""}
            defaultDeposito={dep}
            defaultSaque={saq}
            defaultBlogueiro={blog}
            defaultQtdContas={qtd}
            defaultMultiplier={Number(op?.valueMultiplier) || 1}
            onSaved={async () => {
              if (montanteTask) {
                const prevOp: any = (montanteTask as any).operation_data || {};
                await updateOperation(montanteTask.id, { ...prevOp, dk_synced: true, savedAt: new Date().toISOString() });
                await complete(montanteTask.id);
                toast.success("Tarefa concluída");
                setMontanteTask(null);
                setTimeout(() => {
                  window.dispatchEvent(new Event("dkdash-lucros:changed"));
                }, 2000);
              }
            }}
          />
        );
      })()}
      <OperarPromptDialog
        open={!!operarPrompt}
        onOpenChange={(v) => { if (!v) setOperarPrompt(null); }}
        defaultLink={operarPrompt ? (extractUrl(operarPrompt.mensagem) || "") : ""}
        defaultMontante={(() => {
          if (!operarPrompt) return "";
          const n = extractNumeric(operarPrompt.matched ?? [], operarPrompt.mensagem ?? "");
          return n != null ? String(n) : "";
        })()}
        onConfirm={async ({ link, montante, grupo }) => {
          const m = operarPrompt;
          if (!m) return;
          setOperarPrompt(null);
          // Salva a atribuição do grupo pra esse link (e por consequência, pra
          // outras URLs do mesmo domínio via fallback do lookup).
          if (grupo && link) {
            try { await assignPlatformGroup([link], grupo); } catch (e) { console.error("bulkAssign", e); }
          }
          const parsedMontante = montante ? parseNumberToken(montante) : null;
          const mensagemForOp = parsedMontante != null
            ? `montante R$ ${parsedMontante}\n${m.mensagem || ""}`
            : (m.mensagem || "");
          const matchedForOp = parsedMontante != null
            ? Array.from(new Set([...(m.matched || []), String(parsedMontante)]))
            : (m.matched || []);
          const sourceMsgId = getOriginalWaMessageId(m as { id?: string; source_msg_id?: string });
          const taskMult = Number(valueMultByTask[sourceMsgId] ?? 1) || 1;
          const promoBase = (() => {
            if (!isPromoFor((m as any).created_at)) return undefined;
            const n = extractNumeric(matchedForOp, mensagemForOp);
            return promoTierPct(n);
          })();
          const seededBlogPct = (promoBase ?? 0.20) + bonusPpFromMult(taskMult);
          const newId = await addTask({
            autor: m.autor, telefone: m.telefone, grupo: m.grupo,
            mensagem: m.mensagem, matched: m.matched,
            link, nome_tarefa: link,
            source_msg_id: sourceMsgId,
            source_chat_id: (m as any).source_chat_id || "",
            source_author_id: (m as any).source_author_id || "",
          });
          if (newId) {
            await updateOperation(newId, { blogueiroPercent: seededBlogPct, valueMultiplier: taskMult } as any);
          }
          toast.success("Adicionada às tarefas");
          const dc = parsedMontante != null
            ? Math.max(1, Math.floor(parsedMontante / 200))
            : (contasFromMessage(m.matched, m.mensagem) || 1);
          const pixKeys = await generatePixKeysForTask({
            count: dc,
            link,
            taskId: newId,
          });
          if (newId && pixKeys.length > 0) await updatePixKeys(newId, pixKeys);
          const phantom: WaTask = {
            id: newId!, user_id: "", autor: m.autor, telefone: m.telefone || "",
            grupo: m.grupo || "", mensagem: mensagemForOp, matched: matchedForOp,
            status: "pending", created_at: new Date().toISOString(), completed_at: null,
            link, nome_tarefa: link, pix_keys: pixKeys,
            operation_data: { blogueiroPercent: seededBlogPct, valueMultiplier: taskMult } as any,
          };
          setOpDialog({ open: true, task: phantom });
        }}
      />


      <PixListDialog
        open={pixDialog.open}
        onOpenChange={(v) => setPixDialog((p) => ({ ...p, open: v }))}
        defaultCount={pixDialog.defaultCount}
        onChange={(items) => {
          if (pixDialog.taskId) updatePixKeys(pixDialog.taskId, items);
        }}
      />

      {(() => {
        // Mantém a task do modal sempre fresca — pega a versão atual do array
        // pra refletir updates como o blogueiroPercent setado pelo botão 3x.
        const liveOpTask = opDialog.task
          ? (tasks.find((t) => t.id === opDialog.task!.id) ?? opDialog.task)
          : null;
        const liveMult = Number((liveOpTask?.operation_data as any)?.valueMultiplier) || 1;
        const promoBase = (() => {
          if (!isPromoFor(liveOpTask?.created_at)) return undefined;
          const n = liveOpTask ? extractNumeric(liveOpTask.matched ?? [], liveOpTask.mensagem ?? "") : null;
          return promoTierPct(n);
        })();
        const effectiveDefault = promoBase != null ? promoBase + bonusPpFromMult(liveMult) : (liveMult > 1 ? 0.20 + bonusPpFromMult(liveMult) : undefined);
        return (
        <TaskOperationDialog
          open={opDialog.open}
          onOpenChange={(v) => setOpDialog((p) => ({ ...p, open: v }))}
          taskId={liveOpTask?.id ?? null}
          taskName={liveOpTask?.nome_tarefa || liveOpTask?.link || liveOpTask?.autor || ""}
          taskLink={liveOpTask?.link ?? null}
          defaultCount={liveOpTask ? (liveOpTask.operation_data?.rows?.length || liveOpTask.pix_keys?.length || contasFromMessage(liveOpTask.matched, liveOpTask.mensagem)) : null}
          targetTotal={liveOpTask ? extractNumeric(liveOpTask.matched ?? [], liveOpTask.mensagem ?? "") : null}
          defaultBlogueiroPercent={effectiveDefault}
          initial={liveOpTask?.operation_data
            ? (effectiveDefault != null
                ? { ...liveOpTask.operation_data, blogueiroPercent: effectiveDefault }
                : liveOpTask.operation_data)
            : null}
          initialPixKeys={liveOpTask?.pix_keys ?? []}
          onSave={async (data) => {
            if (liveOpTask) {
              const prev = (liveOpTask.operation_data as any) || {};
              await updateOperation(liveOpTask.id, { ...prev, ...data } as any);
            }
          }}
          onChangePixKeys={async (keys) => {
            if (liveOpTask) await updatePixKeys(liveOpTask.id, keys);
          }}
          taskHue={(() => {
            if (!liveOpTask || active.length < 2) return null;
            const TASK_HUES = [12, 45, 90, 160, 195, 230, 280, 320];
            const i = active.findIndex((x) => x.id === liveOpTask.id);
            return i >= 0 ? TASK_HUES[i % TASK_HUES.length] : null;
          })()}
        />
        );
      })()}
      <ManualTaskDialog
        open={manualTaskOpen}
        onOpenChange={setManualTaskOpen}
        groups={(() => {
          const names = Array.from(new Set(
            platformMappings.map((m) => m.platform_name).filter(Boolean)
          )).sort((a, b) => a.localeCompare(b));
          return names.map((n) => ({ chat_id: n, grupo: n }));
        })()}
        onConfirm={async (d) => {
          const parsedMontante = d.valor ? parseNumberToken(d.valor) : null;
          const matched = parsedMontante != null ? [String(parsedMontante)] : (d.valor ? [d.valor] : []);
          const mensagem = parsedMontante != null ? `montante R$ ${parsedMontante}` : (d.valor || "");
          const newId = await addTask({
            autor: "Manual",
            grupo: d.grupo || "",
            mensagem,
            matched,
            link: d.link,
            nome_tarefa: d.link,
            source_chat_id: undefined,
          });
          if (!newId) { toast.error("Falha ao adicionar"); return; }
          toast.success("Tarefa adicionada");
          const dc = parsedMontante != null
            ? Math.max(1, Math.floor(parsedMontante / 200))
            : (contasFromMessage(matched, mensagem) || 1);
          const pixKeys = await generatePixKeysForTask({
            count: dc,
            link: d.link,
            taskId: newId,
          });
          if (pixKeys.length > 0) await updatePixKeys(newId, pixKeys);
          const phantom: WaTask = {
            id: newId, user_id: "", autor: "Manual", telefone: "",
            grupo: d.grupo || "", mensagem, matched,
            status: "pending", created_at: new Date().toISOString(), completed_at: null,
            link: d.link, nome_tarefa: d.link, pix_keys: pixKeys, operation_data: {},
          };
          setOpDialog({ open: true, task: phantom });
        }}
      />
      <IOSInstallDialog open={iosInstallOpen} onOpenChange={setIosInstallOpen} />
      <Dialog open={conclusionEditOpen} onOpenChange={setConclusionEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modelo da mensagem de conclusão</DialogTitle>
          </DialogHeader>
          <Textarea
            value={conclusionDraft}
            onChange={(e) => setConclusionDraft(e.target.value)}
            rows={8}
            className="font-mono text-sm"
          />
          <div className="flex justify-between gap-2">
            <Button
              variant="ghost"
              onClick={() => setConclusionDraft(DEFAULT_CONCLUSION)}
            >
              Restaurar padrão
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setConclusionEditOpen(false)}>Cancelar</Button>
              <Button
                onClick={async () => {
                  await saveConclusionTemplate(conclusionDraft);
                  setConclusionEditOpen(false);
                }}
              >
                Salvar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MonitorPage;
