-- Separate from manual save: imports preserve text exactly and may contain no
-- ingredients. Invoker permissions keep all inserts subject to existing RLS.
create or replace function public.import_recipe_with_ingredients(
  p_household_id uuid, p_recipe jsonb, p_ingredients jsonb
)
returns table (id uuid, title text, ingredient_count integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created_recipe public.recipes%rowtype;
  saved_ingredients integer;
begin
  if auth.uid() is null then
    raise exception 'A Pantry session is required' using errcode = '28000';
  end if;
  if coalesce(trim(p_recipe->>'title'), '') = ''
     or coalesce(p_recipe->>'source_type', '') not in ('url', 'pinterest_pin')
     or jsonb_typeof(p_ingredients) is distinct from 'array'
     or jsonb_typeof(p_recipe->'instructions') is distinct from 'array'
     or jsonb_typeof(p_recipe->'tags') is distinct from 'array' then
    raise exception 'Invalid imported recipe' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.household_members
    where household_id = p_household_id and user_id = auth.uid()
  ) then
    raise exception 'You are not a member of this household' using errcode = '42501';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_ingredients) ingredient
    where coalesce(trim(ingredient->>'name'), '') = ''
  ) then
    raise exception 'Every ingredient needs a name' using errcode = '22023';
  end if;

  insert into public.recipes (
    household_id, title, created_by, source_url, source_type, image_url,
    instructions, tags, servings, prep_time_minutes, cook_time_minutes
  ) values (
    p_household_id, p_recipe->>'title', auth.uid(), p_recipe->>'source_url',
    p_recipe->>'source_type', p_recipe->>'image_url', p_recipe->'instructions',
    p_recipe->'tags', (p_recipe->>'servings')::integer,
    (p_recipe->>'prep_time_minutes')::integer, (p_recipe->>'cook_time_minutes')::integer
  ) returning * into created_recipe;

  insert into public.recipe_ingredients (recipe_id, name, quantity, unit, raw_string)
  select created_recipe.id, ingredient.name, ingredient.quantity, ingredient.unit, ingredient.raw_string
  from jsonb_to_recordset(p_ingredients) as ingredient(
    name text, quantity numeric, unit text, raw_string text
  );
  get diagnostics saved_ingredients = row_count;
  return query select created_recipe.id, created_recipe.title, saved_ingredients;
end;
$$;

revoke execute on function public.import_recipe_with_ingredients(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.import_recipe_with_ingredients(uuid, jsonb, jsonb) to authenticated;
