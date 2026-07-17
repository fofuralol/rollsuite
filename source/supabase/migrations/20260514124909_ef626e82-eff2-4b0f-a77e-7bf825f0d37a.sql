UPDATE public.wa_tasks
SET completed_at = (operation_data->>'savedAt')::timestamptz
WHERE id IN (
  '7bffdd39-f59c-41cd-80c8-b711a73e2f28',
  'c15ddc3b-9370-43be-bf85-6f3f7366c566'
)
AND operation_data ? 'savedAt';

UPDATE public.wa_tasks
SET operation_data = jsonb_set(operation_data, '{dk_synced}', 'true'::jsonb)
WHERE id = 'c15ddc3b-9370-43be-bf85-6f3f7366c566';