import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Calculator } from "lucide-react";

const Auth = () => {
  const { user, loading, signIn, signUp } = useAuth();
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  if (loading) return null;
  if (user) return <Navigate to="/" replace />;

  const submit = async (mode: "in" | "up") => {
    setBusy(true);
    const fn = mode === "in" ? signIn : signUp;
    const { error } = await fn(nickname, password);
    setBusy(false);
    if (error) toast.error(error);
    else if (mode === "up") toast.success("Conta criada! Você já está logado.");
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <div className="size-12 rounded-xl bg-primary/15 text-primary flex items-center justify-center mb-3">
            <Calculator className="size-6" />
          </div>
          <h1 className="text-2xl font-semibold">Calculadora de Rolls</h1>
          <p className="text-sm text-muted-foreground">Acesse com seu nickname</p>
        </div>

        <Tabs defaultValue="in" className="bg-card border border-border rounded-xl p-5">
          <TabsList className="grid grid-cols-2 w-full mb-4">
            <TabsTrigger value="in">Entrar</TabsTrigger>
            <TabsTrigger value="up">Criar conta</TabsTrigger>
          </TabsList>

          {(["in", "up"] as const).map((mode) => (
            <TabsContent key={mode} value={mode} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor={`nick-${mode}`}>Nickname</Label>
                <Input
                  id={`nick-${mode}`}
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="seu_nick"
                  autoComplete="username"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`pw-${mode}`}>Senha</Label>
                <Input
                  id={`pw-${mode}`}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === "in" ? "current-password" : "new-password"}
                  onKeyDown={(e) => e.key === "Enter" && submit(mode)}
                />
              </div>
              <Button
                className="w-full"
                disabled={busy || !nickname || !password}
                onClick={() => submit(mode)}
              >
                {mode === "in" ? "Entrar" : "Criar conta"}
              </Button>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </main>
  );
};

export default Auth;
