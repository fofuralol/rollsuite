CREATE TABLE IF NOT EXISTS public.dkdash_turno_alert_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  filial_id text NOT NULL DEFAULT 'filial01',
  categoria text NOT NULL DEFAULT 'montante',
  last_signature text,
  last_notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, filial_id, categoria)
);

ALTER TABLE public.dkdash_turno_alert_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own turno alert state select"
ON public.dkdash_turno_alert_state
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "own turno alert state insert"
ON public.dkdash_turno_alert_state
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own turno alert state update"
ON public.dkdash_turno_alert_state
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "own turno alert state delete"
ON public.dkdash_turno_alert_state
FOR DELETE
USING (auth.uid() = user_id);

CREATE TRIGGER dkdash_turno_alert_state_set_updated_at
BEFORE UPDATE ON public.dkdash_turno_alert_state
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_dkdash_turno_alert_state_user_categoria
ON public.dkdash_turno_alert_state(user_id, categoria);

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  PERFORM cron.unschedule('dkdash-turno-push-check');
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END $$;

SELECT cron.schedule(
  'dkdash-turno-push-check',
  '10 seconds',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url', true) || '/functions/v1/dkdash-turno-poll',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', current_setting('app.settings.anon_key', true),
      'Authorization', 'Bearer ' || current_setting('app.settings.anon_key', true)
    ),
    body := jsonb_build_object('source', 'cron')
  );
  $$
);