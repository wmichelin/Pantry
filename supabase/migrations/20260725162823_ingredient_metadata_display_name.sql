-- Prefer display casing for the household ingredient catalog.
-- normalized_name remains the unique key (lower(trim)).

alter table public.ingredient_metadata
  add column if not exists display_name text;

update public.ingredient_metadata
set display_name = initcap(normalized_name)
where display_name is null;

alter table public.ingredient_metadata
  alter column display_name set not null;

alter table public.ingredient_metadata
  alter column display_name set default '';
