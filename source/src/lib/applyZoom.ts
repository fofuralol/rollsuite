// Aplica o zoom salvo o mais cedo possível (antes do primeiro paint),
// pra não depender do ZoomButton ser montado.
const KEY = "ui:zoom";
const BASE_WIDTH = 1280;

export function applyStoredZoom() {
  let uz = 1;
  try {
    const v = parseFloat(localStorage.getItem(KEY) || "1");
    if (!isNaN(v) && v > 0) uz = v;
  } catch {}
  const w = window.innerWidth || BASE_WIDTH;
  const autoFactor = Math.min(1, Math.max(0.5, w / BASE_WIDTH));
  const z = uz * autoFactor;
  // @ts-ignore
  document.body.style.zoom = String(z);
  const vh = 100 / z;
  document.documentElement.style.setProperty("--app-vh", `${vh}vh`);
  document.documentElement.style.height = `${vh}vh`;
  document.body.style.minHeight = `${vh}vh`;
}

// re-aplica quando a janela redimensiona (Electron sem ZoomButton montado ainda)
let bound = false;
export function bindZoomAutoResize() {
  if (bound) return;
  bound = true;
  window.addEventListener("resize", () => applyStoredZoom());
}
