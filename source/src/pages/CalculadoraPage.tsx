import { useEffect, useMemo, useRef, useState } from "react";
import { Calculator, Plus, Trash2, Check, ClipboardPaste, Tag, Search, KeyRound, ClipboardList, X, Pencil, CloudDownload, ChevronLeft, ChevronRight, GripVertical } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useSlotMappingCodes } from "@/hooks/useSlotMappingCodes";
import { useChavesPix, type ChavePix } from "@/hooks/useChavesPix";
import { useWaTasks } from "@/hooks/useWaTasks";
import { useDkDashTurno } from "@/hooks/useDkDashTurno";
import { BANCO_COLORS } from "@/lib/bancoColors";
import { supabase } from "@/integrations/supabase/client";

import ProxyMiniRing from "@/components/ProxyMiniRing";
import MetaFeedCard from "@/components/MetaFeedCard";
import { useMetaEvents } from "@/hooks/useMetaEvents";
import { loadSlotPresets, saveSlotPresets, colorClasses, PRESET_COLORS, type SlotPreset } from "@/lib/slotPresets";
import SlotsCatalogDialog from "@/components/calc/SlotsCatalogDialog";
import RowSlotsPicker, { type RowSlotAssignment } from "@/components/calc/RowSlotsPicker";
import RowSlotsBreakdown from "@/components/calc/RowSlotsBreakdown";
import { Layers } from "lucide-react";

const hashHue = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
};

const normalizeChave = (s: string): string =>
  (s || "").toLowerCase().trim().replace(/[\s.\-/()+]/g, "");

interface Row {
  id: number;
  deposito: string;
  rollover: string;
  bet: string;
  saque: string;
  slots?: RowSlotAssignment[];
}

interface Group {
  id: number;
  label: string;
  taskId?: string;
  rows: Row[];
}

const newRow = (id: number): Row => ({
  id, deposito: "", rollover: "2,2", bet: "0,4", saque: "",
});

const newGroup = (id: number, label = "Manual", rows?: Row[], taskId?: string): Group => ({
  id, label, taskId, rows: rows ?? [newRow(1)],
});

const parseNum = (v: string | undefined | null): number => {
  if (!v) return 0;
  const n = parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

const fmt = (n: number, dec = 2) =>
  Number.isFinite(n) ? n.toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec }) : "—";

const fmtInt = (n: number) =>
  Number.isFinite(n) ? String(Math.round(n)) : "—";

const STORAGE_KEY = "rolls_calculator_groups_v2";

const isEmptyGroup = (g: Group) =>
  g.rows.length === 1 && !g.rows[0].deposito && !g.rows[0].saque;

const CalculadoraPage = () => {
  const [groups, setGroups] = useState<Group[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [];
  });
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [slotsCatalogOpen, setSlotsCatalogOpen] = useState(false);
  const [pasteGid, setPasteGid] = useState<number | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [addCodeOpen, setAddCodeOpen] = useState(false);
  const [selectedCodeSlot, setSelectedCodeSlot] = useState("");
  const [creatingCodeSlot, setCreatingCodeSlot] = useState(false);
  const [newCodeSlot, setNewCodeSlot] = useState("");
  const [newCodeNome, setNewCodeNome] = useState("");
  const [newCodeValor, setNewCodeValor] = useState("");
  const [savingCode, setSavingCode] = useState(false);
  const [editCodeMode, setEditCodeMode] = useState(false);
  const [editingCode, setEditingCode] = useState<{ slot: string; origNome: string; origCodigo: string; nome: string; codigo: string } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const { map: slotCodesMap, reload: reloadSlotCodes } = useSlotMappingCodes();

  // Presets de slot (Bikini Party, Jade, etc.) — configuráveis pelo usuário
  const [slotPresets, setSlotPresets] = useState<SlotPreset[]>(() => loadSlotPresets());
  useEffect(() => {
    const onChange = () => setSlotPresets(loadSlotPresets());
    window.addEventListener("slot-presets:changed", onChange);
    return () => window.removeEventListener("slot-presets:changed", onChange);
  }, []);
  const persistPresets = (list: SlotPreset[]) => { setSlotPresets(list); saveSlotPresets(list); };
  const [presetEditOpen, setPresetEditOpen] = useState(false);
  const [presetDraft, setPresetDraft] = useState<SlotPreset | null>(null);
  const [presetIsNew, setPresetIsNew] = useState(false);
  const openNewPreset = () => {
    setPresetDraft({ id: `p${Date.now()}`, name: "", rollover: "", bet: "", color: "blue" });
    setPresetIsNew(true);
    setPresetEditOpen(true);
  };
  const openEditPreset = (p: SlotPreset) => {
    setPresetDraft({ ...p });
    setPresetIsNew(false);
    setPresetEditOpen(true);
  };
  const savePresetDraft = () => {
    if (!presetDraft) return;
    const name = presetDraft.name.trim();
    if (!name) { toast.error("Informe um nome"); return; }
    const clean: SlotPreset = { ...presetDraft, name };
    if (presetIsNew) persistPresets([...slotPresets, clean]);
    else persistPresets(slotPresets.map((p) => p.id === clean.id ? clean : p));
    setPresetEditOpen(false);
    toast.success(presetIsNew ? "Preset criado" : "Preset atualizado");
  };
  const deletePresetDraft = () => {
    if (!presetDraft) return;
    persistPresets(slotPresets.filter((p) => p.id !== presetDraft.id));
    setPresetEditOpen(false);
    toast.success("Preset removido");
  };

  // Importar códigos da nuvem (one-shot, só no desktop)
  const isDesktop = typeof window !== "undefined" && !!(window as any).electronAPI;
  const [importOpen, setImportOpen] = useState(false);
  const [importEmail, setImportEmail] = useState("");
  const [importPwd, setImportPwd] = useState("");
  const [importing, setImporting] = useState(false);
  const handleImportFromCloud = async () => {
    if (!importEmail.trim() || !importPwd) { toast.error("Informe email e senha da sua conta"); return; }
    setImporting(true);
    try {
      const { importSlotCodesFromCloud } = await import("@/integrations/desktop/cloudImport");
      const res = await importSlotCodesFromCloud(importEmail.trim(), importPwd);
      toast.success(`Importado: ${res.imported} códigos em ${res.slots} slots`);
      setImportOpen(false);
      setImportEmail(""); setImportPwd("");
      await reloadSlotCodes();
    } catch (e: any) {
      toast.error(e.message || "Falha ao importar");
    } finally {
      setImporting(false);
    }
  };

  // Pix
  const { chaves, add: addChave, update: updateChave, remove: removeChave } = useChavesPix();
  const [chaveQuery, setChaveQuery] = useState("");
  const [chaveResultado, setChaveResultado] = useState<ChavePix | null | undefined>(undefined);
  const [pixManagerOpen, setPixManagerOpen] = useState(false);
  const [novoBanco, setNovoBanco] = useState("");
  const [novoTipo, setNovoTipo] = useState("CPF");
  const [novaChave, setNovaChave] = useState("");
  const [novoTitular, setNovoTitular] = useState("");

  // Tarefas em andamento
  const { inProgress, active, ready: tasksReady, updateOperation } = useWaTasks();
  const turno = useDkDashTurno("montante");
  const autoPassedTaskIds = useRef<Set<string>>(new Set());
  const TASK_HUES = [12, 45, 90, 160, 195, 230, 280, 320];
  const hueForTask = (taskId?: string): number | null => {
    if (!taskId || active.length < 2) return null;
    const i = active.findIndex((x) => x.id === taskId);
    return i >= 0 ? TASK_HUES[i % TASK_HUES.length] : null;
  };
  const [pasteSaqueGid, setPasteSaqueGid] = useState<number | null>(null);
  const [confirmSaque, setConfirmSaque] = useState<{ gid: number; taskId: string } | null>(null);
  const [saqueProgress, setSaqueProgress] = useState<Record<number, "idle" | "loading" | "done">>({});

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(groups)); } catch {}
  }, [groups]);

  // Metas atingidas → match com giros de algum depósito
  const { events: metaEvents } = useMetaEvents();
  const metaTargets = useMemo(() => {
    const s = new Set<number>();
    metaEvents.forEach((e) => { if (e.target != null) s.add(e.target); });
    return s;
  }, [metaEvents]);
  const computeSlotRolls = (r: Row): number[] => {
    const slots = r.slots ?? [];
    if (slots.length === 0) return [];
    const dep = parseNum(r.deposito);
    const roll = parseNum(r.rollover);
    const totalPeso = slots.reduce((a, s) => a + (s.peso > 0 ? s.peso : 0), 0) || 1;
    return slots.map((s) => {
      const frac = (s.peso > 0 ? s.peso : 0) / totalPeso;
      const avSlot = dep * roll * frac;
      return s.bet > 0 ? Math.ceil(avSlot / s.bet) : 0;
    });
  };

  const rollsSet = useMemo(() => {
    const s = new Set<number>();
    groups.forEach((g) => g.rows.forEach((r) => {
      const dep = parseNum(r.deposito);
      const roll = parseNum(r.rollover);
      const bet = parseNum(r.bet);
      const slotRolls = computeSlotRolls(r);
      if (slotRolls.length > 0) {
        const sum = slotRolls.reduce((a, b) => a + b, 0);
        if (sum > 0) s.add(sum);
        slotRolls.forEach((n) => { if (n > 0) s.add(n); });
      } else if (dep > 0 && roll > 0 && bet > 0) {
        s.add(Math.ceil((dep * roll) / bet));
      }
    }));
    return s;
  }, [groups]);

  // Lista ORDENADA de depósitos (mesma ordem que aparece na tela)
  const deposits = useMemo(() => {
    const list: { rolls: number; dep: number }[] = [];
    groups.forEach((g) => g.rows.forEach((r) => {
      const dep = parseNum(r.deposito);
      const roll = parseNum(r.rollover);
      const bet = parseNum(r.bet);
      const slotRolls = computeSlotRolls(r);
      if (slotRolls.length > 0) {
        const sum = slotRolls.reduce((a, b) => a + b, 0);
        if (sum > 0) list.push({ rolls: sum, dep });
        // adiciona cada slot como um "depósito virtual" para permitir match individual
        slotRolls.forEach((n) => { if (n > 0) list.push({ rolls: n, dep }); });
      } else if (dep > 0 && roll > 0 && bet > 0) {
        list.push({ rolls: Math.ceil((dep * roll) / bet), dep });
      }
    }));
    return list;
  }, [groups]);



  // Auto-cola depósitos quando uma tarefa entra em andamento
  const autoPastedTaskIds = useRef<Set<string>>(new Set());
  const seenInProgressIds = useRef<Set<string>>(new Set());
  const pendingPassTaskIds = useRef<Set<string>>(new Set());
  const seededInProgressRef = useRef(false);
  useEffect(() => {
    if (!tasksReady) return;
    // Na primeira passada após o load, semeia o set com as tarefas já em andamento
    // SEM enfileirá-las para "passar a vez" — evita pular vez no F5.
    if (!seededInProgressRef.current) {
      for (const t of inProgress) seenInProgressIds.current.add(t.id);
      seededInProgressRef.current = true;
    } else {
      // Marca tarefas recém-entradas em andamento como candidatas a "passar a vez"
      for (const t of inProgress) {
        if (!seenInProgressIds.current.has(t.id)) {
          seenInProgressIds.current.add(t.id);
          if (!autoPassedTaskIds.current.has(t.id)) {
            pendingPassTaskIds.current.add(t.id);
          }
        }
      }
    }

    setGroups((prev) => {
      let next = prev;
      let changed = false;
      let nextId = Math.max(0, ...prev.map((g) => g.id));
      for (const t of inProgress) {
        if (autoPastedTaskIds.current.has(t.id)) continue;
        if (next.some((g) => g.taskId === t.id)) { autoPastedTaskIds.current.add(t.id); continue; }
        const deps = (t.operation_data?.rows ?? [])
          .map((r) => Number(r?.deposito) || 0)
          .filter((v) => v > 0);
        if (!deps.length) continue; // aguarda os depósitos chegarem
        autoPastedTaskIds.current.add(t.id);
        nextId += 1;
        const ng: Group = {
          id: nextId,
          label: t.nome_tarefa || t.link || t.autor || "Tarefa",
          taskId: t.id,
          rows: deps.map((v, i) => ({
            id: i + 1,
            deposito: String(v).replace(".", ","),
            rollover: "2,1",
            bet: "0,81",
            saque: "",
          })),
        };
        next = next.length === 1 && isEmptyGroup(next[0]) ? [ng] : [...next, ng];
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [inProgress, tasksReady]);

  // (removido) auto "passar a vez" — agora é só manual via botão.


  // Remove grupo automaticamente quando a tarefa é concluída
  useEffect(() => {
    if (!tasksReady) return;
    const activeIds = new Set(active.map((t) => t.id));
    setGroups((prev) => {
      const next = prev.filter((g) => !g.taskId || activeIds.has(g.taskId));
      return next.length === prev.length ? prev : next;
    });
  }, [active, tasksReady]);

  const codeGroups = useMemo(() => {
    const result: { slot: string; codes: { label: string; codigo: string }[] }[] = [];
    for (const slotKey of Object.keys(slotCodesMap).sort()) {
      const codes = slotCodesMap[slotKey];
      if (!codes || codes.length === 0) continue;
      const items = codes
        .map((c, i) => ({ label: (c.nome || `#${i + 1}`).trim(), codigo: c.codigo }))
        .filter((c) => c.codigo);
      if (items.length === 0) continue;
      result.push({ slot: slotKey, codes: items });
    }
    return result;
  }, [slotCodesMap]);

  const copyCode = (codigo: string, label: string, key: string) => {
    if (!codigo) { toast.error("Código vazio"); return; }
    navigator.clipboard.writeText(codigo).then(
      () => {
        setCopiedKey(key);
        toast.success(`Código "${label}" copiado`);
        setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1200);
      },
      () => toast.error("Falha ao copiar")
    );
  };

  const copyRolls = (value: number, key: string) => {
    if (!value) return;
    const text = String(Math.round(value));
    navigator.clipboard.writeText(text).then(
      () => {
        setCopiedKey(key);
        toast.success(`${text} rolls copiados`);
        setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1200);
      },
      () => toast.error("Erro ao copiar")
    );
  };

  const updateRow = (gid: number, rid: number, patch: Partial<Row>) => {
    setGroups((prev) => prev.map((g) => g.id !== gid ? g : {
      ...g, rows: g.rows.map((r) => r.id === rid ? { ...r, ...patch } : r),
    }));
  };

  const addRow = (gid: number) => {
    setGroups((prev) => prev.map((g) => {
      if (g.id !== gid) return g;
      const last = g.rows[g.rows.length - 1];
      const nextId = (last?.id ?? 0) + 1;
      return { ...g, rows: [...g.rows, { id: nextId, deposito: "", rollover: last?.rollover ?? "2,1", bet: last?.bet ?? "0,81", saque: "" }] };
    }));
  };

  const removeRow = (gid: number, rid: number) => {
    setGroups((prev) => prev.map((g) => {
      if (g.id !== gid) return g;
      if (g.rows.length === 1) return g;
      return { ...g, rows: g.rows.filter((r) => r.id !== rid) };
    }));
  };

  const removeGroup = (gid: number) => {
    setGroups((prev) => prev.filter((g) => g.id !== gid));
  };

  // Drag & drop: reorder rows within a group, and reorder groups themselves.
  const dragRef = useRef<
    | { type: "row"; gid: number; rid: number }
    | { type: "group"; gid: number }
    | null
  >(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const moveRow = (gid: number, fromRid: number, toRid: number) => {
    setGroups((prev) => prev.map((g) => {
      if (g.id !== gid) return g;
      const from = g.rows.findIndex((r) => r.id === fromRid);
      const to = g.rows.findIndex((r) => r.id === toRid);
      if (from < 0 || to < 0 || from === to) return g;
      const rows = [...g.rows];
      const [it] = rows.splice(from, 1);
      rows.splice(to, 0, it);
      return { ...g, rows };
    }));
  };

  const moveGroup = (fromGid: number, toGid: number) => {
    setGroups((prev) => {
      const from = prev.findIndex((g) => g.id === fromGid);
      const to = prev.findIndex((g) => g.id === toGid);
      if (from < 0 || to < 0 || from === to) return prev;
      const next = [...prev];
      const [it] = next.splice(from, 1);
      next.splice(to, 0, it);
      return next;
    });
  };

  const addManualGroup = () => {
    setGroups((prev) => {
      const nextId = Math.max(0, ...prev.map((g) => g.id)) + 1;
      return [...prev, newGroup(nextId)];
    });
  };

  const addGroupFromTask = (task: typeof inProgress[number]) => {
    const deps = (task.operation_data?.rows ?? []).map((r) => Number(r?.deposito) || 0).filter((v) => v > 0);
    if (!deps.length) { toast.error("Sem depósitos nessa tarefa"); return; }
    setGroups((prev) => {
      const nextId = Math.max(0, ...prev.map((g) => g.id)) + 1;
      const ng: Group = {
        id: nextId,
        label: task.nome_tarefa || task.link || task.autor || "Tarefa",
        taskId: task.id,
        rows: deps.map((v, i) => ({
          id: i + 1,
          deposito: String(v).replace(".", ","),
          rollover: "2,1",
          bet: "0,81",
          saque: "",
        })),
      };
      if (prev.length === 1 && isEmptyGroup(prev[0])) return [ng];
      return [...prev, ng];
    });
    toast.success(`${deps.length} depósito${deps.length > 1 ? "s" : ""} colado${deps.length > 1 ? "s" : ""}`);
  };

  const openPaste = (gid: number) => { setPasteText(""); setPasteGid(gid); };

  const confirmPaste = () => {
    const text = pasteText;
    const gid = pasteGid;
    if (gid == null) return;
    if (!text.trim()) { toast.error("Lista vazia"); return; }
    const values = text
      .split(/[\s,;]+/)
      .map((s) => s.trim().replace(/[^\d.,-]/g, ""))
      .filter((s) => s.length > 0)
      .map((s) => {
        const hasComma = s.includes(",");
        const hasDot = s.includes(".");
        let normalized = s;
        if (hasComma && hasDot) normalized = s.replace(/\./g, "").replace(",", ".");
        else if (hasComma) normalized = s.replace(",", ".");
        const n = parseFloat(normalized);
        return Number.isFinite(n) && n > 0 ? n : null;
      })
      .filter((n): n is number => n !== null);

    if (values.length === 0) { toast.error("Nenhum valor válido encontrado"); return; }

    setGroups((prev) => prev.map((g) => {
      if (g.id !== gid) return g;
      const baseRoll = g.rows[0]?.rollover ?? "2,1";
      const baseBet = g.rows[0]?.bet ?? "0,81";
      let nextId = 1;
      return {
        ...g,
        rows: values.map((v, i) => {
          const existing = g.rows[i];
          return {
            id: nextId++,
            deposito: String(v).replace(".", ","),
            rollover: existing?.rollover ?? baseRoll,
            bet: existing?.bet ?? baseBet,
            saque: existing?.saque ?? "",
          };
        }),
      };
    }));
    toast.success(`${values.length} depósito${values.length > 1 ? "s" : ""} aplicado${values.length > 1 ? "s" : ""}`);
    setPasteGid(null);
  };

  const buscarChave = () => {
    const q = normalizeChave(chaveQuery);
    if (!q) { setChaveResultado(undefined); toast.error("Digite uma chave"); return; }
    const found = chaves.find((c) => normalizeChave(c.chave) === q)
      || chaves.find((c) => normalizeChave(c.chave).includes(q))
      || null;
    setChaveResultado(found);
    if (!found) toast.error("Chave não cadastrada");
  };

  const handleSaveCode = async () => {
    const slotName = (creatingCodeSlot ? newCodeSlot : selectedCodeSlot).trim();
    if (!slotName) return;
    setSavingCode(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) { toast.error("Usuário não autenticado"); return; }
      const { data: existing, error: fetchErr } = await supabase
        .from("slot_mapping_codes")
        .select("id, codes, slot_name")
        .ilike("slot_name", slotName)
        .maybeSingle();
      if (fetchErr) { toast.error("Erro ao buscar slot"); return; }
      const newEntry = { nome: newCodeNome.trim(), codigo: newCodeValor.trim() };
      if (existing) {
        const updated = [...(Array.isArray(existing.codes) ? existing.codes : []), newEntry];
        const { error } = await supabase.from("slot_mapping_codes").update({ codes: updated as any }).eq("id", existing.id);
        if (error) { toast.error("Erro ao salvar"); return; }
      } else {
        const { error } = await supabase.from("slot_mapping_codes").insert({ slot_name: slotName, codes: [newEntry] as any, user_id: userData.user.id });
        if (error) { toast.error("Erro ao criar slot"); return; }
      }
      toast.success(`Código "${newEntry.nome}" adicionado`);
      setAddCodeOpen(false);
    } finally {
      setSavingCode(false);
    }
  };

  const fetchSlotRow = async (slotName: string) => {
    // Sem filtro por user_id: desktop é single-user e browser tem RLS aplicada automaticamente.
    const { data, error } = await supabase
      .from("slot_mapping_codes")
      .select("id, codes, slot_name")
      .ilike("slot_name", slotName)
      .maybeSingle();
    if (error) { toast.error("Erro ao buscar slot"); return null; }
    return data;
  };

  const handleUpdateCode = async () => {
    if (!editingCode) return;
    const nome = editingCode.nome.trim();
    const codigo = editingCode.codigo.trim();
    if (!nome || !codigo) { toast.error("Preencha nome e código"); return; }
    setSavingEdit(true);
    try {
      const row = await fetchSlotRow(editingCode.slot);
      if (!row) return;
      const codes = Array.isArray(row.codes) ? [...(row.codes as any[])] : [];
      const idx = codes.findIndex((c: any) => (c?.nome ?? "") === editingCode.origNome && (c?.codigo ?? "") === editingCode.origCodigo);
      if (idx < 0) { toast.error("Código não encontrado"); return; }
      codes[idx] = { nome, codigo };
      const { error } = await supabase.from("slot_mapping_codes").update({ codes: codes as any }).eq("id", row.id);
      if (error) { toast.error("Erro ao salvar"); return; }
      toast.success("Código atualizado");
      setEditingCode(null);
    } finally { setSavingEdit(false); }
  };

  const handleDeleteCode = async () => {
    if (!editingCode) return;
    setSavingEdit(true);
    try {
      const row = await fetchSlotRow(editingCode.slot);
      if (!row) return;
      const codes = Array.isArray(row.codes) ? [...(row.codes as any[])] : [];
      const idx = codes.findIndex((c: any) => (c?.nome ?? "") === editingCode.origNome && (c?.codigo ?? "") === editingCode.origCodigo);
      if (idx < 0) { toast.error("Código não encontrado"); return; }
      codes.splice(idx, 1);
      if (codes.length === 0) {
        const { error } = await supabase.from("slot_mapping_codes").delete().eq("id", row.id);
        if (error) { toast.error("Erro ao excluir"); return; }
      } else {
        const { error } = await supabase.from("slot_mapping_codes").update({ codes: codes as any }).eq("id", row.id);
        if (error) { toast.error("Erro ao excluir"); return; }
      }
      toast.success("Código removido");
      setEditingCode(null);
    } finally { setSavingEdit(false); }
  };

  const handleDeleteSlot = async (slotName: string) => {
    if (!confirm(`Excluir TODOS os códigos do slot "${slotName}"?`)) return;
    const row = await fetchSlotRow(slotName);
    if (!row) return;
    const { error } = await supabase.from("slot_mapping_codes").delete().eq("id", row.id);
    if (error) { toast.error("Erro ao excluir slot"); return; }
    toast.success(`Slot "${slotName}" excluído`);
  };

  const moveCode = async (slotName: string, fromIdx: number, dir: -1 | 1) => {
    const row = await fetchSlotRow(slotName);
    if (!row) return;
    const codes = Array.isArray(row.codes) ? [...(row.codes as any[])] : [];
    const toIdx = fromIdx + dir;
    if (toIdx < 0 || toIdx >= codes.length) return;
    [codes[fromIdx], codes[toIdx]] = [codes[toIdx], codes[fromIdx]];
    const { error } = await supabase.from("slot_mapping_codes").update({ codes: codes as any }).eq("id", row.id);
    if (error) { toast.error("Erro ao mover"); return; }
  };

  const renderGroup = (g: Group, gIdx: number) => {
    const calcs = g.rows.map((r) => {
      const dep = parseNum(r.deposito);
      const roll = parseNum(r.rollover);
      const bet = parseNum(r.bet);
      const saque = parseNum(r.saque);
      const av = dep * roll;
      const slots = r.slots ?? [];
      let rolls: number;
      let slotRolls: number[] = [];
      if (slots.length > 0) {
        const totalPeso = slots.reduce((a, s) => a + (s.peso > 0 ? s.peso : 0), 0) || 1;
        slotRolls = slots.map((s) => {
          const frac = (s.peso > 0 ? s.peso : 0) / totalPeso;
          const avSlot = dep * roll * frac;
          return s.bet > 0 ? Math.ceil(avSlot / s.bet) : 0;
        });
        rolls = slotRolls.reduce((a, b) => a + b, 0);
      } else {
        rolls = bet > 0 ? Math.ceil(av / bet) : 0;
      }
      const lp = saque - dep;
      return { dep, roll, bet, saque, av, rolls, slotRolls, lp, hasSlots: slots.length > 0 };
    });
    const totals = calcs.reduce(
      (acc, c) => ({
        dep: acc.dep + c.dep, av: acc.av + c.av, rolls: acc.rolls + c.rolls,
        saque: acc.saque + c.saque, lp: acc.lp + c.lp,
      }),
      { dep: 0, av: 0, rolls: 0, saque: 0, lp: 0 }
    );

    const groupHue = hueForTask(g.taskId);
    const groupStyle = groupHue != null ? ({ ["--task-hue" as never]: String(groupHue) } as React.CSSProperties) : undefined;
    return (
      <div
        key={g.id}
        style={groupStyle}
        className={`${groupHue != null ? "task-glow rounded-xl border p-3 " : ""}transition-colors ${dragOver === `group-${g.id}` ? "ring-2 ring-primary/50 rounded-xl" : ""}`}
        onDragOver={(e) => {
          if (dragRef.current?.type === "group" && dragRef.current.gid !== g.id) {
            e.preventDefault();
            setDragOver(`group-${g.id}`);
          }
        }}
        onDragLeave={() => { if (dragOver === `group-${g.id}`) setDragOver(null); }}
        onDrop={(e) => {
          if (dragRef.current?.type === "group" && dragRef.current.gid !== g.id) {
            e.preventDefault();
            moveGroup(dragRef.current.gid, g.id);
          }
          setDragOver(null);
          dragRef.current = null;
        }}
      >
        {gIdx > 0 && (
          <div className="my-4 flex items-center gap-2">
            <div className="h-px flex-1 bg-border" />
            <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">grupo {gIdx + 1}</span>
            <div className="h-px flex-1 bg-border" />
          </div>
        )}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              draggable
              onDragStart={(e) => {
                dragRef.current = { type: "group", gid: g.id };
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => { dragRef.current = null; setDragOver(null); }}
              title="Arrastar grupo"
              className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground shrink-0"
            >
              <GripVertical className="w-3.5 h-3.5" />
            </button>
            <Badge variant="outline" className="text-[10px] h-5 px-1.5 shrink-0">
              {g.taskId ? "TAREFA" : "MANUAL"}
            </Badge>
            <span className="font-bold text-sm truncate" title={g.label}>{g.label}</span>
            <span className="text-[10px] text-muted-foreground shrink-0">
              · {g.rows.length} linha{g.rows.length > 1 ? "s" : ""}
            </span>
          </div>
          <div className="flex items-center gap-1.5 justify-self-center flex-wrap">
            {slotPresets.map((p) => (
              <div key={p.id} className="flex items-center">
                <Button
                  size="sm"
                  variant="outline"
                  className={`h-6 text-[10px] px-2 rounded-r-none ${colorClasses(p.color)}`}
                  onClick={() => setGroups((prev) => prev.map((x) => x.id !== g.id ? x : { ...x, rows: x.rows.map((r) => ({ ...r, rollover: p.rollover, bet: p.bet })) }))}
                  title={`Rollover ${p.rollover} · Bet ${p.bet}`}
                >
                  {p.name}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className={`h-6 w-6 p-0 rounded-l-none border-l-0 ${colorClasses(p.color)}`}
                  onClick={() => openEditPreset(p)}
                  title="Editar preset"
                >
                  <Pencil className="w-3 h-3" />
                </Button>
              </div>
            ))}
            <Button
              size="sm"
              variant="outline"
              className="h-6 w-6 p-0 text-muted-foreground"
              onClick={openNewPreset}
              title="Adicionar preset"
            >
              <Plus className="w-3.5 h-3.5" />
            </Button>
          </div>
          <div className="justify-self-end">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
              onClick={() => removeGroup(g.id)}
              title="Remover grupo"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {(() => {
          const gridTpl = "grid-cols-[28px_1fr_1fr_1fr_1.1fr_1fr_1fr_1fr_minmax(86px,auto)]";
          return (
            <div className={`hidden md:grid ${gridTpl} gap-1.5 px-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground`}>
              <div>#</div>
              <div className="flex items-center gap-1">
                <span>Depósito</span>
                <div className="ml-auto flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => addRow(g.id)}
                    title="Adicionar depósito"
                    className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => openPaste(g.id)}
                    title="Colar lista"
                    className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                  >
                    <ClipboardPaste className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const deps = g.rows.map((r) => parseNum(r.deposito)).filter((v) => v > 0);
                      if (!deps.length) { toast.error("Sem depósitos para copiar"); return; }
                      const text = deps.map((v) => String(Math.trunc(v))).join("\n");
                      navigator.clipboard.writeText(text).then(
                        () => toast.success(`${deps.length} depósito${deps.length > 1 ? "s" : ""} copiado${deps.length > 1 ? "s" : ""}`),
                        () => toast.error("Falha ao copiar"),
                      );
                    }}
                    title="Copiar depósitos"
                    className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                  >
                    <Check className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <div>Roll.</div>
              <div>Bet</div>
              <div className="text-right">AV</div>
              <div className="text-right">Giros</div>
              <div>Saque</div>
              <div className="text-right">L/P</div>
              <div></div>
            </div>
          );
        })()}

        <div className="space-y-2">
          {g.rows.map((r, idx) => {
            const c = calcs[idx];
            const rowGridTpl = "md:grid-cols-[28px_1fr_1fr_1fr_1.1fr_1fr_1fr_1fr_minmax(86px,auto)]";
            const onColEnter = (col: string) => (e: React.KeyboardEvent<HTMLInputElement>) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              if (idx === g.rows.length - 1) {
                addRow(g.id);
                setTimeout(() => {
                  const next = document.querySelector<HTMLInputElement>(
                    `[data-calc-col="${col}"][data-calc-group="${g.id}"][data-calc-row="${idx + 1}"]`
                  );
                  next?.focus(); next?.select();
                }, 0);
              } else {
                const next = document.querySelector<HTMLInputElement>(
                  `[data-calc-col="${col}"][data-calc-group="${g.id}"][data-calc-row="${idx + 1}"]`
                );
                next?.focus(); next?.select();
              }
            };
            return (
              <div
                key={r.id}
                className={`${((c.rolls > 0 && metaTargets.has(c.rolls)) || (c.slotRolls && c.slotRolls.some((n) => n > 0 && metaTargets.has(n)))) ? "meta-match-glow rounded-md px-2 py-1 -mx-2 " : ""}${dragOver === `row-${g.id}-${r.id}` ? "ring-2 ring-primary/50 rounded-md" : ""}`}
                onDragOver={(e) => {
                  const d = dragRef.current;
                  if (d?.type === "row" && d.gid === g.id && d.rid !== r.id) {
                    e.preventDefault();
                    setDragOver(`row-${g.id}-${r.id}`);
                  }
                }}
                onDragLeave={() => { if (dragOver === `row-${g.id}-${r.id}`) setDragOver(null); }}
                onDrop={(e) => {
                  const d = dragRef.current;
                  if (d?.type === "row" && d.gid === g.id && d.rid !== r.id) {
                    e.preventDefault();
                    e.stopPropagation();
                    moveRow(g.id, d.rid, r.id);
                  }
                  setDragOver(null);
                  dragRef.current = null;
                }}
              >
                <div className={`grid grid-cols-2 ${rowGridTpl} gap-2 items-center`}>
                  <div className="text-xs text-muted-foreground tabular-nums col-span-2 md:col-span-1 flex items-center gap-1">
                    <button
                      type="button"
                      draggable
                      onDragStart={(e) => {
                        dragRef.current = { type: "row", gid: g.id, rid: r.id };
                        e.dataTransfer.effectAllowed = "move";
                        e.stopPropagation();
                      }}
                      onDragEnd={() => { dragRef.current = null; setDragOver(null); }}
                      title="Arrastar linha"
                      className="cursor-grab active:cursor-grabbing text-muted-foreground/60 hover:text-foreground"
                    >
                      <GripVertical className="w-3 h-3" />
                    </button>
                    <span>#{idx + 1}</span>
                  </div>
                  <Input type="number" inputMode="decimal" step="any" placeholder="Depósito"
                    value={r.deposito} onChange={(e) => updateRow(g.id, r.id, { deposito: e.target.value })}
                    onKeyDown={onColEnter("deposito")} data-calc-col="deposito" data-calc-group={g.id} data-calc-row={idx}
                    className="h-9 text-sm font-semibold tabular-nums" />
                  <Input type="text" inputMode="decimal" placeholder="Rollover"
                    value={r.rollover} onChange={(e) => updateRow(g.id, r.id, { rollover: e.target.value })}
                    onKeyDown={onColEnter("rollover")} data-calc-col="rollover" data-calc-group={g.id} data-calc-row={idx}
                    className="h-9 text-sm font-semibold tabular-nums" />
                  <Input type="text" inputMode="decimal" placeholder="Bet"
                    value={r.bet} onChange={(e) => updateRow(g.id, r.id, { bet: e.target.value })}
                    onKeyDown={onColEnter("bet")} data-calc-col="bet" data-calc-group={g.id} data-calc-row={idx}
                    disabled={c.hasSlots}
                    className="h-9 text-sm font-semibold tabular-nums" />
                  <Input type="number" inputMode="decimal" step="any" placeholder="Apostas Válidas"
                    value={c.av > 0 ? String(Math.round(c.av)) : ""}
                    onChange={(e) => {
                      const newAv = parseNum(e.target.value);
                      const dep = parseNum(r.deposito);
                      if (dep > 0 && newAv >= 0) {
                        const newRoll = newAv / dep;
                        updateRow(g.id, r.id, { rollover: newRoll.toFixed(4).replace(/\.?0+$/, "") });
                      }
                    }}
                    onKeyDown={onColEnter("av")} data-calc-col="av" data-calc-group={g.id} data-calc-row={idx}
                    className="h-9 text-sm font-bold tabular-nums text-right bg-muted/40" />
                  {c.hasSlots ? (
                    <div className="h-9 px-2 flex items-center justify-end gap-1.5 rounded-md bg-muted/30 border border-border/40 text-xs font-bold tabular-nums text-muted-foreground" title="Soma dos giros por slot">
                      Σ {fmtInt(c.rolls)}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => copyRolls(c.rolls, `row-${g.id}-${r.id}`)}
                      disabled={!c.rolls}
                      title="Clique para copiar"
                      className="h-9 px-2 flex items-center justify-end gap-1.5 rounded-md bg-primary/10 border border-primary/30 text-sm font-bold tabular-nums text-primary hover:bg-primary/20 active:scale-95 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {copiedKey === `row-${g.id}-${r.id}` && <Check className="w-3 h-3" />}
                      {fmtInt(c.rolls)}
                    </button>
                  )}
                  <Input type="number" inputMode="decimal" step="any" placeholder="Saque"
                    value={r.saque} onChange={(e) => updateRow(g.id, r.id, { saque: e.target.value })}
                    onKeyDown={onColEnter("saque")} data-calc-col="saque" data-calc-group={g.id} data-calc-row={idx}
                    className="h-9 text-sm font-semibold tabular-nums" />
                  <div className={`h-9 px-2 flex items-center justify-end rounded-md text-sm font-bold tabular-nums border ${
                    c.lp > 0 ? "bg-green-500/10 border-green-500/30 text-green-400"
                    : c.lp < 0 ? "bg-red-500/10 border-red-500/30 text-red-400"
                    : "bg-muted/40 border-border/40 text-muted-foreground"
                  }`}>
                    {c.dep || c.saque ? `${c.lp >= 0 ? "+" : ""}${fmt(c.lp)}` : "—"}
                  </div>
                  <div className="flex items-center gap-1 justify-self-end">
                    <RowSlotsPicker
                      value={r.slots ?? []}
                      onChange={(next) => updateRow(g.id, r.id, { slots: next })}
                      onManage={() => setSlotsCatalogOpen(true)}
                      onApplyToAll={(slots) => {
                        setGroups((prev) => prev.map((x) => x.id !== g.id ? x : {
                          ...x,
                          rows: x.rows.map((row) => ({
                            ...row,
                            slots: slots.map((s) => ({ ...s })),
                          })),
                        }));
                        toast.success(`Slots aplicados em ${g.rows.length} linha(s)`);
                      }}
                    />
                    <button onClick={() => removeRow(g.id, r.id)} disabled={g.rows.length === 1}
                      className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      title="Remover linha">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                {c.hasSlots && (
                  <RowSlotsBreakdown
                    slots={r.slots ?? []}
                    deposito={c.dep}
                    rolloverTotal={c.roll}
                    onChange={(next) => updateRow(g.id, r.id, { slots: next })}
                    onCopy={copyRolls}
                    copiedKey={copiedKey}
                    copyKeyPrefix={`row-${g.id}-${r.id}`}
                  />
                )}
              </div>
            );
          })}
        </div>

        <div className="flex justify-center mt-3">
          {(() => {
            const state = saqueProgress[g.id] ?? "idle";
            const isLoading = state === "loading";
            const isDone = state === "done";
            return (
              <button
                type="button"
                disabled={isLoading}
                onClick={() => {
                  const hasSaques = g.rows.some((r) => parseNum(r.saque) > 0);
                  if (!hasSaques) { toast.error("Preencha ao menos um saque"); return; }
                  if (inProgress.length === 0) { toast.error("Nenhuma tarefa em andamento"); return; }
                  const linked = g.taskId && inProgress.find((t) => t.id === g.taskId);
                  if (linked) {
                    setConfirmSaque({ gid: g.id, taskId: linked.id });
                  } else {
                    setPasteSaqueGid(g.id);
                  }
                }}
                className={`relative overflow-hidden rounded-md border h-9 px-5 text-xs font-semibold flex items-center justify-center gap-2 transition-colors duration-500 ease-out ${
                  isDone
                    ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-300 w-72"
                    : isLoading
                    ? "border-blue-500/60 bg-blue-500/15 text-blue-200 w-72 cursor-wait"
                    : "border-blue-500/40 bg-blue-500/5 text-blue-300 hover:bg-blue-500/10 w-64"
                }`}
              >
                {isLoading && (
                  <span
                    className="absolute inset-y-0 left-0 w-1/3 bg-blue-500/40"
                    style={{ animation: "calcProgressLoop 1.1s ease-in-out infinite" }}
                  />
                )}
                <span className="relative flex items-center gap-1.5">
                  {isDone ? (
                    <>
                      <Check className="w-3.5 h-3.5" /> Pronto
                    </>
                  ) : (
                    <>
                      <ClipboardPaste className="w-3.5 h-3.5" />
                      {isLoading ? "Preparando..." : "Autocolar saques na tarefa"}
                    </>
                  )}
                </span>
              </button>
            );
          })()}
        </div>

        {g.rows.length > 1 && (
          <div className="mt-3 rounded-lg border border-primary/40 bg-primary/10 p-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground mb-2">
              Totais ({g.rows.length} depósitos)
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div>
                <div className="text-[10px] uppercase text-muted-foreground">Depósito</div>
                <div className="text-base font-bold tabular-nums">R$ {fmt(totals.dep)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-muted-foreground">Apostas Válidas</div>
                <div className="text-base font-bold tabular-nums">R$ {fmt(totals.av)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-muted-foreground">Giros</div>
                <button
                  type="button"
                  onClick={() => copyRolls(totals.rolls, `totals-${g.id}`)}
                  disabled={!totals.rolls}
                  className="text-base font-black tabular-nums text-primary hover:underline active:scale-95 transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {copiedKey === `totals-${g.id}` && <Check className="w-3.5 h-3.5" />}
                  {fmtInt(totals.rolls)}
                </button>
              </div>
              <div>
                <div className="text-[10px] uppercase text-muted-foreground">Saque</div>
                <div className="text-base font-bold tabular-nums">R$ {fmt(totals.saque)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-muted-foreground">L/P</div>
                <div className={`text-base font-black tabular-nums ${totals.lp > 0 ? "text-green-400" : totals.lp < 0 ? "text-red-400" : ""}`}>
                  {totals.lp >= 0 ? "+" : ""}R$ {fmt(totals.lp)}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // For autocolar saques dialog: scoped to a single group
  const saqueGroup = pasteSaqueGid != null ? groups.find((g) => g.id === pasteSaqueGid) : null;

  return (
    <div className="bg-background text-foreground">
      <div className="sticky top-0 z-20 h-14 px-3 sm:px-5 border-b border-border bg-card/40 flex items-center gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Calculator className="w-5 h-5 text-primary shrink-0" />
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-semibold whitespace-nowrap">Calculadora de Giros</h1>
            <p className="text-[11px] text-muted-foreground hidden sm:block whitespace-nowrap">
              <span className="font-mono">AV = Dep × Roll</span> · <span className="font-mono">Giros = AV ÷ Bet</span>
            </p>
          </div>
        </div>
        <div className="flex items-center ml-auto gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            onClick={() => setSlotsCatalogOpen(true)}
            title="Cadastrar slots"
          >
            <Layers className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Meus Slots</span>
          </Button>
          <ProxyMiniRing />
        </div>
      </div>
      <SlotsCatalogDialog open={slotsCatalogOpen} onOpenChange={setSlotsCatalogOpen} />

      <main className="p-4 sm:p-6 flex justify-center">
        <div className="space-y-2 w-full max-w-5xl">
          {groups.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 p-6 flex flex-col items-center gap-2">
              <p className="text-xs text-muted-foreground">Nenhum grupo de depósitos.</p>
              <Button size="sm" variant="outline" className="h-8 gap-1" onClick={addManualGroup}>
                <Plus className="w-3.5 h-3.5" /> Adicionar grupo manual
              </Button>
            </div>
          ) : (
            groups.map((g, i) => renderGroup(g, i))
          )}

          {/* Códigos */}
          <div className="mt-3">
            <div className="rounded-lg border border-border/60 bg-muted/30 p-3 flex flex-col">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground flex items-center gap-1.5">
                  <Tag className="w-3 h-3" /> Códigos de Mapeamento
                  {codeGroups.length > 0 && (
                    <span className="text-muted-foreground/70">({codeGroups.length} {codeGroups.length === 1 ? "slot" : "slots"})</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {isDesktop && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 w-6 p-0"
                      onClick={() => setImportOpen(true)}
                      title="Importar códigos da nuvem (conta do browser)"
                    >
                      <CloudDownload className="w-3 h-3" />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant={editCodeMode ? "secondary" : "outline"}
                    className="h-6 w-6 p-0"
                    onClick={() => setEditCodeMode((m) => !m)}
                    title={editCodeMode ? "Sair do modo edição" : "Editar códigos"}
                    disabled={codeGroups.length === 0}
                  >
                    <Pencil className="w-3 h-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant={addCodeOpen ? "secondary" : "outline"}
                    className="h-6 w-6 p-0"
                    onClick={() => {
                      if (!addCodeOpen) {
                        setSelectedCodeSlot(codeGroups[0]?.slot ?? "");
                        setCreatingCodeSlot(codeGroups.length === 0);
                        setNewCodeSlot("");
                        setNewCodeNome(""); setNewCodeValor("");
                      }
                      setAddCodeOpen((o) => !o);
                    }}
                    title={addCodeOpen ? "Fechar" : "Adicionar código"}
                  >
                    <Plus className={`w-3.5 h-3.5 transition-transform ${addCodeOpen ? "rotate-45" : ""}`} />
                  </Button>
                </div>
              </div>

              {addCodeOpen && (
                <div className="mb-2 p-2 rounded-md border border-border/60 bg-background/60">
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2">
                    {codeGroups.length > 0 && !creatingCodeSlot ? (
                      <select
                        value={selectedCodeSlot}
                        onChange={(e) => {
                          if (e.target.value === "__new__") {
                            setCreatingCodeSlot(true);
                            setNewCodeSlot("");
                            return;
                          }
                          setCreatingCodeSlot(false);
                          setSelectedCodeSlot(e.target.value);
                        }}
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                      >
                        <option value="">Slot...</option>
                        {codeGroups.map((g) => <option key={g.slot} value={g.slot}>{g.slot}</option>)}
                        <option value="__new__">+ Novo slot...</option>
                      </select>
                    ) : (
                      <Input
                        value={newCodeSlot}
                        onChange={(e) => setNewCodeSlot(e.target.value)}
                        placeholder="Nome do slot"
                        className="h-9 text-sm"
                        autoFocus
                      />
                    )}
                    <Input value={newCodeNome} onChange={(e) => setNewCodeNome(e.target.value)} placeholder="Nome (ex: 50)" className="h-9 text-sm" />
                    <Input value={newCodeValor} onChange={(e) => setNewCodeValor(e.target.value)} placeholder="Código" className="h-9 text-sm font-mono" />
                    <Button
                      size="sm"
                      className="h-9 text-xs gap-1.5"
                      disabled={savingCode || !(creatingCodeSlot ? newCodeSlot : selectedCodeSlot).trim() || !newCodeNome.trim() || !newCodeValor.trim()}
                      onClick={async () => { await handleSaveCode(); setNewCodeNome(""); setNewCodeValor(""); setNewCodeSlot(""); setCreatingCodeSlot(codeGroups.length === 0); setAddCodeOpen(true); }}
                    >
                      {savingCode ? "..." : "Salvar"}
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex-1 overflow-auto max-h-64">
                {codeGroups.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground text-center py-4">
                    Nenhum código cadastrado. Clique no <span className="font-bold">+</span> para adicionar.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {codeGroups.map((g) => (
                      <div key={g.slot} className="flex items-start gap-2">
                        <div className="text-[10px] font-mono uppercase text-muted-foreground/80 min-w-[80px] pt-0.5 truncate flex items-center gap-1" title={g.slot}>
                          <span className="truncate">{g.slot}</span>
                          {editCodeMode && (
                            <button
                              type="button"
                              onClick={() => handleDeleteSlot(g.slot)}
                              className="text-destructive hover:opacity-80 shrink-0"
                              title="Excluir slot inteiro"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1 flex-1">
                          {g.codes.map((c, i) => {
                            const hue = hashHue(c.label.toLowerCase() || String(i));
                            const key = `code-${g.slot}-${i}`;
                            const style: React.CSSProperties = {
                              backgroundColor: `hsl(${hue} 70% 50% / 0.18)`,
                              borderColor: `hsl(${hue} 70% 55% / 0.5)`,
                              color: `hsl(${hue} 85% 78%)`,
                            };
                            const onClick = editCodeMode
                              ? () => setEditingCode({ slot: g.slot, origNome: c.label, origCodigo: c.codigo, nome: c.label, codigo: c.codigo })
                              : () => copyCode(c.codigo, c.label, key);
                            return (
                              <div key={key} className="inline-flex items-center">
                                {editCodeMode && (
                                  <button
                                    type="button"
                                    onClick={() => moveCode(g.slot, i, -1)}
                                    disabled={i === 0}
                                    className="text-muted-foreground hover:text-primary disabled:opacity-30 px-0.5"
                                    title="Mover para esquerda"
                                  >
                                    <ChevronLeft className="w-3 h-3" />
                                  </button>
                                )}
                                <button type="button" onClick={onClick} style={style}
                                  className={`inline-flex items-center gap-1 rounded-md border font-bold whitespace-nowrap leading-none text-[10px] px-2 py-0.5 hover:opacity-80 active:scale-95 transition uppercase ${editCodeMode ? "ring-1 ring-primary/40" : ""}`}>
                                  {editCodeMode ? <Pencil className="w-3 h-3" /> : (copiedKey === key && <Check className="w-3 h-3" />)}
                                  {c.label}
                                </button>
                                {editCodeMode && (
                                  <button
                                    type="button"
                                    onClick={() => moveCode(g.slot, i, 1)}
                                    disabled={i === g.codes.length - 1}
                                    className="text-muted-foreground hover:text-primary disabled:opacity-30 px-0.5"
                                    title="Mover para direita"
                                  >
                                    <ChevronRight className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>


            <div className="mt-2">
              <MetaFeedCard deposits={deposits} rollsSet={rollsSet} />
            </div>
          </div>

        </div>
      </main>

      {/* Paste */}
      {/* Editar código */}
      <Dialog open={!!editingCode} onOpenChange={(o) => { if (!o) setEditingCode(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="w-4 h-4 text-primary" /> Editar código
            </DialogTitle>
            <DialogDescription className="text-xs">
              Slot: <span className="font-mono uppercase">{editingCode?.slot}</span>
            </DialogDescription>
          </DialogHeader>
          {editingCode && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Nome</label>
                <Input
                  value={editingCode.nome}
                  onChange={(e) => setEditingCode({ ...editingCode, nome: e.target.value })}
                  placeholder="Nome (ex: 50)"
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Código</label>
                <Input
                  value={editingCode.codigo}
                  onChange={(e) => setEditingCode({ ...editingCode, codigo: e.target.value })}
                  placeholder="Código"
                  className="h-9 text-sm font-mono"
                />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="destructive" size="sm" onClick={handleDeleteCode} disabled={savingEdit} className="gap-1.5">
              <Trash2 className="w-3.5 h-3.5" /> Excluir
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditingCode(null)} disabled={savingEdit}>Cancelar</Button>
              <Button size="sm" onClick={handleUpdateCode} disabled={savingEdit}>{savingEdit ? "..." : "Salvar"}</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pasteGid != null} onOpenChange={(o) => { if (!o) setPasteGid(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardPaste className="w-4 h-4 text-primary" /> Colar lista de depósitos
            </DialogTitle>
            <DialogDescription className="text-xs">
              Cole valores separados por espaço, vírgula, ponto-e-vírgula ou nova linha.
            </DialogDescription>
          </DialogHeader>
          <Textarea autoFocus value={pasteText} onChange={(e) => setPasteText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); confirmPaste(); } }}
            placeholder={"100\n200,50\n1.234,56"}
            className="min-h-[180px] text-sm font-mono tabular-nums" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasteGid(null)}>Cancelar</Button>
            <Button onClick={confirmPaste}>Confirmar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pix manager */}
      <Dialog open={pixManagerOpen} onOpenChange={setPixManagerOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><KeyRound className="w-4 h-4 text-primary" /> Chaves Pix</DialogTitle>
            <DialogDescription className="text-xs">Cadastre chaves para usar na busca rápida.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Input placeholder="Banco" value={novoBanco} onChange={(e) => setNovoBanco(e.target.value)} className="h-9 text-sm" />
              <Input placeholder="Tipo (CPF/Email/...)" value={novoTipo} onChange={(e) => setNovoTipo(e.target.value)} className="h-9 text-sm" />
              <Input placeholder="Chave" value={novaChave} onChange={(e) => setNovaChave(e.target.value)} className="h-9 text-sm font-mono" />
              <Input placeholder="Titular" value={novoTitular} onChange={(e) => setNovoTitular(e.target.value)} className="h-9 text-sm" />
            </div>
            <Button size="sm" disabled={!novaChave.trim()} onClick={async () => {
              const novo = await addChave();
              if (novo) {
                await updateChave(novo.id, {
                  banco: novoBanco.trim(),
                  tipoChave: novoTipo.trim() || "CPF",
                  chave: novaChave.trim(),
                  titular: novoTitular.trim(),
                });
                setNovoBanco(""); setNovaChave(""); setNovoTitular("");
                toast.success("Chave adicionada");
              }
            }}>
              <Plus className="w-3.5 h-3.5 mr-1" /> Adicionar
            </Button>
            <div className="border border-border/60 rounded max-h-[300px] overflow-auto">
              {chaves.length === 0 ? (
                <p className="p-4 text-xs text-muted-foreground text-center">Nenhuma chave cadastrada.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1.5">Banco</th>
                      <th className="text-left px-2 py-1.5">Tipo</th>
                      <th className="text-left px-2 py-1.5">Chave</th>
                      <th className="text-left px-2 py-1.5">Titular</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {chaves.map((c) => (
                      <tr key={c.id} className="border-t border-border/40">
                        <td className="px-2 py-1.5">{c.banco || "—"}</td>
                        <td className="px-2 py-1.5">{c.tipoChave || "—"}</td>
                        <td className="px-2 py-1.5 font-mono">{c.chave}</td>
                        <td className="px-2 py-1.5">{c.titular || "—"}</td>
                        <td className="px-2 py-1.5">
                          <button onClick={() => removeChave(c.id)} className="text-muted-foreground hover:text-destructive">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Autocolar saques em tarefa */}
      <Dialog open={pasteSaqueGid != null} onOpenChange={(o) => { if (!o) setPasteSaqueGid(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardPaste className="w-4 h-4 text-blue-400" /> Autocolar saques na tarefa
            </DialogTitle>
            <DialogDescription className="text-xs">
              Escolha a tarefa em andamento para receber os saques preenchidos neste grupo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[400px] overflow-auto">
            {saqueGroup && inProgress.map((t) => {
              const opRows = t.operation_data?.rows ?? [];
              const calcSaques = saqueGroup.rows.map((r) => parseNum(r.saque));
              const preselected = saqueGroup.taskId === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={async () => {
                    const gid = saqueGroup!.id;
                    const merged: { deposito: number; saque: number }[] = [];
                    const len = Math.max(opRows.length, calcSaques.length);
                    for (let i = 0; i < len; i++) {
                      merged.push({
                        deposito: Number(opRows[i]?.deposito) || 0,
                        saque: calcSaques[i] ?? 0,
                      });
                    }
                    setPasteSaqueGid(null);
                    setSaqueProgress((p) => ({ ...p, [gid]: "loading" }));
                    try {
                      await updateOperation(t.id, {
                        ...(t.operation_data ?? {}),
                        rows: merged,
                        savedAt: new Date().toISOString(),
                      });
                      toast.success(`Saques colados em "${t.nome_tarefa || t.autor}"`);
                      setSaqueProgress((p) => ({ ...p, [gid]: "done" }));
                      window.setTimeout(() => setSaqueProgress((p) => ({ ...p, [gid]: "idle" })), 1500);
                    } catch (e) {
                      setSaqueProgress((p) => ({ ...p, [gid]: "idle" }));
                    }
                  }}
                  className={`w-full text-left rounded-md border p-2 transition ${
                    preselected
                      ? "border-blue-500/60 bg-blue-500/15 hover:bg-blue-500/20"
                      : "border-blue-500/30 bg-background/40 hover:bg-blue-500/10"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/40 h-4 text-[9px] px-1">EM ANDAMENTO</Badge>
                      <span className="font-bold text-sm truncate max-w-[260px]">{t.nome_tarefa || t.link || t.autor}</span>
                      <span className="text-[10px] text-muted-foreground">· {t.autor}</span>
                      {preselected && <Badge variant="outline" className="text-[9px] h-4 px-1">grupo atual</Badge>}
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      {opRows.length} dep · {saqueGroup.rows.filter((r) => parseNum(r.saque) > 0).length} saques
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasteSaqueGid(null)}>Cancelar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmar autocolagem em tarefa vinculada */}
      <Dialog open={confirmSaque != null} onOpenChange={(o) => { if (!o) setConfirmSaque(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardPaste className="w-4 h-4 text-blue-400" /> Colar saques na tarefa?
            </DialogTitle>
            <DialogDescription className="text-xs">
              {(() => {
                if (!confirmSaque) return null;
                const t = inProgress.find((x) => x.id === confirmSaque.taskId);
                return <>Os saques deste grupo serão colados em <span className="font-bold text-foreground">{t?.nome_tarefa || t?.link || t?.autor || "tarefa"}</span>.</>;
              })()}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmSaque(null)}>Cancelar</Button>
            <Button
              onClick={async () => {
                if (!confirmSaque) return;
                const gid = confirmSaque.gid;
                const g = groups.find((x) => x.id === gid);
                const t = inProgress.find((x) => x.id === confirmSaque.taskId);
                if (!g || !t) { setConfirmSaque(null); return; }
                const opRows = t.operation_data?.rows ?? [];
                const calcSaques = g.rows.map((r) => parseNum(r.saque));
                const merged: { deposito: number; saque: number }[] = [];
                const len = Math.max(opRows.length, calcSaques.length);
                for (let i = 0; i < len; i++) {
                  merged.push({
                    deposito: Number(opRows[i]?.deposito) || 0,
                    saque: calcSaques[i] ?? 0,
                  });
                }
                setConfirmSaque(null);
                setSaqueProgress((p) => ({ ...p, [gid]: "loading" }));
                try {
                  await updateOperation(t.id, {
                    ...(t.operation_data ?? {}),
                    rows: merged,
                    savedAt: new Date().toISOString(),
                  });
                  toast.success(`Saques colados em "${t.nome_tarefa || t.autor}"`);
                  setSaqueProgress((p) => ({ ...p, [gid]: "done" }));
                  window.setTimeout(() => setSaqueProgress((p) => ({ ...p, [gid]: "idle" })), 1500);
                } catch (e) {
                  setSaqueProgress((p) => ({ ...p, [gid]: "idle" }));
                }
              }}
            >
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Importar códigos da nuvem (desktop) */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Importar códigos da nuvem</DialogTitle>
            <DialogDescription>
              Faça login com a conta que você usa no navegador. Os códigos serão baixados para este computador. Sua senha não fica salva.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input
              type="email"
              placeholder="Email"
              value={importEmail}
              onChange={(e) => setImportEmail(e.target.value)}
              autoFocus
            />
            <Input
              type="password"
              placeholder="Senha"
              value={importPwd}
              onChange={(e) => setImportPwd(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleImportFromCloud(); }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)} disabled={importing}>Cancelar</Button>
            <Button onClick={handleImportFromCloud} disabled={importing}>
              {importing ? "Importando..." : "Importar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={presetEditOpen} onOpenChange={setPresetEditOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{presetIsNew ? "Novo preset" : "Editar preset"}</DialogTitle>
            <DialogDescription className="text-xs">
              Aplica Rollover e Bet padrão em todas as linhas do grupo.
            </DialogDescription>
          </DialogHeader>
          {presetDraft && (
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Nome</label>
                <Input value={presetDraft.name} onChange={(e) => setPresetDraft({ ...presetDraft, name: e.target.value })} placeholder="Ex: Sweet Bonanza" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Rollover</label>
                  <Input value={presetDraft.rollover} onChange={(e) => setPresetDraft({ ...presetDraft, rollover: e.target.value })} placeholder="2,1" />
                </div>
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Bet</label>
                  <Input value={presetDraft.bet} onChange={(e) => setPresetDraft({ ...presetDraft, bet: e.target.value })} placeholder="0,81" />
                </div>
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Cor</label>
                <div className="flex flex-wrap gap-1.5">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setPresetDraft({ ...presetDraft, color: c })}
                      className={`h-7 px-2 text-[10px] rounded border ${colorClasses(c)} ${presetDraft.color === c ? "ring-2 ring-offset-1 ring-offset-background ring-foreground/40" : ""}`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="flex justify-between sm:justify-between">
            {!presetIsNew && (
              <Button variant="destructive" size="sm" onClick={deletePresetDraft}>
                <Trash2 className="w-3.5 h-3.5 mr-1" /> Remover
              </Button>
            )}
            <div className="flex gap-2 ml-auto">
              <Button variant="outline" size="sm" onClick={() => setPresetEditOpen(false)}>Cancelar</Button>
              <Button size="sm" onClick={savePresetDraft}>Salvar</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CalculadoraPage;
