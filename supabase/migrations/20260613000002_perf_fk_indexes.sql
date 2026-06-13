-- PERFORMANCE: add covering indexes for foreign keys flagged by the Supabase
-- linter (0001_unindexed_foreign_keys). Purely additive and reversible.
-- NOT YET APPLIED TO PRODUCTION.

create index if not exists household_members_user_id_idx
  on public.household_members (user_id);

create index if not exists households_created_by_idx
  on public.households (created_by);

create index if not exists recipes_household_id_idx
  on public.recipes (household_id);

create index if not exists recipes_created_by_idx
  on public.recipes (created_by);

create index if not exists recipe_ingredients_recipe_id_idx
  on public.recipe_ingredients (recipe_id);

create index if not exists stores_household_id_idx
  on public.stores (household_id);

create index if not exists ingredient_store_availability_store_id_idx
  on public.ingredient_store_availability (store_id);

create index if not exists week_queues_recipe_id_idx
  on public.week_queues (recipe_id);

create index if not exists week_queues_added_by_idx
  on public.week_queues (added_by);
