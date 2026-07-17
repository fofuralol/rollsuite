import { useEffect, useState, useCallback } from "react";
import { Ticket, ShoppingCart } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const CONN_STORAGE_KEY = "proxy_connection_string";
const URL_STORAGE_KEY = "proxy_panel_url";
const DEFAULT_CONN = "proxy.marceloproxies.com.br:823:d6c6f7e581a465f3b270:3fb4c21e2aac785f";
const DEFAULT_URL = "https://marceloproxies.com.br/proxy/948924";
const REFRESH_MS = 60 * 1000;

interface ProxyBalance {
  percentualUsado: number | null;
  usadoText: string | null;
  totalText: string | null;
  disponivelText: string | null;
}

const ProxyMiniRing = () => {
  const [data, setData] = useState<ProxyBalance | null>(null);
  const [loading, setLoading] = useState(false);

  const panelUrl = (typeof window !== "undefined"
    ? localStorage.getItem(URL_STORAGE_KEY)?.trim()
    : "") || DEFAULT_URL;

  const fetchBalance = useCallback(async () => {
    setLoading(true);
    try {
      const { data: result, error } = await supabase.functions.invoke("proxy-balance", {
        body: { panelUrl },
      });
      if (error) throw error;
      if (result?.error) throw new Error(result.error);
      setData(result as ProxyBalance);
    } catch {
      // silencioso no header
    } finally {
      setLoading(false);
    }
  }, [panelUrl]);

  useEffect(() => {
    fetchBalance();
    const id = setInterval(fetchBalance, REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchBalance]);

  const handleClick = async () => {
    const conn = (localStorage.getItem(CONN_STORAGE_KEY) || DEFAULT_CONN).trim();
    try {
      await navigator.clipboard.writeText(conn);
      toast.success("Conexão proxy copiada");
    } catch {
      toast.error("Falha ao copiar");
    }
  };

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

  const openPanel = () => {
    const url = (typeof window !== "undefined"
      ? localStorage.getItem(URL_STORAGE_KEY)?.trim()
      : "") || DEFAULT_URL;
    const w = 900;
    const h = 700;
    const left = window.screenX + (window.outerWidth - w) / 2;
    const top = window.screenY + (window.outerHeight - h) / 2;
    window.open(
      url,
      "marceloproxies_addgb",
      `popup=yes,width=${w},height=${h},left=${left},top=${top}`
    );
  };

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

  const size = 38;
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - Math.min(100, pct) / 100);

  return (
    <div className="flex items-center gap-2 shrink-0">
      <button
        type="button"
        onClick={handleClick}
        title={data ? `Proxy · clique para copiar conexão` : "Proxy: carregando..."}
        className="flex items-center gap-2.5 shrink-0 rounded-lg px-2 py-1 hover:bg-muted/60 active:scale-95 transition-colors disabled:opacity-50"
        disabled={loading && !data}
        aria-label="Saldo da proxy"
      >
        <div className="relative shrink-0" style={{ width: size, height: size }}>
          <svg
            width={size}
            height={size}
            className="-rotate-90"
            style={{ filter: data ? `drop-shadow(0 0 4px ${ringColor})` : undefined }}
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
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={`font-mono text-[9px] font-bold ${data ? textColorClass : "text-muted-foreground"}`}>
              {data ? `${pct.toFixed(0)}%` : "…"}
            </span>
          </div>
        </div>

        <div className="flex flex-col items-start text-left leading-tight">
          <span className={`font-mono text-[11px] font-bold ${data ? textColorClass : "text-muted-foreground"}`}>
            {data ? data.disponivelText ?? "—" : "—"}
          </span>
          <span className="text-[9px] text-muted-foreground">
            {data ? `${data.usadoText} / ${data.totalText}` : "carregando..."}
          </span>
        </div>
      </button>

      <div className="flex items-center gap-1">
        <button
          onClick={copyCoupon}
          className={`flex items-center gap-1 px-2 py-0.5 rounded-sm border border-dashed text-[10px] font-mono font-bold uppercase tracking-wider transition-colors ${
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
          onClick={openPanel}
          className="flex items-center gap-1 px-2 py-0.5 rounded-sm bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/25 hover:text-emerald-300 transition-colors text-[10px] font-bold tracking-wider"
          title="Abrir painel da proxy para adicionar GBs"
        >
          <ShoppingCart className="w-3 h-3" />
          <span>Adicionar GBs</span>
        </button>
      </div>
    </div>
  );
};

export default ProxyMiniRing;
