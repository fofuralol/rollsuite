import { useEffect, useState } from "react";

const KEY = "live_chat_enabled_v1";
const EVENT = "live-chat-enabled:changed";

export function readLiveChatEnabled(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}

export function setLiveChatEnabled(enabled: boolean) {
  try {
    localStorage.setItem(KEY, enabled ? "1" : "0");
  } catch {}
  try { (window as any).electronAPI?.waSetLiveChat?.(enabled); } catch {}
  window.dispatchEvent(new CustomEvent(EVENT, { detail: enabled }));
}

export function useLiveChatEnabled() {
  const [enabled, setEnabled] = useState<boolean>(readLiveChatEnabled);
  useEffect(() => {
    // Sync inicial pro main process (Electron), pra ele saber se pode pular downloadMedia.
    try { (window as any).electronAPI?.waSetLiveChat?.(enabled); } catch {}
    const handler = () => setEnabled(readLiveChatEnabled());
    window.addEventListener(EVENT, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(EVENT, handler);
      window.removeEventListener("storage", handler);
    };
  }, [enabled]);
  return enabled;
}
