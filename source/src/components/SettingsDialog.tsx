import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Settings,
  Palette,
  Bell,
  DatabaseBackup,
  RefreshCw,
  Download,
  User,
  LogOut,
  Loader2,
  BellOff,
  Coins,
  Skull,
  MessageCircle,
  Puzzle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { IS_DESKTOP } from "@/lib/runtime";
import { useAuth } from "@/hooks/useAuth";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import ZoomButton from "@/components/ZoomButton";

import GlobalBackupButtons from "@/components/GlobalBackupButtons";
import DesktopUpdateButton from "@/components/DesktopUpdateButton";
import UpdateSourceConfig from "@/components/UpdateSourceConfig";
import MontanteSettingsDialog from "@/components/MontanteSettingsDialog";
import { triggerMontanteResult } from "@/components/MontanteResultOverlay";
import WhatsAppConfigSection from "@/components/WhatsAppConfigSection";
import GoogleDriveBackupSection from "@/components/GoogleDriveBackupSection";
import ExtensionTokenInjectorDialog from "@/components/ExtensionTokenInjectorDialog";
import rolldashExtAsset from "@/assets/rolldash-extension.zip.asset.json";
import extensionOpenAsset from "@/assets/extension-open.zip.asset.json";
// (assets ainda usados na seção Downloads para web)

type SectionId =
  | "aparencia"
  | "notificacoes"
  | "whatsapp"
  | "extensao"
  | "backup"
  | "atualizacao"
  | "montante"
  | "downloads"
  | "conta";

type Section = {
  id: SectionId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  hidden?: boolean;
};

const SECTIONS: Section[] = [
  { id: "aparencia", label: "Aparência", icon: Palette },
  { id: "notificacoes", label: "Notificações", icon: Bell, hidden: IS_DESKTOP },
  { id: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { id: "extensao", label: "Extensão", icon: Puzzle },
  { id: "backup", label: "Backup", icon: DatabaseBackup },
  { id: "atualizacao", label: "Atualização", icon: RefreshCw, hidden: !IS_DESKTOP },
  { id: "montante", label: "Montante (Lucro/Prejuízo)", icon: Coins, hidden: !IS_DESKTOP },
  { id: "downloads", label: "Downloads", icon: Download, hidden: IS_DESKTOP },
  { id: "conta", label: "Conta", icon: User },
];

async function downloadFile(url: string, filename: string) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const a = document.createElement("a");
    const objectUrl = URL.createObjectURL(blob);
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch {
    window.open(url, "_blank");
  }
}

function SectionAparencia() {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold mb-1">Zoom da interface</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Ajuste o tamanho de tudo na tela. Auto-ajusta com o tamanho da janela.
        </p>
        <div className="rounded-md border border-border bg-muted/30 p-3 inline-flex">
          <ZoomButton />
        </div>
      </div>
    </div>
  );
}

function SectionNotificacoes() {
  const push = usePushNotifications();
  if (!push.supported) {
    return (
      <p className="text-sm text-muted-foreground">
        Notificações push não são suportadas neste navegador.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Notificações push</h3>
      <p className="text-xs text-muted-foreground">
        Receba alertas de tarefas mesmo quando o app estiver em segundo plano.
      </p>
      <Button
        variant={push.enabled ? "default" : "outline"}
        onClick={() => (push.enabled ? push.disable() : push.enable())}
        disabled={push.busy}
        className="gap-2"
      >
        {push.busy ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : push.enabled ? (
          <Bell className="w-4 h-4" />
        ) : (
          <BellOff className="w-4 h-4" />
        )}
        {push.enabled ? "Push ativado — clique para desativar" : "Ativar push neste dispositivo"}
      </Button>
    </div>
  );
}

function SectionBackup() {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Backup global</h3>
      <p className="text-xs text-muted-foreground">
        Exporte todos os seus dados (códigos mapeados, chaves Pix, prioridades, catálogos e histórico
        de tarefas) em um único arquivo JSON. Você pode subir esse arquivo no Google Drive ou onde
        preferir e reimportar depois.
      </p>
      <div className="rounded-md border border-border bg-muted/30 p-3 flex flex-col gap-1 max-w-xs">
        <GlobalBackupButtons collapsed={false} />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Ao importar, os dados atuais destas tabelas serão substituídos pelos dados do arquivo.
      </p>
      <GoogleDriveBackupSection />
    </div>
  );
}

function SectionAtualizacao() {
  if (!IS_DESKTOP) {
    return (
      <p className="text-sm text-muted-foreground">
        Atualizações automáticas só estão disponíveis no app desktop.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Atualização do app</h3>
      <p className="text-xs text-muted-foreground">
        Verifica se há uma nova versão do app desktop ou do conteúdo interno e aplica.
      </p>
      <DesktopUpdateButton />
      <div className="pt-4 mt-2 border-t border-border/50">
        <UpdateSourceConfig />
      </div>
    </div>
  );
}

function SectionDownloads() {
  const items = [
    { label: "Extensão Chrome", url: rolldashExtAsset.url, file: "rolldash-extensao.zip" },
    { label: "Extensão Open (sem serial)", url: extensionOpenAsset.url, file: "rolldash-extensao-open.zip" },
    { label: "Zapo", url: "/zapo.zip", file: "zapo.zip" },
    { label: "Zapo2 (standalone)", url: "/zapo2.zip", file: "zapo2.zip" },
  ];
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Downloads</h3>
      <p className="text-xs text-muted-foreground">
        Baixe os apps auxiliares e a extensão do navegador.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {items.map((it) => (
          <Button
            key={it.file}
            variant="outline"
            className="justify-start gap-2"
            onClick={() => downloadFile(it.url, it.file)}
          >
            <Download className="w-4 h-4" />
            {it.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function SectionMontante() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  if (!IS_DESKTOP) {
    return (
      <p className="text-sm text-muted-foreground">
        Disponível apenas no app desktop.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold mb-1">Testar overlays</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Dispara o overlay animado de Lucro ou Prejuízo para pré-visualizar animação e som.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="gap-1.5 border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10"
            onClick={() => triggerMontanteResult("lucro")}
          >
            <Coins className="w-4 h-4" /> Testar Lucro
          </Button>
          <Button
            variant="outline"
            className="gap-1.5 border-red-500/50 text-red-400 hover:bg-red-500/10"
            onClick={() => triggerMontanteResult("prejuizo")}
          >
            <Skull className="w-4 h-4" /> Testar Prejuízo
          </Button>
        </div>
      </div>
      <div>
        <h3 className="text-sm font-semibold mb-1">Animação e sons</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Ajuste duração, sons e efeitos visuais do overlay de resultado.
        </p>
        <Button variant="outline" className="gap-1.5" onClick={() => setSettingsOpen(true)}>
          <Settings className="w-4 h-4" /> Abrir configurações do Montante
        </Button>
      </div>
      <MontanteSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}

function SectionExtensao() {
  const [injectorOpen, setInjectorOpen] = useState(false);
  const [cloudEnabled, setCloudEnabled] = useState(true);
  const [localEnabled, setLocalEnabled] = useState(true);
  const [localStatus, setLocalStatus] = useState<{ running: boolean; port: number | null }>({ running: false, port: null });

  const refreshStatus = async () => {
    const api = (window as any).electronAPI;
    if (!api) return;
    try {
      const cfg = await api.metaGetConfig?.();
      if (cfg?.data) {
        setCloudEnabled(cfg.data.cloud_enabled !== false);
        setLocalEnabled(cfg.data.local_enabled !== false);
      }
      const st = await api.metaLocalStatus?.();
      if (st?.data) setLocalStatus(st.data);
    } catch {}
  };

  useEffect(() => {
    if (!IS_DESKTOP) return;
    refreshStatus();
  }, []);

  const toggleCloud = async (v: boolean) => {
    setCloudEnabled(v);
    const api = (window as any).electronAPI;
    await api?.metaSetConfig?.({ cloud_enabled: v });
    refreshStatus();
  };
  const toggleLocal = async (v: boolean) => {
    setLocalEnabled(v);
    const api = (window as any).electronAPI;
    await api?.metaSetConfig?.({ local_enabled: v });
    // servidor sobe/cai — dá um tempo pro handler
    setTimeout(refreshStatus, 300);
  };

  const [generating, setGenerating] = useState(false);
  const generatePreconfigured = async () => {
    const api: any = (window as any).electronAPI;
    if (!api?.extGenerate) {
      const { toast } = await import("sonner");
      toast.error("Disponível apenas no app desktop");
      return;
    }
    let token = "";
    try {
      token =
        localStorage.getItem("desktop_extension_token") ||
        localStorage.getItem("monitor_push_forward_wa_token") ||
        "";
    } catch {}
    setGenerating(true);
    const { data, error } = await api.extGenerate({ token });
    setGenerating(false);
    const { toast } = await import("sonner");
    if (error) { toast.error(error.message); return; }
    if (!data) return;
    toast.success(`Extensão pronta: ${data.zipPath}`);
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold mb-1">Extensão pré-configurada</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Gera um .zip da extensão do Chrome em modo offline puro, sem exigir token.
        </p>
        <Button
          variant="default"
          className="gap-2"
          onClick={generatePreconfigured}
          disabled={generating}
        >
          <Puzzle className="w-4 h-4" />
          {generating ? "Gerando…" : "Gerar extensão pré-configurada"}
        </Button>
      </div>

      {IS_DESKTOP && (
        <>
          <div className="border-t border-border/60 pt-4">
            <h3 className="text-sm font-semibold mb-1">Recebimento de metas</h3>
            <p className="text-xs text-muted-foreground mb-3">
              A extensão envia a meta direto para este app no mesmo PC, sem internet.
            </p>

            <div className="space-y-2 max-w-md">
              <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 p-3">
                <div>
                  <div className="text-sm font-medium">Servidor local (sem internet)</div>
                  <div className="text-[11px] text-muted-foreground">
                    {localStatus.running
                      ? `Ativo em 127.0.0.1:${localStatus.port} — funciona offline no mesmo PC.`
                      : "Desligado. Ligue para receber metas offline no mesmo PC."}
                  </div>
                </div>
                <Switch checked={localEnabled} onCheckedChange={toggleLocal} />
              </label>

              <label className="hidden items-center justify-between gap-3 rounded-md border border-border bg-muted/30 p-3">
                <div>
                  <div className="text-sm font-medium">Sincronização em nuvem</div>
                  <div className="text-[11px] text-muted-foreground">
                    Desativada no modo offline puro.
                  </div>
                </div>
                <Switch checked={cloudEnabled} onCheckedChange={toggleCloud} />
              </label>
            </div>

            {!cloudEnabled && !localEnabled && (
              <p className="text-[11px] text-destructive mt-2">
                Atenção: ambos desligados — nenhuma meta será recebida.
              </p>
            )}
          </div>

          <div className="border-t border-border/60 pt-4">
            <h3 className="text-sm font-semibold mb-1">Injetor de token</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Avançado: reprocessa um .zip existente para remover dependência de nuvem/token.
            </p>
            <Button variant="default" className="gap-2" onClick={() => setInjectorOpen(true)}>
              <Puzzle className="w-4 h-4" /> Abrir injetor
            </Button>
            <ExtensionTokenInjectorDialog open={injectorOpen} onOpenChange={setInjectorOpen} />
          </div>
        </>
      )}
    </div>
  );
}

function SectionConta() {
  const { user, signOut } = useAuth();
  const email = user?.email?.replace(/@rolls\.local$/, "");
  const [syncEmail, setSyncEmail] = useState<string>(() => {
    try { return localStorage.getItem("monitor_sync_email") || ""; } catch { return ""; }
  });
  const [syncPwd, setSyncPwd] = useState<string>(() => {
    try { return localStorage.getItem("monitor_sync_pwd") || ""; } catch { return ""; }
  });
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<null | { ok: boolean; msg: string }>(null);

  const save = () => {
    try {
      localStorage.setItem("monitor_sync_email", syncEmail.trim());
      localStorage.setItem("monitor_sync_pwd", syncPwd);
    } catch {}
  };

  const testAndSave = async () => {
    if (!syncEmail || !syncPwd) { setStatus({ ok: false, msg: "Informe email e senha" }); return; }
    setTesting(true);
    setStatus(null);
    try {
      const URL = import.meta.env.VITE_SUPABASE_URL as string;
      const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
      const { createClient } = await import("@supabase/supabase-js");
      const cloud = createClient(URL, KEY, {
        auth: { persistSession: false, storageKey: "rolls-cloud-test-auth", autoRefreshToken: false, detectSessionInUrl: false },
      });
      const e = syncEmail.includes("@") ? syncEmail.toLowerCase() : `${syncEmail.toLowerCase().replace(/[^a-z0-9_]/g, "")}@rolls.local`;
      const { data, error } = await cloud.auth.signInWithPassword({ email: e, password: syncPwd });
      if (error || !data.user) throw new Error(error?.message || "Credenciais inválidas");
      save();
      setStatus({ ok: true, msg: "Credenciais salvas e validadas" });
      try { await cloud.auth.signOut(); } catch {}
    } catch (err: any) {
      setStatus({ ok: false, msg: err?.message || "Falha ao validar" });
    } finally {
      setTesting(false);
    }
  };

  const clearSync = () => {
    try {
      localStorage.removeItem("monitor_sync_email");
      localStorage.removeItem("monitor_sync_pwd");
    } catch {}
    setSyncEmail("");
    setSyncPwd("");
    setStatus({ ok: true, msg: "Credenciais removidas" });
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold mb-1">Sessão local</h3>
        <p className="text-xs text-muted-foreground">Você está conectado como:</p>
        <p className="text-sm font-medium mt-1">{email || "—"}</p>
        <Button variant="destructive" onClick={signOut} className="gap-2 mt-3">
          <LogOut className="w-4 h-4" />
          Sair da conta
        </Button>
      </div>

      <div className="border-t border-border pt-4">
        <h3 className="text-sm font-semibold mb-1">Conta de sincronização (nuvem)</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Use aqui o mesmo email e senha da versão web. Fica salvo neste PC — não precisa digitar de novo.
        </p>
        <div className="space-y-2">
          <div>
            <label className="text-xs text-muted-foreground">Email</label>
            <input
              type="email"
              autoComplete="username"
              value={syncEmail}
              onChange={(e) => setSyncEmail(e.target.value)}
              placeholder="voce@exemplo.com"
              className="w-full mt-1 px-3 py-2 rounded-md bg-background border border-border text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Senha</label>
            <input
              type="password"
              autoComplete="current-password"
              value={syncPwd}
              onChange={(e) => setSyncPwd(e.target.value)}
              placeholder="••••••••"
              className="w-full mt-1 px-3 py-2 rounded-md bg-background border border-border text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          {status && (
            <p className={cn("text-xs", status.ok ? "text-emerald-500" : "text-destructive")}>
              {status.msg}
            </p>
          )}
          <div className="flex gap-2 pt-1 flex-wrap">
            <Button onClick={testAndSave} disabled={testing} className="gap-2">
              {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <User className="w-4 h-4" />}
              {testing ? "Validando…" : "Testar e salvar"}
            </Button>
            <Button variant="outline" onClick={save} disabled={testing}>
              Salvar sem testar
            </Button>
            <Button variant="ghost" onClick={clearSync} disabled={testing}>
              Limpar
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

const CONTENT: Record<SectionId, React.ComponentType> = {
  aparencia: SectionAparencia,
  notificacoes: SectionNotificacoes,
  whatsapp: WhatsAppConfigSection,
  extensao: SectionExtensao,
  backup: SectionBackup,
  atualizacao: SectionAtualizacao,
  montante: SectionMontante,
  downloads: SectionDownloads,
  conta: SectionConta,
};

export default function SettingsDialog() {
  const visible = SECTIONS.filter((s) => !s.hidden);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<SectionId>(visible[0]?.id ?? "aparencia");
  const Active = CONTENT[active];

  const currentSection = visible.find((s) => s.id === active);

  useEffect(() => {
    const onOpenWa = () => {
      setActive("whatsapp");
      setOpen(true);
    };
    window.addEventListener("wa:openConfig", onOpenWa as EventListener);
    return () => window.removeEventListener("wa:openConfig", onOpenWa as EventListener);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2.5 gap-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground whitespace-nowrap"
          title="Configurações"
        >
          <Settings className="w-3.5 h-3.5" />
          <span>Configurações</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl p-0 gap-0 overflow-hidden border-border/60 shadow-2xl">
        <div className="flex flex-col sm:flex-row h-[min(640px,85vh)]">
          {/* Sidebar */}
          <aside className="sm:w-64 shrink-0 border-b sm:border-b-0 sm:border-r border-border/60 bg-gradient-to-b from-muted/40 to-muted/10 flex flex-col">
            <div className="px-5 py-5 border-b border-border/60">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center ring-1 ring-primary/20">
                  <Settings className="w-4 h-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <DialogTitle className="text-base leading-tight">Configurações</DialogTitle>
                  <DialogDescription className="text-[11px] mt-0.5 leading-tight">
                    Ajustes do aplicativo
                  </DialogDescription>
                </div>
              </div>
            </div>
            <nav className="flex sm:flex-col gap-1 p-2 sm:p-3 overflow-x-auto sm:overflow-x-visible sm:flex-1">
              {visible.map((s) => {
                const Icon = s.icon;
                const isActive = active === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setActive(s.id)}
                    className={cn(
                      "group relative flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-left transition-colors whitespace-nowrap sm:whitespace-normal",
                      isActive
                        ? "bg-background text-foreground font-medium shadow-sm ring-1 ring-border/60"
                        : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
                    )}
                  >
                    {isActive && (
                      <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-primary hidden sm:block" />
                    )}
                    <Icon
                      className={cn(
                        "w-4 h-4 shrink-0 transition-colors",
                        isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                      )}
                    />
                    <span className="truncate">{s.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>

          {/* Conteúdo */}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="px-6 py-4 border-b border-border/60 bg-background/50 shrink-0">
              {currentSection && (
                <div className="flex items-center gap-2.5">
                  <currentSection.icon className="w-4 h-4 text-primary" />
                  <h2 className="text-base font-semibold">{currentSection.label}</h2>
                </div>
              )}
            </div>
            <div className="flex-1 overflow-auto px-6 py-6">
              <Active />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

