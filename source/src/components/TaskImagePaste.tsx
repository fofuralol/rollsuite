import { useEffect, useRef, useState } from "react";
import { ImageIcon, X, Check } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  taskId: string;
  userId: string;
  imageUrls: string[];
  onChange: (paths: string[]) => void;
}

const BUCKET = "wa-task-images";

async function uploadBlob(userId: string, taskId: string, blob: Blob): Promise<string | null> {
  const eapi = (window as any).electronAPI;
  if (eapi?.uploadTaskImage) {
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    const res = await eapi.uploadTaskImage({
      userId,
      taskId,
      base64: btoa(binary),
      mimeType: blob.type || "image/png",
    });
    if (res?.error) { toast.error(res.error.message); return null; }
    return res?.data?.path ?? null;
  }
  const ext = (blob.type.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "");
  const path = `${userId}/${taskId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: blob.type || "image/png",
    upsert: true,
  });
  if (error) { toast.error(error.message); return null; }
  return path;
}

function Thumb({ path, onRemove }: { path: string; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancel = false;
    const eapi = (window as any).electronAPI;
    if (eapi?.readTaskImage) {
      eapi.readTaskImage(path).then((res: any) => {
        if (cancel || res?.error || !res?.data?.base64) return;
        const src = `data:${res.data.mimeType || "image/png"};base64,${res.data.base64}`;
        setUrl(src);
      });
    } else {
      supabase.storage.from(BUCKET).createSignedUrl(path, 600).then(({ data }) => {
        if (!cancel) setUrl(data?.signedUrl ?? null);
      });
    }
    return () => {
      cancel = true;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [path]);

  const toPng = async (blob: Blob): Promise<Blob> => {
    if (blob.type === "image/png") return blob;
    return await new Promise<Blob>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const ctx = c.getContext("2d");
        if (!ctx) return reject(new Error("canvas"));
        ctx.drawImage(img, 0, 0);
        c.toBlob((b) => b ? resolve(b) : reject(new Error("blob")), "image/png");
      };
      img.onerror = () => reject(new Error("img"));
      img.src = URL.createObjectURL(blob);
    });
  };

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
      toast.error("Navegador não suporta copiar imagens");
      return;
    }
    try {
      // Passa Promise<Blob> direto pro ClipboardItem — preserva o user gesture
      // mesmo durante o fetch assíncrono (requisito do Safari/Chrome).
      const pngPromise = (async () => {
        const eapi = (window as any).electronAPI;
        let blob: Blob | null = null;
        if (eapi?.readTaskImage) {
          const res = await eapi.readTaskImage(path);
          if (res?.error || !res?.data?.base64) throw new Error(res?.error?.message || "download falhou");
          const bin = atob(res.data.base64);
          const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          blob = new Blob([arr], { type: res.data.mimeType || "image/png" });
        } else {
          const res = await supabase.storage.from(BUCKET).download(path);
          if (res.error || !res.data) throw new Error(res.error?.message || "download falhou");
          blob = res.data;
        }
        return await toPng(blob);
      })();

      try {
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": pngPromise as unknown as Promise<Blob> }),
        ]);
      } catch {
        // Fallback: aguarda o blob e tenta de novo (alguns browsers não aceitam Promise)
        const png = await pngPromise;
        await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      }

      setCopied(true);
      toast.success("Imagem copiada");
      setTimeout(() => setCopied(false), 1200);
    } catch (err) {
      console.error("[copy image]", err);
      toast.error(`Falha ao copiar: ${err instanceof Error ? err.message : "erro"}`);
    }
  };

  return (
    <div className="relative group">
      {url ? (
        <button
          type="button"
          onClick={handleCopy}
          className="block h-20 w-20 rounded border border-border/40 bg-black/20 overflow-hidden hover:ring-2 hover:ring-primary/60 active:scale-95 transition"
          title="Clique para copiar"
        >
          <img src={url} alt="preview" className="h-full w-full object-cover pointer-events-none" />
        </button>
      ) : (
        <div className="h-20 w-20 rounded border border-border/40 bg-black/20 flex items-center justify-center text-[9px] text-muted-foreground">…</div>
      )}
      {copied && (
        <div className="absolute inset-0 rounded bg-emerald-500/30 flex items-center justify-center pointer-events-none">
          <Check className="w-6 h-6 text-emerald-200" />
        </div>
      )}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
        title="Remover"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

export default function TaskImagePaste({ taskId, userId, imageUrls, onChange }: Props) {
  const urls = imageUrls || [];

  const addImage = async (blob: Blob) => {
    if (!blob.type.startsWith("image/")) { toast.error("Não é uma imagem"); return; }
    const path = await uploadBlob(userId, taskId, blob);
    if (path) {
      onChange([...urls, path]);
      toast.success(`Imagem ${urls.length + 1} anexada`);
    }
  };

  const tryPasteFromClipboard = async () => {
    // Electron desktop: usa IPC nativo (sem precisar de permissão do browser)
    const eapi = (window as any).electronAPI;
    if (eapi?.readClipboardImage) {
      try {
        const b64 = await eapi.readClipboardImage();
        if (!b64) { toast.message("Nenhuma imagem na área de transferência"); return; }
        const bin = atob(b64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        await addImage(new Blob([arr], { type: "image/png" }));
        return;
      } catch {
        toast.error("Falha ao ler clipboard");
        return;
      }
    }
    try {
      if (!navigator.clipboard?.read) {
        toast.error("Use Ctrl+V para colar");
        return;
      }
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const type = it.types.find((t) => t.startsWith("image/"));
        if (type) { const blob = await it.getType(type); await addImage(blob); return; }
      }
      toast.message("Nenhuma imagem na área de transferência");
    } catch {
      toast.error("Permissão negada — use Ctrl+V");
    }
  };

  return (
    <div
      onClick={tryPasteFromClipboard}
      onPaste={(e) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        for (const it of Array.from(items)) {
          if (it.kind === "file" && it.type.startsWith("image/")) {
            const file = it.getAsFile();
            if (file) { addImage(file); e.preventDefault(); return; }
          }
        }
      }}
      tabIndex={0}
      className="mt-2 rounded-md border border-dashed border-border/60 bg-background/40 p-2 cursor-pointer hover:border-primary/50 hover:bg-background/60 focus:outline-none focus:ring-1 focus:ring-primary/40 transition"
      title="Clique para colar imagem da área de transferência"
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground flex items-center gap-1">
          <ImageIcon className="w-3 h-3" /> Imagens da tarefa {urls.length > 0 ? `(${urls.length})` : "— clique para colar"}
        </div>
      </div>
      {urls.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {urls.map((p, i) => (
            <Thumb
              key={p}
              path={p}
              onRemove={() => {
                const eapi = (window as any).electronAPI;
                if (eapi?.removeTaskImage) eapi.removeTaskImage([p]).then(() => {});
                else supabase.storage.from(BUCKET).remove([p]).then(() => {});
                onChange(urls.filter((_, idx) => idx !== i));
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
