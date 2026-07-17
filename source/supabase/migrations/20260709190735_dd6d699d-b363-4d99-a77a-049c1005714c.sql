CREATE OR REPLACE FUNCTION public.normalize_dkdash_ranking_nickname()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.nickname := lower(trim(coalesce(NEW.nickname, '')));

  IF NEW.nickname = 'fofuralo' THEN
    NEW.nickname := 'fofuralol';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_dkdash_ranking_nickname ON public.dkdash_ranking;
CREATE TRIGGER trg_normalize_dkdash_ranking_nickname
BEFORE INSERT OR UPDATE OF nickname ON public.dkdash_ranking
FOR EACH ROW
EXECUTE FUNCTION public.normalize_dkdash_ranking_nickname();

INSERT INTO public.dkdash_ranking (nickname, total_hoje, total_mes, total_geral, updated_at)
SELECT
  'fofuralol',
  COALESCE(MAX(total_hoje), 0),
  COALESCE(MAX(total_mes), 0),
  COALESCE(MAX(total_geral), 0),
  COALESCE(MAX(updated_at), now())
FROM public.dkdash_ranking
WHERE lower(trim(nickname)) IN ('fofuralo', 'fofuralol')
ON CONFLICT (nickname) DO UPDATE SET
  total_hoje = GREATEST(public.dkdash_ranking.total_hoje, EXCLUDED.total_hoje),
  total_mes = GREATEST(public.dkdash_ranking.total_mes, EXCLUDED.total_mes),
  total_geral = GREATEST(public.dkdash_ranking.total_geral, EXCLUDED.total_geral),
  updated_at = GREATEST(public.dkdash_ranking.updated_at, EXCLUDED.updated_at);

DELETE FROM public.dkdash_ranking
WHERE lower(trim(nickname)) = 'fofuralo';