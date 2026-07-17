
-- 1. extension_licenses: add owner column and tighten policies
ALTER TABLE public.extension_licenses
  ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL DEFAULT auth.uid();

DROP POLICY IF EXISTS "auth select licenses" ON public.extension_licenses;
DROP POLICY IF EXISTS "auth insert licenses" ON public.extension_licenses;
DROP POLICY IF EXISTS "auth update licenses" ON public.extension_licenses;
DROP POLICY IF EXISTS "auth delete licenses" ON public.extension_licenses;

CREATE POLICY "own licenses select" ON public.extension_licenses
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own licenses insert" ON public.extension_licenses
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own licenses update" ON public.extension_licenses
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own licenses delete" ON public.extension_licenses
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 2. wa_messages: add UPDATE policy
CREATE POLICY "own msg update" ON public.wa_messages
  FOR UPDATE TO public USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 3. meta_events: add INSERT + UPDATE policies (owner-scoped)
CREATE POLICY "users insert own meta_events" ON public.meta_events
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users update own meta_events" ON public.meta_events
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 4. realtime.messages: extend topic authorization to cover wa_messages, wa_tasks, meta_events
DROP POLICY IF EXISTS "Users can subscribe to own topic" ON realtime.messages;
CREATE POLICY "Users can subscribe to own topic" ON realtime.messages
  FOR SELECT TO authenticated USING (
    split_part(realtime.topic(), ':', 1) = ANY (ARRAY['calc_rows','slot_mapping_codes','wa_messages','wa_tasks','meta_events'])
    AND split_part(realtime.topic(), ':', 2) = (SELECT (auth.uid())::text)
  );

-- 5. Storage public buckets: drop broad SELECT policies that enable listing.
-- Public buckets still allow direct file access via public URL without a SELECT policy.
DROP POLICY IF EXISTS "Public read zapo-updates" ON storage.objects;
DROP POLICY IF EXISTS "zapo2-updates public read" ON storage.objects;
