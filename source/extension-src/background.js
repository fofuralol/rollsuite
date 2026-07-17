// Background service worker — handles tab capture stream and dashboard sync
let offscreenReady = false;
let lastCaptureTime = 0;
const MIN_CAPTURE_INTERVAL = 150;

const SUPABASE_URL = "https://zgbybodkkakaswmaroko.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpnYnlib2Rra2FrYXN3bWFyb2tvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2NDgyNjIsImV4cCI6MjA5MDIyNDI2Mn0.LFo6yOWrnx8bOBiwzQOdvpCrjYEflkVlVwjOcdSXY0M";
const DEFAULT_WEBHOOK_URL = "https://pmwevrhnoxnbcuslkeid.supabase.co/functions/v1/meta-webhook?token=COLE_SEU_TOKEN_AQUI";
const WEBHOOK_TOKEN_PLACEHOLDER = "COLE_SEU_TOKEN_AQUI";

const syncQueue = [];
let syncInFlight = false;
let lastQueuedStep = -1;
let lastSentStep = -1;
let monitorTabId = null;

function processSyncQueue() {
  if (syncInFlight || syncQueue.length === 0) return;

  const step = syncQueue.shift();
  syncInFlight = true;

  chrome.storage.local.get(["dashUserId", "dashDbRowId", "dashMaeId", "dashFilhaId"], (data) => {
    if (!data.dashUserId || !data.dashDbRowId || !data.dashMaeId || data.dashFilhaId == null) {
      syncInFlight = false;
      processSyncQueue();
      return;
    }

    fetch(`${SUPABASE_URL}/functions/v1/extension-roll-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY },
      body: JSON.stringify({
        user_id: data.dashUserId,
        tabela_id: data.dashDbRowId,
        mae_id: data.dashMaeId,
        conta_id: Number(data.dashFilhaId),
        giros_feitos: step,
      }),
    })
      .then((r) => {
        if (r.ok) {
          lastSentStep = step;
          console.log("[BG] Sync OK:", step);
        } else {
          console.warn("[BG] Sync failed:", r.status, "step:", step);
        }
      })
      .catch((e) => console.error("[BG] Sync error:", e))
      .finally(() => {
        syncInFlight = false;
        processSyncQueue();
      });
  });
}

function syncStep(steps) {
  const normalized = Number.isFinite(steps) ? Math.max(0, Math.floor(steps)) : 0;
  const highestKnownStep = Math.max(lastQueuedStep, lastSentStep);
  if (normalized <= highestKnownStep) return;

  syncQueue.push(normalized);
  lastQueuedStep = normalized;
  processSyncQueue();
}

async function ensureOffscreen() {
  if (offscreenReady) return;
  const existing = await chrome.offscreen.hasDocument?.() || false;
  if (!existing) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["USER_MEDIA"],
      justification: "Tab capture for pixel monitoring in background",
    });
  }
  offscreenReady = true;
}

async function startStreamMonitor(tabId, region, sendResponse) {
  monitorTabId = tabId;
  try {
    await ensureOffscreen();
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    chrome.runtime.sendMessage(
      {
        type: "START_STREAM_MONITOR",
        streamId,
        tabId,
        region,
      },
      (res) => {
        if (chrome.runtime.lastError) {
          console.error("[BG] Erro ao iniciar offscreen stream:", chrome.runtime.lastError.message);
          if (sendResponse) sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        console.log("[BG] Stream monitor iniciado para tab", tabId, res);
        if (sendResponse) sendResponse(res?.ok ? { ok: true } : { ok: false, error: res?.error || "offscreen failed" });
      }
    );
  } catch (e) {
    console.error("[BG] Erro ao iniciar stream:", e);
    if (sendResponse) sendResponse({ ok: false, error: e.message });
  }
}

function stopStreamMonitor() {
  monitorTabId = null;
  chrome.runtime.sendMessage({ type: "STOP_STREAM_MONITOR" });
  console.log("[BG] Stream monitor parado");
}

function requestOcrFromOffscreen() {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const imageDataUrl = arguments[0];
    ensureOffscreen()
      .then(() => {
        try {
          chrome.runtime.sendMessage({ type: "RUN_OCR_NOW", imageDataUrl }, (res) => {
            if (chrome.runtime.lastError) {
              console.warn("[BG] OCR err:", chrome.runtime.lastError.message);
              finish(null);
            } else finish(res || null);
          });
        } catch (e) { finish(null); }
      })
      .catch((e) => {
        console.warn("[BG] ensureOffscreen falhou para OCR:", e?.message || e);
        finish(null);
      });
    setTimeout(() => finish(null), 20000);
  });
}

function normalizeTargetMessage(msg) {
  const steps = msg && (msg.steps ?? msg.giros);
  const target = msg && (msg.target ?? msg.targetSteps);
  const balance = msg && msg.balance != null ? Number(msg.balance) : null;
  const balanceRaw = msg && msg.balance_raw ? String(msg.balance_raw) : null;
  return {
    ...msg,
    steps: steps != null ? Number(steps) : null,
    target: target != null ? Number(target) : null,
    balance: Number.isFinite(balance) ? balance : null,
    balance_raw: balanceRaw || null,
  };
}

function getWebhookParts(url) {
  try {
    const parsed = new URL(String(url || ""));
    return { host: parsed.host, token: parsed.searchParams.get("token") || "" };
  } catch {
    return null;
  }
}

function shouldResetWebhookUrl(savedUrl) {
  if (!savedUrl) return true;
  const saved = getWebhookParts(savedUrl);
  const fallback = getWebhookParts(DEFAULT_WEBHOOK_URL);
  if (!saved || !fallback) return true;
  if (saved.host !== fallback.host) return true;
  if (!saved.token || saved.token === WEBHOOK_TOKEN_PLACEHOLDER) return true;
  if (fallback.token && fallback.token !== WEBHOOK_TOKEN_PLACEHOLDER && saved.token !== fallback.token) return true;
  return false;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  // Legacy screenshot capture (fallback)
  if (msg.type === "CAPTURE_TAB" && tabId) {
    const now = Date.now();
    if (now - lastCaptureTime < MIN_CAPTURE_INTERVAL) {
      sendResponse({ ok: false, throttled: true });
      return false;
    }
    lastCaptureTime = now;

    chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        console.error("[BG] Capture error:", chrome.runtime.lastError.message);
        sendResponse({ ok: false });
        return;
      }
      chrome.tabs.sendMessage(tabId, { type: "SCREENSHOT_RESULT", dataUrl });
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === "CAPTURE_TAB_DIRECT" && tabId) {
    const now = Date.now();
    if (now - lastCaptureTime < MIN_CAPTURE_INTERVAL) {
      sendResponse({ ok: false, throttled: true });
      return false;
    }
    lastCaptureTime = now;

    chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        console.error("[BG] Capture direct error:", chrome.runtime.lastError.message);
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      sendResponse({ ok: true, dataUrl });
    });
    return true;
  }

  // Start stream-based monitoring (works in background)
  if (msg.type === "START_STREAM_MONITOR_REQUEST" && tabId) {
    startStreamMonitor(tabId, msg.region, sendResponse);
    return true; // async response
  }

  // Stop stream monitoring
  if (msg.type === "STOP_STREAM_MONITOR_REQUEST") {
    stopStreamMonitor();
    sendResponse({ ok: true });
    return false;
  }

  // Pixel changed detected by offscreen — forward to content script
  if (msg.type === "PIXEL_CHANGED") {
    const targetTab = msg.tabId || monitorTabId;
    if (targetTab) {
      chrome.tabs.sendMessage(targetTab, { type: "STREAM_PIXEL_CHANGED" });
    }
    return false;
  }

  if (msg.type === "DASH_SYNC_STEP") {
    syncStep(msg.steps);
    return false;
  }

  // Widget start request — load saved settings and trigger START_MONITOR
  if (msg.type === "WIDGET_START_REQUEST" && tabId) {
    chrome.storage.local.get(["targetValue", "betValue"], (data) => {
      const target = parseInt(data.targetValue) || 100;
      const bet = parseFloat(data.betValue) || 0;
      chrome.tabs.sendMessage(tabId, {
        type: "START_MONITOR",
        targetSteps: target,
        betValue: bet,
      });
    });
    return false;
  }

  // Widget stopped — notify popup
  if (msg.type === "WIDGET_STOPPED") {
    stopStreamMonitor();
    return false;
  }

  if (msg.type === "PASSIVE_UPDATE" && tabId) {
    const remaining = msg.remaining;
    if (remaining != null) {
      chrome.action.setBadgeText({ text: String(remaining), tabId });
      chrome.action.setBadgeBackgroundColor({ color: remaining === 0 ? "#22c55e" : "#f59e0b", tabId });
    }
    return false;
  }

  if (msg.type === "TARGET_REACHED" && tabId) {
    chrome.action.setBadgeText({ text: "✓", tabId });
    chrome.action.setBadgeBackgroundColor({ color: "#22c55e", tabId });
    // Lê saldo via OCR (antes de parar o stream do offscreen)
    requestOcrFromOffscreen(msg.mapped_frame_data_url || null)
      .catch(() => null)
      .then((ocr) => {
        notifyTargetReached(tabId, { ...msg, balance: ocr?.balance ?? null, balance_raw: ocr?.balance_raw ?? null });
        stopStreamMonitor();
      });
    return false;
  }

  // Botão de teste no popup — dispara fake "meta atingida"
  if (msg.type === "TEST_TARGET_REACHED") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const t = tabs && tabs[0];
      const targetTabId = t?.id || tabId || 0;
      notifyTargetReached(targetTabId, {
        steps: msg.steps ?? 99,
        target: msg.target ?? 99,
      }, (result) => {
        try { sendResponse(result); } catch {}
      });
    });
    return true;
  }

  return false;
});


// ===== Notificação de meta atingida =====
function notifyTargetReached(tabId, msg, done) {
  try {
    const normalized = normalizeTargetMessage(msg);
    chrome.tabs.get(tabId, (tab) => {
      const tabTitle = (tab && tab.title) || "Aba";
      const tabUrl = (tab && tab.url) || "";
      const steps = normalized.steps;
      const target = normalized.target;
      const balance = normalized.balance;
      const balanceRaw = normalized.balance_raw;
      const balanceTxt = balance != null ? ` · R$ ${balance.toFixed(2).replace(".", ",")}` : (balanceRaw ? ` · ${balanceRaw}` : "");
      const bodyTxt = `${tabTitle}${steps != null ? ` — ${steps}${target ? "/" + target : ""} giros` : ""}${balanceTxt}`;

      // Notificação nativa do Chrome (toca som do SO mesmo com a aba mutada)
      try {
        const notifId = `target-${tabId}-${Date.now()}`;
        chrome.notifications.create(notifId, {
          type: "basic",
          iconUrl: "icon-logo.png",
          title: "🎯 Meta atingida!",
          message: bodyTxt,
          priority: 2,
          requireInteraction: false,
        }, () => {
          setTimeout(() => { try { chrome.notifications.clear(notifId); } catch {} }, 3000);
        });
      } catch (e) { console.warn("[BG] notif err", e); }

      chrome.storage.local.get(["webhookUrl"], async (data) => {
        let url = (data.webhookUrl && data.webhookUrl.trim()) || DEFAULT_WEBHOOK_URL;
        if (shouldResetWebhookUrl(url)) {
          const oldParts = getWebhookParts(url);
          const newParts = getWebhookParts(DEFAULT_WEBHOOK_URL);
          console.warn("[BG] webhookUrl inválido/obsoleto — resetando", oldParts?.host, "→", newParts?.host);
          url = DEFAULT_WEBHOOK_URL;
          chrome.storage.local.set({ webhookUrl: DEFAULT_WEBHOOK_URL });
        }
        const parts = getWebhookParts(url);
        if (!parts?.token || parts.token === WEBHOOK_TOKEN_PLACEHOLDER) {
          const error = "Token do webhook não foi injetado na extensão";
          console.warn("[BG] webhook bloqueado:", error);
          done?.({ ok: false, error });
          return;
        }
        // 1) Envio local: tenta o app rodando em 127.0.0.1 (offline-friendly).
        //    Fire-and-forget — não bloqueia o webhook cloud.
        const localPayload = {
          token: parts.token,
          id: `ext-${tabId}-${Date.now()}`,
          event: "target_reached",
          tab_id: tabId,
          source_tab_id: tabId,
          tab_title: tabTitle,
          tab_url: tabUrl,
          url: tabUrl,
          title: tabTitle,
          steps: steps ?? null,
          target: target ?? null,
          balance,
          balance_raw: balanceRaw,
          timestamp: new Date().toISOString(),
        };
        const localPorts = [47821, 47822, 47823, 47824, 47825];
        let localOk = false;
        for (const p of localPorts) {
          try {
            const lr = await fetch(`http://127.0.0.1:${p}/meta`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(localPayload),
              signal: AbortSignal.timeout ? AbortSignal.timeout(1200) : undefined,
            });
            if (lr.ok) { localOk = true; console.log("[BG] meta local OK :", p); break; }
            if (lr.status === 401 || lr.status === 503) break; // token errado ou desativado
          } catch {}
        }

        // 2) Cloud: continua enviando pro webhook (a menos que só local esteja ligado no app).
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "target_reached",
            tab_id: tabId,
            tab_title: tabTitle,
            tab_url: tabUrl,
            url: tabUrl,
            title: tabTitle,
            steps: steps ?? null,
            target: target ?? null,
            balance,
            balance_raw: balanceRaw,
            timestamp: new Date().toISOString(),
          }),
        }).then(async (r) => {
          if (r.ok) {
            console.log("[BG] webhook OK", r.status);
            done?.({ ok: true, status: r.status, local: localOk });
            return;
          }
          const text = await r.text().catch(() => "");
          console.warn("[BG] webhook", r.status, text);
          done?.({ ok: localOk, status: r.status, error: text || `HTTP ${r.status}`, local: localOk });
        }).catch((e) => {
          console.warn("[BG] webhook err", e);
          done?.({ ok: localOk, error: e?.message || String(e), local: localOk });
        });
      });
    });
  } catch (e) {
    console.warn("[BG] notifyTargetReached err", e);
    done?.({ ok: false, error: e?.message || String(e) });
  }
}

// Foca a aba ao clicar na notificação
chrome.notifications?.onClicked?.addListener((notifId) => {
  const m = /^target-(\d+)-/.exec(notifId);
  if (!m) return;
  const tabId = parseInt(m[1]);
  chrome.tabs.update(tabId, { active: true }, () => {
    chrome.tabs.get(tabId, (t) => t && chrome.windows.update(t.windowId, { focused: true }));
  });
  chrome.notifications.clear(notifId);
});

// ===== Click no ícone da extensão -> toggle overlay injetado =====
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_ROLLSUITE_PANEL" });
  } catch (e) {
    // content script ainda não carregado nessa aba — injeta e tenta de novo
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_ROLLSUITE_PANEL" });
    } catch (err) {
      console.warn("[BG] não foi possível abrir o painel nesta aba:", err?.message);
    }
  }
});
