create table public.background_library (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users (id) on delete cascade,
    name text not null check (btrim(name) <> ''),
    group_name text not null default '',
    image text not null check (left(image, 11) = 'data:image/'),
    created_at timestamptz not null default now()
);

create index background_library_owner_idx on public.background_library (owner_id, created_at);

alter table public.background_library enable row level security;

create policy background_library_select_own on public.background_library
    for select to authenticated using (owner_id = (select auth.uid()));
create policy background_library_insert_own on public.background_library
    for insert to authenticated with check (owner_id = (select auth.uid()));
create policy background_library_update_own on public.background_library
    for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy background_library_delete_own on public.background_library
    for delete to authenticated using (owner_id = (select auth.uid()));
