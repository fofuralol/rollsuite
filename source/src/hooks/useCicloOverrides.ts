import { useCallback, useEffect, useState } from "react";

export type CicloOverride = {
  nome_ciclo?: string;
  deposito?: number;
  saque?: number;
  blogueiro?: number;
  taxa_dk?: number;
  deleted?: boolean;
};

const KEY = "dkdash_ciclo_overrides_v1";

type Store = Record<string, CicloOverride>;

function read(): Store {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}") as Store; } catch { return {}; }
}
function write(s: Store) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
}

export function cicloKey(c: { nome_ciclo?: string; data_criacao?: string; PK?: string } & Record<string, unknown>) {
  const pk = (c as any).PK || (c as any).pk || (c as any).id;
  if (pk) return `pk:${pk}`;
  return `nm:${c.nome_ciclo || ""}::${c.data_criacao || ""}`;
}

export function useCicloOverrides() {
  const [map, setMap] = useState<Store>(() => read());

  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) setMap(read()); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const set = useCallback((key: string, patch: CicloOverride | null) => {
    setMap((prev) => {
      const next = { ...prev };
      if (patch === null) delete next[key];
      else next[key] = { ...(prev[key] || {}), ...patch };
      write(next);
      return next;
    });
  }, []);

  return { overrides: map, setOverride: set };
}
