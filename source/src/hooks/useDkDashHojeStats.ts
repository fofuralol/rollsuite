import { useEffect, useMemo, useState } from "react";
import { useDkDashLucros, type DkDashCiclo, type DkDashDia } from "@/hooks/useDkDashLucros";
import { tierPctFor, loadFixedPromoRate } from "@/lib/promoTiers";

const PROMO_KEY = "dkdash:promo-dates";
const NORMAL_RATE_KEY = "dkdash:normal-rate";
const DEFAULT_NORMAL_RATE = 0.20;
const PROMO_WINDOWS_KEY = "monitor_promo_windows";

type PromoWindow = { start: string; end: string | null };

function loadPromos(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(PROMO_KEY) || "[]")); }
  catch { return new Set(); }
}
function loadNormalRate(): number {
  try {
    const v = Number(localStorage.getItem(NORMAL_RATE_KEY));
    if (Number.isFinite(v) && v > 0 && v < 1) return v;
  } catch {}
  return DEFAULT_NORMAL_RATE;
}
function loadPromoWindows(): PromoWindow[] {
  try {
    const raw = localStorage.getItem(PROMO_WINDOWS_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.filter((w) => w && typeof w.start === "string");
    }
    const oldActive = localStorage.getItem("monitor_promo_active") === "1";
    const oldAt = localStorage.getItem("monitor_promo_activated_at");
    if (oldAt) return [{ start: oldAt, end: oldActive ? null : new Date().toISOString() }];
  } catch {}
  return [];
}

export function computeDiaStats(dia: DkDashDia | undefined, opts: {
  normalRate: number;
  promoRate: number;
  isPromo: boolean;
  promoWindows: PromoWindow[];
}) {
  if (!dia) return { investido: 0, retornado: 0, comissao: 0, liquido: 0, bruto: 0 };
  const { normalRate, promoRate, isPromo, promoWindows } = opts;
  const isPromoFor = (createdAt?: string | null) => {
    if (!createdAt || promoWindows.length === 0) return false;
    const ts = new Date(createdAt).getTime();
    if (!Number.isFinite(ts)) return false;
    return promoWindows.some((w) => {
      const s = new Date(w.start).getTime();
      const e = w.end ? new Date(w.end).getTime() : Infinity;
      if (!Number.isFinite(s)) return false;
      return ts >= s && ts <= e;
    });
  };
  const resolve = (c: DkDashCiclo) => {
    const dep = Number(c.deposito ?? c.investido ?? 0);
    const bonusPerc = Number((c as any).bonus_perc ?? 0);
    const bonusExtra = dep * (bonusPerc / 100);
    const criado = ((c as any).created_at || (c as any).data_criacao || (c as any).data_ciclo || null) as string | null;
    const tier = isPromoFor(criado) ? tierPctFor(dep) : undefined;
    if (tier != null) return { effPct: tier, blog: dep * tier, bonusExtra };
    if (isPromo && dep >= 400) return { effPct: promoRate, blog: dep * promoRate, bonusExtra };
    return { effPct: normalRate, blog: Number(c.blogueiro ?? 0), bonusExtra };
  };
  const ciclos = dia.ciclos ?? [];
  let investido = 0, retornado = 0, comissao = 0;
  for (const c of ciclos) {
    const { blog, effPct, bonusExtra } = resolve(c);
    investido += Number(c.deposito ?? c.investido ?? 0);
    retornado += Number(c.saque ?? 0) + blog + bonusExtra;
    comissao += blog * effPct;
  }
  const bruto = retornado - investido;
  const liquido = bruto - comissao;
  return { investido, retornado, comissao, liquido, bruto };
}

export function useDkDashHojeStats() {
  const { dias } = useDkDashLucros();
  const [promoDates, setPromoDates] = useState<Set<string>>(() => loadPromos());
  const [normalRate, setNormalRate] = useState<number>(() => loadNormalRate());
  const [promoRate, setPromoRate] = useState<number>(() => loadFixedPromoRate());
  const [promoWindows, setPromoWindows] = useState<PromoWindow[]>(() => loadPromoWindows());

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === PROMO_KEY) setPromoDates(loadPromos());
      if (e.key === NORMAL_RATE_KEY) setNormalRate(loadNormalRate());
      if (e.key === "dkdash:promo-rate") setPromoRate(loadFixedPromoRate());
      if (e.key === PROMO_WINDOWS_KEY) setPromoWindows(loadPromoWindows());
    };
    const onFixedChange = () => setPromoRate(loadFixedPromoRate());
    const onPromoWindowsChange = () => {
      setPromoWindows((prev) => {
        const next = loadPromoWindows();
        return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
      });
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("dkdash:promo-rate-changed", onFixedChange);
    window.addEventListener("promo-windows:changed", onPromoWindowsChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("dkdash:promo-rate-changed", onFixedChange);
      window.removeEventListener("promo-windows:changed", onPromoWindowsChange);
    };
  }, []);

  const dia = useMemo(() => [...dias].sort((a, b) => (a.data < b.data ? 1 : -1))[0], [dias]);
  const isPromo = !!dia && promoDates.has(dia.data);

  return useMemo(
    () => computeDiaStats(dia, { normalRate, promoRate, isPromo, promoWindows }),
    [dia, normalRate, promoRate, isPromo, promoWindows],
  );
}
