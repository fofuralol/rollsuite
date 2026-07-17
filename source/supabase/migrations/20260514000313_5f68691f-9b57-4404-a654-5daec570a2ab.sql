
ALTER TABLE public.wa_messages ADD COLUMN IF NOT EXISTS source_author_id text NOT NULL DEFAULT '';
ALTER TABLE public.wa_tasks ADD COLUMN IF NOT EXISTS source_author_id text NOT NULL DEFAULT '';
ALTER TABLE public.wa_tasks ADD COLUMN IF NOT EXISTS image_url text NOT NULL DEFAULT '';
ALTER TABLE public.wa_outbox ADD COLUMN IF NOT EXISTS image_url text NOT NULL DEFAULT '';

INSERT INTO storage.buckets (id, name, public)
VALUES ('wa-task-images', 'wa-task-images', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

CREATE POLICY "wa-task-images public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'wa-task-images');

CREATE POLICY "wa-task-images user insert"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'wa-task-images' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "wa-task-images user update"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'wa-task-images' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "wa-task-images user delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'wa-task-images' AND auth.uid()::text = (storage.foldername(name))[1]);
