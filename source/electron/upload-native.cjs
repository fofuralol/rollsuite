#!/usr/bin/env node
// Empacota electron-release/RollsSuite-win32-x64/ em zip e publica em updates/native/
// como `native/RollsSuite-win32-x64.zip` + `native/version.txt`.
// Depois de rodar, faça commit/push da pasta updates/ para o GitHub.
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const SRC_DIR = path.resolve(__dirname, "..", "electron-release", "RollsSuite-win32-x64");
const UPDATES_NATIVE_DIR = path.resolve(__dirname, "..", "..", "updates", "native");
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

// Copy the standalone updater.exe next to the main .exe so it ships in the zip.
const UPDATER_SRC = path.resolve(__dirname, "bin", "updater.exe");
const UPDATER_DST = path.join(SRC_DIR, "updater.exe");
if (fs.existsSync(UPDATER_SRC)) {
  fs.copyFileSync(UPDATER_SRC, UPDATER_DST);
  console.log("Bundled updater.exe →", UPDATER_DST);
} else {
  console.warn("[warn] electron/bin/updater.exe não encontrado — updates in-place não funcionarão. Rode `go build` no updater-src/.");
}


console.log("Zipping contents of", SRC_DIR);
try {
  execSync(`nix run nixpkgs#zip -- -qr "${ZIP_OUT}" .`, { cwd: SRC_DIR, stdio: "inherit" });
} catch {
  execSync(`zip -qr "${ZIP_OUT}" .`, { cwd: SRC_DIR, stdio: "inherit" });
}
const stat = fs.statSync(ZIP_OUT);
console.log("Zip pronto:", ZIP_OUT, (stat.size / 1024 / 1024).toFixed(1), "MB");

function writeNativeFile(name, buf) {
  fs.mkdirSync(UPDATES_NATIVE_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPDATES_NATIVE_DIR, name), buf);
}

(() => {
  const zipBuf = fs.readFileSync(ZIP_OUT);
  console.log(`Publishing updates/native/RollsSuite-win32-x64.zip (${(zipBuf.length / 1024 / 1024).toFixed(1)} MB)…`);
  writeNativeFile("RollsSuite-win32-x64.zip", zipBuf);
  const meta = { version, generatedAt: new Date().toISOString(), platform: "win32-x64", file: "RollsSuite-win32-x64.zip", size: zipBuf.length };
  writeNativeFile("version.txt", Buffer.from(version));
  writeNativeFile("manifest.json", Buffer.from(JSON.stringify(meta, null, 2)));
  console.log("Done. Commit/push updates/native/ to GitHub. Native version", version);
})();
