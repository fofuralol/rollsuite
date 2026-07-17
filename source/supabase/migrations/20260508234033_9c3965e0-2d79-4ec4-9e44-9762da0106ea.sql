-- Add telefone column to wa_messages
ALTER TABLE public.wa_messages
ADD COLUMN telefone text NOT NULL DEFAULT ''::text;

-- Update existing rows to empty string (already covered by default)