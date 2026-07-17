import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { MessageCircle, Plus, Trash2, Copy, KeyRound, Play, ChevronLeft, ChevronRight, Syringe } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useWhatsApp, extractMatchingLines } from "@/hooks/useWhatsApp";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import KeywordsTextarea from "@/components/KeywordsTextarea";
import ExtensionTokenInjectorDialog from "@/components/ExtensionTokenInjectorDialog";
import { IS_DESKTOP } from "@/lib/runtime";
import { cn } from "@/lib/utils";

const WhatsAppPanel = () => {
  const { messages, keywords, tokens, webhookUrl, replaceKeywords, createToken, removeToken, removeMessage, testMessage } = useWhatsApp();
  const { user } = useAuth();
  const [oldEnabled, setOldEnabled] = useState(true);
  const [showConfig, setShowConfig] = useState(false);
  const [testText, setTestText] = useState("");
  const [injectorOpen, setInjectorOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const [metaToken, setMetaToken] = useState<string>("");

  useEffect(() => { setIdx(0); }, [messages[0]?.id]);
  useEffect(() => {
    if (idx > messages.length - 1) setIdx(Math.max(0, messages.length - 1));
  }, [messages.length, idx]);

  useEffect(() => {
    const onOpen = () => {
      setShowConfig(true);
      setTimeout(() => {
        try {
          document.getElementById("wa-config-anchor")?.scrollIntoView({ behavior: "smooth", block: "start" });
        } catch {}
      }, 50);
    };
    window.addEventListener("wa:openConfig", onOpen as EventListener);
    return () => window.removeEventListener("wa:openConfig", onOpen as EventListener);
  }, []);

  useEffect(() => {
    if (!user) return;
    supabase.from("app_settings").select("value")
      .eq("user_id", user.id).eq("key", "wa_old_listener_enabled").maybeSingle()
      .then(({ data }) => setOldEnabled(data?.value !== "false"));
  }, [user]);

  useEffect(() => {
    (async () => {
      try {
        const api = (window as any).electronAPI;
        if (IS_DESKTOP && api?.metaGetConfig) {
          const r = await api.metaGetConfig().catch(() => null);
          const t = r?.data?.token;
          if (t) {
            setMetaToken(String(t));
            return;
          }
        }
        if (typeof localStorage !== "undefined") {
          const t = localStorage.getItem("monitor_push_forward_wa_token");
          if (t) setMetaToken(t);
        }
      } catch {}
    })();
  }, []);

  const toggleOldListener = async (val: boolean) => {
    if (!user) return;
    setOldEnabled(val);
    const { error } = await supabase.from("app_settings").upsert({
      user_id: user.id, key: "wa_old_listener_enabled", value: val ? "true" : "false",
    }, { onConflict: "user_id,key" });
    if (error) { toast.error(error.message); setOldEnabled(!val); }
    else toast.success(val ? "Listener antigo ativado" : "Listener antigo desativado");
  };

  const current = messages[idx];

  const handleRemove = async (id: string) => {
    await removeMessage(id);
    setIdx((i) => Math.max(0, Math.min(i, messages.length - 2)));
  };

  const copy = async (text: string, label = "Copiado") => {
    try { await navigator.clipboard.writeText(text); toast.success(label); } catch { toast.error("Falha ao copiar"); }
  };

  const applyMetaToken = async (token: string) => {
    try {
      try { localStorage.setItem("monitor_push_forward_wa_token", token); } catch {}
      const api = (window as any).electronAPI;
      if (IS_DESKTOP && api?.metaSetConfig) {
        await api.metaSetConfig({ token, enabled: true });
        try { await api.metaPollNow?.(); } catch {}
      }
      setMetaToken(token);
      toast.success("Token deste PC atualizado. Só metas com esse token vão notificar aqui.");
      try { window.dispatchEvent(new StorageEvent("storage", { key: "monitor_push_forward_wa_token", newValue: token })); } catch {}
    } catch (e: any) {
      toast.error(e?.message || "Falha ao salvar token");
    }
  };


  return (
    <div id="wa-config-anchor" className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-4 h-4 text-primary" />
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            WhatsApp ({messages.length})
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setShowConfig(true)} className="h-7 text-xs gap-1">
          <KeyRound className="w-3 h-3" /> Config
        </Button>
      </div>

      <Dialog open={showConfig} onOpenChange={setShowConfig}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Configurações WhatsApp</DialogTitle>
          </DialogHeader>

          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 flex items-center justify-between gap-2">
            <div>
              <div className="text-[11px] font-bold">Listener antigo (PC sem .exe)</div>
              <div className="text-[10px] text-muted-foreground">Quando desligado, o servidor ignora mensagens vindas do listener antigo.</div>
            </div>
            <Switch checked={oldEnabled} onCheckedChange={toggleOldListener} />
          </div>

          <div className="rounded-md border border-border/40 bg-background/40 p-3 space-y-3">
            <div className="space-y-1">
              <div className="text-[10px] uppercase font-bold text-muted-foreground">Webhook URL</div>
              <div className="flex gap-1">
                <Input readOnly value={webhookUrl} className="h-8 text-xs font-mono" onFocus={(e) => e.currentTarget.select()} />
                <Button size="sm" variant="outline" className="h-8" onClick={() => copy(webhookUrl, "URL copiada")}><Copy className="w-3 h-3" /></Button>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <div className="text-[10px] uppercase font-bold text-muted-foreground">Tokens do listener</div>
                <div className="flex gap-1">
                  {IS_DESKTOP && (
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setInjectorOpen(true)} title="Injetar token em uma extensão .zip">
                      <Syringe className="w-3 h-3" /> Injetor
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => createToken()}><Plus className="w-3 h-3" /> Gerar</Button>
                </div>
              </div>
              {tokens.length === 0 ? (
                <div className="text-[11px] text-muted-foreground italic">Nenhum token. Gere um e cole no listener.js como TOKEN.</div>
              ) : (
                <div className="space-y-1">
                  {tokens.map((t) => (
                    <div key={t.id} className="flex items-center gap-1">
                      <Input
                        readOnly
                        value={t.token}
                        className={cn(
                          "h-7 text-[11px] font-mono",
                          metaToken === t.token && "border-primary ring-1 ring-primary"
                        )}
                        onFocus={(e) => e.currentTarget.select()}
                      />
                      <Button
                        size="sm"
                        variant={metaToken === t.token ? "default" : "outline"}
                        className="h-7 text-[10px] px-2"
                        onClick={() => applyMetaToken(t.token)}
                        title="Usar este token para receber notificações de Meta neste PC"
                      >
                        {metaToken === t.token ? "✓ Ativo aqui" : "Usar neste PC"}
                      </Button>
                      <Button size="sm" variant="outline" className="h-7" onClick={() => copy(t.token, "Token copiado")}><Copy className="w-3 h-3" /></Button>
                      <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={() => removeToken(t.id)}><Trash2 className="w-3 h-3" /></Button>
                    </div>
                  ))}
                  {metaToken && !tokens.some((t) => t.token === metaToken) && (
                    <div className="text-[10px] text-amber-600 dark:text-amber-400 pt-1">
                      ⚠ Token ativo neste PC ({metaToken.slice(0, 12)}…) não está na lista acima. Selecione um da lista pra alinhar.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>


      <div className="space-y-2">
        <div className="text-[10px] uppercase font-bold text-muted-foreground">
          Palavras-chave (uma por linha — vazio = enviar tudo dos grupos)
        </div>
        <KeywordsTextarea keywords={keywords} onSave={replaceKeywords} rows={8} />
      </div>

      <div className="space-y-1 rounded-md border border-border/40 bg-background/40 p-2">
        <div className="text-[10px] uppercase font-bold text-muted-foreground">Testar notificação</div>
        <Textarea
          value={testText}
          onChange={(e) => setTestText(e.target.value)}
          placeholder="Digite uma mensagem com a palavra-chave..."
          className="text-xs min-h-[60px]"
        />
        <Button
          size="sm"
          className="h-8 w-full gap-1"
          onClick={() => { if (testText.trim()) { testMessage(testText); } }}
        >
          <Play className="w-3 h-3" /> Testar
        </Button>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase font-bold text-muted-foreground">Mensagens recebidas (últimas 24h)</div>
          {messages.length > 0 && (
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0" disabled={idx >= messages.length - 1}
                onClick={() => setIdx((i) => Math.min(messages.length - 1, i + 1))} title="Anterior">
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
              <span className="text-[10px] text-muted-foreground tabular-nums">{idx + 1}/{messages.length}</span>
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0" disabled={idx <= 0}
                onClick={() => setIdx((i) => Math.max(0, i - 1))} title="Próxima">
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}
        </div>
        {!current ? (
          <div className="text-[11px] text-muted-foreground italic text-center py-4">
            Aguardando mensagens... configure o listener.js no seu PC.
          </div>
        ) : (
          <div key={current.id} className="rounded-md border border-border/40 bg-background/40 p-2 text-xs group">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-primary truncate">{current.autor}</span>
                  {current.telefone && (
                    <span className="text-[10px] text-muted-foreground">{current.telefone}</span>
                  )}
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(current.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </span>
                  {current.matched.map((p) => (
                    <Badge key={p} variant="outline" className="h-4 text-[9px] px-1">{p}</Badge>
                  ))}
                </div>
                <div className="mt-1 whitespace-pre-wrap break-words font-medium">
                  {extractMatchingLines(current.mensagem, current.matched)}
                </div>
              </div>
              <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition">
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => copy(current.mensagem)}><Copy className="w-3 h-3" /></Button>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive" onClick={() => handleRemove(current.id)}><Trash2 className="w-3 h-3" /></Button>
              </div>
            </div>
          </div>
        )}
      </div>
      <ExtensionTokenInjectorDialog open={injectorOpen} onOpenChange={setInjectorOpen} />
    </div>
  );
};

export default WhatsAppPanel;
