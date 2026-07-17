import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut } from "lucide-react";

const KEY = "ui:zoom";
const STEPS = [0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const BASE_WIDTH = 1280; // abaixo disso, encolhe gradativamente

function applyZoom(z: number) {
  // @ts-ignore - non-standard mas funciona em Chromium/Electron
  document.body.style.zoom = String(z);
  // Quando zoom < 1, o body fica menor visualmente e h-screen (100vh)
  // não preenche a tela; precisamos esticar a raiz para 100/z vh
  // pra que os containers internos (h-full, overflow-auto) calculem certo
  // e o conteúdo desça até o fim sem cortar.
  const vh = 100 / z;
  document.documentElement.style.setProperty("--app-vh", `${vh}vh`);
  document.documentElement.style.height = `${vh}vh`;
  document.body.style.minHeight = `${vh}vh`;
}

export default function ZoomButton() {
  const [userZoom, setUserZoom] = useState<number>(1);

  const recompute = useCallback((uz: number) => {
    const w = window.innerWidth || BASE_WIDTH;
    const autoFactor = Math.min(1, Math.max(0.5, w / BASE_WIDTH));
    applyZoom(uz * autoFactor);
  }, []);

  useEffect(() => {
    let uz = 1;
    try {
      const v = parseFloat(localStorage.getItem(KEY) || "1");
      if (!isNaN(v) && v > 0) uz = v;
    } catch {}
    setUserZoom(uz);
    recompute(uz);
    const onResize = () => recompute(uz);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [recompute]);

  // re-aplica quando userZoom muda + listener com valor atualizado
  useEffect(() => {
    recompute(userZoom);
    const onResize = () => recompute(userZoom);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [userZoom, recompute]);

  const update = (z: number) => {
    const clamped = Math.max(STEPS[0], Math.min(STEPS[STEPS.length - 1], z));
    setUserZoom(clamped);
    try { localStorage.setItem(KEY, String(clamped)); } catch {}
  };

  const step = (dir: 1 | -1) => {
    const idx = STEPS.findIndex((s) => Math.abs(s - userZoom) < 0.001);
    const cur = idx >= 0 ? idx : STEPS.findIndex((s) => s >= userZoom);
    const next = Math.max(0, Math.min(STEPS.length - 1, (cur < 0 ? STEPS.indexOf(1) : cur) + dir));
    update(STEPS[next]);
  };

  return (
    <div className="flex items-center gap-0.5">
      <Button variant="ghost" size="sm" className="h-9 w-9 p-0" onClick={() => step(-1)} title="Diminuir zoom">
        <ZoomOut className="w-4 h-4" />
      </Button>
      <button
        onClick={() => update(1)}
        className="text-xs tabular-nums w-10 text-center text-muted-foreground hover:text-foreground"
        title="Resetar zoom (auto-ajusta com o tamanho da janela)"
      >
        {Math.round(userZoom * 100)}%
      </button>
      <Button variant="ghost" size="sm" className="h-9 w-9 p-0" onClick={() => step(1)} title="Aumentar zoom">
        <ZoomIn className="w-4 h-4" />
      </Button>
    </div>
  );
}
