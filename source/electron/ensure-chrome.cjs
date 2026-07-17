// Garante que existe um Chrome portátil dentro da pasta do app.
// Baixa na primeira execução; reutiliza nas próximas.
const fs = require("fs");
const path = require("path");

function rmrf(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true, maxRetries: 3 });
  } catch {}
}

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

  // Se a pasta da build existe mas o .exe sumiu (download interrompido, antivírus
  // apagou, cópia parcial do RollsSuite entre PCs, etc.), o @puppeteer/browsers
  // recusa a reinstalação com "folder exists but executable is missing".
  // Limpamos qualquer pasta relacionada a esse buildId para forçar download limpo.
  try {
    const browserRoot = path.join(cacheDir, "chrome");
    if (fs.existsSync(browserRoot)) {
      for (const entry of fs.readdirSync(browserRoot)) {
        if (entry.includes(buildId)) rmrf(path.join(browserRoot, entry));
      }
    }
  } catch {}

  onProgress && onProgress(`Baixando Chrome compatível (${buildId})…`);
  let lastPct = -1;
  try {
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
  } catch (err) {
    // Segunda tentativa: limpar cache inteiro e reinstalar
    onProgress && onProgress(`Falha no download, limpando cache e tentando novamente…`);
    try {
      rmrf(path.join(cacheDir, "chrome"));
    } catch {}
    await install({
      cacheDir,
      browser: Browser.CHROME,
      buildId,
      platform,
    });
  }

  if (!fs.existsSync(executablePath)) {
    throw new Error(
      `Chrome baixado mas executável não encontrado em ${executablePath}. Verifique antivírus/permissões.`
    );
  }

  return { executablePath, buildId, cacheDir };
}

module.exports = { ensureChrome };
