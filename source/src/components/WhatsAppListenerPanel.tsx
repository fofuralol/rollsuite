import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Play, Square, LogOut, Save, Wifi, WifiOff, QrCode, Settings2, Cloud, CloudOff, History } from "lucide-react";
import { IS_DESKTOP } from "@/lib/runtime";
import { toast } from "sonner";

interface WaDiagnostics {
  connectedAs?: string | null;
  keywordsCount: number;
  keywordsSample: string[];
  keywordsDiskCount: number;
  groupFiltersCount: number;
  groupFilters: string[];
  totalGroupChats: number;
  matchedGroupsCount: number;
  matchedGroups: string[];
  unmatchedFilters: string[];
  cloudSyncEnabled: boolean;
  checkedAt: string;
}

interface WaState {
  status: "disconnected" | "starting" | "qr" | "connected" | "error";
  qr: string | null;
  info: { wid?: string; pushname?: string } | null;
  progress?: string;
  diagnostics?: WaDiagnostics;
}

export default function WhatsAppListenerPanel() {
  const [state, setState] = useState<WaState>({ status: "disconnected", qr: null, info: null });
  const [groups, setGroups] = useState("");
  const [cloudToken, setCloudToken] = useState("");
  const [cloudSyncEnabled, setCloudSyncEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [tokenDirty, setTokenDirty] = useState(false);

  useEffect(() => {
    if (!IS_DESKTOP) return;
    const api = (window as any).electronAPI;
    api.waState().then((r: any) => r?.data && setState(r.data));
    api.waConfigGet().then((r: any) => {
      if (r?.data?.groups != null) setGroups(r.data.groups);
      if (r?.data?.cloud_token != null) setCloudToken(r.data.cloud_token);
      if (r?.data?.cloud_sync_enabled != null) setCloudSyncEnabled(!!r.data.cloud_sync_enabled);
    });
    const off = api.onWaState?.((s: WaState) => setState(s));
    return () => { try { off?.(); } catch {} };
  }, []);

  if (!IS_DESKTOP) return null;

  const api = (window as any).electronAPI;

  const start = async () => {
    setBusy(true);
    const r = await api.waStart();
    setBusy(false);
    if (r?.error) toast.error(r.error.message);
  };
  const stop = async () => { setBusy(true); await api.waStop(); setBusy(false); };
  const logout = async () => {
    if (!confirm("Remover sessão do WhatsApp? Vai precisar escanear o QR de novo.")) return;
    setBusy(true); await api.waLogout(); setBusy(false);
  };
  const saveGroups = async () => {
    await api.waConfigSet({ groups });
    setDirty(false);
    toast.success("Grupos salvos");
  };
  const saveCloudToken = async () => {
    await api.waConfigSet({ cloud_token: cloudToken.trim(), cloud_sync_enabled: cloudSyncEnabled });
    setTokenDirty(false);
    if (!cloudSyncEnabled || !cloudToken.trim()) {
      toast.success("Sincronização nuvem desativada");
    } else {
      toast.success("Sincronização nuvem ativada");
    }
  };

  const [backfilling, setBackfilling] = useState(false);
  const runBackfill = async () => {
    if (state.status !== "connected") { toast.error("Conecte o WhatsApp primeiro"); return; }
    setBackfilling(true);
    try {
      const r = await api.waBackfill({ hours: 24, perChat: 50 });
      if (r?.error) { toast.error(r.error.message); return; }
      const d = r?.data || {};
      if (d.ok) toast.success(`Recuperadas: ${d.processed || 0} mensagem(ns) analisadas de ${d.scanned || 0}`);
      else toast.error(d.error || "Falha ao recuperar");
    } finally { setBackfilling(false); }
  };


  const statusBadge = (() => {
    switch (state.status) {
      case "connected": return <Badge className="bg-emerald-600/20 text-emerald-400 border-emerald-600/30"><Wifi className="w-3 h-3 mr-1" />Conectado{state.info?.pushname ? ` · ${state.info.pushname}` : ""}</Badge>;
      case "qr": return <Badge variant="outline" className="text-amber-400 border-amber-600/30"><QrCode className="w-3 h-3 mr-1" />Aguardando QR</Badge>;
      case "starting": return <Badge variant="outline"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Iniciando…</Badge>;
      case "error": return <Badge variant="destructive">Erro</Badge>;
      default: return <Badge variant="outline" className="text-muted-foreground"><WifiOff className="w-3 h-3 mr-1" />Desconectado</Badge>;
    }
  })();

  return (
    <Card className="p-3 md:p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Listener WhatsApp</span>
          {statusBadge}
        </div>
        <div className="flex gap-2">
          {state.status === "connected" || state.status === "qr" || state.status === "starting" ? (
            <Button size="sm" variant="outline" onClick={stop} disabled={busy}><Square className="w-3.5 h-3.5 mr-1" />Parar</Button>
          ) : (
            <Button size="sm" onClick={start} disabled={busy}><Play className="w-3.5 h-3.5 mr-1" />Iniciar</Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.dispatchEvent(new Event("wa:openConfig"))}
            title="Configurações (token, webhook, palavras-chave)"
          >
            <Settings2 className="w-3.5 h-3.5 mr-1" />Config
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={runBackfill}
            disabled={backfilling || state.status !== "connected"}
            title="Recuperar mensagens antigas (últimas 24h) que casem com as palavras-chave"
          >
            {backfilling ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <History className="w-3.5 h-3.5 mr-1" />}
            Recuperar
          </Button>
          <Button size="sm" variant="ghost" onClick={logout} disabled={busy} title="Remover sessão"><LogOut className="w-3.5 h-3.5" /></Button>
        </div>
      </div>

      {state.progress && (
        <p className="text-xs text-muted-foreground">{state.progress}</p>
      )}

      {state.status === "connected" && state.diagnostics && (() => {
        const d = state.diagnostics;
        const okKw = d.keywordsCount > 0;
        const okGrp = d.groupFiltersCount === 0 || d.matchedGroupsCount > 0;
        const Row = ({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) => (
          <div className="flex items-start gap-2 text-xs">
            <span className={ok ? "text-emerald-400" : "text-amber-400"}>{ok ? "✓" : "⚠"}</span>
            <div className="flex-1">
              <div className="font-medium">{label}</div>
              {detail && <div className="text-muted-foreground text-[11px] break-all">{detail}</div>}
            </div>
          </div>
        );
        return (
          <div className="rounded-lg border border-border bg-card/40 p-2.5 space-y-1.5">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Diagnóstico da conexão</div>
            <Row
              ok={okKw}
              label={`Palavras-chave: ${d.keywordsCount}`}
              detail={d.keywordsSample.length ? `ex.: ${d.keywordsSample.join(", ")}${d.keywordsCount > d.keywordsSample.length ? "…" : ""}` : "nenhuma cadastrada"}
            />
            <Row
              ok={okGrp}
              label={`Grupos mapeados: ${d.matchedGroupsCount}/${d.groupFiltersCount} filtros (${d.totalGroupChats} grupos no WhatsApp)`}
              detail={d.matchedGroups.length ? d.matchedGroups.join(" · ") : (d.groupFiltersCount ? "nenhum filtro casou" : "sem filtros — todos os grupos passam")}
            />
            {d.unmatchedFilters.length > 0 && (
              <Row ok={false} label={`${d.unmatchedFilters.length} filtro(s) sem grupo`} detail={d.unmatchedFilters.join(", ")} />
            )}
            <Row
              ok={true}
              label={`Sincronização nuvem: ${d.cloudSyncEnabled ? "ativa" : "desativada"}`}
            />
          </div>
        );
      })()}

      {state.status === "qr" && state.qr && (
        <div className="flex flex-col items-center gap-2 p-3 rounded-lg bg-card/50 border border-border">
          <img src={state.qr} alt="QR WhatsApp" className="w-56 h-56 rounded bg-white p-2" />
          <p className="text-xs text-muted-foreground">Abra WhatsApp → Aparelhos conectados → Conectar aparelho</p>
        </div>
      )}

      <div className="space-y-2">
        <Label className="text-xs">Grupos monitorados (um por linha, match por substring)</Label>
        <Textarea
          value={groups}
          onChange={(e) => { setGroups(e.target.value); setDirty(true); }}
          placeholder={"sala vip\ngrupo principal"}
          rows={3}
          className="text-sm font-mono"
        />
        <div className="flex justify-between items-center">
          <p className="text-xs text-muted-foreground">Palavras-chave são as mesmas configuradas abaixo no card de WhatsApp.</p>
          <Button size="sm" variant={dirty ? "default" : "outline"} onClick={saveGroups} disabled={!dirty}>
            <Save className="w-3.5 h-3.5 mr-1" />Salvar
          </Button>
        </div>
      </div>

      <div className="space-y-2 pt-2 border-t border-border">
        <div className="flex items-center gap-2">
          {cloudSyncEnabled && cloudToken ? <Cloud className="w-3.5 h-3.5 text-emerald-400" /> : <CloudOff className="w-3.5 h-3.5 text-muted-foreground" />}
          <Label className="text-xs">Sincronização nuvem (responder do celular)</Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="cloudSyncEnabled"
            checked={cloudSyncEnabled}
            onCheckedChange={(v) => { setCloudSyncEnabled(!!v); setTokenDirty(true); }}
          />
          <Label htmlFor="cloudSyncEnabled" className="text-xs cursor-pointer">Ativar sincronização com nuvem</Label>
        </div>
        <Input
          type="password"
          value={cloudToken}
          onChange={(e) => { setCloudToken(e.target.value); setTokenDirty(true); }}
          placeholder="cole o token do wa_tokens (label: listener)"
          className="text-sm font-mono"
          disabled={!cloudSyncEnabled}
        />
        <div className="flex justify-between items-center gap-2">
          <p className="text-xs text-muted-foreground">
            Com token e ativado, mensagens recebidas vão pra nuvem e você pode disparar modelos pelo celular.
          </p>
          <Button size="sm" variant={tokenDirty ? "default" : "outline"} onClick={saveCloudToken} disabled={!tokenDirty}>
            <Save className="w-3.5 h-3.5 mr-1" />Salvar
          </Button>
        </div>
      </div>
    </Card>
  );
}
