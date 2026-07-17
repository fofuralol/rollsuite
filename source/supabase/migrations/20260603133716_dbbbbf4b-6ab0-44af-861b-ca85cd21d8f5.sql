CREATE TABLE public.platform_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  url_norm text NOT NULL,
  platform_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, url_norm)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_mappings TO authenticated;
GRANT ALL ON public.platform_mappings TO service_role;

ALTER TABLE public.platform_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own platform mappings select" ON public.platform_mappings
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own platform mappings insert" ON public.platform_mappings
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own platform mappings update" ON public.platform_mappings
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own platform mappings delete" ON public.platform_mappings
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER platform_mappings_set_updated_at
  BEFORE UPDATE ON public.platform_mappings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_platform_mappings_user_name ON public.platform_mappings (user_id, platform_name);