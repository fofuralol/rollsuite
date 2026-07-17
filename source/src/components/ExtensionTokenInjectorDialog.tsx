import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { FileArchive, Plus, Syringe, Copy, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useWhatsApp } from "@/hooks/useWhatsApp";
import { IS_DESKTOP } from "@/lib/runtime";
import { createClient } from "@supabase/supabase-js";

type ZipInfo = {
  zipPath: string;
  currentToken: string;
  currentSupabaseUrl: string | null;
  targetSupabaseUrl: string;
  needsUrlSwap: boolean;
  files: { file: string; count: number; urlCount?: number }[];
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const CLOUD_URL = import.meta.env.VITE_SUPABASE_URL as string;
const CLOUD_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

const nickToEmail = (value: string) => {
  const text = value.trim();
  if (text.includes("@")) return text.toLowerCase();
  return `${text.toLowerCase().replace(/[^a-z0-9_]/g, "")}@rolls.local`;
};

export default function ExtensionTokenInjectorDialog({ open, onOpenChange }: Props) {
  const { tokens, createToken } = useWhatsApp();
  const [zip, setZip] = useState<ZipInfo | null>(null);
  const [selectedToken, setSelectedToken] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState<string>("");
  const [log, setLog] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const [syncEmail, setSyncEmail] = useState<string>(() => {
    try { return localStorage.getItem("monitor_sync_email") || ""; } catch { return ""; }
  });
  const [syncPwd, setSyncPwd] = useState<string>(() => {
    try { return localStorage.getItem("monitor_sync_pwd") || ""; } catch { return ""; }
  });
  useEffect(() => { try { localStorage.setItem("monitor_sync_email", syncEmail); } catch {} }, [syncEmail]);
  useEffect(() => { try { localStorage.setItem("monitor_sync_pwd", syncPwd); } catch {} }, [syncPwd]);

  useEffect(() => {
    if (!IS_DESKTOP) return;
    const api: any = (window as any).electronAPI;
    const off = api?.onExtInjectProgress?.((p: any) => {
      if (typeof p.pct === "number") setProgress(p.pct);
      if (p.step) setStep(p.step);
      if (p.log) setLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${p.log}`]);
    });
    return () => off?.();
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  useEffect(() => {
    if (!open) {
      setZip(null); setSelectedToken(""); setBusy(false);
      setProgress(0); setStep(""); setLog([]);
    }
  }, [open]);

  const pickZip = async () => {
    const api: any = (window as any).electronAPI;
    if (!api?.extPickAndRead) { toast.error("Disponível apenas no app desktop"); return; }
    const { data, error } = await api.extPickAndRead();
    if (error) { toast.error(error.message); return; }
    if (!data) return;
    setZip(data);
    try { localStorage.setItem("desktop_extension_token", data.currentToken); } catch {}
    setLog((p) => [...p,
      `[${new Date().toLocaleTimeString()}] Carregado: ${data.zipPath}`,
      `[${new Date().toLocaleTimeString()}] Token atual: ${data.currentToken}`,
      `[${new Date().toLocaleTimeString()}] URL atual: ${data.currentSupabaseUrl || "(nenhuma)"}`,
      `[${new Date().toLocaleTimeString()}] URL alvo:  ${data.targetSupabaseUrl}${data.needsUrlSwap ? " ⚠️ vai ser trocada" : " ✓ igual"}`,
      ...data.files.map((f: any) => `[${new Date().toLocaleTimeString()}] ${f.file}: ${f.count} token(s), ${f.urlCount ?? 0} URL(s)`),
    ]);
  };

  const validateTokenInBackend = async (token: string) => {
    const res = await fetch(`${CLOUD_URL}/functions/v1/meta-events-recent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: CLOUD_KEY,
        Authorization: `Bearer ${CLOUD_KEY}`,
      },
      body: JSON.stringify({ token, since: new Date().toISOString() }),
    });
    if (res.ok) return { ok: true as const };
    const text = await res.text().catch(() => "");
    return { ok: false as const, status: res.status, text };
  };

  const syncTokenToBackend = async (token: string) => {
    const email = syncEmail.trim();
    const pwd = syncPwd;

    if (!email || !pwd) {
      return {
        ok: false as const,
        message: "Informe email e senha logo acima e tente novamente.",
      };
    }

    const cloud = createClient(CLOUD_URL, CLOUD_KEY, { auth: { persistSession: false } });
    const { data, error } = await cloud.auth.signInWithPassword({ email: nickToEmail(email), password: pwd });
    if (error || !data.user) {
      return { ok: false as const, message: error?.message || "Falha ao autenticar no backend" };
    }

    const existing = await cloud.from("wa_tokens").select("id").eq("token", token).maybeSingle();
    if (existing.error && existing.error.code !== "PGRST116") {
      await cloud.auth.signOut().catch(() => {});
      return { ok: false as const, message: existing.error.message };
    }

    if (!existing.data?.id) {
      const insert = await cloud.from("wa_tokens").insert({ token, label: "desktop", user_id: data.user.id });
      if (insert.error) {
        await cloud.auth.signOut().catch(() => {});
        return { ok: false as const, message: insert.error.message };
      }
    }

    await cloud.auth.signOut().catch(() => {});
    return { ok: true as const };
  };

  const doInject = async () => {
    if (!zip || !selectedToken) return;
    if (selectedToken === zip.currentToken && !zip.needsUrlSwap) {
      toast.message("Token e URL já estão corretos");
      return;
    }
    // Validação: o token precisa existir no banco, senão o meta-webhook devolve 401
    // e nenhum evento chega no card de Metas.
    const exists = tokens.some((t) => t.token === selectedToken);
    if (!exists) {
      toast.error("Token não está salvo na nuvem — gere outro ou faça login antes.");
      setLog((p) => [...p, `[${new Date().toLocaleTimeString()}] ❌ Abortado: token ${selectedToken.slice(0, 12)}… não existe em wa_tokens (webhook retornaria 401)`]);
      return;
    }
    try {
      const validation = await validateTokenInBackend(selectedToken);
      if (!validation.ok) {
        setLog((p) => [...p, `[${new Date().toLocaleTimeString()}] ⚠ Backend recusou o token (${validation.status}): ${validation.text.slice(0, 160)}`]);
        setLog((p) => [...p, `[${new Date().toLocaleTimeString()}] Tentando sincronizar token local com backend…`]);
        const synced = await syncTokenToBackend(selectedToken);
        if (!synced.ok) {
          toast.error("Token não está salvo no backend", { description: synced.message });
          setLog((p) => [...p, `[${new Date().toLocaleTimeString()}] ❌ Sync falhou: ${synced.message}`]);
          return;
        }
        const recheck = await validateTokenInBackend(selectedToken);
        if (!recheck.ok) {
          toast.error("Backend ainda recusou o token após sincronizar.");
          setLog((p) => [...p, `[${new Date().toLocaleTimeString()}] ❌ Revalidação falhou (${recheck.status}): ${recheck.text.slice(0, 160)}`]);
          return;
        }
        setLog((p) => [...p, `[${new Date().toLocaleTimeString()}] ✓ Token sincronizado e validado no backend`]);
      }
    } catch (error: any) {
      toast.error(error?.message || "Falha ao validar token no backend");
      return;
    }
    setBusy(true); setProgress(0); setStep("Iniciando…");
    const api: any = (window as any).electronAPI;
    const { data, error } = await api.extInjectToken({
      zipPath: zip.zipPath,
      newToken: selectedToken,
      newSupabaseUrl: zip.targetSupabaseUrl,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    try {
      localStorage.setItem("desktop_extension_token", selectedToken);
      localStorage.setItem("monitor_push_forward_wa_token", selectedToken);
      window.dispatchEvent(new StorageEvent("storage", { key: "monitor_push_forward_wa_token", newValue: selectedToken }));
    } catch {}
    try {
      await api?.metaSetConfig?.({ token: selectedToken, enabled: true });
      await api?.metaPollNow?.();
    } catch {}
    toast.success(zip.needsUrlSwap ? "Token + URL do Supabase injetados" : "Token injetado");
    setZip({ ...zip, currentToken: selectedToken, currentSupabaseUrl: zip.targetSupabaseUrl, needsUrlSwap: false });
  };

  const copy = (s: string) => { navigator.clipboard.writeText(s); toast.success("Copiado"); };

  const doGenerate = async () => {
    if (!selectedToken) { toast.error("Selecione um token abaixo"); return; }
    const api: any = (window as any).electronAPI;
    if (!api?.extGenerate) { toast.error("Disponível apenas no app desktop"); return; }
    setBusy(true); setProgress(0); setStep("Iniciando…");
    const { data, error } = await api.extGenerate({ token: selectedToken });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    if (!data) return; // cancelled
    try {
      localStorage.setItem("desktop_extension_token", selectedToken);
      localStorage.setItem("monitor_push_forward_wa_token", selectedToken);
      window.dispatchEvent(new StorageEvent("storage", { key: "monitor_push_forward_wa_token", newValue: selectedToken }));
    } catch {}
    toast.success(`Extensão pronta: ${data.zipPath}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Syringe className="w-4 h-4 text-primary" /> Injetor de token na extensão
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Step 0: gerar extensão pronta */}
          <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 space-y-2">
            <div className="text-[10px] uppercase font-bold tracking-wider text-primary">
              Extensão pronta pra este PC
            </div>
            <div className="text-[11px] text-muted-foreground">
              Gera um .zip com o token selecionado e a URL deste app já injetados.
              Selecione um token abaixo antes de gerar.
            </div>
            <Button
              onClick={doGenerate}
              disabled={!selectedToken || busy}
              className="w-full gap-2"
              variant="default"
            >
              <FileArchive className="w-4 h-4" />
              {busy ? "Gerando…" : "Gerar extensão pré-configurada"}
            </Button>
          </div>

          {/* Step 1: pick zip (avançado) */}
          <div className="rounded-lg border border-border/60 bg-card/40 p-3 space-y-2">
            <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">1. Ou re-injetar em zip existente</div>
            {!zip ? (
              <Button onClick={pickZip} variant="outline" className="w-full gap-2">
                <FileArchive className="w-4 h-4" /> Selecionar extensão zipada
              </Button>
            ) : (
              <div className="space-y-2">
                <div className="text-[11px] text-muted-foreground truncate" title={zip.zipPath}>📦 {zip.zipPath}</div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px]">Token atual</Badge>
                  <Input readOnly value={zip.currentToken} className="h-7 text-[11px] font-mono" onFocus={(e) => e.currentTarget.select()} />
                  <Button size="sm" variant="ghost" className="h-7" onClick={() => copy(zip.currentToken)}>
                    <Copy className="w-3 h-3" />
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={zip.needsUrlSwap ? "destructive" : "secondary"} className="text-[10px]">
                    URL Supabase
                  </Badge>
                  <Input
                    readOnly
                    value={zip.needsUrlSwap ? `${zip.currentSupabaseUrl} → ${zip.targetSupabaseUrl}` : zip.targetSupabaseUrl}
                    className="h-7 text-[10px] font-mono"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                </div>
                {zip.needsUrlSwap && (
                  <div className="text-[10px] text-amber-500">
                    ⚠️ Extensão aponta pra outro projeto — a URL será trocada junto com o token.
                  </div>
                )}
                <Button onClick={pickZip} variant="ghost" size="sm" className="text-[11px] h-7">Trocar arquivo</Button>
              </div>
            )}
          </div>

          {/* Step 2: tokens */}
          <div className="rounded-lg border border-border/60 bg-card/40 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
                2. Tokens do WhatsApp ({tokens.length})
              </div>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => createToken("desktop")}>
                <Plus className="w-3 h-3" /> Gerar novo
              </Button>
            </div>
            {tokens.length === 0 ? (
              <div className="text-[11px] text-muted-foreground italic">Nenhum token. Gere um.</div>
            ) : (
              <div className="space-y-1 max-h-44 overflow-y-auto">
                {tokens.map((t) => {
                  const isCurrent = zip?.currentToken === t.token;
                  const isSelected = selectedToken === t.token;
                  return (
                    <label
                      key={t.id}
                      className={`flex items-center gap-2 p-1.5 rounded border cursor-pointer transition ${
                        isSelected ? "border-primary bg-primary/10" : "border-border/40 hover:bg-muted/30"
                      }`}
                    >
                      <input
                        type="radio"
                        name="tok"
                        checked={isSelected}
                        onChange={() => setSelectedToken(t.token)}
                        className="accent-primary"
                      />
                      <Input readOnly value={t.token} className="h-6 text-[11px] font-mono border-0 bg-transparent" onFocus={(e) => e.currentTarget.select()} />
                      {isCurrent && <Badge variant="default" className="text-[9px] gap-1"><CheckCircle2 className="w-2.5 h-2.5" />atual</Badge>}
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Step 2.5: credentials (persistidas em localStorage — usadas se o token precisar ser sincronizado no backend) */}
          <div className="rounded-lg border border-border/60 bg-card/40 p-3 space-y-2">
            <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
              2b. Login da nuvem (email + senha)
            </div>
            <div className="text-[10px] text-muted-foreground">
              Usado apenas se o token ainda não estiver salvo no backend. Fica salvo neste dispositivo.
            </div>
            <Input
              type="email"
              placeholder="email ou apelido"
              value={syncEmail}
              onChange={(e) => setSyncEmail(e.target.value)}
              autoComplete="username"
              className="h-8 text-xs"
            />
            <Input
              type="password"
              placeholder="senha"
              value={syncPwd}
              onChange={(e) => setSyncPwd(e.target.value)}
              autoComplete="current-password"
              className="h-8 text-xs"
            />
          </div>

          {/* Step 3: inject */}
          <div className="rounded-lg border border-border/60 bg-card/40 p-3 space-y-2">
            <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">3. Injetar</div>
            <Button
              onClick={doInject}
              disabled={!zip || !selectedToken || busy}
              className="w-full gap-2"
            >
              <Syringe className="w-4 h-4" />
              {busy ? "Injetando…" : "Injetar token selecionado na extensão"}
            </Button>
            {(busy || progress > 0) && (
              <div className="space-y-1">
                <Progress value={progress} />
                <div className="text-[11px] text-muted-foreground">{step} — {progress}%</div>
              </div>
            )}
          </div>

          {/* Log */}
          <div className="rounded-lg border border-border/60 bg-black/40 p-2">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> Log
              </div>
              {log.length > 0 && (
                <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setLog([])}>limpar</Button>
              )}
            </div>
            <div
              ref={logRef}
              className="h-32 overflow-y-auto font-mono text-[10px] text-muted-foreground whitespace-pre-wrap"
            >
              {log.length === 0 ? <span className="italic">Aguardando…</span> : log.join("\n")}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
