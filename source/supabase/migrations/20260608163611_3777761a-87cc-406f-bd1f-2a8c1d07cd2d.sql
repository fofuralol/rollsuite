CREATE TABLE public.dkdash_turno_rotations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  filial_id text not null,
  categoria text not null default 'montante',
  rotated_username text not null,
  day date not null default (now() at time zone 'America/Sao_Paulo')::date,
  created_at timestamptz not null default now()
);
CREATE INDEX idx_dkdash_turno_rot_lookup ON public.dkdash_turno_rotations(user_id, filial_id, categoria, day);
GRANT SELECT, INSERT ON public.dkdash_turno_rotations TO authenticated;
GRANT ALL ON public.dkdash_turno_rotations TO service_role;
ALTER TABLE public.dkdash_turno_rotations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own select" ON public.dkdash_turno_rotations FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own insert" ON public.dkdash_turno_rotations FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);