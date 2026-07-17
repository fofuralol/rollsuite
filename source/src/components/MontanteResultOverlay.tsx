import { useEffect, useRef, useState } from "react";
import { IS_DESKTOP } from "@/lib/runtime";
import coinsSound from "@/assets/coins.mp3.asset.json";
import wastedSound from "@/assets/wasted.mp3.asset.json";
import seFudeuImg from "@/assets/se-fudeu.png.asset.json";
import { loadMontanteSettings } from "@/lib/montanteSettings";

type Kind = "lucro" | "prejuizo";

export type MontanteResultDetail = { kind: Kind };

const DEFAULT_DURATION_MS = 3000;
const COIN_COUNT = 40;

function Coins() {
  const coins = Array.from({ length: COIN_COUNT });
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {coins.map((_, i) => {
        const left = Math.random() * 100;
        const delay = Math.random() * 1.2;
        const duration = 1.6 + Math.random() * 1.4;
        const size = 24 + Math.random() * 28;
        const rotate = Math.random() * 720 - 360;
        return (
          <div
            key={i}
            style={{
              left: `${left}%`,
              top: `-60px`,
              width: size,
              height: size,
              animation: `coin-fall ${duration}s linear ${delay}s forwards`,
              ["--coin-rot" as any]: `${rotate}deg`,
            }}
            className="absolute rounded-full bg-gradient-to-br from-yellow-300 via-yellow-500 to-yellow-700 shadow-[0_0_12px_rgba(250,200,40,0.8)] border-2 border-yellow-200 flex items-center justify-center text-yellow-900 font-black"
          >
            $
          </div>
        );
      })}
    </div>
  );
}

export default function MontanteResultOverlay() {
  const [active, setActive] = useState<Kind | null>(null);
  const [duration, setDuration] = useState<number>(DEFAULT_DURATION_MS);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<number | null>(null);


  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<MontanteResultDetail>).detail;
      if (!detail) return;
      // Stop previous
      if (timerRef.current) window.clearTimeout(timerRef.current);
      if (audioRef.current) { try { audioRef.current.pause(); } catch {} }

      const settings = loadMontanteSettings();
      const effectiveDuration = settings.durationMs;
      setDuration(effectiveDuration);

      if (settings.animationsEnabled) {
        setActive(detail.kind);
      }

      const custom = settings.customAudio[detail.kind];
      const rawUrl = detail.kind === "lucro" ? coinsSound.url : wastedSound.url;
      let src: string;
      if (custom) {
        src = custom;
      } else if (rawUrl.startsWith("http")) {
        src = rawUrl;
      } else if (typeof window !== "undefined" && window.location.protocol === "file:") {
        src = `https://calculadora-de-roll.lovable.app${rawUrl}`;
      } else {
        src = rawUrl;
      }
      const audio = new Audio(src);
      if (!src.startsWith("data:")) audio.crossOrigin = "anonymous";
      audio.volume = settings.volume;
      audioRef.current = audio;
      audio.play().catch((err) => console.warn("[MontanteResult] audio play failed:", err, src));

      timerRef.current = window.setTimeout(() => {
        setActive(null);
        try { audio.pause(); } catch {}
      }, effectiveDuration);
    };

    window.addEventListener("montante-result", handler as EventListener);
    return () => {
      window.removeEventListener("montante-result", handler as EventListener);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      if (audioRef.current) { try { audioRef.current.pause(); } catch {} }
    };
  }, []);

  if (!active) return null;

  return (
    <>
      <style>{`
        @keyframes coin-fall {
          0% { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(110vh) rotate(var(--coin-rot)); opacity: 1; }
        }
        @keyframes flash-green {
          0%, 100% { background-color: rgba(34,197,94,0); }
          20%, 60% { background-color: rgba(34,197,94,0.45); }
        }
        @keyframes flash-red {
          0%, 100% { background-color: rgba(220,20,20,0); }
          15%, 55% { background-color: rgba(220,20,20,0.55); }
        }
        @keyframes wasted-in {
          0% { transform: translate(-50%,-50%) scale(0.2) rotate(-8deg); opacity: 0; filter: blur(8px); }
          60% { transform: translate(-50%,-50%) scale(1.15) rotate(-4deg); opacity: 1; filter: blur(0); }
          100% { transform: translate(-50%,-50%) scale(1) rotate(-4deg); opacity: 1; }
        }
      `}</style>
      <div
        className="fixed inset-0 z-[9999] pointer-events-none"
        style={{
          animation: active === "lucro"
            ? `flash-green ${duration}ms ease-in-out`
            : `flash-red ${duration}ms ease-in-out`,
        }}
      >
        {active === "lucro" && <Coins />}
        {active === "prejuizo" && (
          <div
            className="absolute left-1/2 top-1/2"
            style={{
              animation: `wasted-in 900ms cubic-bezier(.2,.9,.2,1) forwards`,
              transform: "translate(-50%,-50%)",
            }}
          >
            <img
              src={
                seFudeuImg.url.startsWith("http")
                  ? seFudeuImg.url
                  : (typeof window !== "undefined" && window.location.protocol === "file:")
                    ? `https://calculadora-de-roll.lovable.app${seFudeuImg.url}`
                    : seFudeuImg.url
              }
              alt="se fudeu"
              draggable={false}
              className="select-none pointer-events-none"
              style={{
                width: "min(80vw, 1400px)",
                height: "auto",
                filter: "drop-shadow(0 0 40px rgba(0,0,0,0.85)) drop-shadow(0 0 80px rgba(220,0,0,0.5))",
              }}
            />

          </div>
        )}
      </div>
    </>
  );
}

export function triggerMontanteResult(kind: Kind) {
  if (!IS_DESKTOP) return;
  window.dispatchEvent(new CustomEvent<MontanteResultDetail>("montante-result", { detail: { kind } }));
}
