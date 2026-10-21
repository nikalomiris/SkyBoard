alter table public.lessons
  add column if not exists card_deck jsonb;
