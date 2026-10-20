-- Per-student invite links with an optional waiting room.
create table public.lesson_invites (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null references public.lesson_sessions (id) on delete cascade,
    owner_id uuid not null references auth.users (id) on delete cascade,
    lesson_id uuid not null,
    label text not null,
    color text not null,
    token text not null unique,
    status text not null default 'pending' check (status in ('pending', 'admitted', 'removed')),
    created_at timestamptz not null default now()
);

create index lesson_invites_session_idx on public.lesson_invites (session_id, created_at);

alter table public.lesson_invites enable row level security;

create policy lesson_invites_select_own on public.lesson_invites
    for select to authenticated using (owner_id = (select auth.uid()));

-- Starts (or resumes) the live room for a lesson; the room id names the realtime channel.
create or replace function public.start_lesson_share(p_lesson_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := auth.uid();
    existing_row public.lesson_sessions%rowtype;
    new_session_id uuid := gen_random_uuid();
    new_expires_at timestamptz := now() + interval '7 days';
begin
    if current_user_id is null then
        raise exception 'Authentication is required to share a lesson.';
    end if;

    if not exists (
        select 1 from public.lessons l
         where l.id = p_lesson_id and l.owner_id = current_user_id
    ) then
        raise exception 'Lesson was not found in your workspace.';
    end if;

    select s.* into existing_row
      from public.lesson_sessions s
     where s.lesson_id = p_lesson_id
       and s.owner_id = current_user_id
       and s.status = 'active'
       and s.expires_at > now()
     order by s.created_at desc
     limit 1;
    if found then
        return jsonb_build_object('sessionId', existing_row.id, 'expiresAt', existing_row.expires_at);
    end if;

    update public.lesson_sessions s
       set status = 'expired', ended_at = now()
     where s.lesson_id = p_lesson_id
       and s.owner_id = current_user_id
       and s.status = 'active';

    insert into public.lesson_sessions (id, owner_id, lesson_id, token_hash, status, expires_at)
    values (
        new_session_id,
        current_user_id,
        p_lesson_id,
        encode(extensions.digest(encode(extensions.gen_random_bytes(24), 'hex'), 'sha256'), 'hex'),
        'active',
        new_expires_at
    );

    return jsonb_build_object('sessionId', new_session_id, 'expiresAt', new_expires_at);
end;
$$;

create or replace function public.create_lesson_invite(p_session_id uuid, p_label text, p_requires_approval boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := auth.uid();
    session_row public.lesson_sessions%rowtype;
    invite_count integer;
    new_row public.lesson_invites%rowtype;
    palette text[] := array['#2f80ed', '#e5484d', '#2e9d68', '#9b51e0', '#f2994a', '#0ea5a4', '#d6409f', '#6b7280'];
begin
    if current_user_id is null then
        raise exception 'Authentication is required to invite a student.';
    end if;

    select s.* into session_row
      from public.lesson_sessions s
     where s.id = p_session_id
       and s.owner_id = current_user_id
       and s.status = 'active'
       and s.expires_at > now();
    if not found then
        raise exception 'This lesson is not being shared.';
    end if;

    select count(*) into invite_count from public.lesson_invites i where i.session_id = p_session_id;

    insert into public.lesson_invites (session_id, owner_id, lesson_id, label, color, token, status)
    values (
        p_session_id,
        current_user_id,
        session_row.lesson_id,
        left(coalesce(nullif(btrim(p_label), ''), 'Student'), 40),
        palette[1 + (invite_count % array_length(palette, 1))],
        encode(extensions.gen_random_bytes(24), 'hex'),
        case when p_requires_approval then 'pending' else 'admitted' end
    )
    returning * into new_row;

    return jsonb_build_object('id', new_row.id, 'label', new_row.label, 'color', new_row.color, 'token', new_row.token, 'status', new_row.status);
end;
$$;

create or replace function public.set_lesson_invite_status(p_invite_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null then
        raise exception 'Authentication is required.';
    end if;
    if p_status not in ('pending', 'admitted', 'removed') then
        raise exception 'Unknown invite status.';
    end if;

    update public.lesson_invites i
       set status = p_status
     where i.id = p_invite_id
       and i.owner_id = auth.uid();
    if not found then
        raise exception 'Invite was not found.';
    end if;
end;
$$;

create or replace function public.get_shared_lesson(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    invite_row public.lesson_invites%rowtype;
    session_row public.lesson_sessions%rowtype;
    lesson_row public.lessons%rowtype;
    base jsonb;
    pages_json jsonb;
begin
    if nullif(btrim(coalesce(p_token, '')), '') is null then
        raise exception 'A student link token is required.';
    end if;

    select i.* into invite_row from public.lesson_invites i where i.token = p_token;
    if not found then
        raise exception 'This student link is invalid or has expired.';
    end if;

    select s.* into session_row from public.lesson_sessions s where s.id = invite_row.session_id;
    if session_row.status = 'ended' then
        raise exception 'LESSON_ENDED';
    end if;
    if session_row.status <> 'active' or session_row.expires_at <= now() then
        raise exception 'This student link is invalid or has expired.';
    end if;

    base := jsonb_build_object(
        'access', invite_row.status,
        'sessionId', session_row.id,
        'invite', jsonb_build_object('id', invite_row.id, 'label', invite_row.label, 'color', invite_row.color)
    );
    if invite_row.status <> 'admitted' then
        return base;
    end if;

    select l.* into lesson_row
      from public.lessons l
     where l.id = session_row.lesson_id
       and l.owner_id = session_row.owner_id;
    if not found then
        raise exception 'This lesson is no longer available.';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
        'name', page.name,
        'position', page.position,
        'elements', page.elements,
        'background', page.background
    ) order by page.position), '[]'::jsonb)
      into pages_json
      from public.lesson_pages as page
     where page.lesson_id = lesson_row.id
       and page.owner_id = lesson_row.owner_id;

    return base || jsonb_build_object(
        'lesson', jsonb_build_object('id', lesson_row.id, 'title', lesson_row.title, 'color', lesson_row.color),
        'pages', pages_json
    );
end;
$$;

revoke all on function public.start_lesson_share(uuid) from public;
revoke all on function public.create_lesson_invite(uuid, text, boolean) from public;
revoke all on function public.set_lesson_invite_status(uuid, text) from public;
revoke all on function public.get_shared_lesson(text) from public;
grant execute on function public.start_lesson_share(uuid) to authenticated;
grant execute on function public.create_lesson_invite(uuid, text, boolean) to authenticated;
grant execute on function public.set_lesson_invite_status(uuid, text) to authenticated;
grant execute on function public.get_shared_lesson(text) to anon, authenticated;
