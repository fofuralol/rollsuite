// Garante que existe um Chrome portátil dentro da pasta do app.
// Baixa na primeira execução; reutiliza nas próximas.
const fs = require("fs");

async function ensureChrome(cacheDir, onProgress) {
  const {
    install,
    computeExecutablePath,
    Browser,
    resolveBuildId,
    detectBrowserPlatform,
  } = require("@puppeteer/browsers");

  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

  const platform = detectBrowserPlatform();
  if (!platform) throw new Error("Plataforma do Chrome não suportada.");

  const buildId = await resolveBuildId(Browser.CHROME, platform, "stable");
  const executablePath = computeExecutablePath({
    cacheDir,
    browser: Browser.CHROME,
    buildId,
    platform,
  });

  if (fs.existsSync(executablePath)) {
    return { executablePath, buildId, cacheDir };
  }

  onProgress && onProgress(`Baixando Chrome compatível (${buildId})…`);
  let lastPct = -1;
  await install({
    cacheDir,
    browser: Browser.CHROME,
    buildId,
    platform,
    downloadProgressCallback: (downloaded, total) => {
      if (!total) return;
      const pct = Math.floor((downloaded / total) * 100);
      if (pct !== lastPct && pct % 10 === 0) {
        lastPct = pct;
        onProgress && onProgress(`Baixando Chrome: ${pct}%`);
      }
    },
  });

  return { executablePath, buildId, cacheDir };
}

module.exports = { ensureChrome };
