import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export type DkDashCiclo = {
  nome_ciclo?: string;
  lucro?: number;
  blogueiro?: number;
  taxa_dk?: number;
  deposito?: number;
  saque?: number;
  retorno?: number;
  investido?: number;
  data_criacao?: string;
  [k: string]: unknown;
};

export type DkDashDia = {
  data: string;
  lucro: number;
  investido: number;
  saque: number;
  retorno: number;
  taxa_dk: number;
  liquido: number;
  ciclos: DkDashCiclo[];
};

const STORAGE_KEY = "dkdash_lucros_cache_v2";

function normalizeDkUsername(username: string) {
  const nick = username.trim().toLowerCase();
  if (nick === "fofuralo") return "fofuralol";
  return nick;
}

export function useDkDashLucros() {
  const [dias, setDias] = useState<DkDashDia[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as DkDashDia[];
    } catch {}
    return [];
  });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("dkdash-lucros", {
        body: { action: "fetch" },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const username = (data as any)?.username;
      if (username && typeof username === "string") {
        try { localStorage.setItem("dkdash_username", normalizeDkUsername(username)); } catch {}
      }
      const rawDias = ((data as any)?.dias || []) as Array<{
        data: string;
        lucro: number;
        investido?: number;
        saque?: number;
        retorno?: number;
        taxa_dk?: number;
        ciclos?: DkDashCiclo[];
      }>;
      const mapped: DkDashDia[] = rawDias.map((d) => {
        const lucro = Number(d.lucro || 0);
        const investido = Number(d.investido || 0);
        const saque = Number(d.saque || 0);
        const retorno = Number(d.retorno || 0);
        const taxa = Number(d.taxa_dk || 0);
        return { data: d.data, lucro, investido, saque, retorno, taxa_dk: taxa, liquido: lucro, ciclos: d.ciclos || [] };
      });
      setDias(mapped);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(mapped)); } catch {}
    } catch {
      // silencioso
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const handler = () => load();
    window.addEventListener("dkdash-lucros:changed", handler);
    const interval = setInterval(() => load(), 60_000);
    return () => {
      window.removeEventListener("dkdash-lucros:changed", handler);
      clearInterval(interval);
    };
  }, [load]);

  const sumLiquido = useCallback(
    (desde?: number, ate?: number) => {
      return dias.reduce((s, d) => {
        if (desde === undefined && ate === undefined) return s + d.liquido;
        const [y, m, day] = d.data.split("-").map(Number);
        if (!y || !m || !day) return s;
        const ts = new Date(y, m - 1, day).getTime();
        if (desde !== undefined && ts < desde) return s;
        if (ate !== undefined && ts >= ate) return s;
        return s + d.liquido;
      }, 0);
    },
    [dias]
  );

  return { dias, loading, reload: load, sumLiquido };
}
