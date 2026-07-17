// Public endpoint — extension calls without auth
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ ok: false, reason: "method" }, 405);

  let body: any = {};
  try { body = await req.json(); } catch { return json({ ok: false, reason: "bad_json" }, 400); }

  const serial = String(body.serial || "").trim().toUpperCase();
  const device_id = String(body.device_id || "").trim();
  const device_info = String(body.device_info || "").slice(0, 500);

  if (!serial || !device_id) return json({ ok: false, reason: "missing_fields" }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: row, error } = await supabase
    .from("extension_licenses")
    .select("*")
    .eq("serial", serial)
    .maybeSingle();

  if (error) return json({ ok: false, reason: "db_error" }, 500);
  if (!row) return json({ ok: false, reason: "invalid_serial" });
  if (!row.active) return json({ ok: false, reason: "revoked" });

  // First activation → bind device
  if (!row.device_id) {
    const { error: upErr } = await supabase
      .from("extension_licenses")
      .update({
        device_id,
        device_info,
        activated_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (upErr) return json({ ok: false, reason: "db_error" }, 500);
    return json({ ok: true, bound: true });
  }

  // Already bound — must match
  if (row.device_id !== device_id) return json({ ok: false, reason: "device_mismatch" });

  await supabase.from("extension_licenses").update({ last_seen_at: new Date().toISOString() }).eq("id", row.id);
  return json({ ok: true });
});
