-- Dedupe: cada (user_id, source_msg_id) só pode existir 1x
DELETE FROM public.wa_messages a
USING public.wa_messages b
WHERE a.ctid < b.ctid
  AND a.user_id = b.user_id
  AND a.source_msg_id = b.source_msg_id
  AND a.source_msg_id <> '';

CREATE UNIQUE INDEX IF NOT EXISTS wa_messages_user_source_msg_unique
  ON public.wa_messages (user_id, source_msg_id)
  WHERE source_msg_id <> '';