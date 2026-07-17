CREATE POLICY "Users can subscribe to own topic" ON realtime.messages FOR SELECT TO authenticated USING (
  (split_part(realtime.topic(), ':', 1) IN ('calc_rows', 'slot_mapping_codes'))
  AND split_part(realtime.topic(), ':', 2) = (SELECT auth.uid()::text)
);