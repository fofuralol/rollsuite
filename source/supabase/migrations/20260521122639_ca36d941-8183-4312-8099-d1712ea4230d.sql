insert into storage.buckets (id, name, public) values ('zapo2-updates', 'zapo2-updates', true) on conflict (id) do nothing;

create policy "zapo2-updates public read"
on storage.objects for select
using (bucket_id = 'zapo2-updates');