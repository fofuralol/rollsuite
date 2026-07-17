import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import webpush from "https://esm.sh/web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const VAPID_PUBLIC = "BBoQs8679ZB5Hbs7CS0zuYf8rX-GrMHo6m8ebAcUw3pGzslglF8GlwpT9w_kCVp13RxJ029S3ADTRZItAZyhMdE";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY");
    const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";
    if (!VAPID_PRIVATE) return json({ error: "missing VAPID_PRIVATE_KEY" }, 500);

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json().catch(() => ({}));
    const { user_id, title, message, url, tag } = body as {
      user_id?: string; title?: string; message?: string; url?: string; tag?: string;
    };
    if (!user_id || !message) return json({ error: "user_id and message required" }, 400);
    console.log("send-push invoke", { user_id, title, tag });

    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", user_id);

    if (!subs || subs.length === 0) return json({ ok: true, sent: 0 });

    const payload = JSON.stringify({
      title: title || "WhatsApp",
      body: message.slice(0, 200),
      url: url || "/monitor",
      tag: tag || "wa-task",
    });

    const results = await Promise.allSettled(
      subs.map((s) =>
        webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          { TTL: 60, urgency: "high", topic: (tag || "wa").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || "wa" },
        )
      )
    );

    const toRemove: string[] = [];
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        const code = (r.reason as { statusCode?: number })?.statusCode;
        console.error("send-push delivery failed", {
          endpoint: subs[i]?.endpoint,
          statusCode: code,
          reason: String((r.reason as Error)?.message || r.reason),
        });
        if (code === 404 || code === 410) toRemove.push(subs[i].id);
      }
    });
    if (toRemove.length > 0) {
      await supabase.from("push_subscriptions").delete().in("id", toRemove);
    }

    const sent = results.filter((r) => r.status === "fulfilled").length;
    return json({ ok: true, sent, removed: toRemove.length });
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
