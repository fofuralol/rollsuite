-- Add telefone column to wa_tasks
ALTER TABLE public.wa_tasks
ADD COLUMN telefone text NOT NULL DEFAULT ''::text;