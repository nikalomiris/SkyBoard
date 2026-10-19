-- Saving the workspace upserts every row, which bumped updated_at on all lessons.
-- Only touch updated_at when the row content actually changed.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if to_jsonb(new) - 'updated_at' = to_jsonb(old) - 'updated_at' then
        new.updated_at = old.updated_at;
    else
        new.updated_at = now();
    end if;
    return new;
end;
$$;

-- Editing a page content counts as editing its lesson.
create or replace function public.touch_lesson_from_page()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if tg_op = 'DELETE' then
        update public.lessons set updated_at = now() where id = old.lesson_id;
        return old;
    end if;
    if tg_op = 'INSERT' or to_jsonb(new) - 'updated_at' <> to_jsonb(old) - 'updated_at' then
        update public.lessons set updated_at = now() where id = new.lesson_id;
    end if;
    return new;
end;
$$;

drop trigger if exists lesson_pages_touch_lesson on public.lesson_pages;
create trigger lesson_pages_touch_lesson after insert or update or delete on public.lesson_pages
    for each row execute function public.touch_lesson_from_page();
