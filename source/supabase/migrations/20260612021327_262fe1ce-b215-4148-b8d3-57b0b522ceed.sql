CREATE TABLE public.dkdash_ranking (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  total_hoje NUMERIC NOT NULL DEFAULT 0,
  total_7d NUMERIC NOT NULL DEFAULT 0,
  total_30d NUMERIC NOT NULL DEFAULT 0,
  total_geral NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dkdash_ranking TO authenticated;
GRANT ALL ON public.dkdash_ranking TO service_role;
ALTER TABLE public.dkdash_ranking ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Ranking visível para autenticados" ON public.dkdash_ranking FOR SELECT TO authenticated USING (true);
CREATE POLICY "Cada usuário gerencia sua linha" ON public.dkdash_ranking FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_dkdash_ranking_updated BEFORE UPDATE ON public.dkdash_ranking FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();