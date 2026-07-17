
ALTER TABLE public.wa_messages ADD COLUMN IF NOT EXISTS source_msg_id text NOT NULL DEFAULT '';
ALTER TABLE public.wa_messages ADD COLUMN IF NOT EXISTS source_chat_id text NOT NULL DEFAULT '';
ALTER TABLE public.wa_tasks ADD COLUMN IF NOT EXISTS source_msg_id text NOT NULL DEFAULT '';
ALTER TABLE public.wa_tasks ADD COLUMN IF NOT EXISTS source_chat_id text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS public.wa_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  chat_id text NOT NULL,
  quoted_msg_id text NOT NULL DEFAULT '',
  text text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE INDEX IF NOT EXISTS wa_outbox_user_status_idx ON public.wa_outbox (user_id, status, created_at);

ALTER TABLE public.wa_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own outbox select" ON public.wa_outbox FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own outbox insert" ON public.wa_outbox FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own outbox update" ON public.wa_outbox FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own outbox delete" ON public.wa_outbox FOR DELETE USING (auth.uid() = user_id);
