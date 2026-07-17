#!/usr/bin/env node
// Empacota electron-release/RollsSuite-win32-x64/ em zip e publica no bucket rolls-updates
// como `native/RollsSuite-win32-x64.zip` + `native/version.txt`.
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = "rolls-updates";

if (!SUPABASE_URL || !SERVICE_KEY) { console.error("Missing env"); process.exit(1); }

const SRC_DIR = path.resolve(__dirname, "..", "electron-release", "RollsSuite-win32-x64");
if (!fs.existsSync(SRC_DIR)) {
  console.error("Pasta não encontrada:", SRC_DIR);
  console.error("Rode primeiro: npx @electron/packager . RollsSuite --platform=win32 --arch=x64 --out=electron-release --overwrite --prune=true --icon=build/icon.ico --extra-resource=build/icon.ico");
  process.exit(1);
}

const ICON_RESOURCE = path.join(SRC_DIR, "resources", "icon.ico");
if (!fs.existsSync(ICON_RESOURCE)) {
  console.warn("[warn] Pacote nativo sem resources/icon.ico — publicando mesmo assim (ícone padrão Electron).");
}


const version = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
const ZIP_OUT = path.resolve(__dirname, "..", "electron-release", `RollsSuite-win32-x64-${version}.zip`);
try { fs.unlinkSync(ZIP_OUT); } catch {}

const NATIVE_VERSION_FILE = path.join(SRC_DIR, "native-version.txt");
fs.writeFileSync(NATIVE_VERSION_FILE, `${version}\n`, "utf8");

console.log("Zipping contents of", SRC_DIR);
try {
  execSync(`nix run nixpkgs#zip -- -qr "${ZIP_OUT}" .`, { cwd: SRC_DIR, stdio: "inherit" });
} catch {
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
  console.log(`Uploading native/RollsSuite-win32-x64.zip (${(zipBuf.length / 1024 / 1024).toFixed(1)} MB)…`);
  await upload("native/RollsSuite-win32-x64.zip", zipBuf, "application/zip");
  const meta = { version, generatedAt: new Date().toISOString(), platform: "win32-x64", file: "RollsSuite-win32-x64.zip", size: zipBuf.length };
  await upload("native/version.txt", Buffer.from(version), "text/plain");
  await upload("native/manifest.json", Buffer.from(JSON.stringify(meta, null, 2)), "application/json");
  console.log("Done. Native version", version);
})().catch((e) => { console.error(e); process.exit(1); });
