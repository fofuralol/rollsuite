
ALTER TABLE public.dkdash_ranking ALTER COLUMN user_id SET DEFAULT gen_random_uuid();
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dkdash_ranking_nickname_key') THEN
    ALTER TABLE public.dkdash_ranking ADD CONSTRAINT dkdash_ranking_nickname_key UNIQUE (nickname);
  END IF;
END $$;

DROP POLICY IF EXISTS "Cada usuário gerencia sua linha" ON public.dkdash_ranking;
DROP POLICY IF EXISTS "Ranking visível para autenticados" ON public.dkdash_ranking;

GRANT SELECT, INSERT, UPDATE ON public.dkdash_ranking TO anon;
GRANT SELECT, INSERT, UPDATE ON public.dkdash_ranking TO authenticated;

CREATE POLICY "Ranking público leitura" ON public.dkdash_ranking FOR SELECT USING (true);
CREATE POLICY "Ranking público insert" ON public.dkdash_ranking FOR INSERT WITH CHECK (true);
CREATE POLICY "Ranking público update" ON public.dkdash_ranking FOR UPDATE USING (true) WITH CHECK (true);
