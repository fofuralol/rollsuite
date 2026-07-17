DROP POLICY IF EXISTS "Ranking público insert" ON public.dkdash_ranking;
DROP POLICY IF EXISTS "Ranking público update" ON public.dkdash_ranking;

CREATE POLICY "Ranking público insert" ON public.dkdash_ranking
FOR INSERT
TO public
WITH CHECK (
  nickname <> ''
  AND nickname <> 'anon'
  AND nickname = lower(trim(nickname))
  AND position('@' in nickname) = 0
  AND total_hoje IS NOT NULL
  AND total_mes IS NOT NULL
  AND total_geral IS NOT NULL
);

CREATE POLICY "Ranking público update" ON public.dkdash_ranking
FOR UPDATE
TO public
USING (
  nickname <> ''
  AND nickname <> 'anon'
  AND nickname = lower(trim(nickname))
  AND position('@' in nickname) = 0
)
WITH CHECK (
  nickname <> ''
  AND nickname <> 'anon'
  AND nickname = lower(trim(nickname))
  AND position('@' in nickname) = 0
  AND total_hoje IS NOT NULL
  AND total_mes IS NOT NULL
  AND total_geral IS NOT NULL
);