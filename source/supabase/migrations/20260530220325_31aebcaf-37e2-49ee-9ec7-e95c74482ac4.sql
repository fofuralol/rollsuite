CREATE TABLE public.pix_bank_priorities (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  banco text NOT NULL,
  nivel integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, banco)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pix_bank_priorities TO authenticated;
GRANT ALL ON public.pix_bank_priorities TO service_role;

ALTER TABLE public.pix_bank_priorities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own bank priorities select" ON public.pix_bank_priorities
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own bank priorities insert" ON public.pix_bank_priorities
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own bank priorities update" ON public.pix_bank_priorities
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own bank priorities delete" ON public.pix_bank_priorities
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER trg_pix_bank_priorities_updated
  BEFORE UPDATE ON public.pix_bank_priorities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();