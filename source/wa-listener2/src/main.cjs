// Thin bootstrapper. NEVER changes after install.
// Loads the real app from the update folder if present, else bundled.
const path = require("path");
const fs = require("fs");
const { app } = require("electron");

function updateDir() {
  const exeDir = path.dirname(app.getPath("exe"));
  return path.join(exeDir, "wa-listener2-data", "app-update");
}

const updated = path.join(updateDir(), "main-app.cjs");
const bundled = path.join(__dirname, "main-app.cjs");
let target = bundled;
try { if (fs.existsSync(updated)) target = updated; } catch {}

try {
  require(target);
} catch (e) {
  console.error("Failed to load", target, e);
  if (target !== bundled) {
    console.error("Falling back to bundled main");
    require(bundled);
  } else {
    throw e;
  }
}
