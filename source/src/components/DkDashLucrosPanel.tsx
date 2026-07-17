import { useEffect, useState } from "react";
import { Loader2, RefreshCw, LogIn, LogOut, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import DkDashHojeCard from "@/components/DkDashHojeCard";

export default function DkDashLucrosPanel() {
  const [checking, setChecking] = useState(true);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [filial, setFilial] = useState("filial01");
  const [saving, setSaving] = useState(false);

  const callFn = async (action: string, extra?: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("dkdash-lucros", {
      body: { action, filial_id: filial, ...extra },
    });
    if (error) {
      let detail = error.message;
      try {
        const ctx: any = (error as any).context;
        if (ctx?.json) { const b = await ctx.json(); if (b?.error) detail = b.error; }
      } catch {}
      throw new Error(detail);
    }
    if ((data as any)?.error) throw new Error((data as any).error);
    return data as any;
  };

  const loadStatus = async () => {
    setChecking(true);
    try {
      const r = await callFn("status");
      setConnected(!!r.connected);
      if (r.info?.filial_id) setFilial(r.info.filial_id);
      if (!r.connected) setShowForm(false);
      return !!r.connected;
    } catch (e: any) {
      toast.error(e.message || "Erro ao verificar conexão");
      setConnected(false);
      return false;
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    (async () => {
      await loadStatus();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    if (!username.trim() || !password) { toast.error("Preencha usuário e senha"); return; }
    setSaving(true);
    try {
      await callFn("save-credentials", { username: username.trim(), password });
      toast.success("DK Dash conectado!");
      setConnected(true);
      setShowForm(false);
      setPassword("");
      window.dispatchEvent(new Event("dkdash-lucros:changed"));
      await loadStatus();
    } catch (e: any) { toast.error(e.message || "Erro ao salvar"); }
    finally { setSaving(false); }
  };

  const handleDisconnect = async () => {
    if (!confirm("Remover conexão com o DK Dash?")) return;
    try {
      await callFn("delete-credentials");
      toast.success("Desconectado");
      setConnected(false);
      setShowForm(false);
    } catch (e: any) { toast.error(e.message || "Erro"); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Montantes</h1>
          <p className="text-xs text-muted-foreground">Espelhado a partir dos ciclos reais do DK Dash</p>
        </div>
        {connected && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-3 text-xs"
              onClick={() => window.dispatchEvent(new Event("dkdash-lucros:changed"))}
              disabled={checking}
            >
              {checking ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              <span className="ml-1.5">Atualizar</span>
            </Button>
            <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={handleDisconnect}>
              <LogOut className="w-3 h-3" />
            </Button>
          </div>
        )}
      </div>

      {connected === null && (
        <Card className="p-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Verificando conexão...
        </Card>
      )}

      {connected === false && !showForm && (
        <Card className="p-6 text-center space-y-3">
          <p className="text-sm text-muted-foreground">Conecte sua conta do DK Dash.</p>
          <Button onClick={() => setShowForm(true)}>
            <LogIn className="w-4 h-4 mr-1.5" />Conectar DK Dash
          </Button>
        </Card>
      )}

      {showForm && (
        <Card className="relative z-50 p-4 space-y-3 max-w-md">
          <h2 className="text-sm font-semibold">Conectar DK Dash</h2>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="dk-filial">Filial</Label>
            <Input id="dk-filial" name="dk-filial" value={filial} onChange={(e) => setFilial(e.target.value)} placeholder="filial01" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="dk-user">Usuário</Label>
            <Input id="dk-user" name="dk-user" value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="dk-pwd">Senha</Label>
            <div className="relative">
              <Input id="dk-pwd" name="dk-pwd" type={showPwd ? "text" : "password"} value={password}
                onChange={(e) => setPassword(e.target.value)} />
              <button type="button" onClick={() => setShowPwd((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
                {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}
              Salvar e conectar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>Cancelar</Button>
          </div>
        </Card>
      )}

      {connected && <DkDashHojeCard />}
    </div>
  );
}
