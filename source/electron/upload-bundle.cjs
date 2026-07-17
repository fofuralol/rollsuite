#!/usr/bin/env node
// Build manifest of dist/ and publish everything into the repository updates/ folder.
// After running this script, commit/push updates/ to GitHub; the app reads updates from GitHub raw URLs.
const fs = require("fs");
const path = require("path");

const DIST = path.resolve(__dirname, "..", "dist");
const UPDATES_DIR = path.resolve(__dirname, "..", "..", "updates");

function assertDesktopBundle() {
  const assetsDir = path.join(DIST, "assets");
  if (!fs.existsSync(assetsDir)) throw new Error("assets/ não encontrado em dist");
  const jsFiles = fs.readdirSync(assetsDir).filter((name) => /^index-.*\.js$/.test(name));
  if (!jsFiles.length) throw new Error("bundle JS principal não encontrado em dist/assets");
  // Pode haver vários "index-*.js" (chunks). O principal é o maior.
  const mainJs = jsFiles
    .map((n) => ({ n, size: fs.statSync(path.join(assetsDir, n)).size }))
    .sort((a, b) => b.size - a.size)[0].n;
  const js = fs.readFileSync(path.join(assetsDir, mainJs), "utf8");
  const hasDesktopMarkers = js.includes("fofuralol-local") || js.includes("electronAPI ausente");
  if (!hasDesktopMarkers) {
    throw new Error("dist atual parece build web, não desktop. Rode: VITE_TARGET=desktop npx vite build");
  }
}

function walk(dir, base = "") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = path.posix.join(base, entry.name);
    if (entry.isDirectory()) out.push(...walk(abs, rel));
    else out.push({ rel, abs });
  }
  return out;
}

function mime(p) {
  const ext = path.extname(p).toLowerCase();
  return ({
    ".html": "text/html", ".js": "application/javascript", ".mjs": "application/javascript",
    ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
    ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2",
    ".ttf": "font/ttf", ".txt": "text/plain", ".map": "application/json",
  })[ext] || "application/octet-stream";
}

function copyToUpdates(rel, buf) {
  const dest = path.join(UPDATES_DIR, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
}

(() => {
  if (!fs.existsSync(DIST)) { console.error("No dist/ — build first"); process.exit(1); }
  assertDesktopBundle();
  const files = walk(DIST);
  const version = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  const manifest = { version, generatedAt: new Date().toISOString(), files: files.map((f) => f.rel) };
  fs.writeFileSync(path.join(DIST, "version.txt"), version);
  fs.writeFileSync(path.join(DIST, "manifest.json"), JSON.stringify(manifest, null, 2));

  if (fs.existsSync(UPDATES_DIR)) fs.rmSync(UPDATES_DIR, { recursive: true, force: true });
  fs.mkdirSync(UPDATES_DIR, { recursive: true });
  console.log(`Publishing ${files.length + 2} files to updates/ (version ${version})…`);
  for (const f of files) {
    const buf = fs.readFileSync(f.abs);
    copyToUpdates(f.rel, buf, mime(f.rel));
    process.stdout.write(".");
  }
  copyToUpdates("version.txt", Buffer.from(version), "text/plain");
  copyToUpdates("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2)), "application/json");
  console.log(`\nDone. Commit/push updates/ to GitHub. Version ${version}`);
})();
