insert into storage.buckets (id, name, public) values ('rolls-updates', 'rolls-updates', true) on conflict (id) do nothing;
create policy "public read rolls-updates" on storage.objects for select using (bucket_id = 'rolls-updates');
create policy "service write rolls-updates" on storage.objects for insert with check (bucket_id = 'rolls-updates');
create policy "service update rolls-updates" on storage.objects for update using (bucket_id = 'rolls-updates');