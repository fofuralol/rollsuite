ALTER TABLE public.dkdash_ranking DROP COLUMN IF EXISTS total_7d;
ALTER TABLE public.dkdash_ranking DROP COLUMN IF EXISTS total_30d;
ALTER TABLE public.dkdash_ranking ADD COLUMN IF NOT EXISTS total_mes NUMERIC NOT NULL DEFAULT 0;