
CREATE TABLE public.extension_licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  serial text NOT NULL UNIQUE,
  label text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  device_id text,
  device_info text NOT NULL DEFAULT '',
  activated_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.extension_licenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth select licenses" ON public.extension_licenses FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert licenses" ON public.extension_licenses FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update licenses" ON public.extension_licenses FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth delete licenses" ON public.extension_licenses FOR DELETE TO authenticated USING (true);

CREATE TRIGGER set_extension_licenses_updated_at
BEFORE UPDATE ON public.extension_licenses
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
