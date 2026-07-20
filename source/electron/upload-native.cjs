#!/usr/bin/env node
// Empacota electron-release/RollsSuite-win32-x64/ em zip e publica em updates/native/.
// Para caber no GitHub, o zip nativo é dividido em partes menores e o app
// reconstrói o arquivo lendo `manifest.json`.
// Depois de rodar, faça commit/push da pasta updates/ para o GitHub.
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const SRC_DIR = path.resolve(__dirname, "..", "electron-release", "RollsSuite-win32-x64");
const UPDATES_NATIVE_DIR = path.resolve(__dirname, "..", "..", "updates", "native");
const PART_SIZE = 9 * 1024 * 1024;
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

function clearNativeDir() {
  fs.mkdirSync(UPDATES_NATIVE_DIR, { recursive: true });
  for (const name of fs.readdirSync(UPDATES_NATIVE_DIR)) {
    fs.rmSync(path.join(UPDATES_NATIVE_DIR, name), { recursive: true, force: true });
  }
}

function partSuffix(index) {
  const a = Math.floor(index / 26);
  const b = index % 26;
  return String.fromCharCode(97 + a) + String.fromCharCode(97 + b);
}

(() => {
  const zipBuf = fs.readFileSync(ZIP_OUT);
  clearNativeDir();
  console.log(`Publishing split native update (${(zipBuf.length / 1024 / 1024).toFixed(1)} MB)…`);
  const files = [];
  for (let offset = 0, i = 0; offset < zipBuf.length; offset += PART_SIZE, i++) {
    const name = `RollsSuite-win32-x64.zip.part-${partSuffix(i)}`;
    const chunk = zipBuf.subarray(offset, Math.min(offset + PART_SIZE, zipBuf.length));
    writeNativeFile(name, chunk);
    files.push(name);
    console.log(`  ${name} ${(chunk.length / 1024 / 1024).toFixed(1)} MB`);
  }
  const meta = {
    version,
    generatedAt: new Date().toISOString(),
    platform: "win32-x64",
    files,
    size: zipBuf.length,
    partSize: PART_SIZE,
  };
  writeNativeFile("version.txt", Buffer.from(version));
  writeNativeFile("manifest.json", Buffer.from(JSON.stringify(meta, null, 2)));
  console.log("Done. Commit/push updates/native/ to GitHub. Native version", version);
})();
