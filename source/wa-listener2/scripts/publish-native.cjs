#!/usr/bin/env node
// Empacota wa-listener2/release/Zapo2-win32-x64/ em zip e publica em zapo2-updates/native/.
// Uso (PowerShell na pasta wa-listener2):
//   npm run package:win
//   $env:SUPABASE_URL="https://ttnpouzoswhhqvedvngx.supabase.co"
//   $env:SUPABASE_SERVICE_ROLE_KEY="<service role>"
//   node scripts/publish-native.cjs
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = "zapo2-updates";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente.");
  process.exit(1);
}

const APP_NAME = "Zapo2";
const SRC_DIR = path.resolve(__dirname, "..", "release", `${APP_NAME}-win32-x64`);
if (!fs.existsSync(SRC_DIR)) {
  console.error("Pasta não encontrada:", SRC_DIR);
  console.error("Rode primeiro: npm run package:win");
  process.exit(1);
}

const version = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
const ZIP_OUT = path.resolve(__dirname, "..", "release", `${APP_NAME}-win32-x64-${version}.zip`);
try { fs.unlinkSync(ZIP_OUT); } catch {}

console.log("Zipping contents of", SRC_DIR);
try {
  // PowerShell built-in (Windows)
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${SRC_DIR}\\*' -DestinationPath '${ZIP_OUT}' -Force"`,
    { stdio: "inherit" },
  );
} catch {
  // Fallback: zip CLI (Linux/macOS/git-bash)
  execSync(`zip -qr "${ZIP_OUT}" .`, { cwd: SRC_DIR, stdio: "inherit" });
}
const stat = fs.statSync(ZIP_OUT);
console.log("Zip pronto:", ZIP_OUT, (stat.size / 1024 / 1024).toFixed(1), "MB");

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
  const zipBuf = fs.readFileSync(ZIP_OUT);
  console.log(`Uploading native/${APP_NAME}-win32-x64.zip (${(zipBuf.length / 1024 / 1024).toFixed(1)} MB)…`);
  await upload(`native/${APP_NAME}-win32-x64.zip`, zipBuf, "application/zip");
  const meta = {
    version,
    generatedAt: new Date().toISOString(),
    platform: "win32-x64",
    file: `${APP_NAME}-win32-x64.zip`,
    size: zipBuf.length,
  };
  await upload("native/version.txt", Buffer.from(version), "text/plain");
  await upload("native/manifest.json", Buffer.from(JSON.stringify(meta, null, 2)), "application/json");
  console.log("OK. Native version:", version);
})().catch((e) => { console.error(e); process.exit(1); });
