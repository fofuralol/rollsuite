const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");

const root = path.join(__dirname, "..");
const srcDir = path.join(root, "extension-src");
const outDir = path.join(root, "dist");
const outZip = path.join(outDir, "extension.zip");

if (!fs.existsSync(srcDir)) {
  throw new Error(`extension-src não encontrado: ${srcDir}`);
}

fs.mkdirSync(outDir, { recursive: true });

const zip = new AdmZip();

function walk(dir, rel = "") {
  for (const name of fs.readdirSync(dir)) {
    if (name === ".DS_Store") continue;
    const abs = path.join(dir, name);
    const entry = rel ? `${rel}/${name}` : name;
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) walk(abs, entry);
    else zip.addFile(entry, fs.readFileSync(abs));
  }
}

walk(srcDir);
zip.writeZip(outZip);

const sizeMb = (fs.statSync(outZip).size / 1024 / 1024).toFixed(2);
console.log(`[extension] Template offline gerado: ${outZip} (${sizeMb} MB)`);