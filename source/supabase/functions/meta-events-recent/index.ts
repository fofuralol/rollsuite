import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({} as any));
    const token = String(body.token || "");
    const since = body.since ? String(body.since) : new Date(Date.now() - 60 * 60 * 1000).toISOString();
    if (!token) return json({ error: "missing token" }, 401);

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: tok } = await sb.from("wa_tokens").select("user_id").eq("token", token).maybeSingle();
    if (!tok?.user_id) return json({ error: "invalid token" }, 401);

    const { data, error } = await sb
      .from("meta_events")
      .select("id,title,steps,target,url,created_at,source_token,balance,balance_raw")
      .eq("user_id", tok.user_id)
      .eq("source_token", token)
      .gt("created_at", since)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) return json({ error: error.message }, 500);

    return json({ events: data || [], now: new Date().toISOString() });
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
