-- Convert week-scoped queue to a running queue.
-- Recipes and shopping checks now persist until explicitly removed.

alter table public.week_queues
  drop constraint week_queues_household_id_recipe_id_week_start_key,
  drop column week_start,
  add constraint week_queues_household_id_recipe_id_key unique (household_id, recipe_id);

alter table public.shopping_list_checks
  drop constraint shopping_list_checks_household_id_week_start_normalized_name_key,
  drop column week_start,
  add constraint shopping_list_checks_household_id_normalized_name_key unique (household_id, normalized_name);
