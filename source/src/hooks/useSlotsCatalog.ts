import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface SlotCatalogItem {
  id: string;
  nome: string;
  bet_default: number;
  ativo: boolean;
}

export function useSlotsCatalog() {
  const [items, setItems] = useState<SlotCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("slots_catalog")
      .select("id, nome, bet_default, ativo")
      .eq("ativo", true)
      .order("nome", { ascending: true });
    if (!error && data) {
      setItems(
        (data as any[]).map((r) => ({
          id: r.id,
          nome: r.nome,
          bet_default: Number(r.bet_default) || 0,
          ativo: !!r.ativo,
        }))
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`slots_catalog_${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "slots_catalog" },
        () => load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load]);

  const add = useCallback(async (nome: string, bet_default: number) => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw new Error("Não autenticado");
    const { error } = await supabase
      .from("slots_catalog")
      .insert({ nome, bet_default, user_id: u.user.id, ativo: true } as any);
    if (error) throw error;
    await load();
  }, [load]);

  const update = useCallback(
    async (id: string, patch: Partial<Pick<SlotCatalogItem, "nome" | "bet_default" | "ativo">>) => {
      const { error } = await supabase.from("slots_catalog").update(patch as any).eq("id", id);
      if (error) throw error;
      await load();
    },
    [load]
  );

  const remove = useCallback(async (id: string) => {
    const { error } = await supabase.from("slots_catalog").delete().eq("id", id);
    if (error) throw error;
    await load();
  }, [load]);

  return { items, loading, reload: load, add, update, remove };
}
