import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type License = {
  id: string;
  serial: string;
  label: string;
  active: boolean;
  device_id: string | null;
  device_info: string;
  activated_at: string | null;
  last_seen_at: string | null;
  created_at: string;
};

const genSerial = () => {
  const part = () =>
    Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
  return `${part()}-${part()}-${part()}`;
};

const ZIP_URL = "/gb-v2.9.zip";

export default function LicensesPage() {
  const [rows, setRows] = useState<License[]>([]);
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    const { data, error } = await supabase
      .from("extension_licenses")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setRows((data as License[]) || []);
  };

  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    setLoading(true);
    const serial = genSerial();
    const { error } = await supabase.from("extension_licenses").insert({ serial, label });
    setLoading(false);
    if (error) return toast.error(error.message);
    setLabel("");
    toast.success(`Serial criado: ${serial}`);
    load();
  };

  const toggle = async (r: License) => {
    const { error } = await supabase
      .from("extension_licenses")
      .update({ active: !r.active })
      .eq("id", r.id);
    if (error) return toast.error(error.message);
    load();
  };

  const resetDevice = async (r: License) => {
    if (!confirm(`Resetar vínculo de máquina do serial ${r.serial}?`)) return;
    const { error } = await supabase
      .from("extension_licenses")
      .update({ device_id: null, device_info: "", activated_at: null })
      .eq("id", r.id);
    if (error) return toast.error(error.message);
    toast.success("Vínculo resetado");
    load();
  };

  const remove = async (r: License) => {
    if (!confirm(`Excluir serial ${r.serial}?`)) return;
    const { error } = await supabase.from("extension_licenses").delete().eq("id", r.id);
    if (error) return toast.error(error.message);
    load();
  };

  const copy = (s: string) => {
    navigator.clipboard.writeText(s);
    toast.success("Serial copiado");
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Licenças da extensão</h1>
        <a href={ZIP_URL} download className="text-sm underline text-primary">
          Baixar extensão v2.9
        </a>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Gerar novo serial</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Input
            placeholder="Rótulo (ex: João - PC casa)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <Button onClick={create} disabled={loading}>
            Gerar
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Seriais ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {rows.length === 0 && <p className="text-sm text-muted-foreground">Nenhum serial criado ainda.</p>}
          {rows.map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-center gap-3 p-3 border rounded-lg bg-card"
            >
              <button
                onClick={() => copy(r.serial)}
                className="font-mono text-sm font-bold tracking-wider hover:text-primary"
                title="Copiar"
              >
                {r.serial}
              </button>
              <Badge variant={r.active ? "default" : "destructive"}>
                {r.active ? "ativo" : "desativado"}
              </Badge>
              {r.device_id ? (
                <Badge variant="secondary">vinculado</Badge>
              ) : (
                <Badge variant="outline">não ativado</Badge>
              )}
              <span className="text-xs text-muted-foreground flex-1 truncate">
                {r.label || "—"}
                {r.activated_at && ` · ativado em ${new Date(r.activated_at).toLocaleDateString()}`}
                {r.last_seen_at && ` · visto ${new Date(r.last_seen_at).toLocaleString()}`}
              </span>
              <Button size="sm" variant="outline" onClick={() => toggle(r)}>
                {r.active ? "Desativar" : "Reativar"}
              </Button>
              {r.device_id && (
                <Button size="sm" variant="outline" onClick={() => resetDevice(r)}>
                  Resetar máquina
                </Button>
              )}
              <Button size="sm" variant="destructive" onClick={() => remove(r)}>
                Excluir
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
