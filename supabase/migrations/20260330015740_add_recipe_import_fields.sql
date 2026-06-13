-- Fields populated when importing a recipe from a URL or Pinterest pin.

alter table public.recipes
  add column source_url         text,
  add column source_type        text not null default 'manual'
    check (source_type in ('url', 'pinterest_pin', 'manual')),
  add column image_url          text,
  add column instructions       jsonb default '[]'::jsonb,
  add column tags               jsonb default '[]'::jsonb,
  add column servings           integer,
  add column prep_time_minutes  integer,
  add column cook_time_minutes  integer;
