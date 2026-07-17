
UPDATE storage.buckets SET public = false WHERE id = 'wa-task-images';
DROP POLICY IF EXISTS "wa-task-images public read" ON storage.objects;

CREATE POLICY "wa-task-images user read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'wa-task-images' AND auth.uid()::text = (storage.foldername(name))[1]);
