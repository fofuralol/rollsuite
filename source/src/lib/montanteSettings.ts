// Settings for the Montante result overlay (desktop animations/sounds).
// Persisted in localStorage. Custom audios are stored as data URLs.

export type Kind = "lucro" | "prejuizo";

export type MontanteSettings = {
  volume: number; // 0..1
  animationsEnabled: boolean;
  durationMs: number; // 500..10000
  customAudio: { lucro: string | null; prejuizo: string | null };
};

const KEY = "montante-settings-v1";

export const DEFAULTS: MontanteSettings = {
  volume: 0.85,
  animationsEnabled: true,
  durationMs: 3000,
  customAudio: { lucro: null, prejuizo: null },
};

export function loadMontanteSettings(): MontanteSettings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return {
      volume: typeof parsed.volume === "number" ? Math.max(0, Math.min(1, parsed.volume)) : DEFAULTS.volume,
      animationsEnabled: parsed.animationsEnabled !== false,
      durationMs: typeof parsed.durationMs === "number" ? Math.max(500, Math.min(15000, parsed.durationMs)) : DEFAULTS.durationMs,
      customAudio: {
        lucro: parsed?.customAudio?.lucro ?? null,
        prejuizo: parsed?.customAudio?.prejuizo ?? null,
      },
    };
  } catch {
    return DEFAULTS;
  }
}

export function saveMontanteSettings(s: MontanteSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    window.dispatchEvent(new CustomEvent("montante-settings-changed"));
  } catch (e) {
    console.warn("[montanteSettings] save failed", e);
  }
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
