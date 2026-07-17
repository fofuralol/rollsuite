
create table public.wa_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  autor text not null default '',
  grupo text not null default '',
  mensagem text not null,
  matched text[] not null default '{}',
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.wa_tasks enable row level security;

create policy "own tasks select" on public.wa_tasks for select using (auth.uid() = user_id);
create policy "own tasks insert" on public.wa_tasks for insert with check (auth.uid() = user_id);
create policy "own tasks update" on public.wa_tasks for update using (auth.uid() = user_id);
create policy "own tasks delete" on public.wa_tasks for delete using (auth.uid() = user_id);

create index wa_tasks_user_status_idx on public.wa_tasks(user_id, status, created_at desc);

alter publication supabase_realtime add table public.wa_tasks;
