import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, Copy, Play } from "lucide-react";
import { useWhatsApp } from "@/hooks/useWhatsApp";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import KeywordsTextarea from "@/components/KeywordsTextarea";
import { IS_DESKTOP } from "@/lib/runtime";
import { useLiveChatEnabled, setLiveChatEnabled } from "@/hooks/useLiveChatEnabled";

export default function WhatsAppConfigSection() {
  const {
    keywords,
    tokens,
    webhookUrl,
    replaceKeywords,
    createToken,
    removeToken,
    testMessage,
  } = useWhatsApp();
  const { user } = useAuth();

  const [oldEnabled, setOldEnabled] = useState(true);
  const [testText, setTestText] = useState("");
  const [metaToken, setMetaToken] = useState<string>("");
  const [proofTtlMin, setProofTtlMin] = useState<number>(30);
  const [proofTtlDirty, setProofTtlDirty] = useState(false);
  const [forwardNumbers, setForwardNumbers] = useState<string>("");
  const [forwardDirty, setForwardDirty] = useState(false);
  

  useEffect(() => {
    if (!IS_DESKTOP) return;
    const api = (window as any).electronAPI;
    api?.waConfigGet?.().then((r: any) => {
      const v = Number(r?.data?.proof_ttl_min);
      if (isFinite(v) && v > 0) setProofTtlMin(v);
      const fn = r?.data?.forward_numbers;
      if (typeof fn === "string") setForwardNumbers(fn);
    }).catch(() => {});
  }, []);

  const saveProofTtl = async () => {
    const api = (window as any).electronAPI;
    if (!api?.waConfigSet) return;
    await api.waConfigSet({ proof_ttl_min: proofTtlMin });
    setProofTtlDirty(false);
    toast.success(`Tempo de espera do comprovante: ${proofTtlMin} min`);
  };

  const saveForwardNumbers = async () => {
    const api = (window as any).electronAPI;
    if (!api?.waConfigSet) return;
    await api.waConfigSet({ forward_numbers: forwardNumbers });
    setForwardDirty(false);
    toast.success("Números de reencaminhamento salvos");
  };

  useEffect(() => {
    (async () => {
      try {
        const api = (window as any).electronAPI;
        if (IS_DESKTOP && api?.metaGetConfig) {
          const r = await api.metaGetConfig().catch(() => null);
          const t = r?.data?.token;
          if (t) { setMetaToken(String(t)); return; }
        }
        if (typeof localStorage !== "undefined") {
          const t = localStorage.getItem("monitor_push_forward_wa_token");
          if (t) setMetaToken(t);
        }
      } catch {}
    })();
  }, []);

  const applyMetaToken = async (token: string) => {
    try {
      try { localStorage.setItem("monitor_push_forward_wa_token", token); } catch {}
      const api = (window as any).electronAPI;
      if (IS_DESKTOP && api?.metaSetConfig) {
        await api.metaSetConfig({ token, enabled: true });
        try { await api.metaPollNow?.(); } catch {}
      }
      setMetaToken(token);
      toast.success("Token deste PC atualizado.");
      try { window.dispatchEvent(new StorageEvent("storage", { key: "monitor_push_forward_wa_token", newValue: token })); } catch {}
    } catch (e: any) {
      toast.error(e?.message || "Falha ao salvar token");
    }
  };

  useEffect(() => {
    if (!user) return;
    supabase
      .from("app_settings")
      .select("value")
      .eq("user_id", user.id)
      .eq("key", "wa_old_listener_enabled")
      .maybeSingle()
      .then(({ data }) => setOldEnabled(data?.value !== "false"));
  }, [user]);

  const toggleOldListener = async (val: boolean) => {
    if (!user) return;
    setOldEnabled(val);
    const { error } = await supabase.from("app_settings").upsert(
      { user_id: user.id, key: "wa_old_listener_enabled", value: val ? "true" : "false" },
      { onConflict: "user_id,key" }
    );
    if (error) { toast.error(error.message); setOldEnabled(!val); }
    else toast.success(val ? "Listener antigo ativado" : "Listener antigo desativado");
  };

  const copy = async (text: string, label = "Copiado") => {
    try { await navigator.clipboard.writeText(text); toast.success(label); }
    catch { toast.error("Falha ao copiar"); }
  };

  const liveChatEnabled = useLiveChatEnabled();

  return (
    <div className="space-y-4">
      {/* Chat ao vivo (performance) */}
      <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-emerald-300">Chat ao vivo no Monitor</div>
          <div className="text-[11px] text-muted-foreground">
            Desative para deixar o app mais leve. O card volta a mostrar só o Modelo PIX.
          </div>
        </div>
        <Switch checked={liveChatEnabled} onCheckedChange={setLiveChatEnabled} />
      </div>

      {/* Listener antigo */}
      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-amber-300">Listener antigo (PC sem .exe)</div>
          <div className="text-[11px] text-muted-foreground">
            Quando desligado, o servidor ignora mensagens vindas do listener antigo.
          </div>
        </div>
        <Switch checked={oldEnabled} onCheckedChange={toggleOldListener} />
      </div>

      {/* Webhook */}
      <div className="space-y-1.5">
        <h3 className="text-sm font-semibold">Webhook URL</h3>
        <div className="flex gap-1">
          <Input readOnly value={webhookUrl} className="h-8 text-[11px] font-mono" onFocus={(e) => e.currentTarget.select()} />
          <Button size="sm" variant="outline" className="h-8" onClick={() => copy(webhookUrl, "URL copiada")}>
            <Copy className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* Tokens */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Tokens do listener</h3>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => createToken()}>
              <Plus className="w-3 h-3" /> Gerar
            </Button>
          </div>
        </div>
        {tokens.length === 0 ? (
          <div className="text-[11px] text-muted-foreground italic">
            Nenhum token. Gere um e cole no listener.js como TOKEN.
          </div>
        ) : (
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {tokens.map((t) => {
              const isActive = metaToken && metaToken === t.token;
              return (
                <div key={t.id} className="flex items-center gap-1">
                  <Input
                    readOnly
                    value={t.token}
                    className={cn("h-7 text-[11px] font-mono", isActive && "border-primary ring-1 ring-primary")}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <Button
                    size="sm"
                    variant={isActive ? "default" : "outline"}
                    className="h-7 text-[10px] px-2"
                    onClick={() => applyMetaToken(t.token)}
                    title="Usar este token para receber notificações neste PC"
                  >
                    {isActive ? "✓ Ativo aqui" : "Usar neste PC"}
                  </Button>
                  <Button size="sm" variant="outline" className="h-7" onClick={() => copy(t.token, "Token copiado")}>
                    <Copy className="w-3 h-3" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={() => removeToken(t.id)}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              );
            })}
            {metaToken && !tokens.some((t) => t.token === metaToken) && (
              <div className="text-[10px] text-amber-600 dark:text-amber-400 pt-1">
                ⚠ Token ativo neste PC ({metaToken.slice(0, 12)}…) não está na lista acima.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Palavras-chave */}
      <div className="space-y-1.5">
        <h3 className="text-sm font-semibold">Palavras-chave ({keywords.length})</h3>
        <p className="text-[11px] text-muted-foreground">Uma por linha.</p>
        <KeywordsTextarea keywords={keywords} onSave={replaceKeywords} rows={8} />
      </div>

      {/* Tempo espera comprovante */}
      {IS_DESKTOP && (
        <div className="rounded-md border border-border/40 bg-muted/30 p-3 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">Tempo de espera do comprovante</h3>
              <p className="text-[11px] text-muted-foreground">
                Após enviar o PIX, o app aguarda anexo/comprovante por este tempo. Depois disso, anexos são ignorados.
              </p>
            </div>
            <div className="text-sm font-mono tabular-nums font-bold text-primary shrink-0">{proofTtlMin} min</div>
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              max={720}
              value={proofTtlMin}
              onChange={(e) => {
                const v = parseInt(e.target.value || "0", 10);
                if (isFinite(v) && v > 0) { setProofTtlMin(v); setProofTtlDirty(true); }
              }}
              className="h-8 w-24 text-xs"
            />
            <Button size="sm" variant={proofTtlDirty ? "default" : "outline"} onClick={saveProofTtl} disabled={!proofTtlDirty} className="h-8">
              Salvar
            </Button>
          </div>
        </div>
      )}

      {/* Reencaminhar para número */}
      {IS_DESKTOP && (
        <div className="rounded-md border border-border/40 bg-muted/30 p-3 space-y-1.5">
          <h3 className="text-sm font-semibold">Reencaminhar mensagens que casam com palavra-chave</h3>
          <p className="text-[11px] text-muted-foreground">
            Um número por linha, com DDI+DDD (ex.: 5511987654321). Deixe vazio para desativar.
          </p>
          <Textarea
            value={forwardNumbers}
            onChange={(e) => { setForwardNumbers(e.target.value); setForwardDirty(true); }}
            placeholder="5511987654321"
            className="text-xs font-mono min-h-[70px]"
          />
          <Button
            size="sm"
            variant={forwardDirty ? "default" : "outline"}
            onClick={saveForwardNumbers}
            disabled={!forwardDirty}
            className="h-8 w-full"
          >
            Salvar números
          </Button>
        </div>
      )}

      {/* Teste */}
      <div className="rounded-md border border-border/40 bg-muted/30 p-3 space-y-1.5">
        <h3 className="text-sm font-semibold">Testar notificação</h3>
        <Textarea
          value={testText}
          onChange={(e) => setTestText(e.target.value)}
          placeholder="Digite uma mensagem com a palavra-chave..."
          className="text-xs min-h-[60px]"
        />
        <Button size="sm" className="h-8 w-full gap-1" onClick={() => { if (testText.trim()) testMessage(testText); }}>
          <Play className="w-3 h-3" /> Testar
        </Button>
      </div>
    </div>
  );
}
