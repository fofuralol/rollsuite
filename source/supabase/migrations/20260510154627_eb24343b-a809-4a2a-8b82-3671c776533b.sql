
CREATE TABLE public.app_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  key text NOT NULL,
  value text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, key)
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own settings select" ON public.app_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own settings insert" ON public.app_settings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own settings update" ON public.app_settings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own settings delete" ON public.app_settings FOR DELETE USING (auth.uid() = user_id);
