import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface AuthCtx {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (nickname: string, password: string) => Promise<{ error?: string }>;
  signUp: (nickname: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

const nickToEmail = (n: string) => `${n.trim().toLowerCase().replace(/[^a-z0-9_]/g, "")}@rolls.local`;

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setUser(s?.user ?? null);
    });
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (nickname: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: nickToEmail(nickname),
      password,
    });
    return error ? { error: "Nickname ou senha inválidos" } : {};
  };

  const signUp = async (nickname: string, password: string) => {
    const clean = nickname.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (clean.length < 3) return { error: "Nickname deve ter ao menos 3 caracteres (a-z, 0-9, _)" };
    if (password.length < 6) return { error: "Senha deve ter ao menos 6 caracteres" };
    const { error } = await supabase.auth.signUp({
      email: nickToEmail(clean),
      password,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) {
      if (error.message.includes("registered")) return { error: "Nickname já cadastrado" };
      return { error: error.message };
    }
    return {};
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <Ctx.Provider value={{ user, session, loading, signIn, signUp, signOut }}>
      {children}
    </Ctx.Provider>
  );
};

export const useAuth = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
};
