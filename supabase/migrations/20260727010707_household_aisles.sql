-- Per-household aisle catalog (replaces fixed app-only INGREDIENT_CATEGORIES as source of truth).
create table public.household_aisles (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  key          text not null,
  label        text not null,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  unique (household_id, key),
  constraint household_aisles_key_nonempty check (length(trim(key)) > 0),
  constraint household_aisles_label_nonempty check (length(trim(label)) > 0)
);

create index household_aisles_household_id_sort_order_idx
  on public.household_aisles (household_id, sort_order);

comment on table public.household_aisles is
  'Household-defined store aisles; ingredient_metadata.category references key.';

alter table public.household_aisles enable row level security;

create policy "household members can read household_aisles"
  on public.household_aisles for select
  using (
    exists (
      select 1 from public.household_members hm
      where hm.household_id = household_aisles.household_id
        and hm.user_id = (select auth.uid())
    )
  );

create policy "household members can insert household_aisles"
  on public.household_aisles for insert
  with check (
    exists (
      select 1 from public.household_members hm
      where hm.household_id = household_aisles.household_id
        and hm.user_id = (select auth.uid())
    )
  );

create policy "household members can update household_aisles"
  on public.household_aisles for update
  using (
    exists (
      select 1 from public.household_members hm
      where hm.household_id = household_aisles.household_id
        and hm.user_id = (select auth.uid())
    )
  );

create policy "household members can delete household_aisles"
  on public.household_aisles for delete
  using (
    key <> 'other'
    and exists (
      select 1 from public.household_members hm
      where hm.household_id = household_aisles.household_id
        and hm.user_id = (select auth.uid())
    )
  );

-- Block deleting the reserved Other aisle even for service_role / bypasses via trigger.
create or replace function public.prevent_delete_other_aisle()
returns trigger
language plpgsql
as $$
begin
  if old.key = 'other' then
    raise exception 'Cannot delete the Other aisle';
  end if;
  return old;
end;
$$;

create trigger trg_prevent_delete_other_aisle
  before delete on public.household_aisles
  for each row
  execute function public.prevent_delete_other_aisle();

-- Allow arbitrary aisle keys on ingredients (validated against household_aisles in app).
alter table public.ingredient_metadata
  drop constraint if exists ingredient_metadata_category_check;

-- Seed default aisles for every household (respect saved walk order when present).
with defaults(key, label, pitch) as (
  values
    ('produce', 'Produce', 10),
    ('meat_seafood', 'Meat & Seafood', 20),
    ('condiments', 'Condiments', 30),
    ('canned_pasta', 'Canned Goods & Pasta', 40),
    ('snacks', 'Snacks', 50),
    ('beverages', 'Beverages', 60),
    ('bread', 'Bread', 70),
    ('baking', 'Baking', 80),
    ('dairy', 'Dairy', 90),
    ('frozen', 'Frozen', 100),
    ('household', 'Household Care', 110),
    ('pet_general', 'Pet & General', 120),
    ('breakfast_international', 'Breakfast & International', 130),
    ('wine', 'Wine', 140),
    ('deli_bakery', 'Deli & Bakery', 150),
    ('health_beauty', 'Health & Beauty', 160),
    ('other', 'Other', 999)
),
ranked as (
  select
    h.id as household_id,
    d.key,
    d.label,
    case
      when h.aisle_category_order is not null
        and cardinality(h.aisle_category_order) > 0
        and array_position(h.aisle_category_order, d.key) is not null
      then array_position(h.aisle_category_order, d.key) * 10
      else d.pitch
    end as sort_order
  from public.households h
  cross join defaults d
)
insert into public.household_aisles (household_id, key, label, sort_order)
select household_id, key, label, sort_order
from ranked
on conflict (household_id, key) do nothing;
