CREATE POLICY "own msg insert"
ON public.wa_messages
FOR INSERT
WITH CHECK (auth.uid() = user_id);