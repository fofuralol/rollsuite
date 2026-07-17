import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const token =
      url.searchParams.get("token") ||
      req.headers.get("x-token") ||
      (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");

    if (!token) return json({ error: "missing token" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: tok } = await supabase
      .from("wa_tokens")
      .select("user_id")
      .eq("token", token)
      .maybeSingle();

    if (!tok?.user_id) return json({ error: "invalid token" }, 401);

    const body = await req.json().catch(() => ({} as any));

    // aceita tanto { event:"target_reached", title, steps, target, url, tabId, ... }
    // quanto outros shapes da extensão
    const event = String(body.event || body.type || "").toLowerCase();
    if (event && event !== "target_reached" && event !== "meta_atingida") {
      return json({ ok: true, skipped: true, event });
    }

    const title = body.title || body.tabTitle || body.nome || null;
    const sourceUrl = body.url || body.tabUrl || body.link || null;
    const steps = Number(body.steps ?? body.current ?? body.atual ?? 0) || null;
    const target = Number(body.target ?? body.meta ?? body.goal ?? 0) || null;
    const tabId = body.tabId != null ? String(body.tabId) : null;
    const balanceRaw = body.balance_raw ?? body.balanceRaw ?? body.saldo_raw ?? null;
    const balanceNum = (() => {
      const v = body.balance ?? body.saldo;
      if (v == null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    })();

    const { error } = await supabase.from("meta_events").insert({
      user_id: tok.user_id,
      title,
      url: sourceUrl,
      steps,
      target,
      balance: balanceNum,
      balance_raw: balanceRaw ? String(balanceRaw) : null,
      source_tab_id: tabId,
      source_token: token,
      raw: body,
    });
    if (error) return json({ error: error.message }, 500);

    // dispara push notification — usa waitUntil pra não ser cancelado quando a function retornar
    try {
      const pushUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-push`;
      const metaLabel = title ? `: ${title}` : "";
      const balanceLabel = balanceNum != null ? ` · R$ ${balanceNum.toFixed(2).replace(".", ",")}` : (balanceRaw ? ` · ${balanceRaw}` : "");
      const desc = (steps != null && target != null ? `${steps} / ${target}` : "Meta concluída") + balanceLabel;
      const pushPromise = fetch(pushUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({
          user_id: tok.user_id,
          title: `🎯 Meta atingida${metaLabel}`,
          message: desc,
          url: "/monitor",
          tag: `meta-${tabId || Date.now()}`,
        }),
      }).then(async (r) => {
        if (!r.ok) console.error("send-push failed", r.status, await r.text().catch(() => ""));
      }).catch((e) => console.error("send-push error", e));
      // @ts-ignore EdgeRuntime existe no Supabase Edge Functions
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
        // @ts-ignore
        EdgeRuntime.waitUntil(pushPromise);
      } else {
        await pushPromise;
      }
    } catch (e) { console.error("push dispatch err", e); }

    return json({ ok: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
