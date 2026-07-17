import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Github, Save, Eraser, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const LS_KEY = "rollsuite_github_config";

type GhConfig = {
  owner: string;
  repo: string;
  branch: string;
  token: string;
  updatesPath: string;
};

function loadConfig(): GhConfig {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        owner: parsed.owner || "",
        repo: parsed.repo || "",
        branch: parsed.branch || "main",
        token: parsed.token || "",
        updatesPath: parsed.updatesPath || "updates",
      };
    }
  } catch {}
  return { owner: "fofuralol", repo: "rollsuite", branch: "main", token: "", updatesPath: "updates" };
}

export default function GithubConfigSection() {
  const [cfg, setCfg] = useState<GhConfig>(loadConfig);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<null | { ok: boolean; msg: string }>(null);

  useEffect(() => { setStatus(null); }, [cfg]);

  const save = () => {
    setSaving(true);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(cfg));
      setStatus({ ok: true, msg: "Configurações salvas neste PC" });
    } catch (e: any) {
      setStatus({ ok: false, msg: e?.message || "Falha ao salvar" });
    } finally {
      setSaving(false);
    }
  };

  const clear = () => {
    try { localStorage.removeItem(LS_KEY); } catch {}
    setCfg({ owner: "", repo: "", branch: "main", token: "", updatesPath: "updates" });
    setStatus({ ok: true, msg: "Configurações removidas" });
  };

  const test = async () => {
    if (!cfg.owner || !cfg.repo) {
      setStatus({ ok: false, msg: "Informe owner e repo" });
      return;
    }
    setTesting(true);
    setStatus(null);
    try {
      const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}`;
      const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
      if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setStatus({ ok: true, msg: `Repositório acessível: ${data.full_name} (${data.private ? "privado" : "público"})` });
    } catch (e: any) {
      setStatus({ ok: false, msg: e?.message || "Falha ao acessar repositório" });
    } finally {
      setTesting(false);
    }
  };

  const field = (label: string, key: keyof GhConfig, placeholder: string, type: string = "text") => (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      <input
        type={type}
        value={cfg[key]}
        onChange={(e) => setCfg({ ...cfg, [key]: e.target.value })}
        placeholder={placeholder}
        className="w-full mt-1 px-3 py-2 rounded-md bg-background border border-border text-sm outline-none focus:ring-2 focus:ring-ring"
        spellCheck={false}
        autoComplete="off"
      />
    </div>
  );

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
          <Github className="w-4 h-4" /> Configuração do GitHub
        </h3>
        <p className="text-xs text-muted-foreground">
          Repositório usado para publicar atualizações do app (auto-update) e sincronizar bundles.
          O token é necessário apenas para repositórios privados ou para publicar releases.
        </p>
      </div>

      <div className="space-y-3 max-w-md">
        {field("Owner (usuário/organização)", "owner", "ex: fofuralol")}
        {field("Repositório", "repo", "ex: rollsuite")}
        {field("Branch", "branch", "main")}
        {field("Pasta de updates", "updatesPath", "updates")}
        {field("Token (Fine-grained PAT)", "token", "ghp_...", "password")}

        {status && (
          <p className={cn("text-xs flex items-center gap-1.5", status.ok ? "text-emerald-500" : "text-destructive")}>
            {status.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
            {status.msg}
          </p>
        )}

        <div className="flex gap-2 pt-1 flex-wrap">
          <Button onClick={save} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Salvar
          </Button>
          <Button variant="outline" onClick={test} disabled={testing} className="gap-2">
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Github className="w-4 h-4" />}
            {testing ? "Testando…" : "Testar conexão"}
          </Button>
          <Button variant="ghost" onClick={clear} disabled={saving || testing} className="gap-2">
            <Eraser className="w-4 h-4" /> Limpar
          </Button>
        </div>
      </div>

      <div className="text-[11px] text-muted-foreground border-t border-border/60 pt-3">
        <p><strong>Dica:</strong> gere o token em GitHub → Settings → Developer settings → Fine-grained tokens, com permissão <em>Contents: Read and write</em> apenas no repositório configurado acima.</p>
      </div>
    </div>
  );
}
