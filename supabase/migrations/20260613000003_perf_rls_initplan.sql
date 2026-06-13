-- PERFORMANCE: wrap auth.uid() in (select auth.uid()) so it is evaluated once per
-- query instead of once per row (Supabase linter 0003_auth_rls_initplan). Behaviour
-- is identical; only the query plan improves.
-- NOT YET APPLIED TO PRODUCTION. Review carefully (a malformed policy can lock users
-- out), apply after backups are confirmed, then smoke-test create/read/update/delete.

-- households
alter policy "Authenticated users can create households" on public.households
  with check ((select auth.uid()) = created_by);
alter policy "Owners can update their households" on public.households
  using (id in (
    select hm.household_id from household_members hm
    where hm.user_id = (select auth.uid()) and hm.role = 'owner'
  ));

-- household_members
alter policy "Users can join households" on public.household_members
  with check ((select auth.uid()) = user_id);
alter policy "Owners can remove members" on public.household_members
  using (household_id in (
    select hm.household_id from household_members hm
    where hm.user_id = (select auth.uid()) and hm.role = 'owner'
  ));

-- week_queues
alter policy "household members can read week_queues" on public.week_queues
  using (exists (select 1 from public.household_members hm
    where hm.household_id = week_queues.household_id and hm.user_id = (select auth.uid())));
alter policy "household members can insert week_queues" on public.week_queues
  with check (added_by = (select auth.uid()) and exists (select 1 from public.household_members hm
    where hm.household_id = week_queues.household_id and hm.user_id = (select auth.uid())));
alter policy "household members can delete week_queues" on public.week_queues
  using (exists (select 1 from public.household_members hm
    where hm.household_id = week_queues.household_id and hm.user_id = (select auth.uid())));

-- stores
alter policy "household members can read stores" on public.stores
  using (exists (select 1 from public.household_members hm
    where hm.household_id = stores.household_id and hm.user_id = (select auth.uid())));
alter policy "household members can insert stores" on public.stores
  with check (exists (select 1 from public.household_members hm
    where hm.household_id = stores.household_id and hm.user_id = (select auth.uid())));
alter policy "household members can update stores" on public.stores
  using (exists (select 1 from public.household_members hm
    where hm.household_id = stores.household_id and hm.user_id = (select auth.uid())));
alter policy "household members can delete stores" on public.stores
  using (exists (select 1 from public.household_members hm
    where hm.household_id = stores.household_id and hm.user_id = (select auth.uid())));

-- ingredient_metadata
alter policy "household members can read ingredient_metadata" on public.ingredient_metadata
  using (exists (select 1 from public.household_members hm
    where hm.household_id = ingredient_metadata.household_id and hm.user_id = (select auth.uid())));
alter policy "household members can insert ingredient_metadata" on public.ingredient_metadata
  with check (exists (select 1 from public.household_members hm
    where hm.household_id = ingredient_metadata.household_id and hm.user_id = (select auth.uid())));
alter policy "household members can update ingredient_metadata" on public.ingredient_metadata
  using (exists (select 1 from public.household_members hm
    where hm.household_id = ingredient_metadata.household_id and hm.user_id = (select auth.uid())));
alter policy "household members can delete ingredient_metadata" on public.ingredient_metadata
  using (exists (select 1 from public.household_members hm
    where hm.household_id = ingredient_metadata.household_id and hm.user_id = (select auth.uid())));

-- ingredient_store_availability
alter policy "household members can read ingredient_store_availability" on public.ingredient_store_availability
  using (exists (select 1 from public.ingredient_metadata im
    join public.household_members hm on hm.household_id = im.household_id
    where im.id = ingredient_store_availability.ingredient_metadata_id and hm.user_id = (select auth.uid())));
alter policy "household members can insert ingredient_store_availability" on public.ingredient_store_availability
  with check (exists (select 1 from public.ingredient_metadata im
    join public.household_members hm on hm.household_id = im.household_id
    where im.id = ingredient_store_availability.ingredient_metadata_id and hm.user_id = (select auth.uid())));
alter policy "household members can delete ingredient_store_availability" on public.ingredient_store_availability
  using (exists (select 1 from public.ingredient_metadata im
    join public.household_members hm on hm.household_id = im.household_id
    where im.id = ingredient_store_availability.ingredient_metadata_id and hm.user_id = (select auth.uid())));

-- shopping_list_checks
alter policy "household members can read shopping_list_checks" on public.shopping_list_checks
  using (exists (select 1 from public.household_members hm
    where hm.household_id = shopping_list_checks.household_id and hm.user_id = (select auth.uid())));
alter policy "household members can insert shopping_list_checks" on public.shopping_list_checks
  with check (exists (select 1 from public.household_members hm
    where hm.household_id = shopping_list_checks.household_id and hm.user_id = (select auth.uid())));
alter policy "household members can delete shopping_list_checks" on public.shopping_list_checks
  using (exists (select 1 from public.household_members hm
    where hm.household_id = shopping_list_checks.household_id and hm.user_id = (select auth.uid())));

-- shopping_list_manual_items
alter policy "household members can read shopping_list_manual_items" on public.shopping_list_manual_items
  using (exists (select 1 from public.household_members hm
    where hm.household_id = shopping_list_manual_items.household_id and hm.user_id = (select auth.uid())));
alter policy "household members can insert shopping_list_manual_items" on public.shopping_list_manual_items
  with check (exists (select 1 from public.household_members hm
    where hm.household_id = shopping_list_manual_items.household_id and hm.user_id = (select auth.uid())));
alter policy "household members can update shopping_list_manual_items" on public.shopping_list_manual_items
  using (exists (select 1 from public.household_members hm
    where hm.household_id = shopping_list_manual_items.household_id and hm.user_id = (select auth.uid())));
alter policy "household members can delete shopping_list_manual_items" on public.shopping_list_manual_items
  using (exists (select 1 from public.household_members hm
    where hm.household_id = shopping_list_manual_items.household_id and hm.user_id = (select auth.uid())));
