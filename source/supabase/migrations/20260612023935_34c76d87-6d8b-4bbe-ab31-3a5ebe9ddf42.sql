ALTER TABLE public.dkdash_ranking DROP CONSTRAINT IF EXISTS dkdash_ranking_user_id_fkey;
ALTER TABLE public.dkdash_ranking DROP CONSTRAINT IF EXISTS dkdash_ranking_pkey;
ALTER TABLE public.dkdash_ranking ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.dkdash_ranking ALTER COLUMN user_id DROP DEFAULT;