import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const token = req.headers.get("x-webhook-token") || "";
    if (!token) return json({ error: "missing token" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: tok } = await supabase
      .from("wa_tokens").select("user_id").eq("token", token).maybeSingle();
    if (!tok) return json({ error: "invalid token" }, 401);
    const user_id = tok.user_id;

    const body = await req.json().catch(() => ({}));
    const autor = String(body.autor ?? "").slice(0, 200);
    const telefone = String(body.telefone ?? "").slice(0, 50);
    const grupo = String(body.grupo ?? "").slice(0, 200);
    const mensagem = String(body.mensagem ?? "").slice(0, 4000);
    let matched = Array.isArray(body.matched)
      ? body.matched.map((s: unknown) => String(s)).slice(0, 30)
      : null;
    const source_msg_id = String(body.msg_id ?? body.source_msg_id ?? "").slice(0, 300);
    const source_chat_id = String(body.chat_id ?? body.source_chat_id ?? "").slice(0, 300);
    const source_author_id = String(body.author_id ?? body.source_author_id ?? "").slice(0, 300);
    const source = String(body.source ?? "").slice(0, 20); // "v2" = listener novo
    if (!mensagem) return json({ ok: true, ignored: "empty" });

    // Filtro de "modelo de PIX" — aplica SEMPRE (listener antigo e v2),
    // pois mensagens de depósito/comprovante não devem virar notificação.
    const lower = mensagem.toLowerCase();
    const isPixModel =
      (lower.includes("pix") &&
        (lower.includes("valor") || lower.includes("chave") || lower.includes("comprovante") ||
         lower.includes("confirmado") || lower.includes("enviado") || lower.includes("deposito") ||
         lower.includes("depósito") || lower.includes("transferência") || lower.includes("transferencia"))) ||
      (lower.includes("nome:") && lower.includes("valor:") && lower.includes("pix")) ||
      (lower.includes("valor:") && (lower.includes("chave:") || lower.includes("chave pix"))) ||
      (lower.includes("nome:") && lower.includes("valor:") && lower.includes("chave"));
    if (isPixModel) return json({ ok: true, ignored: "pix-model" });

    // Retrocompatível: se o listener (antigo) não mandar `matched`, aplicamos o filtro aqui.
    if (matched === null) {
      // Toggle: só afeta o listener ANTIGO. O v2 já filtra por grupo localmente.
      if (source !== "v2") {
        const { data: setting } = await supabase
          .from("app_settings")
          .select("value")
          .eq("user_id", user_id)
          .eq("key", "wa_old_listener_enabled")
          .maybeSingle();
        const enabled = setting?.value !== "false"; // default = ativo
        if (!enabled) return json({ ok: true, ignored: "old-listener-disabled" });
      }

      const { data: kws } = await supabase.from("wa_keywords").select("palavra").eq("user_id", user_id);
      const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const stripUrls = (s: string) => s
        .replace(/\b(?:https?:\/\/|www\.)\S+/gi, " ")
        .replace(/\b[\w-]+\.(?:com|net|org|io|br|co|gg|me|app|dev|xyz|info|tv|live|site|online|store|link|bet|vip|win|club|games?|cc|to|us|uk|eu)(?:\.[a-z]{2})?(?:\/\S*)?/gi, " ");
      const normalizeAmount = (s: string): string | null => {
        let v = s.trim();
        const mK = v.match(/^([\d.,]+)\s*[kK]$/);
        if (mK) {
          const num = parseFloat(mK[1].replace(",", "."));
          if (!isFinite(num)) return null;
          return String(Math.round(num * 1000));
        }
        v = v.replace(/[.,]\d{1,2}$/, "");
        v = v.replace(/[.,]/g, "");
        return v;
      };
      matched = (kws ?? [])
        .map((k: { palavra: string }) => k.palavra)
        .filter((p: string) => {
          if (!p) return false;
          if (/^\d+$/.test(p)) {
            const clean = stripUrls(mensagem);
            const re = /\d+(?:[.,]\d+)?\s*[kK](?![\p{L}\p{N}_])|\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?/gu;
            const nums = clean.match(re) || [];
            return nums.some((n) => normalizeAmount(n) === p);
          }
          const re = new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escapeRegex(p)}(?=$|[^\\p{L}\\p{N}_])`, "iu");
          return re.test(mensagem);
        });
    }

    if (matched.length === 0) return json({ ok: true, ignored: "no-match" });

    const { error: insErr } = await supabase.from("wa_messages").insert({
      user_id, autor, telefone, grupo, mensagem, matched,
      source_msg_id, source_chat_id, source_author_id,
    });
    if (insErr) {
      // 23505 = unique_violation → mensagem já foi salva por outro listener (zapo em outro PC)
      if ((insErr as any).code === "23505") return json({ ok: true, ignored: "duplicate" });
      return json({ error: insErr.message }, 500);
    }

    try {
      const pushUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-push`;
      fetch(pushUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({
          user_id,
          title: `WhatsApp: ${autor || "Nova mensagem"}`,
          message: mensagem,
          url: "/monitor",
        }),
      }).catch(() => {});
    } catch { /* ignore */ }

    return json({ ok: true, matched });
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
