import { useEffect, useState, useCallback } from "react";
import { Wifi, RefreshCw, AlertCircle, Pencil, ShoppingCart, Ticket } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const CONN_STORAGE_KEY = "proxy_connection_string";
const CONN_SETTING_KEY = "proxy_connection_string";
const URL_STORAGE_KEY = "proxy_panel_url";
const URL_SETTING_KEY = "proxy_panel_url";
const DEFAULT_CONN = "proxy.marceloproxies.com.br:823:d6c6f7e581a465f3b270:3fb4c21e2aac785f";
const DEFAULT_URL = "https://marceloproxies.com.br/proxy/948924";

interface ProxyBalance {
  usadoGb: number | null;
  totalGb: number | null;
  disponivelGb: number | null;
  percentualUsado: number | null;
  usadoText: string | null;
  totalText: string | null;
  disponivelText: string | null;
  atualizadoEm: string;
}

const REFRESH_MS = 60 * 1000;

const ProxyBalanceCard = () => {
  const [data, setData] = useState<ProxyBalance | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conn, setConn] = useState<string>(() => {
    const saved = (localStorage.getItem(CONN_STORAGE_KEY) ?? "").trim();
    return saved || DEFAULT_CONN;
  });
  const [panelUrl, setPanelUrl] = useState<string>(() => {
    const saved = (localStorage.getItem(URL_STORAGE_KEY) ?? "").trim();
    return saved || DEFAULT_URL;
  });
  const [editing, setEditing] = useState(false);
  const [draftConn, setDraftConn] = useState("");
  const [draftUrl, setDraftUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [couponCopied, setCouponCopied] = useState(false);

  const copyCoupon = async () => {
    try {
      await navigator.clipboard.writeText("BLACKETERNA");
      setCouponCopied(true);
      toast.success("Cupom BLACKETERNA copiado");
      setTimeout(() => setCouponCopied(false), 1500);
    } catch {
      toast.error("Falha ao copiar cupom");
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const localConn = (localStorage.getItem(CONN_STORAGE_KEY) ?? "").trim();
      const localUrl = (localStorage.getItem(URL_STORAGE_KEY) ?? "").trim();
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;

      const { data: rows } = await supabase
        .from("app_settings")
        .select("key,value")
        .in("key", [CONN_SETTING_KEY, URL_SETTING_KEY]);

      if (cancelled) return;

      const remoteConn = rows?.find((r) => r.key === CONN_SETTING_KEY)?.value?.trim() ?? "";
      const remoteUrl = rows?.find((r) => r.key === URL_SETTING_KEY)?.value?.trim() ?? "";

      const resolvedConn = remoteConn || localConn || DEFAULT_CONN;
      const resolvedUrl = remoteUrl || localUrl || DEFAULT_URL;

      setConn(resolvedConn);
      setPanelUrl(resolvedUrl);
      localStorage.setItem(CONN_STORAGE_KEY, resolvedConn);
      localStorage.setItem(URL_STORAGE_KEY, resolvedUrl);

      if (uid) {
        const upserts: Array<{ user_id: string; key: string; value: string }> = [];
        if (!remoteConn) upserts.push({ user_id: uid, key: CONN_SETTING_KEY, value: resolvedConn });
        if (!remoteUrl) upserts.push({ user_id: uid, key: URL_SETTING_KEY, value: resolvedUrl });
        if (upserts.length > 0) {
          await supabase.from("app_settings").upsert(upserts, { onConflict: "user_id,key" });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const openEditor = () => {
    setDraftConn(conn);
    setDraftUrl(panelUrl);
    setEditing(true);
  };

  const saveSettings = async () => {
    const vConn = draftConn.trim();
    const vUrl = draftUrl.trim();

    if (!vConn) {
      toast.error("Preencha a conexão da proxy");
      return;
    }
    if (!vUrl) {
      toast.error("Preencha a URL do painel");
      return;
    }
    try {
      new URL(vUrl);
    } catch {
      toast.error("URL inválida");
      return;
    }

    localStorage.setItem(CONN_STORAGE_KEY, vConn);
    localStorage.setItem(URL_STORAGE_KEY, vUrl);
    setConn(vConn);
    setPanelUrl(vUrl);
    setEditing(false);

    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) {
      toast.success("Salvo localmente (sem login)");
      return;
    }
    const { error: upErr } = await supabase
      .from("app_settings")
      .upsert(
        [
          { user_id: uid, key: CONN_SETTING_KEY, value: vConn },
          { user_id: uid, key: URL_SETTING_KEY, value: vUrl },
        ],
        { onConflict: "user_id,key" }
      );
    if (upErr) {
      toast.error("Salvo local, falha ao sincronizar");
    } else {
      toast.success("Configurações salvas");
    }
  };

  const copyConn = async () => {
    const resolvedConn = (conn || localStorage.getItem(CONN_STORAGE_KEY) || "").trim();
    if (!resolvedConn) {
      openEditor();
      return;
    }
    try {
      await navigator.clipboard.writeText(resolvedConn);
      setCopied(true);
      toast.success("Conexão copiada");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Falha ao copiar");
    }
  };

  const fetchBalance = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: result, error: invokeErr } = await supabase.functions.invoke("proxy-balance", {
        body: { panelUrl },
      });
      if (invokeErr) throw invokeErr;
      if (result?.error) throw new Error(result.error);
      setData(result as ProxyBalance);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao buscar saldo");
    } finally {
      setLoading(false);
    }
  }, [panelUrl]);

  useEffect(() => {
    fetchBalance();
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => { if (!id) id = setInterval(fetchBalance, REFRESH_MS); };
    const stop = () => { if (id) { clearInterval(id); id = null; } };
    if (typeof document === "undefined" || !document.hidden) start();
    const onVis = () => {
      if (document.hidden) stop();
      else { fetchBalance(); start(); }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [fetchBalance]);

  const pct = data?.percentualUsado ?? 0;
  const isCritical = pct >= 75;
  const isWarning = pct >= 40 && pct < 75;
  const ringColor = isCritical
    ? "hsl(0 84% 60%)"
    : isWarning
    ? "hsl(48 96% 53%)"
    : "hsl(187 95% 55%)";
  const textColorClass = isCritical
    ? "text-red-500"
    : isWarning
    ? "text-yellow-400"
    : "text-cyan-400";

  const size = 96;
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - Math.min(100, pct) / 100);

  return (
    <div className="bg-card border border-border rounded-xl p-4 relative shadow-sm">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Proxy
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={openEditor}
            className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
            title="Editar configurações da proxy"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={fetchBalance}
            disabled={loading}
            className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            title="Atualizar saldo"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
          <Wifi className={`w-4 h-4 ${data ? textColorClass : "text-muted-foreground"}`} />
        </div>
      </div>

      <button
        onClick={copyCoupon}
        className={`absolute top-12 right-3 flex items-center gap-1 px-2 py-0.5 rounded-sm border border-dashed text-[10px] font-mono font-bold uppercase tracking-wider transition-colors ${
          couponCopied
            ? "border-emerald-400 text-emerald-400 bg-emerald-400/10"
            : "border-amber-400/60 text-amber-400 hover:border-amber-400 hover:bg-amber-400/10"
        }`}
        title="Copiar cupom BLACKETERNA"
      >
        <Ticket className="w-3 h-3" />
        <span>{couponCopied ? "Copiado!" : "BLACKETERNA"}</span>
      </button>

      <button
        onClick={() => {
          const w = 900;
          const h = 700;
          const left = window.screenX + (window.outerWidth - w) / 2;
          const top = window.screenY + (window.outerHeight - h) / 2;
          window.open(
            panelUrl,
            "marceloproxies_addgb",
            `popup=yes,width=${w},height=${h},left=${left},top=${top}`
          );
        }}
        className="absolute top-[5.25rem] right-3 flex items-center gap-1 px-2 py-0.5 rounded-sm bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/25 hover:text-emerald-300 transition-colors text-[10px] font-bold tracking-wider"
        title="Abrir painel da proxy para adicionar GBs"
      >
        <ShoppingCart className="w-3 h-3" />
        <span>Adicionar GBs</span>
      </button>

      {error ? (
        <div className="flex items-center gap-1.5 text-destructive text-xs">
          <AlertCircle className="w-3 h-3" />
          <span className="truncate">{error}</span>
        </div>
      ) : !data ? (
        <span className="text-xs text-muted-foreground animate-pulse">Carregando...</span>
      ) : (
        <div className="flex items-center gap-3">
          <div className="relative shrink-0" style={{ width: size, height: size }}>
            <svg
              width={size}
              height={size}
              className="-rotate-90"
              style={{ filter: `drop-shadow(0 0 8px ${ringColor})` }}
            >
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke="hsl(var(--muted))"
                strokeWidth={stroke}
                opacity={0.3}
              />
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={ringColor}
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                style={{ transition: "stroke-dashoffset 0.6s ease, stroke 0.3s ease" }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`font-mono text-xl font-bold ${textColorClass}`}>
                {pct.toFixed(0)}%
              </span>
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                Usado
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <div className="flex flex-col">
              <span className={`font-mono text-lg font-bold ${textColorClass}`}>
                {data.disponivelText ?? "—"}
              </span>
              <span className="text-[10px] text-muted-foreground">Disponível</span>
            </div>
            <div className={`text-[10px] font-mono ${textColorClass} opacity-80`}>
              {data.usadoText} / {data.totalText}
            </div>
            <button
              onClick={copyConn}
              className={`mt-1 self-start px-2 py-0.5 rounded transition-colors text-[10px] font-semibold shadow-sm whitespace-nowrap ${
                isCritical
                  ? "bg-red-500 text-white hover:bg-red-400"
                  : isWarning
                  ? "bg-yellow-400 text-black hover:bg-yellow-300"
                  : "bg-cyan-400 text-black hover:bg-cyan-300"
              }`}
              title={conn ? "Copiar conexão" : "Definir conexão"}
            >
              {copied ? "Copiado!" : "Copiar conexão"}
            </button>
          </div>
        </div>
      )}

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Configurações da Proxy</DialogTitle>
            <DialogDescription>
              Estas configurações ficam fixas até serem alteradas novamente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="proxy-url" className="text-xs">
                URL do painel da proxy
              </Label>
              <Input
                id="proxy-url"
                value={draftUrl}
                onChange={(e) => setDraftUrl(e.target.value)}
                placeholder="https://marceloproxies.com.br/proxy/..."
                className="font-mono text-xs"
              />
              <p className="text-[10px] text-muted-foreground">
                Usada também ao clicar em "Adicionar GBs".
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="proxy-conn" className="text-xs">
                Conexão da proxy
              </Label>
              <Input
                id="proxy-conn"
                value={draftConn}
                onChange={(e) => setDraftConn(e.target.value)}
                placeholder="host:porta:user:senha"
                className="font-mono text-xs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
            <Button onClick={saveSettings}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProxyBalanceCard;
