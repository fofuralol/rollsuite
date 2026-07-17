// Settings for WhatsApp message narration (TTS).
export type WaNarrationSettings = {
  enabled: boolean;
  volume: number; // 0..1
};

const KEY = "wa-narration-settings-v1";
export const DEFAULTS: WaNarrationSettings = { enabled: true, volume: 1 };

export function loadWaNarration(): WaNarrationSettings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const p = JSON.parse(raw);
    return {
      enabled: p.enabled !== false,
      volume: typeof p.volume === "number" ? Math.max(0, Math.min(1, p.volume)) : 1,
    };
  } catch { return DEFAULTS; }
}

export function saveWaNarration(s: WaNarrationSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    window.dispatchEvent(new CustomEvent("wa-narration-changed"));
  } catch {}
}
