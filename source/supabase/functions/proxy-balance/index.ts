const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEFAULT_PROXY_ID = "948924";
const API_BASE = "https://api.marceloproxies.com.br";
const BYTES_IN_GB = 1024 * 1024 * 1024;
const PACOTE_GB = 5;

const buildResponse = (disponivelBytes: number, balanceFormat?: string) => {
  const disponivelGbTotal = disponivelBytes / BYTES_IN_GB;
  const disponivelGb = Math.min(PACOTE_GB, disponivelGbTotal);
  const usadoGb = Math.max(0, PACOTE_GB - disponivelGb);
  const percentualUsado = (usadoGb / PACOTE_GB) * 100;
  const fmt = (gb: number) => `${gb.toFixed(2)} GB`;

  return {
    usadoGb: Math.round(usadoGb * 100) / 100,
    totalGb: PACOTE_GB,
    disponivelGb: Math.round(disponivelGb * 100) / 100,
    percentualUsado: Math.round(percentualUsado * 10) / 10,
    usadoText: fmt(usadoGb),
    totalText: fmt(PACOTE_GB),
    disponivelText: balanceFormat ?? fmt(disponivelGb),
    atualizadoEm: new Date().toISOString(),
  };
};

const extractProxyId = (input: string | null | undefined): string => {
  if (!input) return DEFAULT_PROXY_ID;
  const trimmed = input.trim();
  if (!trimmed) return DEFAULT_PROXY_ID;
  // Já é um ID puro
  if (/^[A-Za-z0-9]+$/.test(trimmed) && !/^https?:/i.test(trimmed)) return trimmed;
  // URL: pega o segmento após /proxy/
  const m = trimmed.match(/\/proxy\/([A-Za-z0-9_-]+)/i);
  if (m) return m[1];
  // Fallback: último segmento alfanumérico significativo
  const seg = trimmed.split(/[\/?#]/).filter(Boolean).pop();
  if (seg && /^[A-Za-z0-9_-]+$/.test(seg)) return seg;
  // Fallback final: bloco de dígitos
  const digits = trimmed.match(/(\d{3,})(?!.*\d)/);
  return digits ? digits[1] : DEFAULT_PROXY_ID;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let panelUrl: string | null = null;
  let proxyIdRaw: string | null = null;
  try {
    const url = new URL(req.url);
    panelUrl = url.searchParams.get("panelUrl");
    proxyIdRaw = url.searchParams.get("proxyId");
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      panelUrl = body?.panelUrl ?? panelUrl;
      proxyIdRaw = body?.proxyId ?? proxyIdRaw;
    }
  } catch {
    // ignore
  }

  const PROXY_ID = extractProxyId(proxyIdRaw || panelUrl);

  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "application/json",
  };

  const fetchSafe = async (url: string, ms = 9000): Promise<any> => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { headers, signal: ctrl.signal });
      if (!r.ok) return {};
      return await r.json().catch(() => ({}));
    } catch (e) {
      console.warn(`fetchSafe failed for ${url}:`, (e as Error).message);
      return {};
    } finally {
      clearTimeout(t);
    }
  };

  try {
    const results = await Promise.allSettled([
      fetchSafe(`${API_BASE}/proxies/${PROXY_ID}`),
      fetchSafe(`${API_BASE}/balance/${PROXY_ID}/balance`),
    ]);
    const proxy = results[0].status === "fulfilled" ? results[0].value : {};
    const bal = results[1].status === "fulfilled" ? results[1].value : {};

    const disponivelBytes = Number(bal?.balance ?? proxy?.currentBalance ?? 0);
    const data = buildResponse(disponivelBytes, bal?.balance_format);

    return new Response(JSON.stringify({ ...data, proxyId: PROXY_ID }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    console.error("proxy-balance error:", message);
    return new Response(
      JSON.stringify({ ...buildResponse(0), error: message, proxyId: PROXY_ID }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  }
});
