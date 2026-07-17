import { useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import { useAuth } from "@/hooks/useAuth";
import { useDkDashLucros } from "@/hooks/useDkDashLucros";
import { IS_DESKTOP } from "@/lib/runtime";

const CLOUD_URL = import.meta.env.VITE_SUPABASE_URL as string;
const CLOUD_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

const cloud =
  CLOUD_URL && CLOUD_KEY
    ? createClient(CLOUD_URL, CLOUD_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, storageKey: "sb-ranking-presence" },
      })
    : null;

function normalizeNick(n: string) {
  const nick = (n || "")
    .trim()
    .replace(/@rolls\.local$/i, "")
    .replace(/@local$/i, "")
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
  if (nick === "fofuralo") return "fofuralol";
  return nick;
}

function startOfDayTs() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function startOfMonthTs() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Garante que qualquer usuário logado apareça no ranking, mesmo sem
 * abrir a página do DkDash. Faz upsert com totais reais (se DkDash
 * estiver configurado) ou zeros.
 */
export function useRankingPresence() {
  const { user } = useAuth();
  const { dias, sumLiquido } = useDkDashLucros();

  useEffect(() => {
    if (!cloud) return;

    // Identidade real do usuário no ranking:
    // - DESKTOP: prioriza monitor_sync_email (identidade única por PC/instalação).
    //   Se vários PCs logam no mesmo DkDash, o sync_email é o que diferencia.
    //   Só cai para dkdash_username se não houver sync_email configurado.
    // - WEB: usa dkdash_username, depois user.email (nunca @local do FAKE_USER).
    let nickname = "";

    if (IS_DESKTOP) {
      const syncEmail = (typeof localStorage !== "undefined" && localStorage.getItem("monitor_sync_email")) || "";
      nickname = normalizeNick(syncEmail);
      if (!nickname) {
        const dkNick = localStorage.getItem("dkdash_username") || "";
        nickname = normalizeNick(dkNick);
      }
    } else {
      const dkNick = (typeof localStorage !== "undefined" && localStorage.getItem("dkdash_username")) || "";
      nickname = normalizeNick(dkNick);
      if (!nickname) {
        const email = user?.email || "";
        if (email && !/@local$/i.test(email)) nickname = normalizeNick(email);
      }
    }

    if (!nickname || nickname === "anon") return;

    const hoje = startOfDayTs();
    const mes = startOfMonthTs();
    const amanha = hoje + 24 * 60 * 60 * 1000;

    const total_hoje = sumLiquido(hoje, amanha) || 0;
    const total_mes = sumLiquido(mes, amanha) || 0;
    const total_geral = sumLiquido() || 0;

    // Nunca grava linha zerada: se DkDash ainda não carregou (dias vazio) ou
    // simplesmente não há lucro, evita sobrescrever a linha existente com 0/0/0.
    if (dias.length === 0 && total_hoje === 0 && total_mes === 0 && total_geral === 0) {
      return;
    }

    (async () => {
      const { error } = await cloud.from("dkdash_ranking").upsert(
        {
          nickname,
          total_hoje,
          total_mes,
          total_geral,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "nickname" }
      );
      if (error) console.error("[ranking-presence] upsert error", error);
    })();
  }, [user?.email, dias, sumLiquido]);


}
