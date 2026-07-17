UPDATE public.wa_tasks
SET completed_at = (operation_data->>'savedAt')::timestamptz
WHERE id = '41c59c1e-0584-4050-8fe2-95fb0896f1cd'
AND operation_data ? 'savedAt';