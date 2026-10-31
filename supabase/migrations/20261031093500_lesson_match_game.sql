alter table public.lessons
  add column if not exists match_game jsonb;
