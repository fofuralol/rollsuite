import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type BankPriority = { banco: string; nivel: number };

export function useBankPriorities() {
  const [priorities, setPriorities] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("pix_bank_priorities")
      .select("banco, nivel");
    if (!error && data) {
      const map: Record<string, number> = {};
      for (const r of data as BankPriority[]) map[r.banco] = r.nivel;
      setPriorities(map);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const setLevel = async (banco: string, nivel: number | null) => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) { toast.error("Não autenticado"); return; }

    if (nivel === null || nivel <= 0) {
      setPriorities((p) => { const n = { ...p }; delete n[banco]; return n; });
      const { error } = await supabase
        .from("pix_bank_priorities")
        .delete()
        .eq("user_id", u.user.id)
        .eq("banco", banco);
      if (error) toast.error(error.message);
      return;
    }

    setPriorities((p) => ({ ...p, [banco]: nivel }));
    const { error } = await supabase
      .from("pix_bank_priorities")
      .upsert(
        { user_id: u.user.id, banco, nivel },
        { onConflict: "user_id,banco" }
      );
    if (error) toast.error(error.message);
  };

  return { priorities, loading, setLevel, reload: load };
}
