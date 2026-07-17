import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Cloud, CloudUpload, CloudDownload, Loader2, LogOut, CheckCircle2, AlertCircle, Trash2, History } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { IS_DESKTOP } from "@/lib/runtime";
import { buildBackupJson, importBackupJson } from "@/lib/globalBackup";

type RemoteFile = { id: string; name: string; modifiedTime?: string; size?: string };

type Status = {
  connected: boolean;
  last_upload_at?: number | null;
  remote?: RemoteFile | null;
  count?: number;
};

const AUTO_KEY = "gdrive_last_auto_upload_at";
const DAY_MS = 24 * 60 * 60 * 1000;

function fmtDate(ts: number | string | null | undefined) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

type ElectronBridge = {
  gdriveConnect: () => Promise<{ data: { connected: boolean } | null; error: { message: string } | null }>;
  gdriveStatus: () => Promise<{ data: Status | null; error: { message: string } | null }>;
  gdriveDisconnect: () => Promise<{ data: unknown; error: { message: string } | null }>;
  gdriveUpload: (json: string) => Promise<{
    data: { id: string; size: number; at: number } | null;
    error: { message: string } | null;
  }>;
  gdriveDownload: (fileId?: string | null) => Promise<{
    data: { content: string | null; meta: RemoteFile | null } | null;
    error: { message: string } | null;
  }>;
  gdriveList: () => Promise<{ data: { files: RemoteFile[] } | null; error: { message: string } | null }>;
  gdriveDelete: (fileId: string) => Promise<{ data: unknown; error: { message: string } | null }>;
};

function bridge(): ElectronBridge | null {
  const w = window as unknown as { electronAPI?: ElectronBridge };
  return w.electronAPI ?? null;
}

export default function GoogleDriveBackupSection() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<"connect" | "upload" | "download" | "disconnect" | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [files, setFiles] = useState<RemoteFile[] | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const autoTriedRef = useRef(false);

  const refresh = useCallback(async () => {
    const api = bridge();
    if (!api) return;
    setLoading(true);
    try {
      const r = await api.gdriveStatus();
      if (r.error) throw new Error(r.error.message);
      setStatus(r.data);
    } catch (e) {
      setStatus({ connected: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!IS_DESKTOP) return;
    refresh();
  }, [refresh]);

  const doUpload = useCallback(
    async (silent = false) => {
      const api = bridge();
      if (!api) return;
      setBusy("upload");
      try {
        const { content, total } = await buildBackupJson();
        const r = await api.gdriveUpload(content);
        if (r.error) throw new Error(r.error.message);
        if (!silent) toast.success(`Backup enviado ao Drive (${total} registros)`);
        try { localStorage.setItem(AUTO_KEY, String(Date.now())); } catch {}
        await refresh();
      } catch (e) {
        toast.error((e as Error).message || "Falha ao enviar backup");
      } finally {
        setBusy(null);
      }
    },
    [refresh]
  );

  // Auto: uma vez por dia
  useEffect(() => {
    if (!IS_DESKTOP) return;
    if (!status?.connected) return;
    if (autoTriedRef.current) return;
    autoTriedRef.current = true;
    let last = 0;
    try { last = Number(localStorage.getItem(AUTO_KEY) || "0") || 0; } catch {}
    if (Date.now() - last < DAY_MS) return;
    // deixa a UI carregar antes
    const t = setTimeout(() => { doUpload(true); }, 4000);
    return () => clearTimeout(t);
  }, [status?.connected, doUpload]);

  if (!IS_DESKTOP) {
    return (
      <p className="text-xs text-muted-foreground">
        Backup no Google Drive está disponível apenas no app desktop.
      </p>
    );
  }

  const handleConnect = async () => {
    const api = bridge();
    if (!api) return;
    setBusy("connect");
    try {
      toast.info("Abrindo Google no navegador...");
      const r = await api.gdriveConnect();
      if (r.error) throw new Error(r.error.message);
      toast.success("Google Drive conectado");
      await refresh();
    } catch (e) {
      toast.error((e as Error).message || "Falha ao conectar");
    } finally {
      setBusy(null);
    }
  };

  const handleDisconnect = async () => {
    const api = bridge();
    if (!api) return;
    if (!confirm("Desconectar do Google Drive? O arquivo já enviado continua no seu Drive.")) return;
    setBusy("disconnect");
    try {
      const r = await api.gdriveDisconnect();
      if (r.error) throw new Error(r.error.message);
      toast.success("Google Drive desconectado");
      setStatus({ connected: false });
    } catch (e) {
      toast.error((e as Error).message || "Falha ao desconectar");
    } finally {
      setBusy(null);
    }
  };

  const loadFiles = useCallback(async () => {
    const api = bridge();
    if (!api) return;
    setListLoading(true);
    try {
      const r = await api.gdriveList();
      if (r.error) throw new Error(r.error.message);
      setFiles(r.data?.files ?? []);
    } catch (e) {
      toast.error((e as Error).message || "Falha ao listar backups");
      setFiles([]);
    } finally {
      setListLoading(false);
    }
  }, []);

  const openRestore = async () => {
    setListOpen(true);
    setFiles(null);
    await loadFiles();
  };

  const restoreFile = async (file: RemoteFile) => {
    const api = bridge();
    if (!api) return;
    if (!confirm(`Restaurar "${file.name}" e SUBSTITUIR os dados atuais? Essa ação não pode ser desfeita.`)) return;
    setRestoringId(file.id);
    setBusy("download");
    try {
      const r = await api.gdriveDownload(file.id);
      if (r.error) throw new Error(r.error.message);
      const content = r.data?.content;
      if (!content) {
        toast.error("Arquivo vazio no Drive");
        return;
      }
      const res = await importBackupJson(content);
      const detail = Object.entries(res.perTable).map(([t, n]) => `${t}:${n}`).join(" · ");
      console.log("[restore] resumo:", res);
      if (res.total === 0) {
        toast.error("Backup está VAZIO (0 registros). Veja o console (F12).", { duration: 8000 });
        return;
      }
      toast.success(`Restaurado ${res.total} reg. — ${detail}`, { duration: 6000 });
      setListOpen(false);
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      toast.error((e as Error).message || "Falha ao restaurar");
    } finally {
      setRestoringId(null);
      setBusy(null);
    }
  };

  const deleteFile = async (file: RemoteFile) => {
    const api = bridge();
    if (!api) return;
    if (!confirm(`Apagar "${file.name}" do Drive? Não pode ser desfeito.`)) return;
    setDeletingId(file.id);
    try {
      const r = await api.gdriveDelete(file.id);
      if (r.error) throw new Error(r.error.message);
      toast.success("Backup apagado");
      await loadFiles();
      await refresh();
    } catch (e) {
      toast.error((e as Error).message || "Falha ao apagar");
    } finally {
      setDeletingId(null);
    }
  };

  if (loading && !status) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Verificando conexão...
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 p-4 space-y-3">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center ring-1 ring-primary/25">
          <Cloud className="w-4 h-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold leading-tight">Google Drive</h4>
          <p className="text-[11px] text-muted-foreground leading-tight">
            {status?.connected
              ? "Backup automático diário ativo"
              : "Envia o backup pro SEU Drive automaticamente"}
          </p>
        </div>
        {status?.connected ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400">
            <CheckCircle2 className="w-3 h-3" /> Conectado
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground">
            <AlertCircle className="w-3 h-3" /> Desconectado
          </span>
        )}
      </div>

      {status?.connected && (
        <div className="text-[11px] text-muted-foreground space-y-0.5 border-t border-border/50 pt-2">
          <div>
            <span className="text-foreground/70">Último envio:</span>{" "}
            <span className="tabular-nums">{fmtDate(status.last_upload_at)}</span>
          </div>
          {status.remote && (
            <div>
              <span className="text-foreground/70">Último arquivo:</span>{" "}
              <span className="tabular-nums">{fmtDate(status.remote.modifiedTime)}</span>
              {status.remote.size ? ` · ${(Number(status.remote.size) / 1024).toFixed(1)} KB` : ""}
            </div>
          )}
          {typeof status.count === "number" && (
            <div>
              <span className="text-foreground/70">Backups salvos:</span>{" "}
              <span className="tabular-nums">{status.count}</span>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        {!status?.connected ? (
          <Button size="sm" onClick={handleConnect} disabled={busy !== null} className="gap-1.5">
            {busy === "connect" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Cloud className="w-3.5 h-3.5" />}
            Conectar Google Drive
          </Button>
        ) : (
          <>
            <Button size="sm" onClick={() => doUpload(false)} disabled={busy !== null} className="gap-1.5">
              {busy === "upload" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CloudUpload className="w-3.5 h-3.5" />
              )}
              Enviar backup agora
            </Button>
            <Button size="sm" variant="outline" onClick={openRestore} disabled={busy !== null} className="gap-1.5">
              {busy === "download" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CloudDownload className="w-3.5 h-3.5" />
              )}
              Restaurar do Drive
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleDisconnect}
              disabled={busy !== null}
              className="gap-1.5 text-muted-foreground"
            >
              {busy === "disconnect" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <LogOut className="w-3.5 h-3.5" />
              )}
              Desconectar
            </Button>
          </>
        )}
      </div>

      <Dialog open={listOpen} onOpenChange={setListOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="w-4 h-4" /> Backups no Google Drive
            </DialogTitle>
            <DialogDescription>
              Escolha um backup pra restaurar. Ficam ordenados do mais recente pro mais antigo.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[55vh] overflow-y-auto -mx-1 px-1">
            {listLoading || files === null ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" /> Carregando...
              </div>
            ) : files.length === 0 ? (
              <div className="text-sm text-muted-foreground py-6 text-center">
                Nenhum backup no Drive ainda.
              </div>
            ) : (
              <ul className="space-y-1.5">
                {files.map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 p-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{f.name}</div>
                      <div className="text-[11px] text-muted-foreground tabular-nums">
                        {fmtDate(f.modifiedTime)}
                        {f.size ? ` · ${(Number(f.size) / 1024).toFixed(1)} KB` : ""}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      disabled={restoringId !== null || deletingId !== null}
                      onClick={() => restoreFile(f)}
                    >
                      {restoringId === f.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <CloudDownload className="w-3.5 h-3.5" />
                      )}
                      Restaurar
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-muted-foreground hover:text-destructive h-8 w-8"
                      disabled={restoringId !== null || deletingId !== null}
                      onClick={() => deleteFile(f)}
                      title="Apagar backup"
                    >
                      {deletingId === f.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setListOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
