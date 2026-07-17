import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface SlotCodeEntry {
  nome: string;
  codigo: string;
}

export interface SlotMappingCodesMap {
  [slotNameLower: string]: SlotCodeEntry[];
}

export function useSlotMappingCodes() {
  const [map, setMap] = useState<SlotMappingCodesMap>({});
  const [loading, setLoading] = useState(true);

  const load = async () => {
    // No filtro por user_id: no desktop (Electron) o DB é local single-user; no browser, RLS já filtra.
    const { data, error } = await supabase
      .from("slot_mapping_codes")
      .select("slot_name, codes");
    if (!error && data) {
      const m: SlotMappingCodesMap = {};
      for (const row of data as any[]) {
        const key = String(row.slot_name || "").trim().toLowerCase();
        if (!key) continue;
        const existing = m[key] || [];
        const incoming = Array.isArray(row.codes) ? row.codes : [];
        m[key] = [...existing, ...incoming];
      }
      setMap(m);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`slot_codes_${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "slot_mapping_codes" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  return { map, loading, reload: load };
}
