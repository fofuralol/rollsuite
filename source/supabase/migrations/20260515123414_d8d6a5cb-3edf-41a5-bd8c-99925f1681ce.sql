insert into storage.buckets (id, name, public) values ('zapo-updates', 'zapo-updates', true);
create policy "Public read zapo-updates" on storage.objects for select using (bucket_id = 'zapo-updates');