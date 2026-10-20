-- Century Gothic is not a web font and renders differently across devices.
-- Persist the Questrial replacement in saved page elements (text, note and grid fonts, including grid cell styles).
-- Triggers are disabled so the font change does not bump updated_at on pages and lessons.
alter table public.lesson_pages disable trigger lesson_pages_set_updated_at;
alter table public.lesson_pages disable trigger lesson_pages_touch_lesson;

update public.lesson_pages
   set elements = replace(
           elements::text,
           '''Century Gothic'', CenturyGothic, AppleGothic, sans-serif',
           '''Questrial'', sans-serif'
       )::jsonb
 where elements::text like '%Century Gothic%';

alter table public.lesson_pages enable trigger lesson_pages_set_updated_at;
alter table public.lesson_pages enable trigger lesson_pages_touch_lesson;
