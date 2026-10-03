alter table public.students
    add column if not exists is_mock boolean not null default false;

alter table public.lessons
    add column if not exists is_mock boolean not null default false;

create unique index if not exists students_one_mock_per_owner_idx
    on public.students (owner_id)
    where is_mock;

create unique index if not exists lessons_one_mock_per_owner_idx
    on public.lessons (owner_id)
    where is_mock;

create or replace function public.ensure_mock_student_lesson(p_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    mock_student_id uuid;
    mock_lesson_id uuid;
    student_name text := 'Demo student';
    name_suffix integer := 1;
    next_position integer;
begin
    perform 1
      from public.profiles
     where id = p_owner_id
     for update;
    if not found then
        raise exception 'Workspace profile was not found.';
    end if;

    select id
      into mock_student_id
      from public.students
     where owner_id = p_owner_id
       and is_mock
     limit 1;

    if mock_student_id is null then
        while exists (
            select 1
              from public.students
             where owner_id = p_owner_id
               and lower(name) = lower(student_name)
        ) loop
            student_name := 'Demo student ' || name_suffix::text;
            name_suffix := name_suffix + 1;
        end loop;

        select coalesce(max(position) + 1, 0)
          into next_position
          from public.students
         where owner_id = p_owner_id;

        insert into public.students (owner_id, name, position, is_mock)
        values (p_owner_id, student_name, next_position, true)
        returning id into mock_student_id;
    end if;

    select id
      into mock_lesson_id
      from public.lessons
     where owner_id = p_owner_id
       and student_id = mock_student_id
       and is_mock
     limit 1;

    if mock_lesson_id is null then
        select coalesce(max(position) + 1, 0)
          into next_position
          from public.lessons
         where owner_id = p_owner_id
           and student_id = mock_student_id;

        insert into public.lessons (owner_id, student_id, title, position, cover, color, is_mock)
        values (p_owner_id, mock_student_id, 'Short vowels at family', next_position, 'vowels', '#daf0e9', true)
        returning id into mock_lesson_id;
    end if;

    insert into public.lesson_pages (owner_id, lesson_id, name, position, elements)
    select p_owner_id,
           mock_lesson_id,
           page.name,
           (page.ordinality - 1)::integer,
           '[]'::jsonb
      from unnest(array['Warm up', 'Blend it', 'Read it']) with ordinality as page(name, ordinality)
    on conflict (lesson_id, position) do nothing;
end;
$$;

revoke all on function public.ensure_mock_student_lesson(uuid) from public, anon, authenticated;

do $$
declare
    profile_row record;
begin
    for profile_row in select id from public.profiles loop
        perform public.ensure_mock_student_lesson(profile_row.id);
    end loop;
end;
$$;

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

    perform public.ensure_mock_student_lesson(new.id);
    update public.profiles
       set workspace_initialized = true
     where id = new.id;

    return new;
end;
$$;

create or replace function public.initialize_workspace(p_students jsonb, p_lessons jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := auth.uid();
begin
    if current_user_id is null then
        raise exception 'Authentication is required to initialize a workspace.';
    end if;

    perform public.ensure_mock_student_lesson(current_user_id);
    update public.profiles
       set workspace_initialized = true
     where id = current_user_id;
end;
$$;

revoke all on function public.initialize_workspace(jsonb, jsonb) from public;
grant execute on function public.initialize_workspace(jsonb, jsonb) to authenticated;