create table public.wa_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  token text not null unique,
  label text not null default 'listener',
  created_at timestamptz not null default now()
);
alter table public.wa_tokens enable row level security;
create policy "own tokens select" on public.wa_tokens for select using (auth.uid() = user_id);
create policy "own tokens insert" on public.wa_tokens for insert with check (auth.uid() = user_id);
create policy "own tokens delete" on public.wa_tokens for delete using (auth.uid() = user_id);

create table public.wa_keywords (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  palavra text not null,
  created_at timestamptz not null default now()
);
alter table public.wa_keywords enable row level security;
create policy "own kw select" on public.wa_keywords for select using (auth.uid() = user_id);
create policy "own kw insert" on public.wa_keywords for insert with check (auth.uid() = user_id);
create policy "own kw delete" on public.wa_keywords for delete using (auth.uid() = user_id);
create policy "own kw update" on public.wa_keywords for update using (auth.uid() = user_id);

create table public.wa_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  autor text not null default '',
  grupo text not null default '',
  mensagem text not null,
  matched text[] not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.wa_messages enable row level security;
create policy "own msg select" on public.wa_messages for select using (auth.uid() = user_id);
create policy "own msg delete" on public.wa_messages for delete using (auth.uid() = user_id);

alter table public.wa_messages replica identity full;
alter publication supabase_realtime add table public.wa_messages;