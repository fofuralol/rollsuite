// Content script — pixel-change detection for counter tracking (NO OCR)
let IS_TOP = false;
try { IS_TOP = (window === window.top); } catch (e) { IS_TOP = (window.parent === window); }

// ── State ──
let monitoring = false;
let betValue = 0;
let hasStopped = false;
let isPaused = false;
let steps = 0;
let targetSteps = 0;
let initialValue = 0;
let counterRegion = null;
let buttonPosition = null;
let continueButtonPosition = null;
let pickMode = null;
let pollInterval = null;
let autoClickInterval = null;
let autoClickRemaining = 0;
let streamMonitorActive = false;

// Pixel comparison state
let prevPixelData = null;
let changeCanvas = null;
let changeCtx = null;
let lastStepAt = 0;

const POLL_MS = 150; // capture interval
const CHANGE_THRESHOLD = 30; // total RGB diff to count as changed pixel
const MIN_CHANGED_PIXELS = 1; // minimum changed pixels to count as a step
const MIN_STEP_GAP_MS = 400; // gap secundário (offscreen já tem lockout próprio)

// ── Painel injetado (substitui o popup nativo do Chrome) ──
let rollsuitePanel = null;
let rollsuiteIframe = null;
let reopenPanelAfterPick = false;

function openRollsuitePanel() {
  if (!IS_TOP) return;
  if (rollsuitePanel) return;
  const wrap = document.createElement("div");
  wrap.id = "rollsuite-panel-wrap";
  wrap.style.cssText = "position:fixed;top:8px;right:8px;width:316px;z-index:2147483647;border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,0.5);overflow:hidden;background:#0a0f0e;transition:height 0.18s ease;";
  const iframe = document.createElement("iframe");
  iframe.src = chrome.runtime.getURL("popup.html");
  iframe.style.cssText = "width:100%;height:300px;border:0;display:block;background:#0a0f0e;transition:height 0.18s ease;";
  iframe.allow = "clipboard-read; clipboard-write";
  wrap.appendChild(iframe);
  document.documentElement.appendChild(wrap);
  rollsuitePanel = wrap;
  rollsuiteIframe = iframe;
}
function closeRollsuitePanel() {
  if (rollsuitePanel) {
    rollsuitePanel.remove();
    rollsuitePanel = null;
    rollsuiteIframe = null;
  }
}
function toggleRollsuitePanel() {
  if (!IS_TOP) return;
  if (rollsuitePanel) closeRollsuitePanel();
  else openRollsuitePanel();
}

// Fechar ao clicar fora do painel
document.addEventListener("mousedown", (e) => {
  if (!rollsuitePanel) return;
  if (pickMode) return; // não fechar durante mapeamento
  if (!rollsuitePanel.contains(e.target)) closeRollsuitePanel();
}, true);

window.addEventListener("message", (e) => {
  const d = e.data || {};
  const h = d.__rollsuite_panel_height;
  if (h && rollsuiteIframe) {
    const target = Math.min(Math.max(h, 80), window.innerHeight - 20);
    rollsuiteIframe.style.height = target + "px";
  }
  if (d.__rollsuite_close) {
    reopenPanelAfterPick = false;
    closeRollsuitePanel();
  }
  if (d.__rollsuite_close_for_pick) {
    reopenPanelAfterPick = true;
    closeRollsuitePanel();
  }
});
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "TOGGLE_ROLLSUITE_PANEL") {
    toggleRollsuitePanel();
  }
  if (msg && msg.type === "CLOSE_ROLLSUITE_PANEL") {
    closeRollsuitePanel();
  }
});



const host = window.location.hostname;

// ── Helpers ──
function buildRegion({ x, y, width, height }) {
  return { x, y, width, height, xRatio: x / window.innerWidth, yRatio: y / window.innerHeight, wRatio: width / window.innerWidth, hRatio: height / window.innerHeight };
}
function buildPos({ x, y }) {
  return { x, y, xRatio: x / window.innerWidth, yRatio: y / window.innerHeight };
}
function normalizeRegion(r) {
  if (!r) return null;
  const hasRatios = typeof r.xRatio === "number" && typeof r.yRatio === "number" && typeof r.wRatio === "number" && typeof r.hRatio === "number" && r.wRatio > 0 && r.hRatio > 0;
  if (hasRatios) {
    return {
      ...r,
      x: Math.round(r.xRatio * window.innerWidth),
      y: Math.round(r.yRatio * window.innerHeight),
      width: Math.max(1, Math.round(r.wRatio * window.innerWidth)),
      height: Math.max(1, Math.round(r.hRatio * window.innerHeight)),
    };
  }
  if (r.width > 0 && r.height > 0) return r;
  return null;
}
function normalizePos(p) {
  if (!p) return null;
  const hasRatios = typeof p.xRatio === "number" && typeof p.yRatio === "number";
  if (hasRatios) {
    return {
      ...p,
      x: Math.round(p.xRatio * window.innerWidth),
      y: Math.round(p.yRatio * window.innerHeight),
    };
  }
  if (typeof p.x === "number" && typeof p.y === "number") return p;
  return null;
}

function buildMonitorRegionPayload(region) {
  const r = normalizeRegion(region);
  if (!r) return null;
  const viewportW = Math.max(1, window.innerWidth || 1);
  const viewportH = Math.max(1, window.innerHeight || 1);
  return {
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
    xRatio: typeof r.xRatio === "number" ? r.xRatio : r.x / viewportW,
    yRatio: typeof r.yRatio === "number" ? r.yRatio : r.y / viewportH,
    wRatio: typeof r.wRatio === "number" && r.wRatio > 0 ? r.wRatio : r.width / viewportW,
    hRatio: typeof r.hRatio === "number" && r.hRatio > 0 ? r.hRatio : r.height / viewportH,
  };
}

function startFallbackPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(() => {
    if (monitoring && !hasStopped && !isPaused) requestScreenshot();
  }, POLL_MS);
  requestScreenshot();
}

function stopFallbackPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

function stopBackgroundStreamMonitor() {
  if (!streamMonitorActive) return;
  streamMonitorActive = false;
  chrome.runtime.sendMessage({ type: "STOP_STREAM_MONITOR_REQUEST" });
}

function startStepDetection() {
  const regionPayload = buildMonitorRegionPayload(counterRegion);
  stopFallbackPolling();
  if (!regionPayload) {
    startFallbackPolling();
    return;
  }

  chrome.runtime.sendMessage({ type: "START_STREAM_MONITOR_REQUEST", region: regionPayload }, (res) => {
    if (chrome.runtime.lastError || !res?.ok) {
      streamMonitorActive = false;
      console.warn("[Content] Offscreen monitor indisponível, mantendo fallback por screenshot", chrome.runtime.lastError?.message || res?.error || "sem detalhe");
      startFallbackPolling();
      return;
    }
    streamMonitorActive = true;
    console.log("[Content] Offscreen monitor iniciado para OCR + detecção em background");
  });
}

// ── Restore from storage ──
chrome.storage.local.get([`mapping_${host}`], (data) => {
  const saved = data[`mapping_${host}`];
  const hasSavedMapping = !!saved && !!normalizeRegion(saved.counterRegion) && !!normalizePos(saved.buttonPosition);
  if (hasSavedMapping) {
    counterRegion = normalizeRegion(saved.counterRegion);
    buttonPosition = normalizePos(saved.buttonPosition);
    continueButtonPosition = normalizePos(saved.continueButtonPosition);
    console.log("[Content] Restaurado:", { counterRegion, buttonPosition, continueButtonPosition });
  } else {
    counterRegion = null;
    buttonPosition = null;
    continueButtonPosition = null;
    chrome.storage.local.remove(`mapping_${host}`);
  }
});

// ── Message handler ──
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "PICK_COUNTER") {
    if (!IS_TOP) { broadcastPick("counter"); }
    startCounterPick();
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === "PICK_BUTTON") {
    if (!IS_TOP) { broadcastPick("button"); }
    startButtonPick();
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === "PICK_CONTINUE_BUTTON") {
    if (!IS_TOP) { broadcastPick("continue"); }
    startContinueButtonPick();
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === "START_MONITOR") {
    if (!IS_TOP) return false;
    targetSteps = msg.targetSteps || 0;
    initialValue = msg.initialValue || 0;
    betValue = msg.betValue || 0;
    steps = 0;
    hasStopped = false;
    prevPixelData = null;
    startMonitoring();
    const acCountRaw = msg.autoClickCount;
    const acCount = acCountRaw === -1 ? -1 : (parseInt(acCountRaw) || 0);
    const acIntv = Math.max(50, parseInt(msg.autoClickInterval) || 150);
    if ((acCount > 0 || acCount === -1) && buttonPosition) {
      startAutoClicker(acCount, acIntv);
    }
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === "STOP_MONITOR") {
    if (!IS_TOP) return false;
    stopAutoClicker();
    // Click the game stop button before stopping monitoring
    if (buttonPosition) clickAt(buttonPosition);
    stopMonitoring();
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === "CLEAR_MAPPING") {
    counterRegion = null;
    buttonPosition = null;
    continueButtonPosition = null;
    prevPixelData = null;
    cleanupPick("counter");
    cleanupPick("button");
    cleanupPick("continue");
    document.querySelectorAll("iframe").forEach((f) => {
      try { f.contentWindow?.postMessage({ source: "autostop", type: "GESTOR_CLEAR_MAPPING" }, "*"); } catch (e) {}
    });
    console.log("[Content] Mapeamento limpo");
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === "SET_MAPPING") {
    if (msg.counterRegion) counterRegion = msg.counterRegion;
    if (msg.buttonPosition) buttonPosition = msg.buttonPosition;
    if (Object.prototype.hasOwnProperty.call(msg, "continueButtonPosition")) {
      continueButtonPosition = msg.continueButtonPosition;
    }
    console.log("[Content] Mapeamento aplicado via SET_MAPPING");
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === "TEST_CLICK") {
    if (!IS_TOP) return false;
    if (buttonPosition) { clickAt(buttonPosition); sendResponse({ ok: true }); }
    else sendResponse({ ok: false });
    return false;
  }
  if (msg.type === "TOGGLE_PAUSE") {
    if (!IS_TOP || !monitoring || hasStopped) { sendResponse({ ok: false }); return false; }
    if (isPaused) {
      isPaused = false;
      const resumeBtn = continueButtonPosition || buttonPosition;
      if (resumeBtn) clickAt(resumeBtn);
      prevPixelData = null;
      startStepDetection();
    } else {
      isPaused = true;
      if (buttonPosition) clickAt(buttonPosition);
      stopFallbackPolling();
      stopBackgroundStreamMonitor();
    }
    updateWidget();
    sendResponse({ ok: true, paused: isPaused });
    return false;
  }
  if (msg.type === "GET_STATUS") {
    if (!IS_TOP && !counterRegion && !buttonPosition) return false;
    if (!counterRegion && !buttonPosition) {
      chrome.storage.local.get([`mapping_${host}`], (data) => {
        const hasStoredMapping = Object.prototype.hasOwnProperty.call(data, `mapping_${host}`);
        const saved = data[`mapping_${host}`];
        const hasSavedMapping = !!saved && !!normalizeRegion(saved.counterRegion) && !!normalizePos(saved.buttonPosition);
        if (hasSavedMapping) {
          counterRegion = normalizeRegion(saved.counterRegion);
          buttonPosition = normalizePos(saved.buttonPosition);
          continueButtonPosition = normalizePos(saved.continueButtonPosition);
        } else {
          counterRegion = null;
          buttonPosition = null;
          continueButtonPosition = null;
        }
        sendResponse({ monitoring, hasStopped, paused: isPaused, steps, targetSteps, initialValue, counterRegion, buttonPosition, continueButtonPosition });
      });
      return true;
    }
    sendResponse({ monitoring, hasStopped, paused: isPaused, steps, targetSteps, initialValue, counterRegion, buttonPosition, continueButtonPosition });
    return false;
  }


  // ── Screenshot result → pixel comparison ──
  if (msg.type === "SCREENSHOT_RESULT") {
    if (!IS_TOP) return false;
    handleScreenshot(msg.dataUrl);
    return false;
  }

  // Iframe picker messages
  if (msg.type === "GESTOR_PICK_COUNTER") { startCounterPick(); return false; }
  if (msg.type === "GESTOR_PICK_BUTTON") { startButtonPick(); return false; }
  if (msg.type === "GESTOR_PICK_CONTINUE_BUTTON") { startContinueButtonPick(); return false; }
  if (msg.type === "TOGGLE_OVERLAY") {
    widgetVisible = !!msg.visible;
    if (widgetVisible) {
      createWidget();
    } else if (widget) {
      widget.style.display = "none";
    }
    return false;
  }
  if (msg.type === "CLICK_IN_FRAME") {
    if (IS_TOP) return false;
    const el = document.elementFromPoint(msg.x, msg.y);
    if (el) {
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: msg.x, clientY: msg.y }));
      }
    }
    return false;
  }

  // Stream-based pixel change from offscreen (works in background)
  if (msg.type === "STREAM_PIXEL_CHANGED") {
    if (!IS_TOP || !monitoring || hasStopped) return false;
    const now = Date.now();
    if (now - lastStepAt >= MIN_STEP_GAP_MS) {
      lastStepAt = now;
      steps++;
      const remaining = Math.max(0, targetSteps - steps);
      console.log("[Content] ⚡ Stream pixel mudou!", { steps, targetSteps, remaining });
      updateWidget();
      chrome.runtime.sendMessage({ type: "PASSIVE_UPDATE", remaining });
      chrome.runtime.sendMessage({ type: "DASH_SYNC_STEP", steps: initialValue + steps });
      if (steps >= targetSteps && targetSteps > 0) {
        stopGame();
      }
    }
    return false;
  }

  return false;
});

// ── Iframe broadcast ──
function broadcastPick(target) {
  const type = target === "counter"
    ? "GESTOR_PICK_COUNTER"
    : target === "continue"
      ? "GESTOR_PICK_CONTINUE_BUTTON"
      : "GESTOR_PICK_BUTTON";
  document.querySelectorAll("iframe").forEach(f => {
    try { f.contentWindow?.postMessage({ source: "autostop", type }, "*"); } catch (e) {}
  });
}

window.addEventListener("message", (e) => {
  const d = e.data;
  if (!d || d.source !== "autostop") return;
  if (d.type === "GESTOR_PICK_COUNTER") startCounterPick();
  if (d.type === "GESTOR_PICK_BUTTON") startButtonPick();
  if (d.type === "GESTOR_PICK_CONTINUE_BUTTON") startContinueButtonPick();
  if (d.type === "GESTOR_CLEAR_MAPPING") {
    counterRegion = null;
    buttonPosition = null;
    continueButtonPosition = null;
    prevPixelData = null;
    cleanupPick("counter");
    cleanupPick("button");
    cleanupPick("continue");
    return;
  }
  if (d.type === "GESTOR_CLICK_AT") {
    const x = typeof d.x === "number" ? d.x : 0;
    const y = typeof d.y === "number" ? d.y : 0;
    dispatchClickNearPoint(x, y);
  }

  if (IS_TOP && d.type === "IFRAME_COUNTER") {
    let ir = null;
    for (const f of document.querySelectorAll("iframe")) { if (f.contentWindow === e.source) { ir = f.getBoundingClientRect(); break; } }
    if (!ir) return;
    counterRegion = buildRegion({ x: ir.left + d.x, y: ir.top + d.y, width: d.w, height: d.h });
    saveAndNotify("counter");
  }
  if (IS_TOP && d.type === "IFRAME_BUTTON") {
    let ir = null;
    for (const f of document.querySelectorAll("iframe")) { if (f.contentWindow === e.source) { ir = f.getBoundingClientRect(); break; } }
    if (!ir) return;
    buttonPosition = buildPos({ x: ir.left + d.x, y: ir.top + d.y });
    saveAndNotify("button");
  }
  if (IS_TOP && d.type === "IFRAME_CONTINUE_BUTTON") {
    let ir = null;
    for (const f of document.querySelectorAll("iframe")) { if (f.contentWindow === e.source) { ir = f.getBoundingClientRect(); break; } }
    if (!ir) return;
    continueButtonPosition = buildPos({ x: ir.left + d.x, y: ir.top + d.y });
    saveAndNotify("continue");
  }
});

function saveAndNotify(what) {
  chrome.storage.local.set({ [`mapping_${host}`]: { counterRegion, buttonPosition, continueButtonPosition } });
  if (what === "counter") {
    console.log("[Content] Counter mapped:", counterRegion);
    chrome.runtime.sendMessage({ type: "COUNTER_MAPPED", region: counterRegion });
  } else if (what === "button") {
    console.log("[Content] Button mapped:", buttonPosition);
    chrome.runtime.sendMessage({ type: "BUTTON_MAPPED", position: buttonPosition });
  } else {
    console.log("[Content] Continue button mapped:", continueButtonPosition);
    chrome.runtime.sendMessage({ type: "CONTINUE_BUTTON_MAPPED", position: continueButtonPosition });
  }
  if (reopenPanelAfterPick) {
    reopenPanelAfterPick = false;
    setTimeout(() => openRollsuitePanel(), 150);
  }
}


// ── Counter Region Picker (drag) ──
let regionStart = null, regionBox = null;
let pickOverlay = null;

function createPickOverlay() {
  if (pickOverlay) pickOverlay.remove();
  pickOverlay = document.createElement("div");
  pickOverlay.id = "autostop-pick-overlay";
  pickOverlay.style.cssText = `position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:2147483646;cursor:crosshair;background:transparent;`;
  document.body.appendChild(pickOverlay);
  return pickOverlay;
}
function removePickOverlay() {
  if (pickOverlay) { pickOverlay.remove(); pickOverlay = null; }
}

function startCounterPick() {
  if (pickMode === "button") cleanupPick("button");
  if (pickMode === "counter") cleanupPick("counter");
  pickMode = "counter";
  showTip("🔢 Clique e arraste para selecionar a área do contador (pequena, ex: 20×20px)");
  regionBox = createOverlay("2px dashed #22c55e", "rgba(34,197,94,0.15)");
  if (IS_TOP) {
    const ov = createPickOverlay();
    ov.addEventListener("mousedown", onRegionDown, true);
    ov.addEventListener("mousemove", onRegionDrag, true);
    ov.addEventListener("mouseup", onRegionUp, true);
  } else {
    document.body.style.cursor = "crosshair";
    document.addEventListener("mousedown", onRegionDown, true);
    document.addEventListener("mousemove", onRegionDrag, true);
    document.addEventListener("mouseup", onRegionUp, true);
  }
}

function onRegionDown(e) {
  if (pickMode !== "counter") return;
  e.preventDefault(); e.stopImmediatePropagation();
  regionStart = { x: e.clientX, y: e.clientY };
  regionBox.style.display = "block";
  Object.assign(regionBox.style, { left: e.clientX+"px", top: e.clientY+"px", width: "0", height: "0" });
}
function onRegionDrag(e) {
  if (pickMode !== "counter" || !regionStart) return;
  const x = Math.min(e.clientX, regionStart.x), y = Math.min(e.clientY, regionStart.y);
  Object.assign(regionBox.style, { left: x+"px", top: y+"px", width: Math.abs(e.clientX-regionStart.x)+"px", height: Math.abs(e.clientY-regionStart.y)+"px" });
}
function onRegionUp(e) {
  if (pickMode !== "counter" || !regionStart) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const x = Math.min(e.clientX, regionStart.x), y = Math.min(e.clientY, regionStart.y);
  const w = Math.abs(e.clientX - regionStart.x), h = Math.abs(e.clientY - regionStart.y);
  cleanupPick("counter");
  if (w < 5 || h < 5) return;
  if (!IS_TOP && window.parent) {
    window.parent.postMessage({ source: "autostop", type: "IFRAME_COUNTER", x, y, w, h }, "*");
  } else {
    counterRegion = buildRegion({ x, y, width: w, height: h });
    saveAndNotify("counter");
  }
  flashConfirm(x + w/2, y + h/2);
}

// ── Button Picker (click) ──
function startButtonPick() {
  startActionButtonPick("button", "🛑 Clique no local exato do botão de PARADA");
}

function startContinueButtonPick() {
  startActionButtonPick("continue", "▶ Clique no local exato do botão de CONTINUAR");
}

function startActionButtonPick(mode, tipText) {
  if (pickMode === "counter") cleanupPick("counter");
  if (pickMode === "button") cleanupPick("button");
  if (pickMode === "continue") cleanupPick("continue");
  pickMode = mode;
  showTip(tipText);
  if (IS_TOP) {
    const ov = createPickOverlay();
    ov.addEventListener("click", onButtonClick, true);
  } else {
    document.body.style.cursor = "crosshair";
    document.addEventListener("click", onButtonClick, true);
  }
}

function onButtonClick(e) {
  if (pickMode !== "button" && pickMode !== "continue") return;
  e.preventDefault(); e.stopImmediatePropagation();
  const mode = pickMode;
  cleanupPick(mode);
  if (!IS_TOP && window.parent) {
    window.parent.postMessage({
      source: "autostop",
      type: mode === "continue" ? "IFRAME_CONTINUE_BUTTON" : "IFRAME_BUTTON",
      x: e.clientX,
      y: e.clientY,
    }, "*");
  } else {
    if (mode === "continue") {
      continueButtonPosition = buildPos({ x: e.clientX, y: e.clientY });
      saveAndNotify("continue");
    } else {
      buttonPosition = buildPos({ x: e.clientX, y: e.clientY });
      saveAndNotify("button");
    }
  }
  flashConfirm(e.clientX, e.clientY);
}

function cleanupPick(which) {
  pickMode = null;
  document.body.style.cursor = "";
  removeTip();
  removePickOverlay();
  if (which === "counter") {
    if (regionBox) { regionBox.remove(); regionBox = null; }
    regionStart = null;
    document.removeEventListener("mousedown", onRegionDown, true);
    document.removeEventListener("mousemove", onRegionDrag, true);
    document.removeEventListener("mouseup", onRegionUp, true);
  }
  if (which === "button" || which === "continue") {
    document.removeEventListener("click", onButtonClick, true);
  }
}

// ── UI helpers ──
function createOverlay(border, bg) {
  const el = document.createElement("div");
  el.style.cssText = `position:fixed;z-index:2147483647;pointer-events:none;display:none;border:${border};background:${bg};border-radius:4px;`;
  document.body.appendChild(el);
  return el;
}
function showTip(text) {
  removeTip();
  const tip = document.createElement("div");
  tip.id = "autostop-tip";
  tip.textContent = text;
  tip.style.cssText = `position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;background:rgba(34,197,94,0.95);color:#000;padding:10px 20px;border-radius:8px;font:700 14px -apple-system,sans-serif;box-shadow:0 4px 20px rgba(0,0,0,0.4);pointer-events:none;`;
  document.body.appendChild(tip);
}
function removeTip() {
  const t = document.getElementById("autostop-tip");
  if (t) t.remove();
}
function flashConfirm(x, y) {
  const el = document.createElement("div");
  el.style.cssText = `position:fixed;left:${x}px;top:${y}px;transform:translate(-50%,-50%);z-index:2147483647;width:60px;height:60px;border-radius:50%;border:3px solid #22c55e;background:rgba(34,197,94,0.3);pointer-events:none;animation:asFlash .6s forwards;`;
  const s = document.createElement("style");
  s.textContent = `@keyframes asFlash{0%{transform:translate(-50%,-50%) scale(1);opacity:1}100%{transform:translate(-50%,-50%) scale(2.5);opacity:0}}`;
  document.head.appendChild(s); document.body.appendChild(el);
  setTimeout(() => { el.remove(); s.remove(); }, 700);
}

// ── Click simulation ──
function dispatchMouseSequence(target, x, y) {
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }));
  }
}

function dispatchClickNearPoint(x, y) {
  const searchOffsets = [
    [0, 0],
    [6, 0], [-6, 0], [0, 6], [0, -6],
    [12, 0], [-12, 0], [0, 12], [0, -12],
    [6, 6], [6, -6], [-6, 6], [-6, -6],
  ];

  for (const [dx, dy] of searchOffsets) {
    const tx = Math.round(x + dx);
    const ty = Math.round(y + dy);
    const el = document.elementFromPoint(tx, ty);
    if (!el) continue;
    if (el.tagName === "IFRAME") {
      const rect = el.getBoundingClientRect();
      try {
        el.contentWindow?.postMessage({ source: "autostop", type: "GESTOR_CLICK_AT", x: tx - rect.left, y: ty - rect.top }, "*");
        return true;
      } catch (e) {
        continue;
      }
    }
    dispatchMouseSequence(el, tx, ty);
    return true;
  }

  return false;
}

function clickAt(pos) {
  const p = normalizePos(pos);
  if (!p) return;
  const clicked = dispatchClickNearPoint(p.x, p.y);
  if (clicked) {
    console.log("[Content] Clique em:", Math.round(p.x), Math.round(p.y));
  } else {
    console.warn("[Content] Nenhum alvo encontrado para clique em:", Math.round(p.x), Math.round(p.y));
  }
}

// ── Screenshot → Pixel Change Detection (NO OCR) ──
function handleScreenshot(dataUrl) {
  if (!monitoring || hasStopped || !counterRegion || isPaused) return;

  const img = new Image();
  img.onload = () => {
    const cr = normalizeRegion(counterRegion);
    if (!cr) return;

    // Crop coordinates in screenshot space (screenshot = full tab at devicePixelRatio)
    const dpr = window.devicePixelRatio || 1;
    const cx = Math.round(cr.x * dpr);
    const cy = Math.round(cr.y * dpr);
    const cw = Math.max(1, Math.round(cr.width * dpr));
    const ch = Math.max(1, Math.round(cr.height * dpr));

    if (cx + cw > img.width || cy + ch > img.height) {
      console.warn("[Content] Região fora da imagem:", { cx, cy, cw, ch, imgW: img.width, imgH: img.height });
      return;
    }

    if (!changeCanvas) {
      changeCanvas = document.createElement("canvas");
      changeCtx = changeCanvas.getContext("2d", { willReadFrequently: true });
    }
    changeCanvas.width = cw;
    changeCanvas.height = ch;
    changeCtx.drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch);
    const imageData = changeCtx.getImageData(0, 0, cw, ch);
    const pixels = imageData.data;

    if (prevPixelData) {
      let changedPixels = 0;
      let strongestPixelDelta = 0;

      for (let i = 0; i < pixels.length; i += 4) {
        const dr = Math.abs(pixels[i] - prevPixelData[i]);
        const dg = Math.abs(pixels[i + 1] - prevPixelData[i + 1]);
        const db = Math.abs(pixels[i + 2] - prevPixelData[i + 2]);
        const pixelDelta = dr + dg + db;

        if (pixelDelta > CHANGE_THRESHOLD) {
          changedPixels++;
          if (pixelDelta > strongestPixelDelta) strongestPixelDelta = pixelDelta;
        }
      }

      const now = Date.now();
      const detectedChange = changedPixels >= MIN_CHANGED_PIXELS;
      const canCountStep = now - lastStepAt >= MIN_STEP_GAP_MS;

      if (detectedChange && canCountStep) {
        lastStepAt = now;
        steps++;
        const remaining = Math.max(0, targetSteps - steps);
        console.log("[Content] ⚡ Pixel mudou!", { changedPixels, strongestPixelDelta, steps, targetSteps, remaining });

        updateWidget();
        chrome.runtime.sendMessage({ type: "PASSIVE_UPDATE", remaining });
        chrome.runtime.sendMessage({ type: "DASH_SYNC_STEP", steps: initialValue + steps });

        if (steps >= targetSteps && targetSteps > 0) {
          stopGame();
        }
      }
    } else {
      console.log("[Content] 📸 Primeira captura salva (referência)");
    }

    prevPixelData = new Uint8ClampedArray(pixels);
  };
  img.src = dataUrl;
}

function requestScreenshot() {
  chrome.runtime.sendMessage({ type: "CAPTURE_TAB" });
}

function captureMappedRegionDataUrl() {
  return new Promise((resolve) => {
    const cr = normalizeRegion(counterRegion);
    if (!cr) {
      resolve(null);
      return;
    }
    chrome.runtime.sendMessage({ type: "CAPTURE_TAB_DIRECT" }, (res) => {
      if (chrome.runtime.lastError || !res?.ok || !res?.dataUrl) {
        resolve(null);
        return;
      }
      const img = new Image();
      img.onload = () => {
        try {
          const dpr = window.devicePixelRatio || 1;
          const cx = Math.round(cr.x * dpr);
          const cy = Math.round(cr.y * dpr);
          const cw = Math.max(1, Math.round(cr.width * dpr));
          const ch = Math.max(1, Math.round(cr.height * dpr));
          const canvas = document.createElement("canvas");
          canvas.width = cw;
          canvas.height = ch;
          const c2 = canvas.getContext("2d", { willReadFrequently: true });
          c2.drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch);
          resolve(canvas.toDataURL("image/png"));
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = res.dataUrl;
    });
  });
}

// ── Stop Game ──
function stopGame() {
  if (hasStopped) return;
  hasStopped = true;
  console.log("[Content] 🛑 META ATINGIDA! Steps:", steps, "/", targetSteps);

  stopAutoClicker();
  stopFallbackPolling();
  if (buttonPosition) clickAt(buttonPosition);

  captureMappedRegionDataUrl()
    .catch(() => null)
    .then((mappedFrameDataUrl) => {
      chrome.runtime.sendMessage({ type: "TARGET_REACHED", steps, targetSteps, mapped_frame_data_url: mappedFrameDataUrl || null });
      updateWidget();
      stopMonitoring();
    });
}

// ── Auto-clicker (continuous clicks on mapped button) ──
function startAutoClicker(count, intervalMs) {
  stopAutoClicker();
  if (!buttonPosition) return;
  if (count === 0) return;
  const unlimited = count === -1;
  autoClickRemaining = unlimited ? Infinity : count;
  console.log("[Content] 🖱 Auto-clicker iniciado:", unlimited ? "∞ (até parar)" : count, "cliques @", intervalMs, "ms");
  const tick = () => {
    if (hasStopped || !monitoring) { stopAutoClicker(); return; }
    if (autoClickRemaining <= 0) { stopAutoClicker(); return; }
    if (buttonPosition) clickAt(buttonPosition);
    if (!unlimited) autoClickRemaining--;
  };
  tick();
  autoClickInterval = setInterval(tick, intervalMs);
}

function stopAutoClicker() {
  if (autoClickInterval) {
    clearInterval(autoClickInterval);
    autoClickInterval = null;
    console.log("[Content] 🖱 Auto-clicker parado");
  }
  autoClickRemaining = 0;
}

// ── Mini Widget ──
let widget = null;
let widgetVisible = false;

// Restore overlay visibility from storage
chrome.storage.local.get(["showOverlay"], (data) => {
  widgetVisible = !!data.showOverlay;
  if (widgetVisible && IS_TOP) {
    createWidget();
  }
});

function createWidget() {
  if (widget) { widget.style.display = (monitoring || widgetVisible) ? "flex" : "none"; return; }
  const logoUrl = chrome.runtime.getURL("icon-logo.png");
  widget = document.createElement("div");
  widget.innerHTML = `
    <div id="asw-hdr" style="display:flex;align-items:center;justify-content:space-between;cursor:grab;gap:8px;">
      <div style="display:flex;align-items:center;gap:7px;">
        <img src="${logoUrl}" alt="RS" style="width:18px;height:18px;border-radius:5px;object-fit:cover;box-shadow:0 0 8px rgba(255,153,0,0.45);">
        <span id="asw-dot" style="font-family:'Orbitron',sans-serif;font-size:11px;font-weight:800;color:#ff9900;letter-spacing:1.2px;text-transform:uppercase;">Contador</span>
      </div>
      <div style="display:flex;gap:5px;">
        <button id="asw-play-btn" title="Iniciar" style="
          width:28px;height:28px;border:none;border-radius:7px;
          background:linear-gradient(135deg,#038c7a,#14b89e);color:#fff;
          font-size:12px;font-weight:900;cursor:pointer;
          display:inline-flex;align-items:center;justify-content:center;padding:0;
          box-shadow:0 2px 8px rgba(3,140,122,0.4);transition:all .12s;
        ">▶</button>
        <button id="asw-stop-btn" title="Parar/Resetar" disabled style="
          width:28px;height:28px;border:none;border-radius:7px;
          background:linear-gradient(135deg,#ef4444,#b91c1c);color:#fff;
          font-size:11px;font-weight:900;cursor:pointer;
          display:inline-flex;align-items:center;justify-content:center;padding:0;
          box-shadow:0 2px 8px rgba(239,68,68,0.4);transition:all .12s;opacity:0.4;
        ">■</button>
      </div>
    </div>
    <div style="margin-top:8px;">
      <div style="display:flex;align-items:baseline;gap:6px;">
        <span style="font-size:10px;color:#6b8581;font-weight:600;">Mudanças:</span>
        <span id="asw-steps" style="font-size:22px;font-weight:800;color:#3b82f6;font-family:'JetBrains Mono',monospace;line-height:1;">0</span>
        <span style="color:#3a4d4a;font-size:14px;">/</span>
        <span id="asw-total" style="color:#ff9900;font-weight:700;font-size:14px;font-family:'JetBrains Mono',monospace;">0</span>
      </div>
      <div style="display:flex;align-items:baseline;gap:6px;margin-top:4px;">
        <span style="font-size:10px;color:#6b8581;font-weight:600;">Valor Estimado:</span>
        <span id="asw-estimated" style="font-size:16px;font-weight:700;color:#14b89e;font-family:'JetBrains Mono',monospace;">—</span>
      </div>
    </div>
    <div style="width:100%;height:4px;background:#1f2d2b;border-radius:2px;margin-top:8px;overflow:hidden;">
      <div id="asw-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#14b89e,#ff9900);border-radius:2px;transition:width .2s;"></div>
    </div>
    <div id="asw-rem" style="font-size:10px;color:#6b8581;margin-top:6px;text-align:center;letter-spacing:0.4px;">Pronto para iniciar</div>
  `;
  widget.style.cssText = `
    position:fixed;bottom:16px;right:16px;z-index:2147483647;
    background:linear-gradient(160deg,#0c1716 0%,#0a0f0e 100%);
    border:1px solid rgba(255,153,0,0.25);
    border-radius:10px;padding:12px 14px;min-width:220px;
    font-family:'Outfit',-apple-system,sans-serif;
    box-shadow:0 8px 32px rgba(0,0,0,0.55);backdrop-filter:blur(12px);
    display:flex;flex-direction:column;user-select:none;
  `;
  let drag = false, dx = 0, dy = 0;
  widget.querySelector("#asw-hdr").addEventListener("mousedown", (e) => {
    if (e.target.tagName === "BUTTON" || e.target.tagName === "IMG") return;
    drag = true; dx = e.clientX - widget.getBoundingClientRect().left; dy = e.clientY - widget.getBoundingClientRect().top;
  });
  document.addEventListener("mousemove", (e) => {
    if (!drag) return;
    widget.style.left = (e.clientX-dx)+"px"; widget.style.top = (e.clientY-dy)+"px";
    widget.style.right = "auto"; widget.style.bottom = "auto";
  });
  document.addEventListener("mouseup", () => { drag = false; });
  document.body.appendChild(widget);

  // PLAY / PAUSE button
  const playBtn = widget.querySelector("#asw-play-btn");
  playBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (monitoring && !hasStopped) {
      // toggle pause/resume
      if (isPaused) {
        isPaused = false;
        const resumeBtn = continueButtonPosition || buttonPosition;
        if (resumeBtn) clickAt(resumeBtn);
        prevPixelData = null;
        if (!pollInterval) {
          pollInterval = setInterval(() => { if (monitoring && !hasStopped && !isPaused) requestScreenshot(); }, POLL_MS);
        }
        setTimeout(() => requestScreenshot(), 500);
      } else {
        isPaused = true;
        if (buttonPosition) clickAt(buttonPosition);
        if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
      }
      updateWidget();
    } else {
      // start
      hasStopped = false;
      chrome.runtime.sendMessage({ type: "WIDGET_START_REQUEST" });
    }
  });

  // STOP button — para e reseta
  const stopBtn = widget.querySelector("#asw-stop-btn");
  stopBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!monitoring && !hasStopped) return;
    stopAutoClicker();
    if (buttonPosition && monitoring) clickAt(buttonPosition);
    stopMonitoring();
    steps = 0;
    hasStopped = false;
    updateWidget();
    chrome.runtime.sendMessage({ type: "WIDGET_STOPPED" });
  });
}


function updateWidget() {
  if (!widget) return;
  const stepsEl = widget.querySelector("#asw-steps");
  const totalEl = widget.querySelector("#asw-total");
  const estEl = widget.querySelector("#asw-estimated");
  const rem = widget.querySelector("#asw-rem");
  const bar = widget.querySelector("#asw-bar");
  const playBtn = widget.querySelector("#asw-play-btn");
  const stopBtn = widget.querySelector("#asw-stop-btn");

  const remaining = Math.max(0, targetSteps - steps);

  if (stepsEl) stepsEl.textContent = steps;
  if (totalEl) totalEl.textContent = targetSteps || 0;

  const estimated = betValue > 0 ? (steps * betValue) : null;
  if (estEl) estEl.textContent = estimated !== null ? `R$ ${estimated.toFixed(2)}` : "—";
  if (rem) rem.textContent = hasStopped ? "✅ Meta atingida!" : isPaused ? "⏸ Pausado" : monitoring ? `${remaining} restantes` : "Pronto para iniciar";
  if (bar && targetSteps > 0) bar.style.width = Math.min(100, (steps / targetSteps) * 100) + "%";

  // Play/Pause button
  if (playBtn) {
    if (monitoring && !hasStopped) {
      if (isPaused) {
        playBtn.textContent = "▶";
        playBtn.title = "Continuar";
        playBtn.style.background = "linear-gradient(135deg,#038c7a,#14b89e)";
        playBtn.style.boxShadow = "0 2px 8px rgba(3,140,122,0.4)";
        playBtn.style.color = "#fff";
      } else {
        playBtn.textContent = "⏸";
        playBtn.title = "Pausar";
        playBtn.style.background = "linear-gradient(135deg,#f59e0b,#ff9900)";
        playBtn.style.boxShadow = "0 2px 8px rgba(245,158,11,0.4)";
        playBtn.style.color = "#1a1a1a";
      }
    } else {
      playBtn.textContent = "▶";
      playBtn.title = "Iniciar";
      playBtn.style.background = "linear-gradient(135deg,#038c7a,#14b89e)";
      playBtn.style.boxShadow = "0 2px 8px rgba(3,140,122,0.4)";
      playBtn.style.color = "#fff";
    }
  }

  // Stop button — habilitado só quando monitorando
  if (stopBtn) {
    const enabled = monitoring && !hasStopped;
    stopBtn.disabled = !enabled;
    stopBtn.style.opacity = enabled ? "1" : "0.4";
    stopBtn.style.cursor = enabled ? "pointer" : "not-allowed";
  }
}


// ── Monitoring ──
function startMonitoring() {
  if (monitoring) return;
  monitoring = true;
  hasStopped = false;
  isPaused = false;
  steps = 0;
  prevPixelData = null;
  lastStepAt = 0;

  chrome.storage.local.get([`mapping_${host}`], (data) => {
    const saved = data[`mapping_${host}`];
    if (saved) {
      if (!counterRegion) counterRegion = normalizeRegion(saved.counterRegion);
      if (!buttonPosition) buttonPosition = normalizePos(saved.buttonPosition);
      if (!continueButtonPosition) continueButtonPosition = normalizePos(saved.continueButtonPosition);
    }

    if (!counterRegion) {
      monitoring = false;
      console.error("[Content] Sem região de contador mapeada!");
      return;
    }

    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }

    createWidget();
    updateWidget();
    console.log("[Content] ⚡ Pixel Monitor iniciado | Steps necessários:", targetSteps);
    console.log("[Content] Região:", counterRegion);
    startStepDetection();
  });
}

function stopMonitoring() {
  monitoring = false;
  isPaused = false;
  stopFallbackPolling();
  if (!hasStopped) stopBackgroundStreamMonitor();
  prevPixelData = null;
  lastStepAt = 0;
  
  if (widget && !hasStopped) {
    const dot = widget.querySelector("#asw-dot");
    if (dot) { dot.textContent = "⏸ PAUSADO"; dot.style.color = "#f59e0b"; }
  }
}
