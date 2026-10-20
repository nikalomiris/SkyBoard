create or replace function public.end_lesson_share(p_lesson_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null then
        raise exception 'Authentication is required to remove a student.';
    end if;

    update public.lesson_sessions
       set status = 'ended', ended_at = now()
     where lesson_id = p_lesson_id
       and owner_id = auth.uid()
       and status = 'active';
end;
$$;

revoke all on function public.end_lesson_share(uuid) from public;
grant execute on function public.end_lesson_share(uuid) to authenticated;
