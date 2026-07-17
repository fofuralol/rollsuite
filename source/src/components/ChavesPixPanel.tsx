import { useState } from "react";
import { Plus, Trash2, Copy, Check, Search, CreditCard, KeyRound, GripVertical, CopyCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";
import { getBancoColor } from "@/lib/bancoColors";
import { useChavesPix, type ChavePix } from "@/hooks/useChavesPix";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const TIPOS_CHAVE = ["CPF", "CNPJ", "E-mail", "Telefone", "Aleatória"];

const hashHue = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
};

const getBancoStyle = (banco: string): { className: string; style?: React.CSSProperties } => {
  const key = (banco || "").toUpperCase().trim();
  if (!key) return { className: "border border-border bg-card" };
  const color = getBancoColor(key);
  if (color.bg !== "bg-muted") {
    return { className: `${color.bg} ${color.border} border` };
  }
  const hue = hashHue(key);
  return {
    className: "border",
    style: {
      backgroundColor: `hsl(${hue} 70% 50% / 0.08)`,
      borderColor: `hsl(${hue} 70% 55% / 0.4)`,
    },
  };
};

interface SortableCardProps {
  c: ChavePix;
  isEditing: boolean;
  copiedId: string | null;
  selected: boolean;
  toggleSelect: (id: string) => void;
  setEditingId: (id: string | null) => void;
  copyChave: (id: string, chave: string, tipo: string) => void;
  setDeleteTarget: (t: { id: string; nome: string } | null) => void;
  updateChave: (id: string, patch: Partial<ChavePix>) => void;
}

const SortableCard = ({
  c,
  isEditing,
  copiedId,
  selected,
  toggleSelect,
  setEditingId,
  copyChave,
  setDeleteTarget,
  updateChave,
}: SortableCardProps) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: c.id });
  const bancoStyle = getBancoStyle(c.banco);
  const dragStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : "auto",
    ...bancoStyle.style,
  };

  return (
    <div
      ref={setNodeRef}
      style={dragStyle}
      onClick={() => setEditingId(isEditing ? null : c.id)}
      className={`group relative rounded-lg border transition-colors duration-200 cursor-pointer hover:border-primary/30 ${bancoStyle.className} ${isEditing ? "ring-1 ring-primary/50" : ""} ${selected ? "ring-2 ring-primary" : ""}`}
    >
      <div className="flex items-center gap-2 p-2.5">
        <div onClick={(e) => e.stopPropagation()} className="flex items-center">
          <Checkbox
            checked={selected}
            onCheckedChange={() => toggleSelect(c.id)}
            aria-label="Selecionar chave"
          />
        </div>
        <button
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          className="touch-none cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-0.5"
          title="Arrastar para reordenar"
          aria-label="Arrastar"
        >
          <GripVertical className="w-4 h-4" />
        </button>

        <div className="w-9 h-9 rounded-full bg-muted/60 flex items-center justify-center shrink-0">
          <CreditCard className="w-4 h-4 text-muted-foreground" />
        </div>


        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-foreground truncate">
              {c.banco || "Sem banco"}
            </span>
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium shrink-0">
              {c.tipoChave}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[11px] font-mono text-muted-foreground truncate">
              {c.chave || "—"}
            </span>
            {c.titular && (
              <span className="text-[10px] text-muted-foreground truncate">· {c.titular}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              copyChave(c.id, c.chave, c.tipoChave);
            }}
            title="Copiar chave"
          >
            {copiedId === c.id ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setDeleteTarget({ id: c.id, nome: `${c.banco} - ${c.chave}` || "Chave Pix" });
            }}
            title="Remover"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {isEditing && (
        <div
          className="grid grid-cols-2 gap-2 px-2.5 pb-2.5 border-t border-border pt-2"
          onClick={(e) => e.stopPropagation()}
        >
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Banco</label>
            <Input
              placeholder="Ex: Nubank"
              value={c.banco}
              onChange={(e) => updateChave(c.id, { banco: e.target.value })}
              className="h-7 text-xs"
              autoFocus
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Tipo de Chave</label>
            <Select value={c.tipoChave} onValueChange={(v) => updateChave(c.id, { tipoChave: v })}>
              <SelectTrigger className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPOS_CHAVE.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Chave Pix</label>
            <Input
              placeholder="Chave"
              value={c.chave}
              onChange={(e) => updateChave(c.id, { chave: e.target.value })}
              className="h-7 text-xs"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Titular</label>
            <Input
              placeholder="Nome do titular"
              value={c.titular}
              onChange={(e) => updateChave(c.id, { titular: e.target.value })}
              className="h-7 text-xs"
            />
          </div>
        </div>
      )}
    </div>
  );
};

const ChavesPixPanel = () => {
  const { chaves, loading, add, update, remove, reorder } = useChavesPix();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; nome: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortMode, setSortMode] = useState<"banco" | "qtd" | "sortido">("qtd");

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const formatChaveValue = (chave: string, tipo: string) => {
    const t = (tipo || "").toLowerCase();
    const isNumeric = t === "telefone" || t === "cpf" || t === "cnpj";
    return isNumeric ? chave.replace(/\D/g, "") : chave.trim();
  };

  const copySelected = async () => {
    const items = chaves.filter((c) => selectedIds.has(c.id) && c.chave);
    if (items.length === 0) { toast.error("Nenhuma chave marcada"); return; }
    const text = items
      .map((c) => formatChaveValue(c.chave, c.tipoChave))
      .filter(Boolean)
      .join("\n");
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        copied = true;
      }
    } catch { copied = false; }
    if (!copied) copied = fallbackCopyText(text);
    if (!copied) { toast.error("Falha ao copiar"); return; }
    toast.success(`${items.length} chave(s) copiada(s)!`);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const addChave = async () => {
    const novo = await add();
    if (novo) setEditingId(novo.id);
  };

  const fallbackCopyText = (value: string) => {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);

    let copied = false;
    try {
      copied = document.execCommand("copy");
    } finally {
      document.body.removeChild(textarea);
    }

    return copied;
  };

  const copyChave = async (id: string, chave: string, tipo: string) => {
    if (!chave) { toast.error("Chave vazia"); return; }
    const t = (tipo || "").toLowerCase();
    const isNumeric = t === "telefone" || t === "cpf" || t === "cnpj";
    const value = isNumeric ? chave.replace(/\D/g, "") : chave.trim();

    if (!value) {
      toast.error("Nada para copiar");
      return;
    }

    let copied = false;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        copied = true;
      }
    } catch {
      copied = false;
    }

    if (!copied) {
      copied = fallbackCopyText(value);
    }

    if (!copied) {
      toast.error("Falha ao copiar");
      return;
    }

    setCopiedId(id);
    toast.success("Chave copiada!");
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = chaves.findIndex((c) => c.id === active.id);
    const newIndex = chaves.findIndex((c) => c.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    reorder(arrayMove(chaves, oldIndex, newIndex));
  };

  const bancoCounts = chaves.reduce<Record<string, number>>((acc, c) => {
    const k = (c.banco || "").toLowerCase();
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  const sorted = (() => {
    const list = [...chaves];
    if (sortMode === "banco") {
      return list.sort((a, b) => {
        const ba = (a.banco || "").toLowerCase();
        const bb = (b.banco || "").toLowerCase();
        if (ba !== bb) return ba.localeCompare(bb);
        return (a.chave || "").localeCompare(b.chave || "", undefined, { numeric: true });
      });
    }
    if (sortMode === "qtd") {
      return list.sort((a, b) => {
        const ba = (a.banco || "").toLowerCase();
        const bb = (b.banco || "").toLowerCase();
        const ca = bancoCounts[ba] || 0;
        const cb = bancoCounts[bb] || 0;
        if (ca !== cb) return cb - ca;
        if (ba !== bb) return ba.localeCompare(bb);
        return (a.chave || "").localeCompare(b.chave || "", undefined, { numeric: true });
      });
    }
    // sortido: round-robin (1 chave de cada banco por vez)
    const groups = new Map<string, ChavePix[]>();
    for (const c of list) {
      const k = (c.banco || "").toLowerCase();
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(c);
    }
    const keys = [...groups.keys()].sort((a, b) => a.localeCompare(b));
    const result: ChavePix[] = [];
    let added = true;
    while (added) {
      added = false;
      for (const k of keys) {
        const arr = groups.get(k)!;
        if (arr.length > 0) {
          result.push(arr.shift()!);
          added = true;
        }
      }
    }
    return result;
  })();

  const filtered = search
    ? sorted.filter((c) =>
        c.banco.toLowerCase().includes(search.toLowerCase()) ||
        c.chave.toLowerCase().includes(search.toLowerCase()) ||
        c.titular.toLowerCase().includes(search.toLowerCase())
      )
    : sorted;

  const bancos = new Set(chaves.map((c) => c.banco.toUpperCase().trim()).filter(Boolean));
  const isDragEnabled = false;

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar banco, chave ou titular..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 text-xs pl-8"
            />
          </div>
          <Button size="sm" onClick={addChave} className="h-8 text-xs gap-1.5 shrink-0">
            <Plus className="w-3.5 h-3.5" /> Nova Chave
          </Button>
        </div>

        <div className="flex items-center gap-3 px-1 flex-wrap">
          <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
            <Checkbox
              checked={filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id))}
              onCheckedChange={(v) => {
                if (v) setSelectedIds(new Set(filtered.map((c) => c.id)));
                else setSelectedIds(new Set());
              }}
            />
            Marcar todas
          </label>
          <Button
            size="sm"
            variant="outline"
            onClick={copySelected}
            disabled={selectedIds.size === 0}
            className="h-7 text-xs gap-1.5"
          >
            <CopyCheck className="w-3.5 h-3.5" />
            Copiar marcadas ({selectedIds.size})
          </Button>
          <Select value={sortMode} onValueChange={(v) => setSortMode(v as typeof sortMode)}>
            <SelectTrigger className="h-7 text-xs w-[200px] ml-auto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="banco">Ordem por nome de banco</SelectItem>
              <SelectItem value="qtd">Nº de chaves por banco</SelectItem>
              <SelectItem value="sortido">Sortido (1 de cada banco)</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-[10px] text-muted-foreground">
            <span className="font-mono font-bold text-foreground">{chaves.length}</span> chaves ·{" "}
            <span className="font-mono font-bold text-foreground">{bancos.size}</span> bancos
          </span>
        </div>

        {loading ? (
          <div className="text-xs text-muted-foreground text-center py-12">Carregando...</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
              <KeyRound className="w-5 h-5 text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground text-center">
              {search ? "Nenhuma chave encontrada." : "Nenhuma chave cadastrada."}
            </p>
            {!search && (
              <Button size="sm" variant="outline" onClick={addChave} className="text-xs gap-1">
                <Plus className="w-3 h-3" /> Adicionar primeira chave
              </Button>
            )}
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={filtered.map((c) => c.id)} strategy={verticalListSortingStrategy}>
              <div className="grid grid-cols-1 gap-2">
                {filtered.map((c) => (
                  <SortableCard
                    key={c.id}
                    c={c}
                    isEditing={editingId === c.id}
                    copiedId={copiedId}
                    selected={selectedIds.has(c.id)}
                    toggleSelect={toggleSelect}
                    setEditingId={setEditingId}
                    copyChave={copyChave}
                    setDeleteTarget={setDeleteTarget}
                    updateChave={update}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      <ConfirmDeleteDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        itemName={deleteTarget?.nome ?? ""}
        onConfirm={() => {
          if (deleteTarget) remove(deleteTarget.id);
          setDeleteTarget(null);
        }}
      />
    </>
  );
};

export default ChavesPixPanel;
