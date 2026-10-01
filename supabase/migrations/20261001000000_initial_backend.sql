create table public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    display_name text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.profiles (id, display_name)
    values (
        new.id,
        nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')), '')
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

create table public.students (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users (id) on delete cascade,
    name text not null check (btrim(name) <> ''),
    position integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (id, owner_id)
);

create table public.student_folders (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users (id) on delete cascade,
    student_id uuid not null,
    parent_id uuid,
    name text not null check (btrim(name) <> ''),
    position integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (id, student_id, owner_id),
    foreign key (student_id, owner_id)
        references public.students (id, owner_id) on delete cascade,
    foreign key (parent_id, student_id, owner_id)
        references public.student_folders (id, student_id, owner_id) on delete cascade
);

create unique index student_folders_root_name_unique
    on public.student_folders (student_id, owner_id, lower(name))
    where parent_id is null;
create unique index student_folders_child_name_unique
    on public.student_folders (parent_id, student_id, owner_id, lower(name))
    where parent_id is not null;

create table public.lessons (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users (id) on delete cascade,
    student_id uuid,
    folder_id uuid,
    title text not null check (btrim(title) <> ''),
    position integer not null default 0,
    cover text,
    color text not null default '#fffef9',
    tags text[] not null default '{}',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (folder_id is null or student_id is not null),
    unique (id, owner_id),
    foreign key (student_id, owner_id)
        references public.students (id, owner_id) on delete cascade,
    foreign key (folder_id, student_id, owner_id)
        references public.student_folders (id, student_id, owner_id)
);

create table public.lesson_pages (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users (id) on delete cascade,
    lesson_id uuid not null,
    name text not null check (btrim(name) <> ''),
    position integer not null default 0,
    background text not null default '#fffef9',
    elements jsonb not null default '[]'::jsonb check (jsonb_typeof(elements) = 'array'),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (id, lesson_id, owner_id),
    unique (lesson_id, position),
    foreign key (lesson_id, owner_id)
        references public.lessons (id, owner_id) on delete cascade
);

create table public.lesson_assets (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users (id) on delete cascade,
    lesson_id uuid not null,
    page_id uuid,
    storage_path text not null unique,
    file_name text not null,
    content_type text not null,
    size_bytes bigint not null check (size_bytes > 0),
    created_at timestamptz not null default now(),
    foreign key (lesson_id, owner_id)
        references public.lessons (id, owner_id) on delete cascade,
    foreign key (page_id, lesson_id, owner_id)
        references public.lesson_pages (id, lesson_id, owner_id) on delete cascade
);

create table public.lesson_sessions (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users (id) on delete cascade,
    lesson_id uuid not null,
    token_hash text not null unique,
    status text not null default 'active' check (status in ('active', 'ended', 'expired')),
    created_at timestamptz not null default now(),
    last_teacher_activity_at timestamptz not null default now(),
    expires_at timestamptz not null default (now() + interval '1 hour'),
    ended_at timestamptz,
    check ((status = 'active' and ended_at is null) or (status <> 'active' and ended_at is not null)),
    foreign key (lesson_id, owner_id)
        references public.lessons (id, owner_id) on delete cascade
);

create index students_owner_position_idx on public.students (owner_id, position);
create index student_folders_student_parent_position_idx on public.student_folders (student_id, parent_id, position);
create index lessons_owner_updated_idx on public.lessons (owner_id, updated_at desc);
create index lessons_student_folder_position_idx on public.lessons (student_id, folder_id, position);
create index lesson_pages_lesson_position_idx on public.lesson_pages (lesson_id, position);
create index lesson_assets_owner_lesson_idx on public.lesson_assets (owner_id, lesson_id);
create index lesson_sessions_active_expiry_idx on public.lesson_sessions (expires_at) where status = 'active';

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
    for each row execute function public.set_updated_at();
create trigger students_set_updated_at before update on public.students
    for each row execute function public.set_updated_at();
create trigger student_folders_set_updated_at before update on public.student_folders
    for each row execute function public.set_updated_at();
create trigger lessons_set_updated_at before update on public.lessons
    for each row execute function public.set_updated_at();
create trigger lesson_pages_set_updated_at before update on public.lesson_pages
    for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.students enable row level security;
alter table public.student_folders enable row level security;
alter table public.lessons enable row level security;
alter table public.lesson_pages enable row level security;
alter table public.lesson_assets enable row level security;
alter table public.lesson_sessions enable row level security;

create policy profiles_select_own on public.profiles
    for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles
    for update to authenticated using (id = (select auth.uid()))
    with check (id = (select auth.uid()));

create policy students_manage_own on public.students
    for all to authenticated using (owner_id = (select auth.uid()))
    with check (owner_id = (select auth.uid()));
create policy student_folders_manage_own on public.student_folders
    for all to authenticated using (owner_id = (select auth.uid()))
    with check (owner_id = (select auth.uid()));
create policy lessons_manage_own on public.lessons
    for all to authenticated using (owner_id = (select auth.uid()))
    with check (owner_id = (select auth.uid()));
create policy lesson_pages_manage_own on public.lesson_pages
    for all to authenticated using (owner_id = (select auth.uid()))
    with check (owner_id = (select auth.uid()));
create policy lesson_assets_manage_own on public.lesson_assets
    for all to authenticated using (owner_id = (select auth.uid()))
    with check (owner_id = (select auth.uid()));
create policy lesson_sessions_select_own on public.lesson_sessions
    for select to authenticated using (owner_id = (select auth.uid()));

create or replace function public.touch_lesson_session(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
    update public.lesson_sessions
    set last_teacher_activity_at = now(),
        expires_at = now() + interval '1 hour'
    where id = p_session_id
      and owner_id = auth.uid()
      and status = 'active'
      and expires_at > now();
    return found;
end;
$$;

create or replace function public.end_lesson_session(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
    update public.lesson_sessions
    set status = 'ended', ended_at = now()
    where id = p_session_id
      and owner_id = auth.uid()
      and status = 'active';
    return found;
end;
$$;

revoke all on function public.touch_lesson_session(uuid) from public;
revoke all on function public.end_lesson_session(uuid) from public;
grant execute on function public.touch_lesson_session(uuid) to authenticated;
grant execute on function public.end_lesson_session(uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'lesson-assets',
    'lesson-assets',
    false,
    52428800,
    array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy lesson_assets_storage_select_own on storage.objects
    for select to authenticated
    using (bucket_id = 'lesson-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy lesson_assets_storage_insert_own on storage.objects
    for insert to authenticated
    with check (bucket_id = 'lesson-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy lesson_assets_storage_update_own on storage.objects
    for update to authenticated
    using (bucket_id = 'lesson-assets' and (storage.foldername(name))[1] = (select auth.uid())::text)
    with check (bucket_id = 'lesson-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy lesson_assets_storage_delete_own on storage.objects
    for delete to authenticated
    using (bucket_id = 'lesson-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
