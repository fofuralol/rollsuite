const $ = (id) => document.getElementById(id);

const DEFAULT_WEBHOOK_URL = "http://127.0.0.1:47821/meta?token=COLE_SEU_TOKEN_AQUI";
const WEBHOOK_TOKEN_PLACEHOLDER = "COLE_SEU_TOKEN_AQUI";

let currentTabId = null;
let currentHost = "";

// ── State ──
let mapping = { counterRegion: null, buttonPosition: null, continueButtonPosition: null };
let monState = { monitoring: false, paused: false, hasStopped: false, steps: 0, targetSteps: 0 };

function storageKey() { return currentHost ? `mapping_${currentHost}` : "mapping"; }
function isCounterValid(r) { return r && r.width > 0 && r.height > 0; }
function isButtonValid(p) { return p && typeof p.x === "number" && typeof p.y === "number"; }

function getWebhookParts(url) {
  try {
    const parsed = new URL(String(url || ""));
    return { host: parsed.host, token: parsed.searchParams.get("token") || "" };
  } catch {
    return null;
  }
}

function resolveWebhookUrl(savedUrl) {
  const saved = getWebhookParts(savedUrl);
  const fallback = getWebhookParts(DEFAULT_WEBHOOK_URL);
  if (!savedUrl || !saved || !fallback) return DEFAULT_WEBHOOK_URL;
  if (saved.host !== fallback.host) return DEFAULT_WEBHOOK_URL;
  if (!saved.token || saved.token === WEBHOOK_TOKEN_PLACEHOLDER) return DEFAULT_WEBHOOK_URL;
  if (fallback.token && fallback.token !== WEBHOOK_TOKEN_PLACEHOLDER && saved.token !== fallback.token) return DEFAULT_WEBHOOK_URL;
  return savedUrl;
}

function saveMapping() {
  chrome.storage.local.set({ [storageKey()]: mapping });
}

// ── Post current height to parent (iframe resize) ──
let lastH = 0;
function postHeight() {
  const h = document.body.scrollHeight;
  if (h === lastH) return;
  lastH = h;
  try { window.parent.postMessage({ __rollsuite_panel_height: h + 4 }, "*"); } catch {}
}
const ro = new ResizeObserver(() => postHeight());
ro.observe(document.body);
window.addEventListener("load", postHeight);

function getTargetSteps() {
  const tv = parseInt($("targetValue").value) || 0;
  return tv > 0 ? tv : 0;
}

function checkReady() {
  const targetSteps = getTargetSteps();
  const hasC = isCounterValid(mapping.counterRegion);
  const hasB = isButtonValid(mapping.buttonPosition);
  const ready = hasC && hasB && targetSteps > 0;
  $("startBtn").disabled = !ready;

  const missing = [];
  if (!hasC) missing.push("área");
  if (!hasB) missing.push("botão");
  if (targetSteps <= 0) missing.push("meta");
  $("startBtn").textContent = missing.length ? `⚠ Falta: ${missing.join(", ")}` : "⚡ Iniciar";
}

function setStatus() {}


function renderMapping() {
  $("counterInfo").style.display = isCounterValid(mapping.counterRegion) ? "flex" : "none";
  $("buttonInfo").style.display = isButtonValid(mapping.buttonPosition) ? "flex" : "none";
  $("continueInfo").style.display = isButtonValid(mapping.continueButtonPosition) ? "flex" : "none";
  if (isCounterValid(mapping.counterRegion)) {
    const r = mapping.counterRegion;
    $("counterInfoText").textContent = `Área ✔ (${Math.round(r.width)}×${Math.round(r.height)}px)`;
  }
  if (isButtonValid(mapping.buttonPosition)) {
    const p = mapping.buttonPosition;
    $("buttonInfoText").textContent = `Botão ✔ (${Math.round(p.x)}, ${Math.round(p.y)})`;
  }
  checkReady();
  renderCodeCard();
}

function showToast(text) {
  $("toast").textContent = text;
  $("toast").classList.add("show");
  setTimeout(() => $("toast").classList.remove("show"), 1800);
}

function send(msg, cb) {
  if (!currentTabId) return;
  try {
    chrome.tabs.sendMessage(currentTabId, msg, (res) => {
      if (chrome.runtime.lastError) { if (cb) cb(null); return; }
      if (cb) cb(res);
    });
  } catch (e) { if (cb) cb(null); }
}

// ── Storage listener ──
chrome.storage.onChanged.addListener((changes) => {
  const key = storageKey();
  if (changes[key]) {
    const saved = changes[key].newValue;
    mapping.counterRegion = saved?.counterRegion || null;
    mapping.buttonPosition = saved?.buttonPosition || null;
    mapping.continueButtonPosition = saved?.continueButtonPosition || null;
    renderMapping();
  }
});

// ── Init ──
async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab?.id;
  try { currentHost = tab?.url ? new URL(tab.url).hostname : ""; } catch (e) { currentHost = ""; }

  chrome.storage.local.get([storageKey(), "targetValue", "betValue", "showOverlay", "autoClickCount", "autoClickInterval", "webhookUrl"], (data) => {
    const saved = data[storageKey()];
    if (isCounterValid(saved?.counterRegion) && isButtonValid(saved?.buttonPosition)) {
      mapping.counterRegion = saved.counterRegion || null;
      mapping.buttonPosition = saved.buttonPosition || null;
      mapping.continueButtonPosition = saved.continueButtonPosition || null;
    }
    if (data.targetValue) $("targetValue").value = data.targetValue;
    $("betValue").value = data.betValue != null ? data.betValue : 0.74;
    const webhookUrl = resolveWebhookUrl(data.webhookUrl);
    $("webhookUrl").value = webhookUrl;
    if (webhookUrl !== data.webhookUrl) chrome.storage.local.set({ webhookUrl });
    if (data.autoClickCount != null) $("autoClickCount").value = data.autoClickCount;
    $("autoClickInterval").value = data.autoClickInterval != null ? data.autoClickInterval : 150;
    $("showOverlay").checked = !!data.showOverlay;
    renderMapping();
  });

  let retries = 0;
  function tryGetStatus() {
    send({ type: "GET_STATUS" }, (res) => {
      if (!res) { if (retries < 3) { retries++; setTimeout(tryGetStatus, 500); } return; }
      if (res.counterRegion) mapping.counterRegion = res.counterRegion;
      if (res.buttonPosition) mapping.buttonPosition = res.buttonPosition;
      if (Object.prototype.hasOwnProperty.call(res, "continueButtonPosition")) {
        mapping.continueButtonPosition = res.continueButtonPosition;
      }
      monState.monitoring = !!res.monitoring;
      monState.hasStopped = !!res.hasStopped;
      monState.steps = res.steps || 0;
      monState.targetSteps = res.targetSteps || 0;
      renderMapping();
      renderMonitor(res.initialValue || 0);
    });
  }
  setTimeout(tryGetStatus, 250);

  // Poll live values
  setInterval(() => {
    send({ type: "GET_STATUS" }, (res) => {
      if (!res) return;
      monState.monitoring = !!res.monitoring;
      monState.hasStopped = !!res.hasStopped;
      monState.paused = !!res.paused;
      monState.steps = res.steps || 0;
      monState.targetSteps = res.targetSteps || 0;
      renderMonitor(res.initialValue || 0);
    });
  }, 250);
}

function renderMonitor() {
  if (monState.monitoring && !monState.hasStopped) {
    $("startBtn").style.display = "none";
    $("stopBtn").style.display = "block";
    $("statusBar").style.display = "flex";
    $("statusBar").className = "status-bar status-active";
    $("statusBar").innerHTML = monState.paused ? "<span>⏸ Pausado</span>" : "<span>⚡ Monitorando giros...</span>";
  } else if (monState.hasStopped) {
    $("startBtn").style.display = "block";
    $("stopBtn").style.display = "none";
    $("statusBar").style.display = "flex";
    $("statusBar").className = "status-bar status-done";
    $("statusBar").innerHTML = "<span>✅ Meta atingida!</span>";
  } else {
    $("startBtn").style.display = "block";
    $("stopBtn").style.display = "none";
    $("statusBar").style.display = "none";
  }
}

function closePanel() {
  try { window.parent.postMessage({ __rollsuite_close: true }, "*"); } catch (e) {}
}
function closePanelForPick() {
  try { window.parent.postMessage({ __rollsuite_close_for_pick: true }, "*"); } catch (e) {}
}

$("startBtn").addEventListener("click", () => {
  const targetSteps = getTargetSteps();
  if (targetSteps <= 0) return;
  const bet = parseFloat($("betValue").value) || 0;
  const rawCount = $("autoClickCount").value.trim();
  const autoClickCount = rawCount === "" ? -1 : (parseInt(rawCount) || 0);
  const autoClickInterval = Math.max(50, parseInt($("autoClickInterval").value) || 150);
  send({ type: "START_MONITOR", targetSteps, initialValue: 0, betValue: bet, autoClickCount, autoClickInterval }, (res) => {
    if (res?.ok) { monState.monitoring = true; monState.hasStopped = false; renderMonitor(); closePanel(); }
  });
});

$("stopBtn").addEventListener("click", () => {
  send({ type: "STOP_MONITOR" }, () => {
    monState.monitoring = false; monState.hasStopped = false; monState.steps = 0; renderMonitor();
  });
});

// ── Mapping events ──
$("mapCounter").addEventListener("click", () => { closePanelForPick(); send({ type: "PICK_COUNTER" }); });
$("mapButton").addEventListener("click", () => { closePanelForPick(); send({ type: "PICK_BUTTON" }); });

$("clearMapping").addEventListener("click", () => {
  mapping = { counterRegion: null, buttonPosition: null, continueButtonPosition: null };
  saveMapping();
  renderMapping();
  send({ type: "CLEAR_MAPPING" });

  showToast("Mapeamento limpo");
});

$("toggleManual").addEventListener("click", () => {
  const sec = $("manualSection");
  sec.style.display = sec.style.display === "none" ? "block" : "none";
  if (mapping.counterRegion) {
    $("cX").value = Math.round(mapping.counterRegion.x) || "";
    $("cY").value = Math.round(mapping.counterRegion.y) || "";
    $("cW").value = Math.round(mapping.counterRegion.width) || "";
    $("cH").value = Math.round(mapping.counterRegion.height) || "";
  }
  if (mapping.buttonPosition) {
    $("bX").value = Math.round(mapping.buttonPosition.x) || "";
    $("bY").value = Math.round(mapping.buttonPosition.y) || "";
  }
});

$("applyManual").addEventListener("click", () => {
  const cx = parseInt($("cX").value) || 0;
  const cy = parseInt($("cY").value) || 0;
  const cw = parseInt($("cW").value) || 0;
  const ch = parseInt($("cH").value) || 0;
  const bx = parseInt($("bX").value) || 0;
  const by = parseInt($("bY").value) || 0;
  if (cw > 0 && ch > 0) mapping.counterRegion = { x: cx, y: cy, width: cw, height: ch, xRatio: 0, yRatio: 0, wRatio: 0, hRatio: 0 };
  if (bx > 0 || by > 0) mapping.buttonPosition = { x: bx, y: by, xRatio: 0, yRatio: 0 };
  saveMapping();
  send({ type: "SET_MAPPING", counterRegion: mapping.counterRegion, buttonPosition: mapping.buttonPosition, continueButtonPosition: mapping.continueButtonPosition });
  renderMapping();
  showToast("Coordenadas aplicadas ✔");
});

$("reloadMapping").addEventListener("click", () => {
  chrome.storage.local.get(null, (allData) => {
    const key = storageKey();
    let saved = allData[key];
    if (!saved) for (const k of Object.keys(allData)) {
      if (k.startsWith("mapping_") && allData[k]?.counterRegion) { saved = allData[k]; break; }
    }
    if (saved) {
      mapping.counterRegion = saved.counterRegion || null;
      mapping.buttonPosition = saved.buttonPosition || null;
      mapping.continueButtonPosition = saved.continueButtonPosition || null;
      renderMapping();
      showToast("Mapeamento recarregado ✔");
    } else showToast("Nenhum mapeamento");
  });
});

$("targetValue").addEventListener("input", () => {
  chrome.storage.local.set({ targetValue: parseInt($("targetValue").value) || 0 });
  checkReady();
});
$("betValue").addEventListener("input", () => {
  chrome.storage.local.set({ betValue: parseFloat($("betValue").value) || 0 });
});
$("showOverlay").addEventListener("change", () => {
  const checked = $("showOverlay").checked;
  chrome.storage.local.set({ showOverlay: checked });
  send({ type: "TOGGLE_OVERLAY", visible: checked });
});
$("webhookUrl")?.addEventListener("input", () => chrome.storage.local.set({ webhookUrl: $("webhookUrl").value.trim() }));
$("resetWebhook")?.addEventListener("click", () => {
  $("webhookUrl").value = DEFAULT_WEBHOOK_URL;
  chrome.storage.local.set({ webhookUrl: DEFAULT_WEBHOOK_URL });
  showToast("Webhook restaurado ✔");
});
$("autoClickCount").addEventListener("input", () => {
  const v = $("autoClickCount").value.trim();
  chrome.storage.local.set({ autoClickCount: v === "" ? null : (parseInt(v) || 0) });
});
$("autoClickInterval").addEventListener("input", () => {
  chrome.storage.local.set({ autoClickInterval: parseInt($("autoClickInterval").value) || 150 });
});

// Messages from content script
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "COUNTER_MAPPED") {
    mapping.counterRegion = msg.region;
    saveMapping(); renderMapping(); showToast("Área mapeada ✔");
  }
  if (msg.type === "BUTTON_MAPPED") {
    mapping.buttonPosition = msg.position;
    saveMapping(); renderMapping(); showToast("Botão mapeado ✔");
  }
  if (msg.type === "TARGET_REACHED") {
    monState.hasStopped = true; monState.monitoring = false;
    renderMonitor(0);
  }
});

init();

// ── Code card (unified import/share) ──
function hasAnyMapping() {
  return isCounterValid(mapping.counterRegion) || isButtonValid(mapping.buttonPosition);
}
function buildShareCode() {
  const data = {};
  if (isCounterValid(mapping.counterRegion)) data.c = mapping.counterRegion;
  if (isButtonValid(mapping.buttonPosition)) data.b = mapping.buttonPosition;
  if (isButtonValid(mapping.continueButtonPosition)) data.cb = mapping.continueButtonPosition;
  return Object.keys(data).length ? btoa(JSON.stringify(data)) : "";
}
function renderCodeCard() {
  const empty = $("codeEmpty");
  const filled = $("codeFilled");
  if (hasAnyMapping()) {
    empty.style.display = "none";
    filled.style.display = "block";
    $("shareCode").value = buildShareCode();
  } else {
    empty.style.display = "block";
    filled.style.display = "none";
  }
}

$("copyCode").addEventListener("click", () => {
  const code = $("shareCode").value;
  navigator.clipboard.writeText(code).then(() => showToast("Código copiado ✔"))
    .catch(() => { $("shareCode").select(); document.execCommand("copy"); showToast("Código copiado ✔"); });
});

$("resetCode").addEventListener("click", () => {
  mapping = { counterRegion: null, buttonPosition: null, continueButtonPosition: null };
  saveMapping();
  send({ type: "CLEAR_MAPPING" });
  $("importCode").value = "";
  renderMapping();
  setTimeout(() => $("importCode").focus(), 50);
  showToast("Limpo — cole novo código");
});

function updateImportState() {
  const wrap = $("importWrap");
  if (wrap) wrap.classList.toggle("has-content", !!$("importCode").value.trim());
}
function tryAutoApplyImport() {
  const code = $("importCode").value.trim();
  if (!code) return;
  try {
    const data = JSON.parse(atob(code));
    if (data.c) mapping.counterRegion = data.c;
    if (data.b) mapping.buttonPosition = data.b;
    if (data.cb) mapping.continueButtonPosition = data.cb;
    saveMapping();
    send({ type: "SET_MAPPING", counterRegion: mapping.counterRegion, buttonPosition: mapping.buttonPosition, continueButtonPosition: mapping.continueButtonPosition });
    $("importCode").value = "";
    updateImportState();
    renderMapping();
    showToast("Mapeamento importado ✔");
  } catch (e) {
    showToast("Código inválido ✗");
  }
}
$("importCode").addEventListener("input", updateImportState);
$("importCode").addEventListener("paste", () => {
  setTimeout(() => { updateImportState(); tryAutoApplyImport(); }, 0);
});
$("clearImport")?.addEventListener("click", () => {
  $("importCode").value = ""; updateImportState(); $("importCode").focus();
});

// Settings overlay
const settingsOverlay = $("settingsOverlay");
$("openSettings")?.addEventListener("click", () => settingsOverlay?.classList.add("show"));
$("closeSettings")?.addEventListener("click", () => settingsOverlay?.classList.remove("show"));
settingsOverlay?.addEventListener("click", (e) => {
  if (e.target === settingsOverlay) settingsOverlay.classList.remove("show");
});
$("testTargetBtn")?.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "TEST_TARGET_REACHED" }, (res) => {
    if (chrome.runtime.lastError) {
      showToast("Falha ao testar webhook");
      return;
    }
    if (res?.ok) showToast("Webhook de teste OK ✔");
    else showToast(`Falha webhook ${res?.status || ""} ✗`);
  });
});

// Collapsible mapping section
$("toggleMappingSection").addEventListener("click", () => {
  const c = $("mappingContent");
  const open = c.style.display !== "none";
  c.style.display = open ? "none" : "block";
  $("mappingChevron").textContent = open ? "▸" : "▾";
  // post height after transition
  setTimeout(postHeight, 50);
  setTimeout(postHeight, 200);
});

// Mapping presets
const MAPPING_PRESETS = {
  bikini5: {
    label: "Bikini 5 telas",
    counterRegion: { x: 760, y: 420, width: 22, height: 22, xRatio: 0.396, yRatio: 0.437, wRatio: 0.011, hRatio: 0.023 },
    buttonPosition: { x: 1095, y: 815, xRatio: 0.570, yRatio: 0.849 },
  },
};
$("presetMappingSelect")?.addEventListener("change", (e) => {
  const p = MAPPING_PRESETS[e.target.value];
  if (!p) return;
  mapping.counterRegion = p.counterRegion;
  mapping.buttonPosition = p.buttonPosition;
  saveMapping();
  send({ type: "SET_MAPPING", counterRegion: mapping.counterRegion, buttonPosition: mapping.buttonPosition });
  renderMapping();
  showToast(`Preset "${p.label}" aplicado ✔`);
  e.target.value = "";
});
