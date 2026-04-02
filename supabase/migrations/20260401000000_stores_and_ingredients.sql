-- Grocery stores the household shops at
create table public.stores (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name         text not null,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);

alter table public.stores enable row level security;

create policy "household members can read stores"
  on public.stores for select
  using (
    exists (select 1 from public.household_members hm
      where hm.household_id = stores.household_id and hm.user_id = auth.uid())
  );

create policy "household members can insert stores"
  on public.stores for insert
  with check (
    exists (select 1 from public.household_members hm
      where hm.household_id = stores.household_id and hm.user_id = auth.uid())
  );

create policy "household members can update stores"
  on public.stores for update
  using (
    exists (select 1 from public.household_members hm
      where hm.household_id = stores.household_id and hm.user_id = auth.uid())
  );

create policy "household members can delete stores"
  on public.stores for delete
  using (
    exists (select 1 from public.household_members hm
      where hm.household_id = stores.household_id and hm.user_id = auth.uid())
  );


-- Per-household metadata keyed by normalized ingredient name
-- normalized_name = ingredient.name.toLowerCase().trim()
create table public.ingredient_metadata (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households(id) on delete cascade,
  normalized_name text not null,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now(),
  unique (household_id, normalized_name)
);

alter table public.ingredient_metadata enable row level security;

create policy "household members can read ingredient_metadata"
  on public.ingredient_metadata for select
  using (
    exists (select 1 from public.household_members hm
      where hm.household_id = ingredient_metadata.household_id and hm.user_id = auth.uid())
  );

create policy "household members can insert ingredient_metadata"
  on public.ingredient_metadata for insert
  with check (
    exists (select 1 from public.household_members hm
      where hm.household_id = ingredient_metadata.household_id and hm.user_id = auth.uid())
  );

create policy "household members can update ingredient_metadata"
  on public.ingredient_metadata for update
  using (
    exists (select 1 from public.household_members hm
      where hm.household_id = ingredient_metadata.household_id and hm.user_id = auth.uid())
  );

create policy "household members can delete ingredient_metadata"
  on public.ingredient_metadata for delete
  using (
    exists (select 1 from public.household_members hm
      where hm.household_id = ingredient_metadata.household_id and hm.user_id = auth.uid())
  );


-- Which stores carry a given ingredient (empty rows = unassigned / "Other")
create table public.ingredient_store_availability (
  ingredient_metadata_id uuid not null references public.ingredient_metadata(id) on delete cascade,
  store_id               uuid not null references public.stores(id) on delete cascade,
  primary key (ingredient_metadata_id, store_id)
);

alter table public.ingredient_store_availability enable row level security;

create policy "household members can read ingredient_store_availability"
  on public.ingredient_store_availability for select
  using (
    exists (
      select 1 from public.ingredient_metadata im
      join public.household_members hm on hm.household_id = im.household_id
      where im.id = ingredient_store_availability.ingredient_metadata_id
        and hm.user_id = auth.uid()
    )
  );

create policy "household members can insert ingredient_store_availability"
  on public.ingredient_store_availability for insert
  with check (
    exists (
      select 1 from public.ingredient_metadata im
      join public.household_members hm on hm.household_id = im.household_id
      where im.id = ingredient_store_availability.ingredient_metadata_id
        and hm.user_id = auth.uid()
    )
  );

create policy "household members can delete ingredient_store_availability"
  on public.ingredient_store_availability for delete
  using (
    exists (
      select 1 from public.ingredient_metadata im
      join public.household_members hm on hm.household_id = im.household_id
      where im.id = ingredient_store_availability.ingredient_metadata_id
        and hm.user_id = auth.uid()
    )
  );
