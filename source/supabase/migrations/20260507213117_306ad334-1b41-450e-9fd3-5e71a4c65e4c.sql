
UPDATE public.chaves_pix SET banco = 'InfinityPay' WHERE banco = 'CloudWalk';
UPDATE public.chaves_pix SET chave = regexp_replace(chave, '^\+55\s*', '') WHERE chave LIKE '+55%';
