import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type ChavePix = {
  id: string;
  banco: string;
  tipoChave: string;
  chave: string;
  titular: string;
  ordem: number;
};

type DbRow = {
  id: string;
  banco: string;
  tipo_chave: string;
  chave: string;
  titular: string;
  ordem: number;
};

const fromDb = (r: DbRow): ChavePix => ({
  id: r.id,
  banco: r.banco,
  tipoChave: r.tipo_chave,
  chave: r.chave,
  titular: r.titular,
  ordem: r.ordem,
});

export function useChavesPix() {
  const [chaves, setChavesState] = useState<ChavePix[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("chaves_pix")
      .select("id, banco, tipo_chave, chave, titular, ordem")
      .order("ordem", { ascending: true })
      .order("created_at", { ascending: true });
    if (!error && data) setChavesState((data as DbRow[]).map(fromDb));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const handler = () => { load(); };
    window.addEventListener("pix:reload", handler);
    return () => window.removeEventListener("pix:reload", handler);
  }, [load]);

  const add = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) { toast.error("Não autenticado"); return; }
    const ordem = chaves.length;
    const { data, error } = await supabase
      .from("chaves_pix")
      .insert({
        user_id: u.user.id,
        banco: "",
        tipo_chave: "CPF",
        chave: "",
        titular: "",
        ordem,
      })
      .select("id, banco, tipo_chave, chave, titular, ordem")
      .single();
    if (error || !data) { toast.error(error?.message ?? "Erro"); return null; }
    const novo = fromDb(data as DbRow);
    setChavesState((prev) => [...prev, novo]);
    return novo;
  };

  const update = async (id: string, patch: Partial<Omit<ChavePix, "id">>) => {
    setChavesState((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    const dbPatch: Record<string, unknown> = {};
    if (patch.banco !== undefined) dbPatch.banco = patch.banco;
    if (patch.tipoChave !== undefined) dbPatch.tipo_chave = patch.tipoChave;
    if (patch.chave !== undefined) dbPatch.chave = patch.chave;
    if (patch.titular !== undefined) dbPatch.titular = patch.titular;
    if (patch.ordem !== undefined) dbPatch.ordem = patch.ordem;
    const { error } = await supabase.from("chaves_pix").update(dbPatch as never).eq("id", id);
    if (error) toast.error(error.message);
  };

  const remove = async (id: string) => {
    setChavesState((prev) => prev.filter((c) => c.id !== id));
    const { error } = await supabase.from("chaves_pix").delete().eq("id", id);
    if (error) { toast.error(error.message); load(); }
  };

  const reorder = async (newList: ChavePix[]) => {
    const reindexed = newList.map((c, i) => ({ ...c, ordem: i }));
    setChavesState(reindexed);
    await Promise.all(
      reindexed.map((c) =>
        supabase.from("chaves_pix").update({ ordem: c.ordem }).eq("id", c.id)
      )
    );
  };

  return { chaves, loading, reload: load, add, update, remove, reorder };
}
