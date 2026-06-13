-- Fix infinite RLS recursion on household_members: a SELECT policy that queries
-- household_members would re-trigger its own policy. A SECURITY DEFINER helper
-- reads membership while bypassing RLS, and all membership-scoped read policies
-- go through it.

create or replace function public.get_my_household_ids()
  returns setof uuid
  language sql
  stable
  security definer
  set search_path to 'public'
as $$
  select household_id from household_members where user_id = auth.uid();
$$;

-- households reads
create policy "Anyone can look up household by invite code"
  on public.households for select to authenticated
  using (true);

create policy "Members can view their households"
  on public.households for select to authenticated
  using (id in (select get_my_household_ids()));

create policy "Owners can update their households"
  on public.households for update to authenticated
  using (id in (
    select hm.household_id from household_members hm
    where hm.user_id = auth.uid() and hm.role = 'owner'
  ));

-- household_members reads/removal
create policy "Members can view co-members"
  on public.household_members for select to authenticated
  using (household_id in (select get_my_household_ids()));

create policy "Owners can remove members"
  on public.household_members for delete to authenticated
  using (household_id in (
    select hm.household_id from household_members hm
    where hm.user_id = auth.uid() and hm.role = 'owner'
  ));

-- recipes
create policy "Members can view household recipes"
  on public.recipes for select to authenticated
  using (household_id in (select get_my_household_ids()));

create policy "Members can create recipes"
  on public.recipes for insert to authenticated
  with check (household_id in (select get_my_household_ids()));

create policy "Members can update recipes"
  on public.recipes for update to authenticated
  using (household_id in (select get_my_household_ids()));

create policy "Members can delete recipes"
  on public.recipes for delete to authenticated
  using (household_id in (select get_my_household_ids()));

-- recipe_ingredients
create policy "Members can view recipe ingredients"
  on public.recipe_ingredients for select to authenticated
  using (recipe_id in (
    select id from recipes where household_id in (select get_my_household_ids())
  ));

create policy "Members can create recipe ingredients"
  on public.recipe_ingredients for insert to authenticated
  with check (recipe_id in (
    select id from recipes where household_id in (select get_my_household_ids())
  ));

create policy "Members can update recipe ingredients"
  on public.recipe_ingredients for update to authenticated
  using (recipe_id in (
    select id from recipes where household_id in (select get_my_household_ids())
  ));

create policy "Members can delete recipe ingredients"
  on public.recipe_ingredients for delete to authenticated
  using (recipe_id in (
    select id from recipes where household_id in (select get_my_household_ids())
  ));
