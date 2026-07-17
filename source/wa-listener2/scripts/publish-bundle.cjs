#!/usr/bin/env node
// Publica o bundle frontend do Zapo2 (main-app.cjs, preload.cjs, ui/index.html)
// como version.json em zapo2-updates/version.json.
//
// Uso:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/publish-bundle.cjs
const fs = require("fs");
const path = require("path");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = "zapo2-updates";
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const ROOT = path.resolve(__dirname, "..");
const FILES = [
  { name: "main-app.cjs", src: path.join(ROOT, "src", "main-app.cjs"), type: "text" },
  { name: "preload.cjs",  src: path.join(ROOT, "src", "preload.cjs"),  type: "text" },
  { name: "index.html",   src: path.join(ROOT, "src", "ui", "index.html"), type: "text" },
];

const version = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
const filesPayload = {};
for (const f of FILES) {
  if (!fs.existsSync(f.src)) { console.error("Faltando:", f.src); process.exit(1); }
  filesPayload[f.name] = { type: f.type, content: fs.readFileSync(f.src, f.type === "text" ? "utf8" : null) };
  if (f.type !== "text") filesPayload[f.name].content = filesPayload[f.name].content.toString("base64");
}
const manifest = { version, generatedAt: new Date().toISOString(), notes: "auto", files: filesPayload };

async function upload(rel, buf, contentType) {
  const url = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${rel}`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      "Content-Type": contentType,
      "x-upsert": "true",
    },
    body: buf,
  });
  if (!r.ok) throw new Error(`upload ${rel}: ${r.status} ${await r.text()}`);
}

(async () => {
  const body = Buffer.from(JSON.stringify(manifest));
  console.log(`Uploading version.json (${(body.length / 1024).toFixed(1)} KB) v${version}…`);
  await upload("version.json", body, "application/json");
  console.log("OK. Bundle version:", version);
})().catch((e) => { console.error(e); process.exit(1); });
