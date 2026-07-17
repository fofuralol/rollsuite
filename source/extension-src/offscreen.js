// Offscreen document — captures tab video stream and detects pixel changes at high frequency
let stream = null;
let monitorInterval = null;
let video = null;
let canvas = null;
let ctx = null;
let prevPixelData = null;
let monitorTabId = null;
let monitorRegion = null; // { xRatio, yRatio, wRatio, hRatio }

const SAMPLE_INTERVAL = 30; // ms — ultra-fast polling
const CHANGE_THRESHOLD = 30; // minimum pixel value difference to count as change
const MIN_CHANGED_PIXELS = 3; // minimum pixels that must change
// Anti double-count: depois de detectar mudança, esperamos a região "estabilizar"
// (N frames consecutivos sem mudança) antes de aceitar a próxima detecção.
// Isso evita que o brilho/animação do slot ao pagar dispare múltiplos eventos.
const STABILIZATION_FRAMES = 6; // ~180ms de estabilidade exigida (6 * 30ms)
const POST_CHANGE_LOCKOUT_MS = 600; // tempo mínimo antes de aceitar próxima mudança
let lastChangeAt = 0;
let stableFrames = STABILIZATION_FRAMES;
let baselinePixelData = null; // baseline "estável" (não atualizada durante animação)

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "START_STREAM_MONITOR") {
    startMonitor(msg.streamId, msg.tabId, msg.region, sendResponse);
    return true;
  }
  if (msg.type === "STOP_STREAM_MONITOR") {
    stopMonitor();
    return false;
  }
  if (msg.type === "RUN_OCR_NOW") {
    runOcrOnCurrentFrame(msg.imageDataUrl || null).then((res) => sendResponse(res || { ok: false })).catch((e) => {
      console.warn("[Offscreen] OCR err", e);
      sendResponse({ ok: false, error: String(e?.message || e) });
    });
    return true;
  }
  return false;
});

// ===== OCR on demand (saldo na região mapeada) =====
let ocrWorker = null;
let ocrWorkerPromise = null;
let lastRegionSnapshot = null;
let lastDetectedSnapshot = null;

function cloneRegionSnapshot(pixels, width, height, capturedAt = Date.now()) {
  return {
    pixels: new Uint8ClampedArray(pixels),
    width,
    height,
    capturedAt,
  };
}

function buildSnapshotFromCurrentFrame() {
  if (!video || !ctx || !monitorRegion || video.videoWidth === 0) return null;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const rx = Math.round(monitorRegion.xRatio * vw);
  const ry = Math.round(monitorRegion.yRatio * vh);
  const rw = Math.max(1, Math.round(monitorRegion.wRatio * vw));
  const rh = Math.max(1, Math.round(monitorRegion.hRatio * vh));
  ctx.drawImage(video, 0, 0, vw, vh);
  const imageData = ctx.getImageData(rx, ry, rw, rh);
  return cloneRegionSnapshot(imageData.data, rw, rh);
}

async function buildOcrBlob(snapshot, { threshold = false } = {}) {
  const scale = 6;
  const pad = 18;
  const tmp = new OffscreenCanvas(snapshot.width, snapshot.height);
  tmp.getContext("2d").putImageData(new ImageData(snapshot.pixels, snapshot.width, snapshot.height), 0, 0);

  const oc = new OffscreenCanvas(snapshot.width * scale + pad * 2, snapshot.height * scale + pad * 2);
  const octx = oc.getContext("2d", { willReadFrequently: true });
  octx.fillStyle = "#ffffff";
  octx.fillRect(0, 0, oc.width, oc.height);
  octx.imageSmoothingEnabled = false;
  octx.drawImage(tmp, pad, pad, snapshot.width * scale, snapshot.height * scale);

  if (threshold) {
    const processed = octx.getImageData(0, 0, oc.width, oc.height);
    const data = processed.data;
    for (let i = 0; i < data.length; i += 4) {
      const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      const v = lum > 92 ? 0 : 255;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
    octx.putImageData(processed, 0, 0);
  }

  return oc.convertToBlob({ type: "image/png" });
}

async function recognizeSnapshot(snapshot) {
  const worker = await getOcrWorker();
  const variants = [
    { label: "threshold", blob: await buildOcrBlob(snapshot, { threshold: true }) },
    { label: "raw", blob: await buildOcrBlob(snapshot, { threshold: false }) },
  ];

  for (const variant of variants) {
    const res = await worker.recognize(variant.blob);
    const raw = (res?.data?.text || "").trim().replace(/\s+/g, " ");
    if (raw) {
      return { raw, variant: variant.label };
    }
  }

  return { raw: "", variant: "none" };
}

async function snapshotFromDataUrl(dataUrl) {
  if (!dataUrl) return null;
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx2 = canvas.getContext("2d", { willReadFrequently: true });
  ctx2.drawImage(bitmap, 0, 0);
  const img = ctx2.getImageData(0, 0, bitmap.width, bitmap.height);
  return cloneRegionSnapshot(img.data, bitmap.width, bitmap.height);
}

async function getOcrWorker() {
  if (ocrWorker) return ocrWorker;
  if (ocrWorkerPromise) return ocrWorkerPromise;
  if (typeof Tesseract === "undefined") throw new Error("Tesseract não carregado");
  ocrWorkerPromise = (async () => {
    console.log("[Offscreen] Inicializando worker OCR...");
    const t0 = Date.now();
    const w = await Tesseract.createWorker("eng", 1, {
      workerPath: chrome.runtime.getURL("tesseract-worker.min.js"),
      corePath: chrome.runtime.getURL("tesseract-core-simd-lstm.wasm.js"),
      langPath: chrome.runtime.getURL(""),
      cacheMethod: "none",
      gzip: true,
    });
    await w.setParameters({
      tessedit_pageseg_mode: "7",
      preserve_interword_spaces: "1",
    });
    // sem whitelist — lê qualquer texto que estiver na área mapeada
    console.log("[Offscreen] Worker OCR pronto em", Date.now() - t0, "ms");
    ocrWorker = w;
    return w;
  })();
  return ocrWorkerPromise;
}

function parseBalanceNumber(raw) {
  if (!raw) return null;
  const normalized = String(raw).trim();
  if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(normalized)) return null;
  // Captura sequência tipo 1.234,56  /  1234,56  /  1234.56  /  1234
  const m = normalized.match(/(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})|\d+(?:\.\d{1,2})?|\d+)/);
  if (!m) return null;
  let s = m[1];
  // se tem vírgula como decimal → remove pontos de milhar
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

async function runOcrOnCurrentFrame(imageDataUrl = null) {
  const directSnapshot = imageDataUrl ? await snapshotFromDataUrl(imageDataUrl).catch(() => null) : null;
  const snapshot = directSnapshot || lastDetectedSnapshot || lastRegionSnapshot || buildSnapshotFromCurrentFrame();
  if (!snapshot) return { ok: false, error: "sem stream/região" };

  try {
    const t0 = Date.now();
    const { raw, variant } = await recognizeSnapshot(snapshot);
    const value = parseBalanceNumber(raw);
    console.log(
      "[Offscreen] OCR (" + (Date.now() - t0) + "ms):",
      raw || "(vazio)",
      "→",
      value,
      "variant:",
      variant,
      "snapshotAge:",
      Date.now() - snapshot.capturedAt,
      "ms"
    );
    return { ok: true, balance: value, balance_raw: raw };
  } catch (e) {
    console.warn("[Offscreen] OCR failure", e);
    return { ok: false, error: String(e?.message || e) };
  }
}

async function startMonitor(streamId, tabId, region, sendResponse) {
  stopMonitor(); // clean up any previous

  monitorTabId = tabId;
  monitorRegion = region;
  prevPixelData = null;

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
        },
      },
    });

    video = document.getElementById("vid");
    canvas = document.getElementById("cvs");
    ctx = canvas.getContext("2d", { willReadFrequently: true });

    video.srcObject = stream;
    await video.play();

    await new Promise((resolve) => {
      if (video.videoWidth > 0) return resolve();
      video.onloadedmetadata = resolve;
    });

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    monitorInterval = setInterval(samplePixels, SAMPLE_INTERVAL);
    console.log("[Offscreen] Monitoramento pixel iniciado a cada", SAMPLE_INTERVAL, "ms");
    // pré-aquece OCR em background pra estar pronto quando a meta bater
    getOcrWorker().catch((e) => console.warn("[Offscreen] preload OCR falhou", e));
    if (sendResponse) sendResponse({ ok: true });
  } catch (e) {
    console.error("[Offscreen] Erro ao iniciar stream:", e);
    if (sendResponse) sendResponse({ ok: false, error: e.message });
  }
}

function countChanges(a, b) {
  let changed = 0;
  for (let i = 0; i < a.length; i += 4) {
    const dr = Math.abs(a[i] - b[i]);
    const dg = Math.abs(a[i + 1] - b[i + 1]);
    const db = Math.abs(a[i + 2] - b[i + 2]);
    if (dr + dg + db > CHANGE_THRESHOLD) changed++;
  }
  return changed;
}

function samplePixels() {
  if (!video || !ctx || !monitorRegion || video.videoWidth === 0) return;

  const vw = video.videoWidth;
  const vh = video.videoHeight;

  ctx.drawImage(video, 0, 0, vw, vh);

  const rx = Math.round(monitorRegion.xRatio * vw);
  const ry = Math.round(monitorRegion.yRatio * vh);
  const rw = Math.max(1, Math.round(monitorRegion.wRatio * vw));
  const rh = Math.max(1, Math.round(monitorRegion.hRatio * vh));

  const imageData = ctx.getImageData(rx, ry, rw, rh);
  const pixels = imageData.data;
  lastRegionSnapshot = cloneRegionSnapshot(pixels, rw, rh);

  // Inicialização
  if (!baselinePixelData) {
    baselinePixelData = new Uint8ClampedArray(pixels);
    prevPixelData = new Uint8ClampedArray(pixels);
    return;
  }

  const now = Date.now();

  // Comparar com o frame anterior para detectar se a região está "em movimento"
  const changedFromPrev = countChanges(pixels, prevPixelData);
  const isMoving = changedFromPrev >= MIN_CHANGED_PIXELS;

  if (isMoving) {
    // Região mexendo (animação/brilho/transição em curso) — não conta nada agora
    stableFrames = 0;
  } else {
    stableFrames++;
  }

  // Comparar com a baseline estável para saber se houve mudança real
  const changedFromBaseline = countChanges(pixels, baselinePixelData);
  const sinceLast = now - lastChangeAt;

  // Só aceitamos uma nova contagem se:
  //   1. A região está estável agora (sem animação em curso)
  //   2. Tem diferença real vs. baseline anterior
  //   3. Já passou tempo suficiente desde a última contagem (lockout)
  if (
    stableFrames >= STABILIZATION_FRAMES &&
    changedFromBaseline >= MIN_CHANGED_PIXELS &&
    sinceLast >= POST_CHANGE_LOCKOUT_MS
  ) {
    lastChangeAt = now;
    baselinePixelData = new Uint8ClampedArray(pixels); // nova baseline
    lastDetectedSnapshot = cloneRegionSnapshot(pixels, rw, rh, now);
    chrome.runtime.sendMessage({
      type: "PIXEL_CHANGED",
      tabId: monitorTabId,
    });
  }

  prevPixelData = new Uint8ClampedArray(pixels);
}

function stopMonitor() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  if (video) {
    video.srcObject = null;
  }
  prevPixelData = null;
  baselinePixelData = null;
  lastRegionSnapshot = null;
  lastDetectedSnapshot = null;
  stableFrames = STABILIZATION_FRAMES;
  lastChangeAt = 0;
  monitorTabId = null;
  console.log("[Offscreen] Monitoramento parado");
}
