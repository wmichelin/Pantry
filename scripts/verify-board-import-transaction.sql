-- STAGING ONLY. Every fixture, trigger, ledger row and recipe is rolled back.
begin;

create function pantry_internal.reject_board_completion_fixture()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.title = 'Injected ledger failure'
     and current_setting('pantry.test_fail_completion', true) = 'on' then
    raise exception 'injected completion failure';
  end if;
  return new;
end;
$$;
create trigger reject_board_completion_fixture
before insert on pantry_internal.board_import_completions
for each row execute function pantry_internal.reject_board_completion_fixture();

create function pantry_internal.board_request_fixture(p_manifest jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_agg((entry - 'ingredients') || jsonb_build_object('raw_ingredients', '[]'::jsonb) order by ordinality)
  from jsonb_array_elements(p_manifest) with ordinality submitted(entry, ordinality)
$$;

create temporary table board_import_fixture_identities as
select id, row_number() over(order by created_at, id) as position
from auth.users
where id in (select distinct created_by from public.households)
limit 2;
grant select on board_import_fixture_identities to authenticated;

select set_config('request.jwt.claim.sub', (
  select created_by::text from public.households
  where name like 'Go Household %' order by created_at desc limit 1
), true);
set local role authenticated;

do $$
declare
  owner_id uuid := auth.uid();
  other_member_id uuid;
  household uuid;
  household_invite text;
  other_household uuid;
  fixture_operation uuid := gen_random_uuid();
  invalid_operation uuid := gen_random_uuid();
  other_operation uuid := gen_random_uuid();
  bulk_operation uuid := gen_random_uuid();
  long_operation uuid := gen_random_uuid();
  manifest jsonb;
  changed_manifest jsonb;
  invalid_manifest jsonb;
  result jsonb;
  saved_id uuid;
  replay_id uuid;
  before_recipes integer;
  long_url text;
begin
  if owner_id is null then raise exception 'Isolated staging fixture identity required'; end if;
  select id into other_member_id from board_import_fixture_identities where id <> owner_id limit 1;
  if other_member_id is null then raise exception 'Second isolated staging identity required'; end if;
  select id, invite_code into household, household_invite from public.create_household('Board transaction scratch', 'Fixture');
  select id into other_household from public.create_household('Board transaction foreign scratch', 'Fixture');

  insert into public.recipes(household_id, title, created_by, source_url, source_type)
  values(household, 'Stored exact URL', owner_id, 'https://example.invalid/exact?A=1', 'url');

  invalid_manifest := jsonb_build_array(
    jsonb_build_object('index', 0, 'title', 'Valid', 'ingredients', '[]'::jsonb,
      'metadata', jsonb_build_object('source_url', '', 'source_type', 'url', 'instructions', '[]'::jsonb, 'tags', '[]'::jsonb)),
    jsonb_build_object('index', 1, 'title', '', 'ingredients', '[]'::jsonb,
      'metadata', jsonb_build_object('source_url', '', 'source_type', 'url', 'instructions', '[]'::jsonb, 'tags', '[]'::jsonb))
  );
  select count(*) into before_recipes from public.recipes where household_id=household;
  begin
    perform public.preflight_board_import(household, invalid_operation, pantry_internal.board_request_fixture(invalid_manifest), invalid_manifest);
    raise exception 'Invalid final item passed preflight';
  exception when invalid_parameter_value then null;
  end;
  if exists(select 1 from pantry_internal.board_import_operations where household_id=household and operation_id=invalid_operation)
     or (select count(*) from public.recipes where household_id=household) <> before_recipes then
    raise exception 'Invalid preflight wrote state';
  end if;

  manifest := jsonb_build_array(
    jsonb_build_object('index', 10, 'title', 'Stored', 'ingredients', '[]'::jsonb,
      'metadata', jsonb_build_object('source_url', 'https://example.invalid/exact?A=1', 'source_type', 'url', 'image_url', null, 'instructions', '[]'::jsonb, 'tags', '[]'::jsonb, 'servings', null, 'prep_time_minutes', null, 'cook_time_minutes', null)),
    jsonb_build_object('index', 20, 'title', 'First new URL', 'ingredients', jsonb_build_array(jsonb_build_object('name', 'salt', 'quantity', null, 'unit', null, 'raw_string', 'salt')),
      'metadata', jsonb_build_object('source_url', 'https://example.invalid/new', 'source_type', 'url', 'image_url', '', 'instructions', jsonb_build_array('second', 'first'), 'tags', jsonb_build_array('b', 'a'), 'servings', 0, 'prep_time_minutes', null, 'cook_time_minutes', 8)),
    jsonb_build_object('index', 21, 'title', 'Batch duplicate', 'ingredients', '[]'::jsonb,
      'metadata', jsonb_build_object('source_url', 'https://example.invalid/new', 'source_type', 'url', 'image_url', null, 'instructions', '[]'::jsonb, 'tags', '[]'::jsonb, 'servings', null, 'prep_time_minutes', null, 'cook_time_minutes', null)),
    jsonb_build_object('index', 30, 'title', 'URL-less one', 'ingredients', '[]'::jsonb,
      'metadata', jsonb_build_object('source_url', '', 'source_type', 'url', 'image_url', null, 'instructions', '[]'::jsonb, 'tags', '[]'::jsonb, 'servings', null, 'prep_time_minutes', null, 'cook_time_minutes', null)),
    jsonb_build_object('index', 31, 'title', 'URL-less two', 'ingredients', '[]'::jsonb,
      'metadata', jsonb_build_object('source_url', '', 'source_type', 'url', 'image_url', null, 'instructions', '[]'::jsonb, 'tags', '[]'::jsonb, 'servings', null, 'prep_time_minutes', null, 'cook_time_minutes', null)),
    jsonb_build_object('index', 40, 'title', 'Injected ledger failure', 'ingredients', jsonb_build_array(jsonb_build_object('name', 'pepper', 'quantity', 0, 'unit', 'tsp', 'raw_string', '0 tsp pepper')),
      'metadata', jsonb_build_object('source_url', 'https://example.invalid/failure', 'source_type', 'url', 'image_url', null, 'instructions', '[]'::jsonb, 'tags', '[]'::jsonb, 'servings', null, 'prep_time_minutes', null, 'cook_time_minutes', null)),
    jsonb_build_object('index', 50, 'title', 'Owner reserved item', 'ingredients', '[]'::jsonb,
      'metadata', jsonb_build_object('source_url', 'https://example.invalid/reserved', 'source_type', 'url', 'image_url', null, 'instructions', '[]'::jsonb, 'tags', '[]'::jsonb, 'servings', null, 'prep_time_minutes', null, 'cook_time_minutes', null))
  );
  result := public.preflight_board_import(household, fixture_operation, pantry_internal.board_request_fixture(manifest), manifest);
  if result->'existing_indexes' <> '[10]'::jsonb then raise exception 'Exact duplicate preflight failed: %', result; end if;

  if public.import_board_item(household, fixture_operation, 10)->>'status' <> 'skipped' then raise exception 'Stored URL was not skipped'; end if;
  result := public.import_board_item(household, fixture_operation, 20);
  if result->>'status' <> 'saved' or (result->>'ingredient_count')::integer <> 1 then raise exception 'New URL save failed'; end if;
  if public.import_board_item(household, fixture_operation, 21)->>'status' <> 'skipped' then raise exception 'Batch duplicate was not skipped'; end if;

  result := public.import_board_item(household, fixture_operation, 30);
  saved_id := (result->>'recipe_id')::uuid;
  replay_id := (public.import_board_item(household, fixture_operation, 30)->>'recipe_id')::uuid;
  if saved_id is distinct from replay_id or (select count(*) from public.recipes where id=saved_id) <> 1 then raise exception 'URL-less replay duplicated or changed identity'; end if;
  if public.import_board_item(household, fixture_operation, 31)->>'status' <> 'saved' then raise exception 'Distinct URL-less item was deduplicated'; end if;

  before_recipes := (select count(*) from public.recipes where household_id=household);
  perform set_config('pantry.test_fail_completion', 'on', true);
  begin
    perform public.import_board_item(household, fixture_operation, 40);
    raise exception 'Injected ledger failure was not raised';
  exception when raise_exception then
    if sqlerrm <> 'injected completion failure' then raise; end if;
  end;
  if (select count(*) from public.recipes where household_id=household) <> before_recipes
     or exists(select 1 from pantry_internal.board_import_completions completion where completion.household_id=household and completion.operation_id=fixture_operation and completion.item_index=40) then
    raise exception 'Failed completion did not roll back recipe and ledger';
  end if;
  perform set_config('pantry.test_fail_completion', 'off', true);
  result := public.import_board_item(household, fixture_operation, 40);
  if result->>'status' <> 'saved'
     or (select count(*) from public.recipes where household_id=household) <> before_recipes + 1 then
    raise exception 'Failed item did not remain retryable: result=%, before=%, after=%',
      result, before_recipes, (select count(*) from public.recipes where household_id=household);
  end if;

  changed_manifest := jsonb_set(manifest, '{1,title}', '"Changed after preflight"');
  begin
    perform public.preflight_board_import(household, fixture_operation, pantry_internal.board_request_fixture(changed_manifest), changed_manifest);
    raise exception 'Changed operation payload was accepted';
  exception when serialization_failure then null;
  end;

  -- A completion remains a tombstone after user deletion, so replay cannot
  -- recreate content the user intentionally removed.
  delete from public.recipes where id=saved_id;
  replay_id := (public.import_board_item(household, fixture_operation, 30)->>'recipe_id')::uuid;
  if replay_id is distinct from saved_id or exists(select 1 from public.recipes where id=saved_id) then raise exception 'Deleted completion was recreated'; end if;

  -- Same URL in another household is not a duplicate.
  changed_manifest := jsonb_build_array(jsonb_build_object('index', 10, 'title', 'Foreign exact URL', 'ingredients', '[]'::jsonb,
    'metadata', jsonb_build_object('source_url', 'https://example.invalid/exact?A=1', 'source_type', 'url', 'image_url', null, 'instructions', '[]'::jsonb, 'tags', '[]'::jsonb, 'servings', null, 'prep_time_minutes', null, 'cook_time_minutes', null)));
  perform public.preflight_board_import(other_household, other_operation, pantry_internal.board_request_fixture(changed_manifest), changed_manifest);
  if public.import_board_item(other_household, other_operation, 10)->>'status' <> 'saved' then raise exception 'URL dedup escaped household scope'; end if;

  -- More than 1,000 existing rows cannot hide a duplicate behind REST paging.
  insert into public.recipes(household_id, title, created_by, source_url, source_type)
  select household, 'Bulk '||n, owner_id, 'https://bulk.invalid/'||n, 'url' from generate_series(1,1001) n;
  changed_manifest := jsonb_build_array(jsonb_build_object('index', 77, 'title', 'Deep duplicate', 'ingredients', '[]'::jsonb,
    'metadata', jsonb_build_object('source_url', 'https://bulk.invalid/1001', 'source_type', 'url', 'image_url', null, 'instructions', '[]'::jsonb, 'tags', '[]'::jsonb, 'servings', null, 'prep_time_minutes', null, 'cook_time_minutes', null)));
  result := public.preflight_board_import(household, bulk_operation, pantry_internal.board_request_fixture(changed_manifest), changed_manifest);
  if result->'existing_indexes' <> '[77]'::jsonb then raise exception 'Deep duplicate was truncated'; end if;

  long_url := 'https://long.invalid/' || (
    select string_agg(md5(n::text), '') from generate_series(1, 200) n
  );
  insert into public.recipes(household_id, title, created_by, source_url, source_type)
  values(household, 'Long URL', owner_id, long_url, 'url');
  changed_manifest := jsonb_build_array(jsonb_build_object('index', 88, 'title', 'Long exact duplicate', 'ingredients', '[]'::jsonb,
    'metadata', jsonb_build_object('source_url', long_url, 'source_type', 'url', 'image_url', null, 'instructions', '[]'::jsonb, 'tags', '[]'::jsonb, 'servings', null, 'prep_time_minutes', null, 'cook_time_minutes', null)));
  result := public.preflight_board_import(household, long_operation, pantry_internal.board_request_fixture(changed_manifest), changed_manifest);
  if result->'existing_indexes' <> '[88]'::jsonb then raise exception 'Long exact URL lookup failed'; end if;

  -- A different member of the same household cannot reserve or replay the
  -- creator's private operation/index identity.
  perform set_config('request.jwt.claim.sub', other_member_id::text, true);
  perform public.join_household_by_invite(household_invite, 'Other member');
  begin
    insert into pantry_internal.board_import_completions(
      household_id, operation_id, item_index, created_by, status,
      recipe_id, title, ingredient_count, ingredients
    ) values(household, fixture_operation, 50, other_member_id, 'skipped', null, 'Owner reserved item', 0, '[]'::jsonb);
    raise exception 'Another member claimed an operation completion';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.import_board_item(household, fixture_operation, 50);
    raise exception 'Another member replayed the owner operation';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);

  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  begin
    perform public.preflight_board_import(household, gen_random_uuid(), pantry_internal.board_request_fixture(manifest), manifest);
    raise exception 'Outsider preflight succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.import_board_item(household, fixture_operation, 20);
    raise exception 'Outsider replay succeeded';
  exception when insufficient_privilege then null;
  end;
  if exists(select 1 from pantry_internal.board_import_operations operation where operation.household_id=household and operation.operation_id=fixture_operation) then
    raise exception 'Outsider could read operation ledger';
  end if;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
end;
$$;

reset role;
do $$
begin
  if has_function_privilege('anon', 'public.preflight_board_import(uuid,uuid,jsonb,jsonb)', 'execute')
     or has_function_privilege('anon', 'public.import_board_item(uuid,uuid,integer)', 'execute')
     or not has_function_privilege('authenticated', 'public.preflight_board_import(uuid,uuid,jsonb,jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.import_board_item(uuid,uuid,integer)', 'execute')
     or (select prosecdef from pg_proc where oid='public.preflight_board_import(uuid,uuid,jsonb,jsonb)'::regprocedure)
     or (select prosecdef from pg_proc where oid='public.import_board_item(uuid,uuid,integer)'::regprocedure)
     or has_table_privilege('anon', 'pantry_internal.board_import_operations', 'select')
     or has_table_privilege('authenticated', 'pantry_internal.board_import_operations', 'update')
     or has_table_privilege('authenticated', 'pantry_internal.board_import_operations', 'delete')
     or not has_table_privilege('authenticated', 'pantry_internal.board_import_operations', 'select,insert')
     or has_table_privilege('anon', 'pantry_internal.board_import_completions', 'select')
     or has_table_privilege('authenticated', 'pantry_internal.board_import_completions', 'update')
     or has_table_privilege('authenticated', 'pantry_internal.board_import_completions', 'delete')
     or not has_table_privilege('authenticated', 'pantry_internal.board_import_completions', 'select,insert')
     or exists (
       select 1 from pg_class
       where oid in (
         'pantry_internal.board_import_operations'::regclass,
         'pantry_internal.board_import_completions'::regclass
       ) and (not relrowsecurity or not relforcerowsecurity)
     ) then
    raise exception 'Incorrect board import privileges';
  end if;
end;
$$;

rollback;
select 'Board preflight, scoped dedup, URL-less replay, tombstones, atomic failure, RLS and grants passed; all writes rolled back' as gate;
