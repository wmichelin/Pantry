-- Staging recipe-save parity gate. Saving a recipe and its ingredients is one
-- transaction, so a partial write cannot leave a recipe without ingredients.
-- PostgREST RPCs must be exposed in public; this narrow SECURITY DEFINER
-- exception uses an empty search_path, explicit object qualification, and only
-- auth.uid() plus the persisted membership table for authorization.

create or replace function public.create_recipe_with_ingredients(
  p_household_id uuid,
  p_recipe jsonb,
  p_ingredients jsonb
)
returns table (id uuid, title text, ingredient_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  created_recipe public.recipes%rowtype;
  recipe_title text := left(coalesce(trim(p_recipe->>'title'), ''), 240);
  imported_source_type text := coalesce(p_recipe->>'source_type', 'manual');
  saved_ingredients integer;
begin
  if caller_id is null then
    raise exception 'A Pantry session is required' using errcode = '28000';
  end if;
  if recipe_title = '' then
    raise exception 'Recipe title is required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_ingredients) <> 'array' then
    raise exception 'Recipe ingredients must be an array' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.household_members
    where household_id = p_household_id
      and user_id = caller_id
  ) then
    raise exception 'You are not a member of this household' using errcode = '42501';
  end if;
  if imported_source_type not in ('url', 'pinterest_pin', 'manual') then
    raise exception 'Unsupported recipe source type' using errcode = '22023';
  end if;

  insert into public.recipes (
    household_id,
    title,
    created_by,
    source_url,
    source_type,
    image_url,
    instructions,
    tags,
    servings,
    prep_time_minutes,
    cook_time_minutes
  )
  values (
    p_household_id,
    recipe_title,
    caller_id,
    nullif(left(coalesce(p_recipe->>'source_url', ''), 2048), ''),
    imported_source_type,
    nullif(left(coalesce(p_recipe->>'image_url', ''), 2048), ''),
    case when jsonb_typeof(p_recipe->'instructions') = 'array' then p_recipe->'instructions' else '[]'::jsonb end,
    case when jsonb_typeof(p_recipe->'tags') = 'array' then p_recipe->'tags' else '[]'::jsonb end,
    nullif(p_recipe->>'servings', '')::integer,
    nullif(p_recipe->>'prep_time_minutes', '')::integer,
    nullif(p_recipe->>'cook_time_minutes', '')::integer
  )
  returning * into created_recipe;

  insert into public.recipe_ingredients (recipe_id, name, quantity, unit, raw_string)
  select
    created_recipe.id,
    left(trim(ingredient.name), 240),
    ingredient.quantity,
    nullif(left(trim(coalesce(ingredient.unit, '')), 80), ''),
    nullif(left(trim(coalesce(ingredient.raw_string, '')), 1000), '')
  from jsonb_to_recordset(p_ingredients) as ingredient(
    name text,
    quantity numeric,
    unit text,
    raw_string text
  )
  where trim(coalesce(ingredient.name, '')) <> '';

  get diagnostics saved_ingredients = row_count;
  if saved_ingredients = 0 then
    raise exception 'At least one recipe ingredient is required' using errcode = '22023';
  end if;

  return query select created_recipe.id, created_recipe.title, saved_ingredients;
end;
$$;

revoke execute on function public.create_recipe_with_ingredients(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.create_recipe_with_ingredients(uuid, jsonb, jsonb) to authenticated;
