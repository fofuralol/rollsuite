import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { normalizeUrl, extractBaseDomain, extractSld } from "@/lib/platformUrl";

export type PlatformMapping = {
  id: string;
  url_norm: string;
  platform_name: string;
};

export function usePlatformMappings() {
  const [mappings, setMappings] = useState<PlatformMapping[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("platform_mappings")
      .select("id, url_norm, platform_name");
    if (!error && data) setMappings(data as PlatformMapping[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const setMapping = useCallback(async (url: string, name: string) => {
    const url_norm = normalizeUrl(url);
    const platform_name = name.trim();
    if (!url_norm) return;
    const { data: u } = await supabase.auth.getUser();
    const user_id = u.user?.id;
    if (!user_id) return;

    if (!platform_name) {
      await supabase.from("platform_mappings")
        .delete().eq("url_norm", url_norm);
    } else {
      await supabase.from("platform_mappings")
        .upsert({ user_id, url_norm, platform_name }, { onConflict: "user_id,url_norm" });
    }
    await load();
  }, [load]);

  // Aplica um nome de plataforma a todas as URLs informadas de uma vez.
  const bulkAssign = useCallback(async (urls: string[], name: string) => {
    const platform_name = name.trim();
    if (!platform_name) return;
    const { data: u } = await supabase.auth.getUser();
    const user_id = u.user?.id;
    if (!user_id) return;
    const rows = Array.from(new Set(urls.map(normalizeUrl).filter(Boolean)))
      .map((url_norm) => ({ user_id, url_norm, platform_name }));
    if (!rows.length) return;
    await supabase.from("platform_mappings")
      .upsert(rows, { onConflict: "user_id,url_norm" });
    await load();
  }, [load]);

  // Remove todos os mapeamentos com um determinado platform_name (desfaz o grupo).
  const deleteGroup = useCallback(async (name: string) => {
    const platform_name = name.trim();
    if (!platform_name) return;
    await supabase.from("platform_mappings").delete().eq("platform_name", platform_name);
    await load();
  }, [load]);

  // Renomeia um grupo (atualiza todos os mapeamentos com aquele nome).
  const renameGroup = useCallback(async (oldName: string, newName: string) => {
    const from = oldName.trim();
    const to = newName.trim();
    if (!from || !to || from === to) return;
    await supabase.from("platform_mappings")
      .update({ platform_name: to }).eq("platform_name", from);
    await load();
  }, [load]);


  // Índice por domínio-base (eTLD+1) pra resolver variações: se "w1.onde.com"
  // já foi atribuído a "W1", então "onde.com", "w2.onde.com", "promo.onde.com"
  // também caem em "W1" — é o mesmo site.
  // Se houver conflito (a mesma base aparece com nomes diferentes), o índice
  // usa o nome mais frequente; empate resolve pelo primeiro (ordem estável).
  const { baseIndex, sldIndex, keywordIndex } = useMemo(() => {
    const baseCounts = new Map<string, Map<string, number>>();
    const sldCounts = new Map<string, Map<string, number>>();
    for (const m of mappings) {
      const base = extractBaseDomain(m.url_norm);
      if (base) {
        if (!baseCounts.has(base)) baseCounts.set(base, new Map());
        const inner = baseCounts.get(base)!;
        inner.set(m.platform_name, (inner.get(m.platform_name) ?? 0) + 1);
      }
      const sld = extractSld(m.url_norm).toLowerCase();
      if (sld) {
        if (!sldCounts.has(sld)) sldCounts.set(sld, new Map());
        const inner = sldCounts.get(sld)!;
        inner.set(m.platform_name, (inner.get(m.platform_name) ?? 0) + 1);
      }
    }
    const pickBest = (counts: Map<string, Map<string, number>>) => {
      const out = new Map<string, string>();
      for (const [key, inner] of counts) {
        let bestName = "";
        let bestCount = 0;
        for (const [name, count] of inner) {
          if (count > bestCount) { bestName = name; bestCount = count; }
        }
        if (bestName) out.set(key, bestName);
      }
      return out;
    };

    // Keyword index: pra cada nome de plataforma, colecionar prefixos de SLD
    // que começam com o nome (case-insensitive, mínimo 3 chars). Ex.: se OKOK
    // foi atribuído a `okokbhd2.com`, então `okokscore5.com`, `okokbhd3.com`
    // etc. também caem em OKOK automaticamente.
    const kwCounts = new Map<string, Map<string, number>>();
    for (const m of mappings) {
      const kw = m.platform_name.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
      if (kw.length < 3) continue;
      const sld = extractSld(m.url_norm).toLowerCase();
      if (!sld.startsWith(kw)) continue;
      if (!kwCounts.has(kw)) kwCounts.set(kw, new Map());
      const inner = kwCounts.get(kw)!;
      inner.set(m.platform_name, (inner.get(m.platform_name) ?? 0) + 1);
    }
    const keywordIdx = pickBest(kwCounts);
    return { baseIndex: pickBest(baseCounts), sldIndex: pickBest(sldCounts), keywordIndex: keywordIdx };
  }, [mappings]);

  const map = new Map(mappings.map((m) => [m.url_norm, m.platform_name]));
  const lookup = (url: string) => {
    const exact = map.get(normalizeUrl(url));
    if (exact) return exact;
    const base = extractBaseDomain(url);
    if (base) {
      const hit = baseIndex.get(base);
      if (hit) return hit;
    }
    const sld = extractSld(url).toLowerCase();
    if (sld) {
      const hit = sldIndex.get(sld);
      if (hit) return hit;
      // Match por keyword: procura o prefixo mais longo do SLD que exista no index
      let best = "";
      let bestLen = 0;
      for (const [kw, name] of keywordIndex) {
        if (sld.startsWith(kw) && kw.length > bestLen) {
          best = name;
          bestLen = kw.length;
        }
      }
      if (best) return best;
    }
    return "";
  };
  const platformNames = Array.from(new Set(mappings.map((m) => m.platform_name))).sort();

  return { mappings, loading, lookup, setMapping, bulkAssign, deleteGroup, renameGroup, platformNames, reload: load };
}

