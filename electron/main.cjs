const { app, BrowserWindow, ipcMain, Notification, shell, clipboard, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const AdmZip = require("adm-zip");
const db = require("./db.cjs");
const dkdash = require("./dkdash.cjs");
const wa = require("./wa.cjs");
const detectGroup = require("./detect-group.cjs");
const automation = require("./automation.cjs");
const gdrive = require("./gdrive.cjs");
const proxyBalanceLocal = require("./proxy-balance.cjs");

const EXT_TOKEN_RE = /([?&]token=)([A-Za-z0-9._\-]+)/g;
const EXT_WEBHOOK_URL_RE = /http:\/\/127\.0\.0\.1:\d+\/meta\?token=[A-Za-z0-9._\-]+/g;
const CURRENT_WEBHOOK_URL = "http://127.0.0.1:47821/meta?token=COLE_SEU_TOKEN_AQUI";
const EXT_TARGET_FILES = ["popup.js", "background.js"];

function withWebhookToken(url, token) {
  const target = new URL(String(url || CURRENT_WEBHOOK_URL));
  target.searchParams.set("token", token);
  return target.toString();
}

function isValidWebhookUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    if (!parsed.searchParams.get("token")) return false;
    return parsed.protocol === "http:" && parsed.hostname === "127.0.0.1" && parsed.pathname === "/meta";
  } catch {
    return false;
  }
}

async function extPickAndRead() {
  const r = await dialog.showOpenDialog({
    title: "Selecione o .zip da extensão",
    filters: [{ name: "Extensão (zip)", extensions: ["zip"] }],
    properties: ["openFile"],
  });
  if (r.canceled || !r.filePaths?.[0]) return { data: null, error: null };
  const zipPath = r.filePaths[0];
  try {
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();
    let currentToken = null;
    let currentWebhookUrl = null;
    const found = [];
    for (const e of entries) {
      const base = path.basename(e.entryName);
      if (!EXT_TARGET_FILES.includes(base)) continue;
      const txt = e.getData().toString("utf8");
      const m = [...txt.matchAll(EXT_TOKEN_RE)];
      const um = [...txt.matchAll(EXT_WEBHOOK_URL_RE)];
      if (m.length || um.length) {
        found.push({ file: e.entryName, count: m.length, urlCount: um.length });
        if (!currentToken && m.length) currentToken = m[0][2];
        if (!currentWebhookUrl && um.length) currentWebhookUrl = um[0][0];
      }
    }
    if (!found.length) {
      return { data: null, error: { message: "Nenhum token/URL encontrado em popup.js/background.js dessa extensão." } };
    }
    return {
      data: {
        zipPath,
        currentToken,
        currentSupabaseRef: null,
        currentSupabaseUrl: currentWebhookUrl,
        targetSupabaseUrl: CURRENT_WEBHOOK_URL,
        needsUrlSwap: !!(currentWebhookUrl && currentWebhookUrl !== CURRENT_WEBHOOK_URL),
        files: found,
      },
      error: null,
    };
  } catch (e) {
    return { data: null, error: { message: `Falha ao ler zip: ${e.message || e}` } };
  }
}

async function extInjectToken(sender, { zipPath, newToken, newWebhookUrl }) {
  const send = (step, pct, log) => {
    try { sender.send("extension:inject-progress", { step, pct, log }); } catch {}
  };
  try {
    if (!zipPath || !fs.existsSync(zipPath)) throw new Error("Zip não encontrado: " + zipPath);
    if (!newToken || !/^[A-Za-z0-9._\-]+$/.test(newToken)) throw new Error("Token inválido");
    const targetUrl = withWebhookToken(newWebhookUrl || CURRENT_WEBHOOK_URL, newToken);
    if (!isValidWebhookUrl(targetUrl)) throw new Error("URL local da extensão inválida");
    send("Abrindo zip…", 5, `zip: ${zipPath}`);
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();
    send("Procurando arquivos…", 15, `${entries.length} entradas no zip — alvo URL: ${targetUrl}`);

    let replaced = 0;
    let urlReplaced = 0;
    let filesTouched = 0;
    for (const e of entries) {
      const base = path.basename(e.entryName);
      if (!EXT_TARGET_FILES.includes(base)) continue;
      const before = e.getData().toString("utf8");
      let count = 0;
      let uCount = 0;
      let after = before.replace(EXT_WEBHOOK_URL_RE, () => { uCount++; return targetUrl; });
      after = after.replace(EXT_TOKEN_RE, (_m, p1) => { count++; return p1 + newToken; });
      if (count > 0 || uCount > 0) {
        zip.updateFile(e.entryName, Buffer.from(after, "utf8"));
        replaced += count;
        urlReplaced += uCount;
        filesTouched++;
        send(`Atualizado: ${e.entryName}`, 30 + filesTouched * 20, `${count} token(s) + ${uCount} URL(s) em ${e.entryName}`);
      }
    }
    if (replaced === 0 && urlReplaced === 0) throw new Error("Nenhum token/URL foi encontrado para substituir.");

    send("Gravando zip…", 85, `total: ${replaced} token(s) + ${urlReplaced} URL(s) em ${filesTouched} arquivo(s)`);
    const backup = zipPath.replace(/\.zip$/i, `.backup-${Date.now()}.zip`);
    try { fs.copyFileSync(zipPath, backup); send("Backup criado", 90, `backup: ${backup}`); } catch {}

    zip.writeZip(zipPath);
    send("Concluído ✅", 100, `Zip atualizado: ${zipPath}`);
    return { data: { ok: true, zipPath, replaced, urlReplaced, filesTouched, backup }, error: null };
  } catch (e) {
    const msg = e?.message || String(e);
    send("Erro ❌", 100, `ERRO: ${msg}`);
    return { data: null, error: { message: msg } };
  }
}

ipcMain.handle("extension:pick-and-read", () => extPickAndRead());
ipcMain.handle("extension:inject-token", (e, payload) => extInjectToken(e.sender, payload || {}));

async function readExtensionTemplate() {
  const candidates = [
    // Bundle atualizado baixado do GitHub: rolls-data/app-update/extension.zip.
    updateDir && path.join(updateDir, "extension.zip"),
    currentAppDir && path.join(currentAppDir(), "extension.zip"),
    // Bundle interno do app: resources/app.asar/dist/extension.zip.
    bundledDir && path.join(bundledDir, "extension.zip"),
    // Compatibilidade com empacotamentos antigos.
    path.join(app.getAppPath(), "dist", "extension.zip"),
    path.join(app.getAppPath(), "extension.zip"),
    process.resourcesPath && path.join(process.resourcesPath, "extension.zip"),
    process.resourcesPath && path.join(process.resourcesPath, "app.asar.unpacked", "dist", "extension.zip"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) {
        return { buffer: fs.readFileSync(candidate), source: candidate };
      }
    } catch {}
  }

  const srcCandidates = [
    path.join(app.getAppPath(), "extension-src"),
    path.join(__dirname, "..", "extension-src"),
  ];
  for (const extSrcPath of srcCandidates) {
    try {
      if (!fs.existsSync(extSrcPath)) continue;
      const zbuild = new AdmZip();
      const walk = (dir, rel = "") => {
        for (const name of fs.readdirSync(dir)) {
          const abs = path.join(dir, name);
          const relPath = rel ? `${rel}/${name}` : name;
          const st = fs.statSync(abs);
          if (st.isDirectory()) walk(abs, relPath);
          else zbuild.addFile(relPath, fs.readFileSync(abs));
        }
      };
      walk(extSrcPath);
      return { buffer: zbuild.toBuffer(), source: extSrcPath };
    } catch {}
  }

  // Último recurso: baixa extension.zip direto do repo de updates configurado.
  try {
    const { UPDATE_BASE } = getBases();
    const url = `${UPDATE_BASE}/extension.zip?t=${Date.now()}`;
    const r = await fetch(url);
    if (r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      try {
        if (updateDir) {
          fs.mkdirSync(updateDir, { recursive: true });
          fs.writeFileSync(path.join(updateDir, "extension.zip"), buf);
        }
      } catch {}
      return { buffer: buf, source: url };
    }
  } catch (e) {
    console.warn("[ext] fallback remoto falhou:", e?.message || e);
  }
  throw new Error(`Template não encontrado. Procurei em: ${candidates.concat(srcCandidates).join(" | ")}`);
}

async function extGenerate(sender, { token, webhookUrl } = {}) {
  const send = (step, pct, log) => {
    try { sender.send("extension:inject-progress", { step, pct, log }); } catch {}
  };
  try {
    if (!token || !/^[A-Za-z0-9._\-]+$/.test(token)) throw new Error("Token inválido");
    const targetUrl = withWebhookToken(webhookUrl || CURRENT_WEBHOOK_URL, token);
    if (!isValidWebhookUrl(targetUrl)) throw new Error("URL local da extensão inválida");

    const { buffer: sourceZipBuf, source } = await readExtensionTemplate();
    send("Abrindo template offline…", 5, `template: ${source}`);

    const save = await dialog.showSaveDialog({
      title: "Salvar extensão pré-configurada",
      defaultPath: `rolldash-extension-${token.slice(0, 8)}.zip`,
      filters: [{ name: "Extensão (zip)", extensions: ["zip"] }],
    });
    if (save.canceled || !save.filePath) return { data: null, error: null };

    fs.writeFileSync(save.filePath, sourceZipBuf);
    send("Injetando token + URL…", 40, `arquivo: ${save.filePath}`);

    const zip = new AdmZip(save.filePath);
    let replaced = 0, urlReplaced = 0, filesTouched = 0;
    for (const e of zip.getEntries()) {
      const base = path.basename(e.entryName);
      if (!EXT_TARGET_FILES.includes(base)) continue;
      const before = e.getData().toString("utf8");
      let c = 0, u = 0;
      let after = before.replace(EXT_WEBHOOK_URL_RE, () => { u++; return targetUrl; });
      after = after.replace(EXT_TOKEN_RE, (_m, p1) => { c++; return p1 + token; });
      if (c > 0 || u > 0) {
        zip.updateFile(e.entryName, Buffer.from(after, "utf8"));
        replaced += c; urlReplaced += u; filesTouched++;
        send(`Atualizado: ${e.entryName}`, 60 + filesTouched * 15, `${c} token(s) + ${u} URL(s) em ${e.entryName}`);
      }
    }
    if (replaced === 0 && urlReplaced === 0) throw new Error("Template não tem marcadores de token/URL.");

    zip.writeZip(save.filePath);
    send("Concluído ✅", 100, `Extensão pronta em: ${save.filePath}`);
    return { data: { ok: true, zipPath: save.filePath, replaced, urlReplaced, filesTouched }, error: null };
  } catch (e) {
    const msg = e?.message || String(e);
    send("Erro ❌", 100, `ERRO: ${msg}`);
    return { data: null, error: { message: msg } };
  }
}
ipcMain.handle("extension:generate", (e, payload) => extGenerate(e.sender, payload || {}));

const DEFAULT_UPDATE_BASE = "https://raw.githubusercontent.com/fofuralol/rollsuite/main/updates";

function updateSourcePath() {
  return path.join(dataDir, "update-source.json");
}
function normalizeBase(u) {
  return String(u || "").trim().replace(/\/+$/, "");
}
function readUpdateSource() {
  try {
    const f = updateSourcePath();
    if (fs.existsSync(f)) {
      const j = JSON.parse(fs.readFileSync(f, "utf8"));
      const base = normalizeBase(j.base) || DEFAULT_UPDATE_BASE;
      const nativeBase = normalizeBase(j.nativeBase) || `${base}/native`;
      return { base, nativeBase, custom: !!j.custom };
    }
  } catch {}
  return { base: DEFAULT_UPDATE_BASE, nativeBase: `${DEFAULT_UPDATE_BASE}/native`, custom: false };
}
function writeUpdateSource(patch) {
  const cur = readUpdateSource();
  const base = normalizeBase(patch?.base) || cur.base;
  const nativeBase = normalizeBase(patch?.nativeBase) || `${base}/native`;
  const next = { base, nativeBase, custom: true, updatedAt: new Date().toISOString() };
  fs.writeFileSync(updateSourcePath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}
function resetUpdateSource() {
  try { fs.unlinkSync(updateSourcePath()); } catch {}
  return readUpdateSource();
}
function getBases() {
  const s = readUpdateSource();
  return { UPDATE_BASE: s.base, NATIVE_BASE: s.nativeBase };
}

ipcMain.handle("update:get-source", () => {
  try { return { data: { ...readUpdateSource(), default: DEFAULT_UPDATE_BASE }, error: null }; }
  catch (e) { return { data: null, error: { message: String(e.message || e) } }; }
});
ipcMain.handle("update:set-source", (_e, patch) => {
  try { return { data: writeUpdateSource(patch || {}), error: null }; }
  catch (e) { return { data: null, error: { message: String(e.message || e) } }; }
});
ipcMain.handle("update:reset-source", () => {
  try { return { data: resetUpdateSource(), error: null }; }
  catch (e) { return { data: null, error: { message: String(e.message || e) } }; }
});

const APP_USER_MODEL_ID = "com.rollssuite.desktop";
try { app.setAppUserModelId(APP_USER_MODEL_ID); } catch {}
try { app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required"); } catch {}

// Nome canônico do app/atalho/AppID — padronizado.
const APP_NAME = "RollsSuite";
const APP_EXE_NAME = `${APP_NAME}.exe`;
const SHORTCUT_NAME = `${APP_NAME}.lnk`;
const LEGACY_SHORTCUT_NAMES = ["RollSuite.lnk"]; // grafias antigas que devem ser removidas
const LEGACY_EXE_NAMES = ["RollSuite.exe"];

function getWindowsShortcutDirs() {
  if (process.platform !== "win32") return [];
  return [
    path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs"),
    app.getPath("desktop"),
    path.join(app.getPath("appData"), "Microsoft", "Internet Explorer", "Quick Launch", "User Pinned", "TaskBar"),
  ];
}

function cleanupLegacyWindowsArtifacts() {
  if (process.platform !== "win32") return;
  try {
    const exeDir = path.dirname(app.getPath("exe"));
    for (const legacyExe of LEGACY_EXE_NAMES) {
      try {
        const legacyExePath = path.join(exeDir, legacyExe);
        if (fs.existsSync(legacyExePath)) fs.rmSync(legacyExePath, { force: true });
      } catch {}
    }

    for (const legacy of LEGACY_SHORTCUT_NAMES) {
      for (const dir of getWindowsShortcutDirs()) {
        try {
          const p = path.join(dir, legacy);
          if (fs.existsSync(p)) fs.rmSync(p, { force: true });
        } catch {}
      }
    }
  } catch {}
}

function refreshWindowsShortcuts() {
  if (process.platform !== "win32") return;
  try {
    const exePath = app.getPath("exe");
    const exeDir = path.dirname(exePath);
    const shortcutDirs = getWindowsShortcutDirs();

    // Apaga grafias legadas em Menu Iniciar e Desktop
    cleanupLegacyWindowsArtifacts();

    // (Re)cria/atualiza atalhos canônicos apontando para o exe atual com AppID e ícone corretos.
    // Inclui a pasta de itens fixados da barra de tarefas para não deixar o Windows preso no ícone antigo.
    const iconPath = getDesktopIconPath() || exePath;
    for (const dir of shortcutDirs) {
      try {
        const lnk = path.join(dir, SHORTCUT_NAME);
        fs.mkdirSync(path.dirname(lnk), { recursive: true });
        shell.writeShortcutLink(lnk, fs.existsSync(lnk) ? "update" : "create", {
          target: exePath,
          cwd: exeDir,
          description: APP_NAME,
          appUserModelId: APP_USER_MODEL_ID,
          icon: iconPath,
          iconIndex: 0,
        });
      } catch {}
    }
  } catch {}
}

// Roda uma única vez por versão nativa instalada — força Windows a refazer cache de ícone
// e remove atalhos/pinos com identidade antiga depois de um autoupdate.
function reconcileIdentityOnce() {
  if (process.platform !== "win32") return;
  try {
    const exeDir = path.dirname(app.getPath("exe"));
    const nativeVersion = (() => {
      try {
        const f = path.join(exeDir, "native-version.txt");
        if (fs.existsSync(f)) return fs.readFileSync(f, "utf8").trim();
      } catch {}
      return "unknown";
    })();
    const flagPath = path.join(dataDir, `identity-${nativeVersion}.flag`);
    if (fs.existsSync(flagPath)) return;

    // Limpa cache de ícones do Explorer (silencioso, sem console)
    try {
      const psCmd = [
        "$ie = Join-Path $env:LOCALAPPDATA 'IconCache.db';",
        "if (Test-Path $ie) { try { Remove-Item -Force $ie -ErrorAction SilentlyContinue } catch {} }",
        "$d = Join-Path $env:LOCALAPPDATA 'Microsoft\\Windows\\Explorer';",
        "if (Test-Path $d) { Get-ChildItem -Path $d -Filter 'iconcache_*.db' -ErrorAction SilentlyContinue | ForEach-Object { try { Remove-Item -Force $_.FullName -ErrorAction SilentlyContinue } catch {} } }",
      ].join(" ");
      const psFile = path.join(dataDir, "identity-refresh.ps1");
      const vbsFile = path.join(dataDir, "identity-refresh.vbs");
      fs.writeFileSync(psFile, psCmd, "utf8");
      fs.writeFileSync(
        vbsFile,
        [
          'Set shell = CreateObject("WScript.Shell")',
          `shell.Run "powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & "${psFile.replace(/\\/g, "\\\\").replace(/"/g, '""')}" & """", 0, False`,
        ].join("\r\n"),
        "utf8",
      );
      const child = spawn("wscript.exe", [vbsFile], { detached: true, stdio: "ignore", windowsHide: true });
      child.unref();
    } catch {}

    fs.writeFileSync(flagPath, new Date().toISOString(), "utf8");
  } catch {}
}


let win;
let dataDir;
let updateDir;
let bundledDir;

function getDesktopIconPath() {
  const candidates = [
    path.join(process.resourcesPath || "", "icon.ico"),
    path.join(__dirname, "..", "build", "icon.ico"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch {}
  }

  return undefined;
}

function validateAppDir(dir) {
  try {
    const indexPath = path.join(dir, "index.html");
    if (!fs.existsSync(indexPath)) return { ok: false, reason: "index.html ausente" };
    const html = fs.readFileSync(indexPath, "utf8");
    const refs = [];
    for (const match of html.matchAll(/\b(?:src|href)=["'](?:\.\/|\/)?([^"']+\.(?:js|css))(?:\?[^"']*)?["']/g)) {
      const rel = String(match[1] || "").replace(/^[\/]+/, "").replace(/\.\./g, "");
      if (rel) refs.push(rel);
    }
    if (!refs.length) return { ok: false, reason: "index.html sem JS/CSS" };
    const missing = refs.filter((rel) => !fs.existsSync(path.join(dir, rel.replace(/\//g, path.sep))));
    if (missing.length) return { ok: false, reason: `assets ausentes: ${missing.join(", ")}` };
    return { ok: true, reason: "ok" };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}

function quarantineBadUpdate(reason) {
  try {
    if (!updateDir || !fs.existsSync(updateDir)) return;
    const badDir = path.join(dataDir, `app-update-broken-${Date.now()}`);
    fs.renameSync(updateDir, badDir);
    fs.mkdirSync(updateDir, { recursive: true });
    console.warn("[update] bundle instalado inválido, voltando ao bundle interno:", reason);
  } catch (e) {
    console.warn("[update] falha ao isolar bundle inválido:", e?.message || e);
  }
}

function readAppDirVersion(dir) {
  try {
    const f = path.join(dir, "version.txt");
    if (fs.existsSync(f)) return fs.readFileSync(f, "utf8").trim();
  } catch {}
  return "0";
}

function compareVersions(a, b) {
  const av = String(a || "0").trim();
  const bv = String(b || "0").trim();
  if (av === bv) return 0;
  return av > bv ? 1 : -1;
}

function currentAppDir() {
  const updateCheck = validateAppDir(updateDir);
  if (updateCheck.ok) {
    const bundledCheck = validateAppDir(bundledDir);
    if (bundledCheck.ok) {
      const updateVersion = readAppDirVersion(updateDir);
      const bundledVersion = readAppDirVersion(bundledDir);
      // Depois de update nativo, o dist embutido pode ser mais novo que um
      // app-update antigo salvo em rolls-data. Carrega sempre o bundle válido
      // mais recente para não ficar pedindo atualização novamente.
      if (compareVersions(bundledVersion, updateVersion) > 0) return bundledDir;
    }
    return updateDir;
  }
  if (updateCheck.reason !== "index.html ausente") quarantineBadUpdate(updateCheck.reason);
  const bundledCheck = validateAppDir(bundledDir);
  if (!bundledCheck.ok) console.error("[update] bundle interno inválido:", bundledCheck.reason);
  return bundledDir;
}

function createWindow() {
  const iconPath = getDesktopIconPath();
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: "#0a0a0a",
    autoHideMenuBar: true,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: "no-user-gesture-required",
    },
  });
  win.loadFile(path.join(currentAppDir(), "index.html"));
  // Diagnóstico: F12 abre DevTools
  win.webContents.on("before-input-event", (event, input) => {
    if (input.key === "F12" && input.type === "keyDown") {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
}

app.whenReady().then(() => {
  const exeDir = path.dirname(app.getPath("exe"));
  dataDir = path.join(exeDir, "rolls-data");
  updateDir = path.join(dataDir, "app-update");
  bundledDir = path.join(__dirname, "..", "dist");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(updateDir)) fs.mkdirSync(updateDir, { recursive: true });
  for (const legacyName of ["swap-update.bat", "update.bat", "install.bat", "swap-update.cmd", "update.cmd", "install.cmd", "swap-update.ps1", "swap-update.vbs", "identity-refresh.ps1", "identity-refresh.vbs"]) {
    try {
      const legacyPath = path.join(dataDir, legacyName);
      if (fs.existsSync(legacyPath)) fs.unlinkSync(legacyPath);
    } catch {}
  }
  cleanupLegacyWindowsArtifacts();
  db.init(path.join(dataDir, "db"));
  wa.init({ dataDir: path.join(dataDir, "wa"), db });
  wa.setSendState((state) => {
    try { win?.webContents.send("wa:state", state); } catch {}
  });
  createWindow();
  refreshWindowsShortcuts();
  reconcileIdentityOnce();
  startMetaPolling();
  // Auto-conecta o WhatsApp ao abrir o app
  setTimeout(() => {
    try { wa.setRawListener?.((m) => { try { win?.webContents.send("wa:raw-message", m); } catch {} }); } catch {}
    try { wa.setRawReactionListener?.((r) => { try { win?.webContents.send("wa:raw-reaction", r); } catch {} }); } catch {}
    wa.startWa((msg) => { try { win?.webContents.send("wa:new-message", msg); } catch {} })
      .catch((e) => console.warn("[wa] auto-start:", e?.message || e));
  }, 5000);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// ----- Meta events offline (extensão → .exe via servidor local) -----
function metaConfigPath() { return path.join(dataDir, "meta-config.json"); }
function metaStatePath() { return path.join(dataDir, "meta-state.json"); }
function readJsonSafe(p, fallback) {
  try { if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
  return fallback;
}
function getMetaConfig() {
  const cfg = readJsonSafe(metaConfigPath(), {});
  // Offline por padrão: não depende de backend externo para receber metas.
  const cloud_enabled = false;
  const local_enabled = cfg.local_enabled !== false; // default: ON
  return {
    token: cfg.token || "",
    cloud_enabled,
    local_enabled,
    // legado
    enabled: cloud_enabled,
  };
}
function setMetaConfig(patch) {
  const cur = getMetaConfig();
  const next = { ...cur, ...(patch || {}) };
  // normaliza campo legado
  if (patch && "enabled" in patch && !("cloud_enabled" in patch)) {
    next.cloud_enabled = patch.enabled !== false;
  }
  next.enabled = next.cloud_enabled;
  try { fs.writeFileSync(metaConfigPath(), JSON.stringify(next, null, 2)); } catch {}
  applyLocalServerState(next);
  return next;
}
function getMetaState() { return readJsonSafe(metaStatePath(), { since: new Date().toISOString(), seen: [] }); }
function setMetaState(s) { try { fs.writeFileSync(metaStatePath(), JSON.stringify(s)); } catch {} }

let metaTimer = null;

// Dispatcher compartilhado (cloud + local)
function dispatchMetaEvent(ev, { silent = false } = {}) {
  if (!ev) return;
  const cfg = getMetaConfig();
  // Só notifica metas do PRÓPRIO token
  if (ev.source_token && cfg.token && ev.source_token !== cfg.token) {
    return;
  }
  if (!silent) {
    const title = ev.title ? `🎯 Meta: ${ev.title}` : "🎯 Meta atingida";
    const body = ev.steps != null && ev.target != null ? `${ev.steps} / ${ev.target}` : "Meta concluída";
    try {
      const n = new Notification({ title, body, urgency: "critical", silent: true });
      n.on("click", () => { try { win?.show(); win?.focus(); } catch {} });
      n.show();
    } catch {}
  }
  try { win?.webContents.send("meta:new-event", ev); } catch {}
}

// ---- Servidor local (extensão → app sem internet) ----
const metaLocal = require("./meta-local-server.cjs");
async function applyLocalServerState(cfg) {
  const c = cfg || getMetaConfig();
  if (c.local_enabled) {
    if (!metaLocal.isRunning()) {
      await metaLocal.start({
        config: getMetaConfig,
        onEvent: (ev) => dispatchMetaEvent(ev),
      });
    }
  } else if (metaLocal.isRunning()) {
    await metaLocal.stop();
  }
}

async function pollMetaOnce() {
  return;
}
function startMetaPolling() {
  if (metaTimer) return;
  metaTimer = setInterval(() => {}, 60_000);
  // Sobe o servidor local se estiver habilitado
  applyLocalServerState().catch(() => {});
}

ipcMain.handle("meta:get-config", () => ({ data: getMetaConfig(), error: null }));
ipcMain.handle("meta:set-config", (_e, patch) => ({ data: setMetaConfig(patch || {}), error: null }));
ipcMain.handle("meta:test-notify", () => {
  try {
    const cfg = getMetaConfig();
    const ev = {
      id: `test-${Date.now()}`,
      title: "Meta de teste",
      url: null,
      steps: 42,
      target: 50,
      source_tab_id: null,
      source_token: cfg?.token || null,
      created_at: new Date().toISOString(),
    };
    try { win?.webContents.send("meta:new-event", ev); } catch {}
    new Notification({ title: "🎯 Teste de notificação", body: "Funcionando! Você vai receber assim quando a meta bater.", silent: true }).show();
    return { data: true, error: null };
  } catch (e) { return { data: false, error: { message: String(e?.message || e) } }; }
});
ipcMain.handle("meta:poll-now", async () => { await pollMetaOnce(); return { data: true, error: null }; });
ipcMain.handle("meta:list", async (_e, opts) => {
  try {
    const cfg = getMetaConfig();
    if (!cfg.token) return { data: [], error: null };
    return { data: [], error: null };
  } catch (e) {
    return { data: [], error: { message: String(e?.message || e) } };
  }
});
ipcMain.handle("meta:local-status", () => ({
  data: { running: metaLocal.isRunning(), port: metaLocal.getPort() },
  error: null,
}));

let isQuitting = false;
async function shutdown() {
  if (isQuitting) return;
  isQuitting = true;
  try { await Promise.race([wa.stopWa(), new Promise((r) => setTimeout(r, 4000))]); } catch {}
}

app.on("window-all-closed", async () => {
  await shutdown();
  app.quit();
});

app.on("before-quit", async (e) => {
  if (!isQuitting) {
    e.preventDefault();
    await shutdown();
    app.exit(0);
  }
});

// ----- DB IPC -----
function broadcastDbChange(op, result) {
  try {
    const action = op?.action;
    if (!action || action === "select") return;
    const table = op.table;
    const wcs = BrowserWindow.getAllWindows().map((w) => w.webContents);
    const send = (payload) => {
      for (const wc of wcs) {
        try { wc.send("db:change", payload); } catch {}
      }
    };
    if (action === "insert") {
      const items = Array.isArray(result) ? result : [result];
      for (const row of items) if (row) send({ table, eventType: "INSERT", new: row, old: null });
    } else if (action === "update" || action === "upsert") {
      const items = Array.isArray(result) ? result : [result];
      for (const row of items) if (row) send({ table, eventType: "UPDATE", new: row, old: row });
    } else if (action === "delete") {
      const items = Array.isArray(result) ? result : [result];
      for (const row of items) if (row) send({ table, eventType: "DELETE", new: null, old: row });
    }
  } catch {}
}

ipcMain.handle("db:query", async (_e, op) => {
  try {
    const data = db.exec(op);
    broadcastDbChange(op, data);
    return { data, error: null };
  }
  catch (err) { return { data: null, error: { message: String(err.message || err) } }; }
});

// ----- Edge function shims -----
ipcMain.handle("fn:invoke", async (_e, name, body) => {
  try {
    if (name === "dkdash-lucros") return { data: await dkdash.handle(body || {}, db), error: null };
    if (name === "proxy-balance") {
      try {
        const data = await proxyBalanceLocal(body || {});
        return { data, error: null };
      } catch (e) {
        return { data: { error: String(e?.message || e) }, error: null };
      }
    }
    if (name === "send-push") {
      try {
        new Notification({ title: body?.title || "Notificação", body: body?.body || "" }).show();
      } catch {}
      return { data: { ok: true }, error: null };
    }

    return { data: { error: `Função desconhecida: ${name}` }, error: null };
  } catch (err) {
    return { data: null, error: { message: String(err.message || err) } };
  }
});

ipcMain.handle("app:notify", (_e, { title, body }) => {
  try { new Notification({ title, body }).show(); } catch {}
});

ipcMain.handle("clipboard:read-image", () => {
  try {
    const img = clipboard.readImage();
    if (!img || img.isEmpty()) return null;
    return img.toPNG().toString("base64");
  } catch { return null; }
});

ipcMain.handle("storage:task-image-upload", (_e, { userId, taskId, base64, mimeType }) => {
  try {
    if (!userId || !taskId || !base64) {
      return { data: null, error: { message: "Dados incompletos para salvar imagem" } };
    }
    const safeUserId = String(userId).replace(/[^a-zA-Z0-9_-]/g, "_");
    const safeTaskId = String(taskId).replace(/[^a-zA-Z0-9_-]/g, "_");
    const ext = String(mimeType || "image/png").split("/")[1]?.replace(/[^a-zA-Z0-9]/g, "") || "png";
    const fileName = `${safeTaskId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
    const relPath = path.join("task-images", safeUserId, fileName).replace(/\\/g, "/");
    const absPath = path.join(dataDir, relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, Buffer.from(base64, "base64"));
    return { data: { path: relPath }, error: null };
  } catch (err) {
    return { data: null, error: { message: String(err.message || err) } };
  }
});

ipcMain.handle("storage:task-image-read", (_e, relPath) => {
  try {
    const safeRel = String(relPath || "").replace(/^\/+/, "").replace(/\.\./g, "");
    if (!safeRel) return { data: null, error: { message: "Caminho inválido" } };
    const absPath = path.join(dataDir, safeRel);
    if (!fs.existsSync(absPath)) return { data: null, error: { message: "Imagem não encontrada" } };
    const ext = path.extname(absPath).toLowerCase();
    const mimeType = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "image/png";
    return { data: { base64: fs.readFileSync(absPath).toString("base64"), mimeType }, error: null };
  } catch (err) {
    return { data: null, error: { message: String(err.message || err) } };
  }
});

ipcMain.handle("storage:task-image-remove", (_e, relPaths) => {
  try {
    const items = Array.isArray(relPaths) ? relPaths : [];
    for (const rel of items) {
      const safeRel = String(rel || "").replace(/^\/+/, "").replace(/\.\./g, "");
      if (!safeRel) continue;
      const absPath = path.join(dataDir, safeRel);
      if (fs.existsSync(absPath)) fs.rmSync(absPath, { force: true });
    }
    return { data: true, error: null };
  } catch (err) {
    return { data: false, error: { message: String(err.message || err) } };
  }
});

// ----- Update system -----
function bundleUpdateStatePath() {
  return path.join(dataDir, "bundle-update-state.json");
}

function readBundleUpdateState() {
  try {
    const f = bundleUpdateStatePath();
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {}
  return {};
}

function writeBundleUpdateState(patch) {
  try {
    const next = { ...readBundleUpdateState(), ...(patch || {}), updatedAt: new Date().toISOString() };
    fs.writeFileSync(bundleUpdateStatePath(), JSON.stringify(next, null, 2), "utf8");
  } catch {}
}

function wasBundleJustApplied(version) {
  try {
    const state = readBundleUpdateState();
    if (!version || state.lastAppliedVersion !== version || !state.lastAppliedAt) return false;
    const ageMs = Date.now() - Date.parse(state.lastAppliedAt);
    return Number.isFinite(ageMs) && ageMs >= 0 && ageMs < 30 * 60 * 1000;
  } catch {
    return false;
  }
}

function getInstalledVersion() {
  return readAppDirVersion(currentAppDir());
}

async function fetchJson(url) {
  const r = await fetch(url + (url.includes("?") ? "&" : "?") + "t=" + Date.now());
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.json();
}

async function downloadFile(url, destAbs) {
  const r = await fetch(url + "?t=" + Date.now());
  if (!r.ok) throw new Error(`HTTP ${r.status} para ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.mkdirSync(path.dirname(destAbs), { recursive: true });
  fs.writeFileSync(destAbs, buf);
}

ipcMain.handle("update:check", async () => {
  try {
    const { UPDATE_BASE } = getBases();
    const manifest = await fetchJson(`${UPDATE_BASE}/manifest.json`);
    const installed = getInstalledVersion();
    const available = String(manifest.version || "").trim();
    const suppressedLoop = available !== installed && wasBundleJustApplied(available);
    return {
      data: {
        installed,
        available,
        hasUpdate: Boolean(available && available !== installed && !suppressedLoop),
        suppressedLoop,
      },
      error: null,
    };
  } catch (e) {
    return { data: null, error: { message: String(e.message || e) } };
  }
});

ipcMain.handle("update:apply", async (e) => {
  try {
    const { UPDATE_BASE } = getBases();
    const manifest = await fetchJson(`${UPDATE_BASE}/manifest.json`);
    const files = Array.isArray(manifest.files) ? manifest.files : [];
    if (!files.length) throw new Error("Manifesto vazio");
    const tmpDir = path.join(dataDir, "app-update-tmp");
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    let done = 0;
    for (const rel of files) {
      const safe = rel.replace(/^[\\/]+/, "").replace(/\.\./g, "");
      await downloadFile(`${UPDATE_BASE}/${safe}`, path.join(tmpDir, safe));
      done++;
      try { e.sender.send("update:progress", { done, total: files.length }); } catch {}
    }
    const version = String(manifest.version || "").trim();
    fs.writeFileSync(path.join(tmpDir, "version.txt"), version);
    const tmpCheck = validateAppDir(tmpDir);
    if (!tmpCheck.ok) throw new Error(`Bundle baixado inválido: ${tmpCheck.reason}`);
    // swap
    if (fs.existsSync(updateDir)) fs.rmSync(updateDir, { recursive: true, force: true });
    fs.renameSync(tmpDir, updateDir);
    writeBundleUpdateState({ lastAppliedVersion: version, lastAppliedAt: new Date().toISOString() });
    return { data: { ok: true, version }, error: null };
  } catch (err) {
    return { data: null, error: { message: String(err.message || err) } };
  }
});

ipcMain.handle("app:reload", () => {
  if (win) win.loadFile(path.join(currentAppDir(), "index.html"));
});

ipcMain.handle("app:open-data-dir", () => {
  try { shell.openPath(dataDir); } catch {}
});

function chatMediaDir() {
  const d = path.join(dataDir, "chat-media");
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}
function safeExtFromMime(mime, fallback) {
  const m = String(mime || "").toLowerCase();
  if (m.includes("jpeg")) return ".jpg";
  if (m.includes("png")) return ".png";
  if (m.includes("gif")) return ".gif";
  if (m.includes("webp")) return ".webp";
  if (m.includes("mp4")) return ".mp4";
  if (m.includes("webm")) return ".webm";
  if (m.includes("ogg")) return ".ogg";
  if (m.includes("mpeg")) return ".mp3";
  if (m.includes("wav")) return ".wav";
  if (m.includes("pdf")) return ".pdf";
  return fallback || ".bin";
}
function saveChatMedia({ dataUrl, filename, mime }) {
  if (!dataUrl || typeof dataUrl !== "string") throw new Error("dataUrl vazio");
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("dataUrl inválido");
  const detectedMime = match[1] || mime || "";
  const buf = Buffer.from(match[2], "base64");
  const dir = chatMediaDir();
  let base = String(filename || "").replace(/[\\/:*?"<>|]/g, "_").trim();
  if (!base) {
    const ext = safeExtFromMime(detectedMime, ".bin");
    base = `midia-${Date.now()}${ext}`;
  } else if (!path.extname(base)) {
    base += safeExtFromMime(detectedMime, "");
  }
  let full = path.join(dir, base);
  if (fs.existsSync(full)) {
    const ext = path.extname(base);
    const stem = base.slice(0, base.length - ext.length);
    full = path.join(dir, `${stem}-${Date.now()}${ext}`);
  }
  fs.writeFileSync(full, buf);
  return full;
}
ipcMain.handle("chat:save-media", (_e, payload) => {
  try {
    const full = saveChatMedia(payload || {});
    return { data: { path: full }, error: null };
  } catch (e) {
    return { data: null, error: { message: String(e?.message || e) } };
  }
});
ipcMain.handle("chat:open-media", (_e, payload) => {
  try {
    let full = payload?.path;
    if (!full && payload?.dataUrl) full = saveChatMedia(payload);
    if (!full) return { data: null, error: { message: "sem caminho" } };
    shell.openPath(full);
    return { data: { path: full }, error: null };
  } catch (e) {
    return { data: null, error: { message: String(e?.message || e) } };
  }
});
ipcMain.handle("chat:open-media-dir", () => {
  try { shell.openPath(chatMediaDir()); return { data: true, error: null }; }
  catch (e) { return { data: null, error: { message: String(e?.message || e) } }; }
});
ipcMain.handle("chat:clear-media", () => {
  try {
    const dir = chatMediaDir();
    let count = 0;
    for (const name of fs.readdirSync(dir)) {
      try { fs.unlinkSync(path.join(dir, name)); count++; } catch {}
    }
    return { data: { count }, error: null };
  } catch (e) {
    return { data: null, error: { message: String(e?.message || e) } };
  }
});
ipcMain.handle("chat:media-stats", () => {
  try {
    const dir = chatMediaDir();
    const files = fs.readdirSync(dir);
    let bytes = 0;
    for (const f of files) {
      try { bytes += fs.statSync(path.join(dir, f)).size; } catch {}
    }
    return { data: { count: files.length, bytes, dir }, error: null };
  } catch (e) {
    return { data: null, error: { message: String(e?.message || e) } };
  }
});

ipcMain.handle("app:version", () => ({ data: getInstalledVersion(), error: null }));

ipcMain.handle("app:open-url", (_e, url) => {
  try {
    let href = String(url || "").trim();
    if (!href) return { data: false, error: "empty" };
    if (!/^https?:\/\//i.test(href)) href = "https://" + href;
    const iconPath = getDesktopIconPath();
    const child = new BrowserWindow({
      width: 1280,
      height: 860,
      backgroundColor: "#0a0a0a",
      autoHideMenuBar: true,
      icon: fs.existsSync(iconPath) ? iconPath : undefined,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    child.loadURL(href);
    child.webContents.setWindowOpenHandler(({ url: u }) => {
      try { shell.openExternal(u); } catch {}
      return { action: "deny" };
    });
    return { data: true, error: null };
  } catch (err) {
    return { data: false, error: String(err?.message || err) };
  }
});

// ----- Native (.exe) auto-update -----
function getInstalledNativeVersion() {
  try {
    const f = path.join(path.dirname(app.getPath("exe")), "native-version.txt");
    if (fs.existsSync(f)) return fs.readFileSync(f, "utf8").trim();
  } catch {}
  return "0";
}

ipcMain.handle("update:check-native", async () => {
  try {
    const { NATIVE_BASE } = getBases();
    const remote = (await (await fetch(`${NATIVE_BASE}/version.txt?t=${Date.now()}`)).text()).trim();
    const installed = getInstalledNativeVersion();
    return { data: { installed, available: remote, hasUpdate: remote && remote !== installed }, error: null };
  } catch (e) {
    return { data: null, error: { message: String(e.message || e) } };
  }
});

ipcMain.handle("update:apply-native", async (e) => {
  try {
    const { NATIVE_BASE } = getBases();
    const remote = (await (await fetch(`${NATIVE_BASE}/version.txt?t=${Date.now()}`)).text()).trim();
    if (!remote) throw new Error("Versão remota inválida");
    const url = `${NATIVE_BASE}/RollsSuite-win32-x64.zip?t=${Date.now()}`;
    try { e.sender.send("update:native-progress", { phase: "download", pct: 0 }); } catch {}
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const total = Number(r.headers.get("content-length")) || 0;
    const reader = r.body.getReader();
    const chunks = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (total) {
        const pct = Math.round((received / total) * 100);
        try { e.sender.send("update:native-progress", { phase: "download", pct }); } catch {}
      }
    }
    const zipBuf = Buffer.concat(chunks);

    const exeDir = path.dirname(app.getPath("exe"));
    const stagingZip = path.join(dataDir, "native-update.zip");
    const stagingDir = path.join(dataDir, "native-staging");
    const swapPs1 = path.join(dataDir, "swap-update.ps1");
    const swapVbs = path.join(dataDir, "swap-update.vbs");
    fs.writeFileSync(stagingZip, zipBuf);

    // PowerShell updater (sem janela visível, sem cmd.exe)
    const psEsc = (p) => p.replace(/'/g, "''");
    const ps = `
$ErrorActionPreference = 'Stop'
$PID_TO_WAIT = ${process.pid}
$ZIP = '${psEsc(stagingZip)}'
$INSTALL = '${psEsc(exeDir)}'
$STAGING = '${psEsc(stagingDir)}'
$VERSION = '${psEsc(remote)}'
$EXE = Join-Path $INSTALL '${APP_EXE_NAME}'
$LOG = Join-Path $INSTALL 'native-update-error.log'
$LEGACY_EXES = @(${LEGACY_EXE_NAMES.map((name) => `'${name}'`).join(", ")})

try { Wait-Process -Id $PID_TO_WAIT -Timeout 60 } catch {}
Start-Sleep -Milliseconds 500

try {
  if (Test-Path $STAGING) { Remove-Item -Recurse -Force $STAGING }
  New-Item -ItemType Directory -Path $STAGING | Out-Null
  Expand-Archive -LiteralPath $ZIP -DestinationPath $STAGING -Force

  $rootExe = Join-Path $STAGING 'RollsSuite.exe'
  if (Test-Path $rootExe) {
    $srcPath = $STAGING
  } else {
    $dirs = Get-ChildItem -Path $STAGING -Directory
    if ($dirs.Count -eq 1) {
      $srcPath = $dirs[0].FullName
    } else {
      $srcPath = $STAGING
    }
  }

  $sourceExe = Join-Path $srcPath 'RollsSuite.exe'
  if (!(Test-Path $sourceExe)) {
    throw 'RollsSuite.exe não encontrado no pacote extraído'
  }

  $copied = $false
  for ($i = 1; $i -le 40; $i++) {
    try {
      Copy-Item -Path (Join-Path $srcPath '*') -Destination $INSTALL -Recurse -Force -ErrorAction Stop
      if (!(Test-Path $EXE)) {
        throw 'Executável não encontrado após cópia'
      }

      $srcHash = (Get-FileHash -LiteralPath $sourceExe -Algorithm SHA256 -ErrorAction Stop).Hash
      $dstHash = (Get-FileHash -LiteralPath $EXE -Algorithm SHA256 -ErrorAction Stop).Hash
      if ($srcHash -ne $dstHash) {
        throw 'Executável instalado não confere com o pacote baixado'
      }

      $copied = $true
      break
    } catch {
      if ($i -ge 40) { throw }
      Start-Sleep -Milliseconds 750
    }
  }

  if (-not $copied) {
    throw 'Não foi possível substituir o executável principal'
  }

  foreach ($legacyExe in $LEGACY_EXES) {
    try {
      $legacyPath = Join-Path $INSTALL $legacyExe
      if ((Test-Path $legacyPath) -and ($legacyPath -ne $EXE)) {
        Remove-Item -Force $legacyPath -ErrorAction SilentlyContinue
      }
    } catch {}
  }

  Set-Content -Path (Join-Path $INSTALL 'native-version.txt') -Value $VERSION -Encoding ASCII

  Remove-Item -Recurse -Force $STAGING
  Remove-Item -Force $ZIP


  Start-Process -FilePath $EXE -WindowStyle Normal
  exit 0

  exit 0
} catch {
  Add-Content -Path $LOG -Value ("[" + (Get-Date) + "] " + $_.Exception.Message)
  Start-Process -FilePath $EXE -WindowStyle Normal
  exit 1
}
`.trim();
    fs.writeFileSync(swapPs1, ps, "utf8");
    fs.writeFileSync(
      swapVbs,
      [
        'Set shell = CreateObject("WScript.Shell")',
        `cmd = "powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File ""${swapPs1.replace(/"/g, '""')}"""`,
        "shell.Run cmd, 0, False",
      ].join("\r\n"),
      "utf8",
    );

    try { e.sender.send("update:native-progress", { phase: "ready", pct: 100 }); } catch {}

    // Usa o host GUI do Windows (wscript) para iniciar o PowerShell oculto sem abrir console.
    const child = spawn(
      "wscript.exe",
      [swapVbs],
      { detached: true, stdio: "ignore", windowsHide: true },
    );
    child.unref();



    setTimeout(() => {
      try { wa.stopWa?.(); } catch {}
      app.exit(0);
    }, 800);

    return { data: { ok: true, version: remote }, error: null };
  } catch (err) {
    return { data: null, error: { message: String(err.message || err) } };
  }
});

ipcMain.handle("app:native-version", () => ({ data: getInstalledNativeVersion(), error: null }));

ipcMain.handle("wa:read-log", () => {
  try {
    const f = path.join(dataDir, "wa", "wa-debug.log");
    if (!fs.existsSync(f)) return { data: "", error: null };
    const stat = fs.statSync(f);
    const max = 64 * 1024;
    const start = Math.max(0, stat.size - max);
    const fd = fs.openSync(f, "r");
    const buf = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return { data: buf.toString("utf8"), error: null };
  } catch (e) { return { data: "", error: { message: String(e.message || e) } }; }
});
ipcMain.handle("wa:clear-log", () => {
  try {
    const f = path.join(dataDir, "wa", "wa-debug.log");
    if (fs.existsSync(f)) fs.writeFileSync(f, "");
    return { data: true, error: null };
  } catch (e) { return { data: false, error: { message: String(e.message || e) } }; }
});

// ----- WhatsApp listener -----
ipcMain.handle("wa:start", async () => {
  try {
    try { wa.setRawListener?.((m) => { try { win?.webContents.send("wa:raw-message", m); } catch {} }); } catch {}
    try { wa.setRawReactionListener?.((r) => { try { win?.webContents.send("wa:raw-reaction", r); } catch {} }); } catch {}
    await wa.startWa((msg) => { try { win?.webContents.send("wa:new-message", msg); } catch {} });
    return { data: wa.getState(), error: null };
  } catch (e) { return { data: null, error: { message: String(e.message || e) } }; }
});
ipcMain.handle("wa:stop", async () => {
  try { await wa.stopWa(); return { data: wa.getState(), error: null }; }
  catch (e) { return { data: null, error: { message: String(e.message || e) } }; }
});
ipcMain.handle("wa:logout", async () => {
  try { await wa.logoutWa(); return { data: wa.getState(), error: null }; }
  catch (e) { return { data: null, error: { message: String(e.message || e) } }; }
});
ipcMain.handle("wa:state", () => ({ data: wa.getState(), error: null }));
ipcMain.handle("wa:config-get", () => ({ data: wa.getConfig(), error: null }));
ipcMain.handle("wa:config-set", (_e, patch) => ({ data: wa.setConfig(patch || {}), error: null }));
ipcMain.handle("wa:diagnostics", () => ({ data: wa.getDiagnostics(), error: null }));
ipcMain.handle("wa:set-live-chat", (_e, enabled) => { try { wa.setLiveChatEnabled(!!enabled); } catch {} return { data: true, error: null }; });
ipcMain.handle("wa:list-groups", async () => {
  try { return { data: await wa.listGroups(), error: null }; }
  catch (e) { return { data: [], error: { message: String(e.message || e) } }; }
});
ipcMain.handle("wa:backfill", async (_e, payload) => {
  try {
    const hours = Number(payload?.hours ?? 24);
    const perChat = Number(payload?.perChat ?? 50);
    const data = await wa.backfillHistory({
      hours, perChat,
      onNewMessage: (msg) => { try { win?.webContents.send("wa:new-message", msg); } catch {} },
    });
    return { data, error: null };
  } catch (e) { return { data: null, error: { message: String(e?.message || e) } }; }
});
ipcMain.handle("wa:send-now", async (_e, payload) => {
  try {
    const state = wa.getState?.();
    if (!state || state.status !== "connected") {
      return { data: null, error: { message: "WhatsApp não conectado" } };
    }
    const data = await wa.sendNow(payload || {});
    return { data, error: null };
  } catch (e) {
    return { data: null, error: { message: String(e?.message || e) } };
  }
});
ipcMain.handle("wa:react", async (_e, payload) => {
  try {
    const state = wa.getState?.();
    if (!state || state.status !== "connected") {
      return { data: null, error: { message: "WhatsApp não conectado" } };
    }
    const data = await wa.sendReaction(payload || {});
    return { data, error: null };
  } catch (e) {
    return { data: null, error: { message: String(e?.message || e) } };
  }
});

// === Auto-detecção de grupo por inspeção do site ===
ipcMain.handle("platform:detect-group", async (_e, payload) => {
  try {
    const urls = Array.isArray(payload?.urls) ? payload.urls : [];
    const knownGroups = Array.isArray(payload?.knownGroups) ? payload.knownGroups : [];
    const results = await detectGroup.detectMany(urls, knownGroups, (p) => {
      try { win?.webContents.send("platform:detect-progress", p); } catch {}
    });
    return { data: results, error: null };
  } catch (e) {
    return { data: null, error: { message: String(e?.message || e) } };
  }
});

// === Cash Hunters automation ===
ipcMain.handle("ch:get-cursor-pos", async (_e, title) => {
  try { return { data: await automation.getCursorPos(title), error: null }; }
  catch (e) { return { data: null, error: { message: String(e.message || e) } }; }
});
ipcMain.handle("ch:config-get", () => {
  try { return { data: automation.loadConfig(), error: null }; }
  catch (e) { return { data: null, error: { message: String(e.message || e) } }; }
});
ipcMain.handle("ch:config-set", (_e, cfg) => {
  try { return { data: automation.saveConfig(cfg || {}), error: null }; }
  catch (e) { return { data: null, error: { message: String(e.message || e) } }; }
});
ipcMain.handle("ch:run", async (_e, args) => {
  try { return { data: await automation.run(args || {}), error: null }; }
  catch (e) { return { data: null, error: { message: String(e.message || e) } }; }
});

// Google Drive backup
ipcMain.handle("gdrive:connect", async () => {
  try { return { data: await gdrive.connect(), error: null }; }
  catch (e) { return { data: null, error: { message: String(e.message || e) } }; }
});
ipcMain.handle("gdrive:status", async () => {
  try { return { data: await gdrive.status(), error: null }; }
  catch (e) { return { data: null, error: { message: String(e.message || e) } }; }
});
ipcMain.handle("gdrive:disconnect", async () => {
  try { return { data: await gdrive.disconnect(), error: null }; }
  catch (e) { return { data: null, error: { message: String(e.message || e) } }; }
});
ipcMain.handle("gdrive:upload", async (_e, jsonString) => {
  try { return { data: await gdrive.upload(String(jsonString || "")), error: null }; }
  catch (e) { return { data: null, error: { message: String(e.message || e) } }; }
});
ipcMain.handle("gdrive:download", async (_e, fileId) => {
  try { return { data: await gdrive.download(fileId || null), error: null }; }
  catch (e) { return { data: null, error: { message: String(e.message || e) } }; }
});
ipcMain.handle("gdrive:list", async () => {
  try { return { data: await gdrive.list(), error: null }; }
  catch (e) { return { data: null, error: { message: String(e.message || e) } }; }
});
ipcMain.handle("gdrive:delete", async (_e, fileId) => {
  try { return { data: await gdrive.remove(String(fileId || "")), error: null }; }
  catch (e) { return { data: null, error: { message: String(e.message || e) } }; }
});
