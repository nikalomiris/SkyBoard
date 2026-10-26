-- Saves only the supplied pages. Pages are removed only from lessons listed in
-- p_complete_lesson_ids, where p_pages holds that lesson's full page set.
create or replace function public.save_lesson_pages_delta(p_pages jsonb, p_complete_lesson_ids uuid[] default '{}')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := auth.uid();
    complete_ids uuid[] := coalesce(p_complete_lesson_ids, '{}');
    staging_base bigint;
begin
    if current_user_id is null then
        raise exception 'Authentication is required to save lesson pages.';
    end if;
    if jsonb_typeof(p_pages) <> 'array' then
        raise exception 'Lesson pages must be provided as an array.';
    end if;

    perform 1
      from public.profiles
     where id = current_user_id
     for update;
    if not found then
        raise exception 'Workspace profile was not found.';
    end if;

    if exists (
        select 1
          from jsonb_array_elements(p_pages) as entry(value)
         where nullif(entry.value ->> 'id', '') is null
            or nullif(entry.value ->> 'lesson_id', '') is null
            or nullif(btrim(entry.value ->> 'name'), '') is null
            or (entry.value ->> 'position')::integer < 0
            or jsonb_typeof(coalesce(entry.value -> 'elements', '[]'::jsonb)) <> 'array'
    ) then
        raise exception 'One or more lesson pages have invalid data.';
    end if;

    if exists (
        select 1
          from jsonb_array_elements(p_pages) as entry(value)
         group by (entry.value ->> 'lesson_id')::uuid, (entry.value ->> 'position')::integer
        having count(*) > 1
    ) then
        raise exception 'Lesson page positions must be unique within each lesson.';
    end if;

    if exists (
        select 1
          from jsonb_array_elements(p_pages) as entry(value)
          left join public.lessons as lesson
            on lesson.id = (entry.value ->> 'lesson_id')::uuid
           and lesson.owner_id = current_user_id
         where lesson.id is null
    ) then
        raise exception 'A lesson page references a lesson outside this workspace.';
    end if;

    if (
        select count(*)
          from public.lessons
         where owner_id = current_user_id
           and id = any (complete_ids)
    ) <> cardinality(complete_ids) then
        raise exception 'A lesson to replace is outside this workspace.';
    end if;

    if exists (
        select 1
          from jsonb_array_elements(p_pages) as entry(value)
          join public.lesson_pages as page
            on page.id = (entry.value ->> 'id')::uuid
         where page.owner_id <> current_user_id
            or page.lesson_id <> (entry.value ->> 'lesson_id')::uuid
    ) then
        raise exception 'A lesson page ID cannot be reassigned.';
    end if;

    select coalesce(max(position)::bigint, 0) + count(*)::bigint + 1
      into staging_base
      from public.lesson_pages
     where owner_id = current_user_id;

    -- Move only the affected pages out of the way so positions can be reassigned.
    with staged as (
        select page.id,
               row_number() over (partition by page.lesson_id order by page.position, page.id) as row_number
          from public.lesson_pages as page
         where page.owner_id = current_user_id
           and (
               page.lesson_id = any (complete_ids)
               or exists (
                   select 1
                     from jsonb_array_elements(p_pages) as entry(value)
                    where (entry.value ->> 'id')::uuid = page.id
               )
           )
    )
    update public.lesson_pages as page
       set position = staging_base + staged.row_number
      from staged
     where page.id = staged.id;

    delete from public.lesson_pages as page
     where page.owner_id = current_user_id
       and page.lesson_id = any (complete_ids)
       and not exists (
           select 1
             from jsonb_array_elements(p_pages) as entry(value)
            where (entry.value ->> 'id')::uuid = page.id
       );

    insert into public.lesson_pages (id, owner_id, lesson_id, name, position, elements, background)
    select (entry.value ->> 'id')::uuid,
           current_user_id,
           (entry.value ->> 'lesson_id')::uuid,
           entry.value ->> 'name',
           (entry.value ->> 'position')::integer,
           coalesce(entry.value -> 'elements', '[]'::jsonb),
           coalesce(nullif(entry.value ->> 'background', ''), '#fffef9')
      from jsonb_array_elements(p_pages) as entry(value)
    on conflict (id) do update
        set lesson_id = excluded.lesson_id,
            name = excluded.name,
            position = excluded.position,
            elements = excluded.elements,
            background = excluded.background,
            updated_at = now();
end;
$$;

revoke all on function public.save_lesson_pages_delta(jsonb, uuid[]) from public;
grant execute on function public.save_lesson_pages_delta(jsonb, uuid[]) to authenticated;
