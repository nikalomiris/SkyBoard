-- Keep previously saved board text, notes, and grid cell fonts in sync with the new board font.
-- Triggers are disabled so the font change does not bump updated_at on pages and lessons.
alter table public.lesson_pages disable trigger lesson_pages_set_updated_at;
alter table public.lesson_pages disable trigger lesson_pages_touch_lesson;

update public.lesson_pages
   set elements = replace(
           elements::text,
           '''Andika'', sans-serif',
           '''Lexend'', sans-serif'
       )::jsonb
 where elements::text like '%Andika%';

alter table public.lesson_pages enable trigger lesson_pages_set_updated_at;
alter table public.lesson_pages enable trigger lesson_pages_touch_lesson;
