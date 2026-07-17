
CREATE TABLE public.slots_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  nome text NOT NULL,
  bet_default numeric NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.slots_catalog TO authenticated;
GRANT ALL ON public.slots_catalog TO service_role;

ALTER TABLE public.slots_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own slots select" ON public.slots_catalog
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own slots insert" ON public.slots_catalog
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own slots update" ON public.slots_catalog
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own slots delete" ON public.slots_catalog
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER slots_catalog_set_updated_at
  BEFORE UPDATE ON public.slots_catalog
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX slots_catalog_user_idx ON public.slots_catalog(user_id, ativo);

ALTER TABLE public.calc_rows ADD COLUMN IF NOT EXISTS slots jsonb NOT NULL DEFAULT '[]'::jsonb;
