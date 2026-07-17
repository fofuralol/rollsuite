CREATE TABLE public.dkdash_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  filial_id text NOT NULL DEFAULT 'filial01',
  dk_username text NOT NULL,
  password_encrypted text NOT NULL,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, filial_id)
);

ALTER TABLE public.dkdash_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own creds select" ON public.dkdash_credentials FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own creds insert" ON public.dkdash_credentials FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own creds update" ON public.dkdash_credentials FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own creds delete" ON public.dkdash_credentials FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER dkdash_credentials_set_updated_at
BEFORE UPDATE ON public.dkdash_credentials
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();