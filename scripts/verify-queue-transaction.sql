-- STAGING ONLY: scratch fixture and injected trigger are transaction-local and
-- rolled back. No existing household data is modified.
begin;
select set_config('request.jwt.claim.sub', (
  select created_by::text from public.households where name like 'Go Household %'
  order by created_at desc limit 1
), true);
create function pg_temp.reject_queue_fixture_check_delete() returns trigger
language plpgsql as $$
begin
  if old.normalized_name='queue-clear-rollback-fixture' then
    raise exception 'injected check delete failure' using errcode='23514';
  end if;
  return old;
end;
$$;
create trigger queue_clear_fixture_failure before delete on public.shopping_list_checks
for each row execute function pg_temp.reject_queue_fixture_check_delete();
set local role authenticated;
do $$
declare
  household uuid;
  other_household uuid;
  recipe uuid;
  other_recipe uuid;
  queue uuid;
  duplicate uuid;
  owner_id text := current_setting('request.jwt.claim.sub');
begin
  if coalesce(owner_id,'')='' then raise exception 'Isolated fixture identity required'; end if;
  select id into household from public.create_household('Queue transaction scratch','Fixture');
  select id into other_household from public.create_household('Queue other household scratch','Fixture');
  select id into recipe from public.import_recipe_with_ingredients(household,'{"title":"Queue test","source_type":"url","tags":[],"instructions":[]}','[]');
  select id into other_recipe from public.import_recipe_with_ingredients(other_household,'{"title":"Other test","source_type":"url","tags":[],"instructions":[]}','[]');
  perform public.add_recipe_to_queue(other_household,other_recipe);
  insert into public.shopping_list_checks(household_id,normalized_name) values(other_household,'other sentinel');
  insert into public.shopping_list_manual_items(household_id,normalized_name) values(other_household,'other sentinel');
  select id into queue from public.add_recipe_to_queue(household,recipe);
  select id into duplicate from public.add_recipe_to_queue(household,recipe);
  if queue<>duplicate or (select count(*) from public.week_queues where household_id=household)<>1 then raise exception 'Duplicate add not idempotent'; end if;
  begin
    perform public.add_recipe_to_queue(household,other_recipe);
    raise exception 'Cross-household recipe accepted';
  exception when invalid_parameter_value then null;
  end;
  insert into public.shopping_list_checks(household_id,normalized_name) values(household,'queue-clear-rollback-fixture');
  insert into public.shopping_list_manual_items(household_id,normalized_name) values(household,'preserved manual');
  begin
    perform public.clear_queue_and_checks(household);
    raise exception 'Expected clear failure';
  exception when check_violation then null;
  end;
  if not exists(select 1 from public.week_queues where id=queue) then raise exception 'Queue deletion survived failed clear'; end if;
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  begin
    perform public.add_recipe_to_queue(household,recipe);
    raise exception 'Outsider add accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.clear_queue_and_checks(household);
    raise exception 'Outsider clear accepted';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.sub',owner_id,true);
  -- Preserve fixture IDs across the role reset needed to drop the test trigger.
  perform set_config('pantry.queue_fixture_household',household::text,true);
  perform set_config('pantry.queue_other_household',other_household::text,true);
end;
$$;
reset role;
drop trigger queue_clear_fixture_failure on public.shopping_list_checks;
set local role authenticated;
do $$
declare
  household uuid:=current_setting('pantry.queue_fixture_household')::uuid;
  other_household uuid:=current_setting('pantry.queue_other_household')::uuid;
begin
  perform public.clear_queue_and_checks(household);
  if exists(select 1 from public.week_queues where household_id=household)
    or exists(select 1 from public.shopping_list_checks where household_id=household)
    or not exists(select 1 from public.shopping_list_manual_items where household_id=household) then
    raise exception 'Clear scope mismatch';
  end if;
  if not exists(select 1 from public.week_queues where household_id=other_household)
    or not exists(select 1 from public.shopping_list_checks where household_id=other_household)
    or not exists(select 1 from public.shopping_list_manual_items where household_id=other_household) then
    raise exception 'Clear touched other household';
  end if;
end;
$$;
rollback;
select 'Queue retry, two-household rejection, injected clear rollback, outsider denial and manual preservation passed; all fixtures rolled back' as gate;
