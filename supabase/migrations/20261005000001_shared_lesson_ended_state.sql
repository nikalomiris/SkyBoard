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
     where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
       and status = 'active'
       and expires_at > now();
    if not found then
        if exists (
            select 1 from public.lesson_sessions
             where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
               and status = 'ended'
        ) then
            raise exception 'LESSON_ENDED';
        end if;
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
