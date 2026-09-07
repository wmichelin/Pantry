-- STAGING ONLY. Requires one existing isolated acceptance identity. All writes
-- are rolled back, including the newly created scratch household.
begin;
select set_config('request.jwt.claim.sub', (
  select created_by::text from public.households
  where name like 'Go Household %' order by created_at desc limit 1
), true);
set local role authenticated;
do $$
declare
  household uuid;
  imported uuid;
  before_count integer;
  owner_id text := current_setting('request.jwt.claim.sub');
  data jsonb := jsonb_build_object(
    'title', 'Exact ' || repeat('x', 300), 'source_url', 'https://example.invalid/' || repeat('p', 2100),
    'source_type', 'url', 'image_url', '', 'instructions', jsonb_build_array(repeat('step ', 5000), 'last'),
    'tags', jsonb_build_array('second', 'first'), 'servings', 0, 'cook_time_minutes', 8
  );
begin
  if coalesce(owner_id, '') = '' then raise exception 'Isolated staging fixture required'; end if;
  select id into household from public.create_household('Import transaction scratch', 'Fixture');
  select id into imported from public.import_recipe_with_ingredients(household, data,
    '[{"name":"salt","quantity":null,"unit":null,"raw_string":"salt"},{"name":"water","quantity":0,"unit":"cups","raw_string":"0 cups water"}]');
  if not exists (select 1 from public.recipes r where r.id=imported
    and r.title=data->>'title' and r.source_url=data->>'source_url' and r.image_url=''
    and r.instructions=data->'instructions' and r.tags=data->'tags' and r.servings=0
    and r.prep_time_minutes is null and r.cook_time_minutes=8 and r.created_by=auth.uid()) then
    raise exception 'Metadata parity failed';
  end if;
  if not exists (select 1 from public.recipe_ingredients where recipe_id=imported and name='salt' and quantity is null and unit is null)
    or not exists (select 1 from public.recipe_ingredients where recipe_id=imported and name='water' and quantity=0 and unit='cups') then
    raise exception 'Ingredient presence parity failed';
  end if;
  perform public.import_recipe_with_ingredients(household, data, '[]');
  select count(*) into before_count from public.recipes where household_id=household;
  begin
    perform public.import_recipe_with_ingredients(household, data, '[{"name":"bad","quantity":"not-a-number"}]');
    raise exception 'Expected ingredient failure';
  exception when invalid_text_representation then null;
  end;
  if (select count(*) from public.recipes where household_id=household) <> before_count then
    raise exception 'Recipe survived ingredient failure';
  end if;
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  begin
    perform public.import_recipe_with_ingredients(household, data, '[]');
    raise exception 'Nonmember imported a recipe';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.sub', owner_id, true);
end;
$$;
reset role;
do $$
begin
  if has_function_privilege('anon', 'public.import_recipe_with_ingredients(uuid,jsonb,jsonb)', 'execute')
    or not has_function_privilege('authenticated', 'public.import_recipe_with_ingredients(uuid,jsonb,jsonb)', 'execute')
    or (select prosecdef from pg_proc where oid='public.import_recipe_with_ingredients(uuid,jsonb,jsonb)'::regprocedure) then
    raise exception 'Incorrect import function privileges';
  end if;
end;
$$;
rollback;
select 'Exact metadata, null/zero, long text, empty imports, atomic rollback, outsider and grants passed; writes rolled back' as gate;
