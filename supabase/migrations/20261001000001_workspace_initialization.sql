alter table public.profiles
    add column if not exists workspace_initialized boolean not null default false;

create unique index if not exists students_owner_name_ci_unique
    on public.students (owner_id, lower(name));

create unique index if not exists student_folders_sibling_name_ci_unique
    on public.student_folders (
        student_id,
        coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
        lower(name)
    );
