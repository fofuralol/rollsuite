// Store simples (event-based) para popups de comprovante flutuantes.
import { useEffect, useState } from "react";

export interface ComprovantePopup {
  id: string;
  autor: string;
  telefone: string;
  grupo: string;
  mensagem: string;
  mediaDataUrl: string;
  mediaMime: string;
  mediaFilename: string;
  createdAt: string;
  chatId?: string;
  msgId?: string;
  reactedEmoji?: string;
}

const listeners = new Set<(items: ComprovantePopup[]) => void>();
let state: ComprovantePopup[] = [];

function emit() {
  const snapshot = [...state];
  listeners.forEach((cb) => {
    try { cb(snapshot); } catch {}
  });
}

export function pushComprovantePopup(item: ComprovantePopup) {
  if (state.some((p) => p.id === item.id)) return;
  state = [...state, item];
  emit();
}

export function dismissComprovantePopup(id: string) {
  state = state.filter((p) => p.id !== id);
  emit();
}

export function updateComprovantePopup(id: string, patch: Partial<ComprovantePopup>) {
  state = state.map((p) => (p.id === id ? { ...p, ...patch } : p));
  emit();
}

export function useComprovantePopups() {
  const [items, setItems] = useState<ComprovantePopup[]>(state);
  useEffect(() => {
    listeners.add(setItems);
    return () => { listeners.delete(setItems); };
  }, []);
  return items;
}
