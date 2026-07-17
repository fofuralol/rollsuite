CREATE TABLE public.chaves_pix (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  banco text NOT NULL DEFAULT '',
  tipo_chave text NOT NULL DEFAULT '',
  chave text NOT NULL,
  titular text NOT NULL DEFAULT '',
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.chaves_pix ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own pix select" ON public.chaves_pix FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own pix insert" ON public.chaves_pix FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own pix update" ON public.chaves_pix FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own pix delete" ON public.chaves_pix FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER chaves_pix_set_updated_at
BEFORE UPDATE ON public.chaves_pix
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();