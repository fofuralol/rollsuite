CREATE TABLE public.meta_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT,
  url TEXT,
  steps INTEGER,
  target INTEGER,
  source_tab_id TEXT,
  raw JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.meta_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users select own meta_events" ON public.meta_events
FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "users delete own meta_events" ON public.meta_events
FOR DELETE TO authenticated
USING (auth.uid() = user_id);

CREATE INDEX meta_events_user_created_idx ON public.meta_events (user_id, created_at DESC);

ALTER PUBLICATION supabase_realtime ADD TABLE public.meta_events;