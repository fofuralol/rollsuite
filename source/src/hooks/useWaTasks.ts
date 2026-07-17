import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type PixKeyRef = {
  id: string;
  banco: string;
  tipo_chave: string;
  chave: string;
  titular?: string;
};

export type WaTask = {
  id: string;
  user_id: string;
  autor: string;
  telefone: string;
  grupo: string;
  mensagem: string;
  matched: string[];
  status: "pending" | "in_progress" | "done";
  created_at: string;
  completed_at: string | null;
  link: string;
  nome_tarefa: string;
  pix_keys: PixKeyRef[];
  operation_data: OperationData;
  source_msg_id?: string;
  source_chat_id?: string;
  source_author_id?: string;
  image_urls?: string[];
};

export type OperationRow = { deposito: number; saque: number };
export type OperationData = {
  rows?: OperationRow[];
  blogueiroPercent?: number;
  valueMultiplier?: number;
  savedAt?: string;
};

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

// ---- In-window broadcast bus ----
// Garante sync imediato entre múltiplas instâncias de useWaTasks
// (ex.: MonitorPage + CalculadoraPage em split view), sem depender
// do realtime via IPC.
type BusEvent =
  | { kind: "upsert"; task: WaTask }
  | { kind: "patch"; id: string; patch: Partial<WaTask> }
  | { kind: "remove"; id: string };
const busListeners = new Set<(ev: BusEvent) => void>();
function bus(ev: BusEvent) {
  for (const fn of busListeners) {
    try { fn(ev); } catch {}
  }
}

export function useWaTasks() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<WaTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  const reload = useCallback(async () => {
    if (!user) {
      setTasks([]);
      setReady(true);
      return;
    }

    setLoading(true);
    try {
      const { data } = await supabase
        .from("wa_tasks")
        .select("*")
        .order("created_at", { ascending: false });
      setTasks((data ?? []) as unknown as WaTask[]);
    } finally {
      setLoading(false);
      setReady(true);
    }
  }, [user]);

  // Histórico permanente — não apagamos mais tarefas antigas automaticamente.


  useEffect(() => {
    reload();
  }, [reload]);

  // In-window bus subscription — propaga mutações locais entre instâncias.
  useEffect(() => {
    const listener = (ev: BusEvent) => {
      if (ev.kind === "upsert") {
        setTasks((prev) => {
          if (prev.find((t) => t.id === ev.task.id)) {
            return prev.map((t) => (t.id === ev.task.id ? { ...t, ...ev.task } : t));
          }
          return [ev.task, ...prev];
        });
      } else if (ev.kind === "patch") {
        setTasks((prev) => prev.map((t) => (t.id === ev.id ? { ...t, ...ev.patch } : t)));
      } else if (ev.kind === "remove") {
        setTasks((prev) => prev.filter((t) => t.id !== ev.id));
      }
    };
    busListeners.add(listener);
    return () => { busListeners.delete(listener); };
  }, []);

  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`wa_tasks_rt_${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "wa_tasks", filter: `user_id=eq.${user.id}` },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const newTask = payload.new as WaTask;
            setTasks((prev) => {
              if (prev.find((t) => t.id === newTask.id)) return prev;
              return [newTask, ...prev];
            });
          } else if (payload.eventType === "UPDATE") {
            const updatedTask = payload.new as WaTask;
            setTasks((prev) => prev.map((t) => (t.id === updatedTask.id ? updatedTask : t)));
          } else if (payload.eventType === "DELETE") {
            const deletedId = (payload.old as any).id;
            setTasks((prev) => prev.filter((t) => t.id !== deletedId));
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user]);

  const addTask = useCallback(
    async (m: { autor: string; telefone?: string; grupo?: string; mensagem: string; matched?: string[]; link?: string; nome_tarefa?: string; pix_keys?: PixKeyRef[]; source_msg_id?: string; source_chat_id?: string; source_author_id?: string }) => {
      if (!user) return null;
      const { data } = await supabase.from("wa_tasks").insert({
        user_id: user.id,
        autor: m.autor,
        telefone: m.telefone ?? "",
        grupo: m.grupo ?? "",
        mensagem: m.mensagem,
        matched: m.matched ?? [],
        status: "pending",
        link: m.link ?? "",
        nome_tarefa: m.nome_tarefa ?? "",
        pix_keys: (m.pix_keys ?? []) as never,
        source_msg_id: m.source_msg_id ?? "",
        source_chat_id: m.source_chat_id ?? "",
        source_author_id: m.source_author_id ?? "",
      }).select("*").single();
      if (data) {
        const newTask = data as unknown as WaTask;
        setTasks((prev) => (prev.find((t) => t.id === newTask.id) ? prev : [newTask, ...prev]));
        bus({ kind: "upsert", task: newTask });
        return newTask.id;
      }
      return null;
    },
    [user],
  );

  const updatePixKeys = useCallback(async (id: string, keys: PixKeyRef[]) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, pix_keys: keys } : t)));
    bus({ kind: "patch", id, patch: { pix_keys: keys } });
    await supabase.from("wa_tasks").update({ pix_keys: keys as never }).eq("id", id);
  }, []);

  const updateOperation = useCallback(async (id: string, op: OperationData) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, operation_data: op } : t)));
    bus({ kind: "patch", id, patch: { operation_data: op } });
    await supabase.from("wa_tasks").update({ operation_data: op as never }).eq("id", id);
  }, []);

  const updateImages = useCallback(async (id: string, image_urls: string[]) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, image_urls } : t)));
    bus({ kind: "patch", id, patch: { image_urls } });
    await supabase.from("wa_tasks").update({ image_urls }).eq("id", id);
  }, []);

  const start = useCallback(async (id: string) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: "in_progress" } : t)));
    bus({ kind: "patch", id, patch: { status: "in_progress" } });
    await supabase.from("wa_tasks").update({ status: "in_progress" }).eq("id", id);
  }, []);

  const complete = useCallback(async (id: string) => {
    const completed_at = new Date().toISOString();
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: "done", completed_at } : t)));
    bus({ kind: "patch", id, patch: { status: "done", completed_at } });
    await supabase.from("wa_tasks").update({ status: "done", completed_at }).eq("id", id);
  }, []);

  const reopen = useCallback(async (id: string) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: "pending", completed_at: null } : t)));
    bus({ kind: "patch", id, patch: { status: "pending", completed_at: null } });
    await supabase.from("wa_tasks").update({ status: "pending", completed_at: null }).eq("id", id);
  }, []);

  const remove = useCallback(async (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    bus({ kind: "remove", id });
    await supabase.from("wa_tasks").delete().eq("id", id);
  }, []);

  const pending = tasks.filter((t) => t.status === "pending");
  const inProgress = tasks.filter((t) => t.status === "in_progress");
  const active = tasks.filter((t) => t.status === "pending" || t.status === "in_progress");
  const done = tasks.filter((t) => t.status === "done");

  return { tasks, pending, inProgress, active, done, loading, ready, addTask, updatePixKeys, updateOperation, updateImages, start, complete, reopen, remove, reload };
}
