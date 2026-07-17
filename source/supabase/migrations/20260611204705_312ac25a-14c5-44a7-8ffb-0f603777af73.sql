ALTER TABLE public.dkdash_credentials
ADD COLUMN IF NOT EXISTS cached_token text,
ADD COLUMN IF NOT EXISTS cached_token_exp bigint,
ADD COLUMN IF NOT EXISTS cached_token_info jsonb;