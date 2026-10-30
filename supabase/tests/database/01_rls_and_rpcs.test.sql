begin;
select plan(27);

-- Two users; the handle_new_user trigger creates their profiles.
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
    ('aaaaaaaa-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'alice@test.local', '{}', now(), now()),
    ('bbbbbbbb-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bob@test.local', '{}', now(), now());

insert into public.lessons (id, owner_id, title) values
    ('a1000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'Alice lesson'),
    ('b1000000-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002', 'Bob lesson');

select ok((select count(*) = 2 from public.profiles where id in ('aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002')), 'new users get profiles');
select ok((select bool_and(relrowsecurity) from pg_class where oid in (select format('public.%I', tablename)::regclass from pg_tables where schemaname = 'public')), 'RLS is enabled on every public table');

-- Anonymous visitors
set local role anon;
select is((select count(*) from public.lessons), 0::bigint, 'anon cannot read lessons');
select is((select count(*) from public.profiles), 0::bigint, 'anon cannot read profiles');
select throws_ok($$select public.save_lesson_pages('[]'::jsonb)$$, null, null, 'anon cannot call save_lesson_pages');

-- Alice
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is((select count(*) from public.lessons where owner_id <> 'aaaaaaaa-0000-4000-8000-000000000001'), 0::bigint, 'alice sees only her own lessons');
select is((select title from public.lessons where id = 'a1000000-0000-4000-8000-000000000001'), 'Alice lesson', 'alice sees her lesson');
select is((select count(*) from public.profiles), 1::bigint, 'alice sees only her profile');
select throws_ok($$insert into public.lessons (owner_id, title) values ('bbbbbbbb-0000-4000-8000-000000000002', 'Hijack')$$, '42501', null, 'alice cannot create lessons for bob');
update public.lessons set title = 'Pwned' where id = 'b1000000-0000-4000-8000-000000000001';
delete from public.lessons where id = 'b1000000-0000-4000-8000-000000000001';
reset role;
select is((select title from public.lessons where id = 'b1000000-0000-4000-8000-000000000001'), 'Bob lesson', 'alice cannot update or delete bob lesson');
set local role authenticated;

-- save_lesson_pages
select lives_ok($$select public.save_lesson_pages('[{"id":"a2000000-0000-4000-8000-000000000001","lesson_id":"a1000000-0000-4000-8000-000000000001","name":"One","position":0,"elements":[]},{"id":"a2000000-0000-4000-8000-000000000002","lesson_id":"a1000000-0000-4000-8000-000000000001","name":"Two","position":1,"elements":[{"id":"x","type":"note"}]}]'::jsonb)$$, 'saves valid pages');
select is((select count(*) from public.lesson_pages), 2::bigint, 'both pages stored');
select lives_ok($$select public.save_lesson_pages('[{"id":"a2000000-0000-4000-8000-000000000002","lesson_id":"a1000000-0000-4000-8000-000000000001","name":"Two","position":0,"elements":[]}]'::jsonb)$$, 'swapping position of a surviving page works');
select is((select count(*) from public.lesson_pages), 1::bigint, 'omitted pages are deleted');
select throws_ok($$select public.save_lesson_pages('{}'::jsonb)$$, null, 'Lesson pages must be provided as an array.', 'rejects non-array input');
select throws_ok($$select public.save_lesson_pages('[{"id":"a2000000-0000-4000-8000-000000000009","lesson_id":"a1000000-0000-4000-8000-000000000001","name":"  ","position":0}]'::jsonb)$$, null, 'One or more lesson pages have invalid data.', 'rejects blank page names');
select throws_ok($$select public.save_lesson_pages('[{"id":"a2000000-0000-4000-8000-000000000009","lesson_id":"a1000000-0000-4000-8000-000000000001","name":"A","position":-1}]'::jsonb)$$, null, 'One or more lesson pages have invalid data.', 'rejects negative positions');
select throws_ok($$select public.save_lesson_pages('[{"id":"a2000000-0000-4000-8000-000000000008","lesson_id":"a1000000-0000-4000-8000-000000000001","name":"A","position":0},{"id":"a2000000-0000-4000-8000-000000000009","lesson_id":"a1000000-0000-4000-8000-000000000001","name":"B","position":0}]'::jsonb)$$, null, 'Lesson page positions must be unique within each lesson.', 'rejects duplicate positions');
select throws_ok($$select public.save_lesson_pages('[{"id":"a2000000-0000-4000-8000-000000000009","lesson_id":"b1000000-0000-4000-8000-000000000001","name":"A","position":0}]'::jsonb)$$, null, 'A lesson page references a lesson outside this workspace.', 'rejects pages for another owner lesson');
select throws_ok($$select public.save_lesson_pages('[{"id":"a2000000-0000-4000-8000-000000000009","lesson_id":"a1000000-0000-4000-8000-000000000001","name":"A","position":0,"elements":"x"}]'::jsonb)$$, null, 'One or more lesson pages have invalid data.', 'rejects non-array elements');

-- Sharing
select lives_ok($$select public.start_lesson_share('a1000000-0000-4000-8000-000000000001')$$, 'owner can start a share');
select throws_ok($$select public.start_lesson_share('b1000000-0000-4000-8000-000000000001')$$, null, null, 'cannot share another owner lesson');

-- Student access through the public RPCs
select is((select count(*) from public.lesson_invites), 0::bigint, 'no invites yet');
create temp table made on commit drop as select public.create_lesson_invite((select id from public.lesson_sessions where lesson_id = 'a1000000-0000-4000-8000-000000000001'), 'Sam', false) as invite;
grant select on made to anon;
set local role anon;
select throws_ok($$select public.get_shared_lesson('not-a-real-token')$$, null, 'This student link is invalid or has expired.', 'unknown token is rejected');
select throws_ok($$select public.get_shared_lesson('  ')$$, null, 'A student link token is required.', 'blank token is rejected');
select is((select public.get_shared_lesson((select invite ->> 'token' from made)) ->> 'access'), 'admitted', 'valid invite token grants admitted access without auth');
select is((select count(*) from public.lesson_invites), 0::bigint, 'anon still cannot read invites directly');

select * from finish();
rollback;
