create extension if not exists pgcrypto;

create or replace function public.create_lesson_session(p_lesson_id uuid)
returns table (session_id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := auth.uid();
    raw_token text;
    new_session_id uuid;
    new_expires_at timestamptz := now() + interval '7 days';
begin
    if current_user_id is null then
        raise exception 'Authentication is required to create a student link.';
    end if;

    if not exists (
        select 1 from public.lessons
         where id = p_lesson_id
           and owner_id = current_user_id
    ) then
        raise exception 'Lesson was not found in your workspace.';
    end if;

    update public.lesson_sessions
       set status = 'ended', ended_at = now()
     where lesson_id = p_lesson_id
       and owner_id = current_user_id
       and status = 'active';

    raw_token := encode(gen_random_bytes(24), 'hex');
    new_session_id := gen_random_uuid();

    insert into public.lesson_sessions (id, owner_id, lesson_id, token_hash, status, expires_at)
    values (new_session_id, current_user_id, p_lesson_id, encode(digest(raw_token, 'sha256'), 'hex'), 'active', new_expires_at);

    return query select new_session_id, raw_token, new_expires_at;
end;
$$;

revoke all on function public.create_lesson_session(uuid) from public;
grant execute on function public.create_lesson_session(uuid) to authenticated;

create or replace function public.get_shared_lesson(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    session_row public.lesson_sessions%rowtype;
    lesson_row public.lessons%rowtype;
    result jsonb;
begin
    if nullif(btrim(coalesce(p_token, '')), '') is null then
        raise exception 'A student link token is required.';
    end if;

    select * into session_row
      from public.lesson_sessions
     where token_hash = encode(digest(p_token, 'sha256'), 'hex')
       and status = 'active'
       and expires_at > now();
    if not found then
        raise exception 'This student link is invalid or has expired.';
    end if;

    select * into lesson_row
      from public.lessons
     where id = session_row.lesson_id
       and owner_id = session_row.owner_id;
    if not found then
        raise exception 'This lesson is no longer available.';
    end if;

    select jsonb_build_object(
        'lesson', jsonb_build_object('id', lesson_row.id, 'title', lesson_row.title, 'color', lesson_row.color),
        'pages', coalesce(jsonb_agg(jsonb_build_object(
            'name', page.name,
            'position', page.position,
            'elements', page.elements,
            'background', page.background
        ) order by page.position), '[]'::jsonb)
    )
      into result
      from public.lesson_pages as page
     where page.lesson_id = lesson_row.id
       and page.owner_id = lesson_row.owner_id;

    return result;
end;
$$;

revoke all on function public.get_shared_lesson(text) from public;
grant execute on function public.get_shared_lesson(text) to anon, authenticated;
