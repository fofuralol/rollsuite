// Faixas de promoção globais (compartilhadas entre Monitor e DK Dash)
export type PromoTier = { min: number; max?: number | null; pct: number };

const TIERS_KEY = "promo:tiers";
const FIXED_KEY = "dkdash:promo-rate";

export const DEFAULT_TIERS: PromoTier[] = [
  { min: 500, max: 799, pct: 0.19 },
  { min: 800, max: 999, pct: 0.18 },
  { min: 1000, max: null, pct: 0.17 },
];

export function loadPromoTiers(): PromoTier[] {
  try {
    const raw = localStorage.getItem(TIERS_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length > 0) {
        return arr.map((t: any) => ({
          min: Number(t.min) || 0,
          max: t.max == null || t.max === "" ? null : Number(t.max),
          pct: Number(t.pct) || 0,
        }));
      }
    }
  } catch {}
  return DEFAULT_TIERS;
}

export function savePromoTiers(t: PromoTier[]) {
  try {
    localStorage.setItem(TIERS_KEY, JSON.stringify(t));
    // notifica outras instâncias da mesma aba
    window.dispatchEvent(new Event("promo-tiers:changed"));
  } catch {}
}

export function tierPctFor(
  n: number | null | undefined,
  tiers?: PromoTier[],
): number | undefined {
  if (n == null) return undefined;
  const list = tiers ?? loadPromoTiers();
  // do maior min para o menor, primeiro match vence
  const sorted = [...list].sort((a, b) => b.min - a.min);
  for (const t of sorted) {
    if (n >= t.min && (t.max == null || n <= t.max)) return t.pct;
  }
  return undefined;
}

const DEFAULT_FIXED = 0.17;
export function loadFixedPromoRate(): number {
  try {
    const v = Number(localStorage.getItem(FIXED_KEY));
    if (Number.isFinite(v) && v > 0 && v < 1) return v;
  } catch {}
  return DEFAULT_FIXED;
}
export function saveFixedPromoRate(v: number) {
  try {
    localStorage.setItem(FIXED_KEY, String(v));
    window.dispatchEvent(new Event("promo-fixed-rate:changed"));
  } catch {}
}
