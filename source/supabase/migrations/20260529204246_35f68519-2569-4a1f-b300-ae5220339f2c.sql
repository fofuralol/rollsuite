WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id, btrim(palavra)
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM public.wa_keywords
)
DELETE FROM public.wa_keywords w
USING ranked r
WHERE w.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS wa_keywords_user_palavra_unique
ON public.wa_keywords (user_id, palavra);

CREATE INDEX IF NOT EXISTS wa_keywords_user_palavra_lookup_idx
ON public.wa_keywords (user_id, palavra);