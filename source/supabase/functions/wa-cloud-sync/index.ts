import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const RETENTION_DAYS = 7;

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

    const url = new URL(req.url);
    const op = url.searchParams.get("op") || (req.method === "GET" ? "pull-outbox" : "");

    if (op === "pull-outbox" && req.method === "GET") {
      // Idempotente: NÃO marca como sending. PC dedup por id e acka quando enviar.
      const { data: pend } = await sb.from("wa_outbox")
        .select("id, chat_id, quoted_msg_id, text, image_url")
        .eq("user_id", user_id).eq("status", "pending")
        .order("created_at", { ascending: true }).limit(20);

      const messages = await Promise.all((pend ?? []).map(async (m: any) => {
        let signed = "";
        if (m.image_url) {
          const sp = extractStoragePath(m.image_url);
          if (sp) {
            const { data: s } = await sb.storage.from("wa-task-images").createSignedUrl(sp, 300);
            signed = s?.signedUrl ?? "";
          }
        }
        return { ...m, image_url: signed };
      }));
      return json({ ok: true, messages });
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const innerOp = String(body.op || op || "");

      if (innerOp === "push-messages") {
        const msgs = Array.isArray(body.messages) ? body.messages : [];
        if (msgs.length) {
          const rows = msgs.map((m: any) => ({
            user_id,
            autor: String(m.autor || ""),
            telefone: String(m.telefone || ""),
            grupo: String(m.grupo || ""),
            mensagem: String(m.mensagem || ""),
            matched: Array.isArray(m.matched) ? m.matched : [],
            source_msg_id: String(m.source_msg_id || ""),
            source_chat_id: String(m.source_chat_id || ""),
            source_author_id: String(m.source_author_id || ""),
            created_at: m.created_at || new Date().toISOString(),
          }));
          const { error: upErr } = await sb.from("wa_messages")
            .upsert(rows, { onConflict: "user_id,source_msg_id", ignoreDuplicates: true });
          if (upErr) return json({ error: upErr.message }, 500);
        }
        // limpeza retenção
        const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400_000).toISOString();
        await sb.from("wa_messages").delete().eq("user_id", user_id).lt("created_at", cutoff);
        return json({ ok: true, inserted: msgs.length });
      }

      if (innerOp === "ack-outbox") {
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

      return json({ error: "unknown op" }, 400);
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
  if (!url) return null;
  if (!url.includes("/")) return null;
  const m = url.match(/wa-task-images\/(.+?)(?:\?|$)/);
  if (m) return decodeURIComponent(m[1]);
  if (!url.startsWith("http")) return url;
  return null;
}
