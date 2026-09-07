-- STAGING ONLY. All fixtures and failure-injection triggers roll back.
begin;
select set_config('request.jwt.claim.sub', (
  select created_by::text from public.households where name like 'Go Household %'
  order by created_at desc limit 1
), true);
create function pg_temp.reject_shopping_fixture_delete() returns trigger
language plpgsql as $$
begin
  if old.normalized_name='shopping-rollback-fixture' and
     current_setting('pantry.shopping_fail_table',true)=tg_table_name then
    raise exception 'injected shopping delete failure' using errcode='23514';
  end if;
  return old;
end;
$$;
create trigger shopping_check_fixture_failure before delete on public.shopping_list_checks
for each row execute function pg_temp.reject_shopping_fixture_delete();
create trigger shopping_manual_fixture_failure before delete on public.shopping_list_manual_items
for each row execute function pg_temp.reject_shopping_fixture_delete();
set local role authenticated;
do $$
declare
  h uuid; other_h uuid; recipe uuid; other_recipe uuid; first_check uuid; repeated_check uuid;
  owner_id text:=current_setting('request.jwt.claim.sub');
  fail_table text;
  unicode_key text;
begin
  if coalesce(owner_id,'')='' then raise exception 'Isolated fixture identity required'; end if;
  select id into h from public.create_household('Shopping transaction scratch','Fixture');
  select id into other_h from public.create_household('Shopping other scratch','Fixture');
  select id into recipe from public.import_recipe_with_ingredients(h,
    '{"title":"Shopping test","source_type":"url","tags":[],"instructions":[]}',
    '[{"name":" Milk ","quantity":0,"unit":""},{"name":"green  onion","quantity":null,"unit":null},{"name":"İ","quantity":null,"unit":null},{"name":"ΟΣ","quantity":null,"unit":null},{"name":"\u00a0Rice\ufeff","quantity":null,"unit":null},{"name":"For the salad:","quantity":null,"unit":null}]');
  select id into other_recipe from public.import_recipe_with_ingredients(other_h,
    '{"title":"Other test","source_type":"url","tags":[],"instructions":[]}','[]');
  perform public.add_recipe_to_queue(h,recipe);
  perform public.add_recipe_to_queue(other_h,other_recipe);
  insert into public.ingredient_metadata(household_id,normalized_name,display_name,sort_order) values(h,'milk','Custom Milk',10);
  insert into public.shopping_list_manual_items(household_id,normalized_name) values(h,'milk'),(h,'tea'),(other_h,'other sentinel');
  perform public.set_shopping_item_checked(other_h,'other sentinel',false,true);
  perform public.set_shopping_item_checked(h,'milk',false,true);
  select id into first_check from public.shopping_list_checks where household_id=h and normalized_name='milk';
  perform public.set_shopping_item_checked(h,'milk',false,true);
  select id into repeated_check from public.shopping_list_checks where household_id=h and normalized_name='milk';
  if first_check<>repeated_check then raise exception 'Repeated check replaced identity'; end if;
  perform public.set_shopping_item_checked(h,'milk',true,true);
  perform public.set_shopping_item_checked(h,'milk',true,false);
  perform public.set_shopping_item_checked(h,'milk',true,false);
  if not exists(select 1 from public.shopping_list_checks where household_id=h and normalized_name='milk')
     or exists(select 1 from public.shopping_list_checks where household_id=h and normalized_name='milk::manual') then
    raise exception 'Recipe/manual checks not independent';
  end if;
  -- Legacy bare-name manual check can be durably unchecked.
  perform public.set_shopping_item_checked(h,'tea',false,true);
  perform public.set_shopping_item_checked(h,'tea',true,false);
  perform public.set_shopping_item_checked(h,'tea',true,false);
  if exists(select 1 from public.shopping_list_checks where household_id=h and normalized_name in ('tea','tea::manual')) then raise exception 'Legacy check survived'; end if;
  -- Internal whitespace is significant; do not collapse it into another name.
  perform public.set_shopping_item_checked(h,'green  onion',false,true);
  perform public.set_shopping_item_checked(h,'green  onion',true,false);
  if not exists(select 1 from public.shopping_list_checks where household_id=h and normalized_name='green  onion') then raise exception 'Internal spaces collapsed'; end if;
  foreach unicode_key in array array[U&'i\0307','ος','rice'] loop
    perform public.set_shopping_item_checked(h,unicode_key,false,true);
    perform public.set_shopping_item_checked(h,unicode_key,true,false);
    if not exists(select 1 from public.shopping_list_checks where household_id=h and normalized_name=unicode_key) then raise exception 'Unicode recipe check removed'; end if;
  end loop;
  perform public.set_shopping_item_checked(h,'for the salad:',false,true);
  perform public.set_shopping_item_checked(h,'for the salad:',true,false);
  if exists(select 1 from public.shopping_list_checks where household_id=h and normalized_name='for the salad:') then raise exception 'Section header prevented legacy uncheck'; end if;
  begin
    perform public.set_shopping_item_checked(h,null,false,true);
    raise exception 'Null check name accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.set_shopping_item_checked(h,U&'\00a0\feff',false,true);
    raise exception 'Blank check name accepted';
  exception when invalid_parameter_value then null;
  end;
  perform public.clear_shopping_checks(h);
  if exists(select 1 from public.shopping_list_checks where household_id=h)
    or (select count(*) from public.week_queues where household_id=h)<>1
    or (select count(*) from public.shopping_list_manual_items where household_id=h)<>2 then raise exception 'Clear checks changed other data'; end if;
  insert into public.shopping_list_checks(household_id,normalized_name) values(h,'shopping-rollback-fixture');
  insert into public.shopping_list_manual_items(household_id,normalized_name) values(h,'shopping-rollback-fixture');
  foreach fail_table in array array['shopping_list_checks','shopping_list_manual_items'] loop
    perform set_config('pantry.shopping_fail_table',fail_table,true);
    begin
      perform public.clear_shopping_week(h);
      raise exception 'Expected injected failure';
    exception when check_violation then null;
    end;
    if (select count(*) from public.week_queues where household_id=h)<>1
      or (select count(*) from public.shopping_list_checks where household_id=h)<>1
      or (select count(*) from public.shopping_list_manual_items where household_id=h)<>3 then raise exception 'Partial clear survived failure'; end if;
  end loop;
  perform set_config('pantry.shopping_fail_table','',true);
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  begin
    perform public.set_shopping_item_checked(h,'outsider',false,true);
    raise exception 'Outsider check accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.clear_shopping_checks(h);
    raise exception 'Outsider clear checks accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.clear_shopping_week(h);
    raise exception 'Outsider clear week accepted';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.sub',owner_id,true);
  perform public.clear_shopping_week(h);
  perform public.clear_shopping_week(h);
  if exists(select 1 from public.week_queues where household_id=h)
    or exists(select 1 from public.shopping_list_checks where household_id=h)
    or exists(select 1 from public.shopping_list_manual_items where household_id=h) then raise exception 'Clear week incomplete'; end if;
  if not exists(select 1 from public.recipes where id=recipe)
    or (select count(*) from public.recipe_ingredients where recipe_id=recipe)<>6
    or not exists(select 1 from public.ingredient_metadata where household_id=h and display_name='Custom Milk') then raise exception 'Clear removed recipe/catalog'; end if;
  if (select count(*) from public.week_queues where household_id=other_h)<>1
    or (select count(*) from public.shopping_list_checks where household_id=other_h)<>1
    or (select count(*) from public.shopping_list_manual_items where household_id=other_h)<>1 then raise exception 'Other household changed'; end if;
end;
$$;
reset role;
do $$
begin
  if has_function_privilege('anon','public.clear_shopping_week(uuid)','EXECUTE')
    or has_function_privilege('anon','public.clear_shopping_checks(uuid)','EXECUTE')
    or has_function_privilege('anon','public.set_shopping_item_checked(uuid,text,boolean,boolean)','EXECUTE')
    or not has_function_privilege('authenticated','public.clear_shopping_week(uuid)','EXECUTE')
    or not has_function_privilege('authenticated','public.clear_shopping_checks(uuid)','EXECUTE')
    or not has_function_privilege('authenticated','public.set_shopping_item_checked(uuid,text,boolean,boolean)','EXECUTE') then raise exception 'Unexpected function grants'; end if;
end;
$$;
rollback;
select 'Shopping check identities, legacy uncheck, second/third-delete rollback, outsider denial, scoped clear and grants passed; fixtures rolled back' as gate;
