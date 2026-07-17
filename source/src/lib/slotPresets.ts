// Presets de Slot (botões "Bikini Party", "Jade", etc.) configuráveis pelo usuário.
// Aplicam rollover/bet padrão em todas as linhas do grupo.
export interface SlotPreset {
  id: string;
  name: string;
  rollover: string;
  bet: string;
  color: string; // tailwind base color name: pink, emerald, blue, amber, purple, cyan, rose, sky, lime
}

const STORAGE_KEY = "calc_slot_presets_v1";

export const DEFAULT_PRESETS: SlotPreset[] = [
  { id: "bikini", name: "Bikini Party", rollover: "2,1", bet: "0,81", color: "pink" },
  { id: "jade", name: "Jade", rollover: "2,7", bet: "0,78", color: "emerald" },
];

export const PRESET_COLORS = [
  "pink", "emerald", "blue", "amber", "purple",
  "cyan", "rose", "sky", "lime", "orange", "violet",
] as const;

export type PresetColor = (typeof PRESET_COLORS)[number];

export function colorClasses(color: string) {
  // border + text + hover bg — usa classes literais p/ Tailwind capturar no build
  switch (color) {
    case "pink": return "border-pink-500/40 text-pink-300 hover:bg-pink-500/10";
    case "emerald": return "border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10";
    case "blue": return "border-blue-500/40 text-blue-300 hover:bg-blue-500/10";
    case "amber": return "border-amber-500/40 text-amber-300 hover:bg-amber-500/10";
    case "purple": return "border-purple-500/40 text-purple-300 hover:bg-purple-500/10";
    case "cyan": return "border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10";
    case "rose": return "border-rose-500/40 text-rose-300 hover:bg-rose-500/10";
    case "sky": return "border-sky-500/40 text-sky-300 hover:bg-sky-500/10";
    case "lime": return "border-lime-500/40 text-lime-300 hover:bg-lime-500/10";
    case "orange": return "border-orange-500/40 text-orange-300 hover:bg-orange-500/10";
    case "violet": return "border-violet-500/40 text-violet-300 hover:bg-violet-500/10";
    default: return "border-muted text-foreground hover:bg-muted/40";
  }
}

export function loadSlotPresets(): SlotPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PRESETS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_PRESETS;
    return parsed;
  } catch {
    return DEFAULT_PRESETS;
  }
}

export function saveSlotPresets(list: SlotPreset[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch {}
  try { window.dispatchEvent(new Event("slot-presets:changed")); } catch {}
}
