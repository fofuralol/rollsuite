import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const token = req.headers.get("x-webhook-token") || "";
    if (!token) return json({ error: "missing token" }, 401);

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: tok } = await sb.from("wa_tokens").select("user_id").eq("token", token).maybeSingle();
    if (!tok) return json({ error: "invalid token" }, 401);
    const user_id = tok.user_id;

    if (req.method === "GET") {
      const [{ data: pend }, { data: kws }] = await Promise.all([
        sb.from("wa_outbox")
          .select("id, chat_id, quoted_msg_id, text, image_url")
          .eq("user_id", user_id).eq("status", "pending")
          .order("created_at", { ascending: true }).limit(20),
        sb.from("wa_keywords").select("palavra").eq("user_id", user_id),
      ]);
      const ids = (pend ?? []).map((p: { id: string }) => p.id);
      if (ids.length) await sb.from("wa_outbox").update({ status: "sending" }).in("id", ids);

      // Gera URL assinada (5min) para cada image_url do bucket wa-task-images
      const messages = await Promise.all((pend ?? []).map(async (m: any) => {
        let signed = "";
        if (m.image_url) {
          const path = extractStoragePath(m.image_url);
          if (path) {
            const { data: s } = await sb.storage.from("wa-task-images").createSignedUrl(path, 300);
            signed = s?.signedUrl ?? "";
          }
        }
        return { ...m, image_url: signed };
      }));

      return json({
        ok: true,
        messages,
        keywords: (kws ?? []).map((k: { palavra: string }) => k.palavra),
      });
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const id = String(body.id ?? "");
      const ok = !!body.ok;
      const retry = !!body.retry;
      const error = String(body.error ?? "").slice(0, 500);
      if (!id) return json({ error: "missing id" }, 400);
      const nextStatus = ok ? "sent" : retry ? "pending" : "failed";
      const { error: upErr } = await sb.from("wa_outbox").update({
        status: nextStatus,
        error: ok ? "" : error,
        sent_at: ok ? new Date().toISOString() : null,
      }).eq("id", id).eq("user_id", user_id);
      if (upErr) return json({ error: upErr.message }, 500);
      return json({ ok: true });
    }

    return json({ error: "method not allowed" }, 405);
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

function extractStoragePath(url: string): string | null {
  // aceita: caminho cru "user_id/abc.png"  ou  URL pública/assinada do storage
  if (!url) return null;
  if (!url.includes("/")) return null;
  const m = url.match(/wa-task-images\/(.+?)(?:\?|$)/);
  if (m) return decodeURIComponent(m[1]);
  if (!url.startsWith("http")) return url;
  return null;
}
