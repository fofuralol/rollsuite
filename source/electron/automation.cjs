// Cash Hunters / DK MONTANTE automation via PowerShell + Win32 API.
// Coordenadas RELATIVAS à janela (recalculadas a cada run via GetWindowRect).

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

function runPS(script, env) {
  return new Promise((resolve, reject) => {
    const ps = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true, env: { ...process.env, ...(env || {}) } }
    );
    let out = "", err = "";
    ps.stdout.on("data", (d) => { out += d.toString(); });
    ps.stderr.on("data", (d) => { err += d.toString(); });
    ps.on("close", (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(err || out || `powershell exited ${code}`));
    });
  });
}

// Bloco PS comum: define classe W com Win32 + helpers Find-Window / Get-WinRect
const PS_W = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, IntPtr info);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, IntPtr info);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
  public static IntPtr FoundHwnd;
  public static string Needle;
  public static bool EnumCb(IntPtr h, IntPtr l) {
    if (!IsWindowVisible(h)) return true;
    var sb = new System.Text.StringBuilder(512);
    GetWindowText(h, sb, 512);
    if (sb.Length == 0) return true;
    if (sb.ToString().IndexOf(Needle, StringComparison.OrdinalIgnoreCase) >= 0) {
      FoundHwnd = h; return false;
    }
    return true;
  }
}
"@
function Find-Window([string]$needle) {
  [W]::FoundHwnd = [IntPtr]::Zero
  [W]::Needle = $needle
  [W]::EnumWindows([W+EnumProc]{ param($h,$l) [W]::EnumCb($h,$l) }, [IntPtr]::Zero) | Out-Null
  return [W]::FoundHwnd
}
function Get-WinRect([IntPtr]$h) {
  $r = New-Object W+RECT
  [void][W]::GetWindowRect($h, [ref]$r)
  return $r
}
`;

// === getCursorPos: retorna ABSOLUTO + (se a janela target for achada) o offset relativo ===
async function getCursorPos(title) {
  const t = (title || "DK MONTANTE").replace(/"/g, '`"');
  const out = await runPS(`
${PS_W}
$p = New-Object W+POINT
[void][W]::GetCursorPos([ref]$p)
$hwnd = Find-Window "${t}"
if ($hwnd -ne [IntPtr]::Zero) {
  $r = Get-WinRect $hwnd
  Write-Output ("$($p.X),$($p.Y),$($r.L),$($r.T)")
} else {
  Write-Output ("$($p.X),$($p.Y),,")
}
`);
  const [ax, ay, wl, wt] = out.split(",");
  const absX = parseInt(ax, 10), absY = parseInt(ay, 10);
  if (wl === "" || wl === undefined) {
    return { x: absX, y: absY, relX: null, relY: null, found: false };
  }
  const wL = parseInt(wl, 10), wT = parseInt(wt, 10);
  return { x: absX, y: absY, relX: absX - wL, relY: absY - wT, found: true };
}

function buildRunScript({ title, coords, delays, flags }) {
  const d = {
    afterFocus: 300,
    afterClick: 90,
    afterPaste: 250,
    afterModalOpen: 500,
    afterSave: 400,
    afterTab: 350,
    ...(delays || {}),
  };
  const t = (title || "DK MONTANTE").replace(/"/g, '`"');

  // helper PS: cada coord vem como (relX,relY); precisamos somar window left/top no run
  const C = (k) => `${coords[k].relX} ${coords[k].relY}`;

  return `
$ErrorActionPreference = "Stop"
${PS_W}

function Focus-Win([IntPtr]$h) {
  [W]::ShowWindow($h, 9) | Out-Null
  [W]::SetForegroundWindow($h) | Out-Null
  Start-Sleep -Milliseconds ${d.afterFocus}
}
function Click-Rel([int]$rx, [int]$ry, [int]$baseL, [int]$baseT) {
  $x = $baseL + $rx; $y = $baseT + $ry
  [W]::SetCursorPos($x, $y) | Out-Null
  Start-Sleep -Milliseconds 50
  [W]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
  [W]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
  Start-Sleep -Milliseconds ${d.afterClick}
}
function Send-Key([byte]$vk) {
  [W]::keybd_event($vk, 0, 0, [IntPtr]::Zero)
  [W]::keybd_event($vk, 0, 2, [IntPtr]::Zero)
}
function Send-Combo([byte]$mod, [byte]$key) {
  [W]::keybd_event($mod, 0, 0, [IntPtr]::Zero)
  [W]::keybd_event($key, 0, 0, [IntPtr]::Zero)
  [W]::keybd_event($key, 0, 2, [IntPtr]::Zero)
  [W]::keybd_event($mod, 0, 2, [IntPtr]::Zero)
}
function Clear-Field() {
  Send-Combo 0x11 0x41   # Ctrl+A
  Start-Sleep -Milliseconds 50
  Send-Key 0x2E          # Delete
  Start-Sleep -Milliseconds 50
}
function Send-Paste() {
  Send-Combo 0x11 0x56
  Start-Sleep -Milliseconds ${d.afterPaste}
}
function Set-Clip([string]$v) {
  Set-Clipboard -Value $v
  Start-Sleep -Milliseconds 80
}

Start-Sleep -Milliseconds 60
$hwnd = Find-Window "${t}"
if ($hwnd -eq [IntPtr]::Zero) { Write-Error "Janela '${title}' nao encontrada"; exit 2 }
Focus-Win $hwnd
$rect = Get-WinRect $hwnd
$bL = $rect.L; $bT = $rect.T

# === Step 1: Quantidade (limpa e cola) ===
if ($env:CH_QTY) {
  Click-Rel ${C("qty")} $bL $bT
  Clear-Field
  Set-Clip $env:CH_QTY
  Send-Paste
}

# === Step 2: Personalizar Depositos (modal) ===
if ($env:CH_DEPS) {
  Click-Rel ${C("deps")} $bL $bT
  Start-Sleep -Milliseconds ${d.afterModalOpen}
  Click-Rel ${C("depsArea")} $bL $bT
  Clear-Field
  Set-Clip $env:CH_DEPS
  Send-Paste
  Click-Rel ${C("depsSave")} $bL $bT
  Start-Sleep -Milliseconds ${d.afterSave}
}

# === Step 3: URL (limpa e cola) ===
if ($env:CH_URL) {
  Click-Rel ${C("url")} $bL $bT
  Clear-Field
  Set-Clip $env:CH_URL
  Send-Paste
}

# === Step 4: Aba Chaves PIX -> Adicionar -> modal -> salvar -> OK ===
if ($env:CH_PIX) {
  Click-Rel ${C("pixTab")} $bL $bT
  Start-Sleep -Milliseconds ${d.afterTab}
  Click-Rel ${C("pixAdd")} $bL $bT
  Start-Sleep -Milliseconds ${d.afterModalOpen}
  Click-Rel ${C("pixArea")} $bL $bT
  Clear-Field
  Set-Clip $env:CH_PIX
  Send-Paste
  Click-Rel ${C("pixSave")} $bL $bT
  Start-Sleep -Milliseconds ${d.afterSave}
  Click-Rel ${C("pixOk")} $bL $bT
  Start-Sleep -Milliseconds ${d.afterSave}
}

# === Step 5: voltar pra aba Inicio e dar Play ===
Click-Rel ${C("inicioTab")} $bL $bT
Start-Sleep -Milliseconds ${d.afterTab}
${flags?.skipPlay ? "" : `Click-Rel ${C("playButton")} $bL $bT`}

Write-Output "OK"
`;
}

async function run({ title, coords, payload, delays, flags }) {
  if (process.platform !== "win32") throw new Error("Automacao soh roda no Windows");
  const need = ["qty","deps","depsArea","depsSave","url","pixTab","pixAdd","pixArea","pixSave","pixOk","inicioTab","playButton"];
  for (const k of need) {
    const c = coords?.[k];
    if (!c || c.relX == null || c.relY == null) {
      throw new Error(`Coordenada '${k}' nao calibrada`);
    }
  }
  const script = buildRunScript({ title: title || "DK MONTANTE", coords, delays, flags });
  return new Promise((resolve, reject) => {
    const ps = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      {
        windowsHide: true,
        env: {
          ...process.env,
          CH_QTY: payload.qty || "",
          CH_DEPS: payload.depsText || "",
          CH_URL: payload.url || "",
          CH_PIX: payload.pixText || "",
        },
      }
    );
    let out = "", err = "";
    ps.stdout.on("data", (d) => { out += d.toString(); });
    ps.stderr.on("data", (d) => { err += d.toString(); });
    ps.on("close", (code) => {
      if (code === 0) resolve({ ok: true, out });
      else reject(new Error(err || out || `powershell exited ${code}`));
    });
  });
}

// === Config persistence ===
function getConfigPath() {
  const { app } = require("electron");
  return path.join(app.getPath("userData"), "cashhunters-config.json");
}
function loadConfig() {
  try {
    const p = getConfigPath();
    if (!fs.existsSync(p)) return { title: "DK MONTANTE", coords: {}, delays: {} };
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return { title: "DK MONTANTE", coords: {}, delays: {} };
  }
}
function saveConfig(cfg) {
  fs.writeFileSync(getConfigPath(), JSON.stringify(cfg, null, 2), "utf-8");
  return cfg;
}

module.exports = { getCursorPos, run, loadConfig, saveConfig };
