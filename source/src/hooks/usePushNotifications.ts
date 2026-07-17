import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { IS_DESKTOP } from "@/lib/runtime";

const VAPID_PUBLIC_KEY =
  "BBoQs8679ZB5Hbs7CS0zuYf8rX-GrMHo6m8ebAcUw3pGzslglF8GlwpT9w_kCVp13RxJ029S3ADTRZItAZyhMdE";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function bufToB64(buf: ArrayBuffer | null) {
  if (!buf) return "";
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.byteLength; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function usePushNotifications() {
  const isIOS =
    typeof navigator !== "undefined" &&
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !(window as any).MSStream;
  const isStandalone =
    typeof window !== "undefined" &&
    (window.matchMedia?.("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true);
  const supported =
    typeof window !== "undefined" &&
    !IS_DESKTOP &&
    window.location.protocol !== "file:" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;
  // No iOS, Web Push só funciona com o app instalado na Tela de Início (iOS 16.4+).
  const needsIOSInstall = isIOS && !isStandalone;
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!supported) return;
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      setEnabled(!!sub && Notification.permission === "granted");
    } catch {
      setEnabled(false);
    }
  }, [supported]);

  useEffect(() => { refresh(); }, [refresh]);

  const enable = useCallback(async () => {
    if (!supported) {
      toast.error("Notificações push não suportadas neste navegador");
      return;
    }
    setBusy(true);
    try {
      if (Notification.permission === "denied") {
        toast.error(
          "Notificações bloqueadas no navegador. Clique no cadeado 🔒 ao lado da URL → Notificações → Permitir, e recarregue a página.",
          { duration: 12000 }
        );
        return;
      }
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        toast.error("Permissão negada. Habilite no cadeado 🔒 ao lado da URL.", { duration: 8000 });
        return;
      }
      const reg =
        (await navigator.serviceWorker.getRegistration("/sw.js")) ||
        (await navigator.serviceWorker.register("/sw.js"));
      await navigator.serviceWorker.ready;

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error("Faça login primeiro"); return; }

      const json = sub.toJSON();
      const endpoint = json.endpoint!;
      const p256dh = json.keys?.p256dh ?? bufToB64(sub.getKey("p256dh"));
      const auth = json.keys?.auth ?? bufToB64(sub.getKey("auth"));

      const { error } = await supabase
        .from("push_subscriptions")
        .upsert(
          { user_id: user.id, endpoint, p256dh, auth, user_agent: navigator.userAgent.slice(0, 200) },
          { onConflict: "endpoint" }
        );
      if (error) { toast.error(error.message); return; }
      setEnabled(true);
      toast.success("Notificações ativadas");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao ativar");
    } finally {
      setBusy(false);
    }
  }, [supported]);

  const disable = useCallback(async () => {
    if (!supported) return;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
      }
      setEnabled(false);
      toast.success("Notificações desativadas");
    } finally {
      setBusy(false);
    }
  }, [supported]);

  return { supported, enabled, busy, enable, disable, refresh, isIOS, isStandalone, needsIOSInstall };
}
