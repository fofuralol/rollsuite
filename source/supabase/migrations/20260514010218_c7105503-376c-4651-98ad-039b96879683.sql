ALTER TABLE public.wa_tasks ADD COLUMN IF NOT EXISTS image_urls text[] NOT NULL DEFAULT '{}';
UPDATE public.wa_tasks SET image_urls = ARRAY[image_url] WHERE image_url <> '' AND (image_urls IS NULL OR array_length(image_urls,1) IS NULL);
ALTER TABLE public.wa_tasks DROP COLUMN IF EXISTS image_url;