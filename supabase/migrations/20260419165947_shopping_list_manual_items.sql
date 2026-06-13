-- Ad-hoc items a household adds to the shopping list that don't come from a recipe.

create table public.shopping_list_manual_items (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households(id) on delete cascade,
  normalized_name text not null,
  quantity        numeric,
  unit            text,
  created_at      timestamptz not null default now(),
  unique (household_id, normalized_name)
);

alter table public.shopping_list_manual_items enable row level security;

create policy "household members can read shopping_list_manual_items"
  on public.shopping_list_manual_items for select
  using (
    exists (select 1 from public.household_members hm
      where hm.household_id = shopping_list_manual_items.household_id and hm.user_id = auth.uid())
  );

create policy "household members can insert shopping_list_manual_items"
  on public.shopping_list_manual_items for insert
  with check (
    exists (select 1 from public.household_members hm
      where hm.household_id = shopping_list_manual_items.household_id and hm.user_id = auth.uid())
  );

create policy "household members can update shopping_list_manual_items"
  on public.shopping_list_manual_items for update
  using (
    exists (select 1 from public.household_members hm
      where hm.household_id = shopping_list_manual_items.household_id and hm.user_id = auth.uid())
  );

create policy "household members can delete shopping_list_manual_items"
  on public.shopping_list_manual_items for delete
  using (
    exists (select 1 from public.household_members hm
      where hm.household_id = shopping_list_manual_items.household_id and hm.user_id = auth.uid())
  );
