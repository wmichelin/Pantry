-- Per-household aisle / department walk order (category ids).
-- Empty array means "use lib/ingredient-categories.ts default pitches".

alter table public.households
  add column if not exists aisle_category_order text[] not null default '{}';

comment on column public.households.aisle_category_order is
  'Ordered ingredient category ids for shopping walk order; empty = app defaults.';
