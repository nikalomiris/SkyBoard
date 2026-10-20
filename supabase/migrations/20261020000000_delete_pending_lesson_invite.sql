create or replace function public.delete_pending_lesson_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null then
        raise exception 'Authentication is required.';
    end if;

    delete from public.lesson_invites i
     where i.id = p_invite_id
       and i.owner_id = auth.uid()
       and i.status = 'pending';
    if not found then
        raise exception 'Pending invite was not found.';
    end if;
end;
$$;

revoke all on function public.delete_pending_lesson_invite(uuid) from public;
grant execute on function public.delete_pending_lesson_invite(uuid) to authenticated;
