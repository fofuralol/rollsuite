
CREATE TABLE public.calc_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  ordem int NOT NULL DEFAULT 0,
  deposito numeric NOT NULL DEFAULT 0,
  rollover numeric NOT NULL DEFAULT 0,
  aposta numeric NOT NULL DEFAULT 0,
  saque numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.slot_mapping_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  slot_name text NOT NULL,
  codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, slot_name)
);

ALTER TABLE public.calc_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slot_mapping_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own rows select" ON public.calc_rows FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own rows insert" ON public.calc_rows FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own rows update" ON public.calc_rows FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own rows delete" ON public.calc_rows FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "own codes select" ON public.slot_mapping_codes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own codes insert" ON public.slot_mapping_codes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own codes update" ON public.slot_mapping_codes FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own codes delete" ON public.slot_mapping_codes FOR DELETE USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER calc_rows_updated BEFORE UPDATE ON public.calc_rows
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER slot_codes_updated BEFORE UPDATE ON public.slot_mapping_codes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.calc_rows REPLICA IDENTITY FULL;
ALTER TABLE public.slot_mapping_codes REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.calc_rows;
ALTER PUBLICATION supabase_realtime ADD TABLE public.slot_mapping_codes;
