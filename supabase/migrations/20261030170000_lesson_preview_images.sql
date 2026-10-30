create or replace function public.get_lesson_previews()
returns table (lesson_id uuid, background text, elements jsonb)
language sql
security definer
set search_path = ''
as $$
    select lesson.id,
           page.background,
           coalesce((
               select jsonb_agg(preview.item order by element.ordinality)
                 from jsonb_array_elements(page.elements) with ordinality as element(item, ordinality)
                 cross join lateral (
                     select case element.item ->> 'type'
                         when 'text' then jsonb_build_object(
                             'id', element.item -> 'id',
                             'type', 'text',
                             'left', element.item -> 'left',
                             'top', element.item -> 'top',
                             'text', left(element.item ->> 'text', 300),
                             'color', element.item -> 'color',
                             'size', element.item -> 'size',
                             'fontFamily', element.item -> 'fontFamily',
                             'align', element.item -> 'align',
                             'scale', element.item -> 'scale'
                         )
                         when 'note' then jsonb_build_object(
                             'id', element.item -> 'id',
                             'type', 'note',
                             'left', element.item -> 'left',
                             'top', element.item -> 'top',
                             'text', left(element.item ->> 'text', 300),
                             'color', element.item -> 'color',
                             'fontSize', element.item -> 'fontSize',
                             'fontFamily', element.item -> 'fontFamily',
                             'scale', element.item -> 'scale'
                         )
                         when 'shape' then jsonb_build_object(
                             'id', element.item -> 'id',
                             'type', 'shape',
                             'left', element.item -> 'left',
                             'top', element.item -> 'top',
                             'shape', element.item -> 'shape',
                             'color', element.item -> 'color',
                             'fillColor', element.item -> 'fillColor',
                             'endX', element.item -> 'endX',
                             'endY', element.item -> 'endY',
                             'startArrow', element.item -> 'startArrow',
                             'endArrow', element.item -> 'endArrow',
                             'rotation', element.item -> 'rotation',
                             'scale', element.item -> 'scale'
                         )
                         when 'grid' then jsonb_build_object(
                             'id', element.item -> 'id',
                             'type', 'grid',
                             'left', element.item -> 'left',
                             'top', element.item -> 'top',
                             'values', element.item -> 'values',
                             'rows', element.item -> 'rows',
                             'cols', element.item -> 'cols',
                             'fontSize', element.item -> 'fontSize',
                             'fontFamily', element.item -> 'fontFamily',
                             'color', element.item -> 'color',
                             'scale', element.item -> 'scale'
                         )
                         when 'image' then jsonb_build_object(
                             'id', element.item -> 'id',
                             'type', 'image',
                             'left', element.item -> 'left',
                             'top', element.item -> 'top',
                             'label', element.item -> 'label',
                             'storagePath', element.item -> 'storagePath',
                             'src', case
                                 when element.item ->> 'src' like 'data:image/%' then element.item -> 'src'
                                 else '""'::jsonb
                             end
                         )
                         when 'pdf' then jsonb_build_object(
                             'id', element.item -> 'id',
                             'type', 'pdf',
                             'left', element.item -> 'left',
                             'top', element.item -> 'top',
                             'label', element.item -> 'label',
                             'src', '""'::jsonb
                         )
                     end as item
                 ) as preview
                where preview.item is not null
           ), '[]'::jsonb) as elements
      from public.lessons as lesson
      join public.lesson_pages as page
        on page.lesson_id = lesson.id
       and page.owner_id = lesson.owner_id
       and page.position = 0
     where lesson.owner_id = (select auth.uid());
$$;

revoke all on function public.get_lesson_previews() from public;
grant execute on function public.get_lesson_previews() to authenticated;
