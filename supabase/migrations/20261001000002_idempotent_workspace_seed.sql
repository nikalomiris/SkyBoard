create or replace function public.initialize_workspace(p_students jsonb, p_lessons jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := auth.uid();
    current_initialized boolean;
begin
    if current_user_id is null then
        raise exception 'Authentication is required to initialize a workspace.';
    end if;
    if jsonb_typeof(p_students) <> 'array' or jsonb_typeof(p_lessons) <> 'array' then
        raise exception 'Workspace seed data must be provided as arrays.';
    end if;

    select workspace_initialized
      into current_initialized
      from public.profiles
     where id = current_user_id
     for update;

    if not found then
        raise exception 'Workspace profile was not found.';
    end if;
    if current_initialized then
        return;
    end if;

    insert into public.students (owner_id, name, position)
    select current_user_id, student.value ->> 'name', coalesce((student.value ->> 'position')::integer, 0)
      from jsonb_array_elements(p_students) as student(value)
     where nullif(btrim(student.value ->> 'name'), '') is not null
    on conflict do nothing;

    insert into public.lessons (id, owner_id, student_id, title, position, cover, color, tags)
    select (lesson.value ->> 'id')::uuid,
           current_user_id,
           student.id,
           lesson.value ->> 'title',
           coalesce((lesson.value ->> 'position')::integer, 0),
           nullif(lesson.value ->> 'cover', ''),
           coalesce(nullif(lesson.value ->> 'color', ''), '#fffef9'),
           coalesce(array(select jsonb_array_elements_text(lesson.value -> 'tags')), '{}')
      from jsonb_array_elements(p_lessons) as lesson(value)
      join public.students as student
        on student.owner_id = current_user_id
       and lower(student.name) = lower(lesson.value ->> 'folder')
     where nullif(btrim(lesson.value ->> 'title'), '') is not null
    on conflict (id) do nothing;

    insert into public.lesson_pages (owner_id, lesson_id, name, position, elements)
    select current_user_id,
           saved_lesson.id,
           page.value,
           (page.ordinality - 1)::integer,
           '[]'::jsonb
      from jsonb_array_elements(p_lessons) as lesson(value)
      join public.lessons as saved_lesson
        on saved_lesson.id = (lesson.value ->> 'id')::uuid
       and saved_lesson.owner_id = current_user_id
      cross join lateral jsonb_array_elements_text(lesson.value -> 'pages') with ordinality as page(value, ordinality)
    on conflict (lesson_id, position) do nothing;

    update public.profiles
       set workspace_initialized = true
     where id = current_user_id;
end;
$$;

revoke all on function public.initialize_workspace(jsonb, jsonb) from public;
grant execute on function public.initialize_workspace(jsonb, jsonb) to authenticated;
