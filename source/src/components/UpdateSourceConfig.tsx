import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Save, RotateCcw, Github } from "lucide-react";
import { toast } from "sonner";
import { IS_DESKTOP } from "@/lib/runtime";

type Source = {
  base: string;
  nativeBase: string;
  custom?: boolean;
  default?: string;
};

function toGithubBase(owner: string, repo: string, branch = "main", folder = "updates") {
  const o = owner.trim();
  const r = repo.trim();
  const b = (branch || "main").trim();
  const f = folder.replace(/^\/+|\/+$/g, "");
  if (!o || !r) return "";
  return `https://raw.githubusercontent.com/${o}/${r}/${b}/${f}`;
}

function parseGithub(base: string): { owner: string; repo: string; branch: string; folder: string } {
  const m = base.match(/^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/i);
  if (!m) return { owner: "", repo: "", branch: "main", folder: "updates" };
  return { owner: m[1], repo: m[2], branch: m[3], folder: m[4].replace(/\/$/, "") };
}

export default function UpdateSourceConfig() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [source, setSource] = useState<Source | null>(null);

  // Modo GitHub (padrão) — preenchimento independente por campo
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("main");
  const [folder, setFolder] = useState("updates");

  // Modo avançado (URLs cruas)
  const [advanced, setAdvanced] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [nativeUrl, setNativeUrl] = useState("");

  const api = () => (window as any).electronAPI;

  const load = async () => {
    if (!IS_DESKTOP) { setLoading(false); return; }
    try {
      const res = await api()?.getUpdateSource?.();
      const data: Source = res?.data || { base: "", nativeBase: "" };
      setSource(data);
      setBaseUrl(data.base);
      setNativeUrl(data.nativeBase);
      const gh = parseGithub(data.base);
      setOwner(gh.owner);
      setRepo(gh.repo);
      setBranch(gh.branch);
      setFolder(gh.folder);
      // Se URL não bate com padrão GitHub Raw, abre modo avançado
      if (!gh.owner) setAdvanced(true);
    } catch (e: any) {
      toast.error("Falha ao ler config: " + (e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (!IS_DESKTOP) return null;

  const save = async () => {
    setSaving(true);
    try {
      let base = "";
      let nativeBase = "";
      if (advanced) {
        base = baseUrl.trim().replace(/\/+$/, "");
        nativeBase = nativeUrl.trim().replace(/\/+$/, "") || `${base}/native`;
        if (!/^https?:\/\//i.test(base)) throw new Error("Base URL inválida (use http/https)");
      } else {
        base = toGithubBase(owner, repo, branch, folder);
        if (!base) throw new Error("Preencha owner e repo");
        nativeBase = `${base}/native`;
      }
      const res = await api()?.setUpdateSource?.({ base, nativeBase });
      if (res?.error) throw new Error(res.error.message);
      toast.success("Origem de atualizações salva");
      await load();
    } catch (e: any) {
      toast.error("Erro: " + (e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setSaving(true);
    try {
      const res = await api()?.resetUpdateSource?.();
      if (res?.error) throw new Error(res.error.message);
      toast.success("Origem redefinida para o padrão");
      await load();
    } catch (e: any) {
      toast.error("Erro: " + (e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando origem…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold flex items-center gap-1.5">
          <Github className="w-3.5 h-3.5" /> Origem das atualizações
        </h4>
        <p className="text-xs text-muted-foreground">
          Define de qual repositório o app baixa novas versões. Se não configurado, usa o padrão do projeto.
        </p>
      </div>

      {!advanced ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="upd-owner" className="text-xs">GitHub owner</Label>
            <Input id="upd-owner" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="fofuralol" autoComplete="off" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="upd-repo" className="text-xs">Repositório</Label>
            <Input id="upd-repo" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="rollsuite" autoComplete="off" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="upd-branch" className="text-xs">Branch</Label>
            <Input id="upd-branch" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" autoComplete="off" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="upd-folder" className="text-xs">Pasta</Label>
            <Input id="upd-folder" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="updates" autoComplete="off" />
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="space-y-1">
            <Label htmlFor="upd-base" className="text-xs">Base URL (bundle)</Label>
            <Input id="upd-base" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://…/updates" autoComplete="off" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="upd-native" className="text-xs">Base URL (native, opcional)</Label>
            <Input id="upd-native" value={nativeUrl} onChange={(e) => setNativeUrl(e.target.value)} placeholder="https://…/updates/native" autoComplete="off" />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Salvar origem
        </Button>
        <Button size="sm" variant="outline" onClick={reset} disabled={saving} className="gap-1.5">
          <RotateCcw className="w-3.5 h-3.5" /> Restaurar padrão
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setAdvanced((v) => !v)} className="text-xs">
          {advanced ? "Usar modo GitHub" : "Modo avançado (URL)"}
        </Button>
      </div>

      <div className="text-[11px] text-muted-foreground space-y-0.5 pt-1">
        <div>Bundle: <span className="text-foreground/80 break-all">{source?.base}</span></div>
        <div>Native: <span className="text-foreground/80 break-all">{source?.nativeBase}</span></div>
        {source?.default && !source?.custom && (
          <div className="text-muted-foreground/70">Usando padrão embutido.</div>
        )}
      </div>
    </div>
  );
}