-- STAGING ONLY: fixture households, triggers and all writes roll back.
begin;
select set_config('request.jwt.claim.sub',(select created_by::text from public.households where name like 'Go Household %' order by created_at desc limit 1),true);
create function pg_temp.reject_list_fixture_write() returns trigger language plpgsql as $$
begin
 if current_setting('pantry.list_fail',true)='on' and new.normalized_name='rollback item' then raise exception 'injected manual write failure' using errcode='23514'; end if;
 return new;
end;
$$;
create trigger list_fixture_failure before insert or update on public.shopping_list_manual_items for each row execute function pg_temp.reject_list_fixture_write();
set local role authenticated;
do $$
declare h uuid; other_h uuid; m uuid; manual uuid; foreign_m uuid; foreign_manual uuid; v jsonb; before_v jsonb; revision text; owner_id text:=current_setting('request.jwt.claim.sub'); op text;
begin
 if coalesce(owner_id,'')='' then raise exception 'Isolated fixture identity required'; end if;
 select id into h from public.create_household('Shopping list transaction scratch','Fixture');
 select id into other_h from public.create_household('Shopping list other scratch','Fixture');
 v:=public.shopping_snapshot(h);
 if jsonb_array_length(v->'aisles')<>17 or jsonb_array_length(v->'ingredients')<>0 then raise exception 'Empty/default aisle mismatch'; end if;
 insert into public.household_aisles(household_id,key,label,sort_order) values(other_h,'custom','My shop',1);
 if jsonb_array_length(public.shopping_snapshot(other_h)->'aisles')<>1 then raise exception 'Custom aisles overwritten'; end if;
 insert into public.ingredient_metadata(household_id,normalized_name,display_name,sort_order,category) values(h,'milk','Custom Milk',-20,'custom') returning id into m;
 perform public.ensure_shopping_catalog(h,'[{"normalized_name":"milk","display_name":"Overwrite"},{"normalized_name":"tea","display_name":"Tea"}]');
 if not exists(select 1 from public.ingredient_metadata where id=m and display_name='Custom Milk' and category='custom' and sort_order=-20) then raise exception 'Catalog seed overwrote metadata'; end if;
 -- Failed manual insertion rolls back its new metadata, not just the manual row.
 before_v:=public.shopping_snapshot(h);
 perform set_config('pantry.list_fail','on',true);
 begin
  perform public.add_shopping_manual_item(h,before_v->>'revision','rollback item','Rollback Item',-30);
  raise exception 'Expected insertion failure';
 exception when check_violation then null;
 end;
 if public.shopping_snapshot(h)<>before_v then raise exception 'Partial add survived'; end if;
 perform set_config('pantry.list_fail','off',true);
 v:=public.add_shopping_manual_item(h,before_v->>'revision','rollback item','Rollback Item',-30);
 select id into manual from public.shopping_list_manual_items where household_id=h and normalized_name='rollback item';
 update public.shopping_list_manual_items set quantity=0,unit='cups' where id=manual;
 -- Readd existing catalog entry must not overflow due to an unrelated max order.
 insert into public.ingredient_metadata(household_id,normalized_name,display_name,sort_order) values(h,'max','Max',2147483647);
 v:=public.shopping_snapshot(h);
 perform public.add_shopping_manual_item(h,v->>'revision','rollback item','Overwrite',-40);
 if not exists(select 1 from public.shopping_list_manual_items where id=manual and quantity=0 and unit='cups' and sort_order=-40) then raise exception 'Readd replaced manual identity or quantities'; end if;
 delete from public.ingredient_metadata where household_id=h and normalized_name='max';
 insert into public.ingredient_metadata(household_id,normalized_name,display_name) values(other_h,'foreign','Foreign') returning id into foreign_m;
 insert into public.shopping_list_manual_items(household_id,normalized_name) values(other_h,'foreign') returning id into foreign_manual;
 -- Failure on the manual update must roll back the earlier metadata update.
 before_v:=public.shopping_snapshot(h);
 perform set_config('pantry.list_fail','on',true);
 begin
  perform public.save_shopping_order(h,before_v->>'revision',jsonb_build_array(jsonb_build_object('id',m,'sort_order',10,'category','dairy')),jsonb_build_array(jsonb_build_object('id',manual,'sort_order',20)));
  raise exception 'Expected ordering failure';
 exception when check_violation then null;
 end;
 if public.shopping_snapshot(h)<>before_v then raise exception 'Partial order survived'; end if;
 perform set_config('pantry.list_fail','off',true);
 -- Same caller belongs to both households: ID scoping must still reject foreign rows.
 begin
  perform public.save_shopping_order(h,before_v->>'revision',jsonb_build_array(jsonb_build_object('id',m,'sort_order',10,'category','dairy'),jsonb_build_object('id',foreign_m,'sort_order',20,'category','other')),'[]');
  raise exception 'Foreign metadata accepted';
 exception when invalid_parameter_value then null;
 end;
 begin
  perform public.save_shopping_order(h,before_v->>'revision',jsonb_build_array(jsonb_build_object('id',m,'sort_order',10,'category','dairy')),jsonb_build_array(jsonb_build_object('id',foreign_manual,'sort_order',20)));
  raise exception 'Foreign manual accepted';
 exception when invalid_parameter_value then null;
 end;
 begin
  perform public.remove_shopping_manual_item(h,foreign_manual);
  raise exception 'Foreign removal accepted';
 exception when invalid_parameter_value then null;
 end;
 if public.shopping_snapshot(h)<>before_v then raise exception 'Rejected foreign order changed data'; end if;
 revision:=before_v->>'revision';
 perform public.set_shopping_item_checked(h,'milk',false,true);
 if public.shopping_snapshot(h)->>'revision'<>revision then raise exception 'Checks invalidated ordering'; end if;
 v:=public.save_shopping_order(h,revision,jsonb_build_array(jsonb_build_object('id',m,'sort_order',10,'category','dairy')),jsonb_build_array(jsonb_build_object('id',manual,'sort_order',20)));
 begin
  perform public.save_shopping_order(h,revision,'[]','[]');
  raise exception 'Stale order accepted';
 exception when serialization_failure then null;
 end;
 -- Even non-cooperating legacy writes visible before recheck invalidate revision.
 revision:=v->>'revision';
 update public.ingredient_metadata set display_name='Concurrent legacy edit' where id=m;
 begin
  perform public.save_shopping_order(h,revision,'[]','[]');
  raise exception 'Visible legacy write not detected';
 exception when serialization_failure then null;
 end;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 foreach op in array array['snapshot','seed','add','remove','order'] loop
  begin
   case op
    when 'snapshot' then perform public.shopping_snapshot(h);
    when 'seed' then perform public.ensure_shopping_catalog(h,'[]');
    when 'add' then perform public.add_shopping_manual_item(h,revision,'bad','Bad',0);
    when 'remove' then perform public.remove_shopping_manual_item(h,manual);
    when 'order' then perform public.save_shopping_order(h,revision,'[]','[]');
   end case;
   raise exception 'Outsider accepted';
  exception when insufficient_privilege then null;
  end;
 end loop;
 perform set_config('request.jwt.claim.sub',owner_id,true);
 perform public.remove_shopping_manual_item(h,manual);
 perform public.remove_shopping_manual_item(h,manual);
 if exists(select 1 from public.shopping_list_manual_items where id=manual) or not exists(select 1 from public.ingredient_metadata where id=m and display_name='Concurrent legacy edit') then raise exception 'Remove scope mismatch'; end if;
end;
$$;
reset role;
do $$
declare f text;
begin
 foreach f in array array['shopping_snapshot(uuid)','ensure_shopping_catalog(uuid,jsonb)','add_shopping_manual_item(uuid,text,text,text,integer)','remove_shopping_manual_item(uuid,uuid)','save_shopping_order(uuid,text,jsonb,jsonb)'] loop
  if has_function_privilege('anon','public.'||f,'EXECUTE') or not has_function_privilege('authenticated','public.'||f,'EXECUTE') then raise exception 'Unexpected grants'; end if;
 end loop;
end;
$$;
rollback;
select 'Shopping snapshot, seeding preservation, atomic add/order rollback, repeat add/remove, stale/foreign/outsider denial and grants passed; all fixtures rolled back' as gate;
