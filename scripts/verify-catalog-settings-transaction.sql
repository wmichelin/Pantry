-- STAGING ONLY. Synthetic identities, rows, failure triggers and writes roll back.
begin;
do $$ declare owner_id uuid:=gen_random_uuid(); member_id uuid:=gen_random_uuid(); begin
 insert into auth.users(id) values(owner_id),(member_id);
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 perform set_config('pantry.catalog_owner',owner_id::text,true);
 perform set_config('pantry.catalog_member',member_id::text,true);
end; $$;
create function pg_temp.reject_catalog_fixture_write() returns trigger language plpgsql as $$
begin
 if current_setting('pantry.catalog_fail',true)=tg_table_name then raise exception 'Injected catalog settings failure' using errcode='23514'; end if;
 if tg_op='DELETE' then return old; end if; return new;
end; $$;
create trigger catalog_mirror_failure before update on public.households for each row execute function pg_temp.reject_catalog_fixture_write();
create trigger catalog_aisle_failure before insert or update or delete on public.household_aisles for each row execute function pg_temp.reject_catalog_fixture_write();
create trigger catalog_metadata_failure before insert or update on public.ingredient_metadata for each row execute function pg_temp.reject_catalog_fixture_write();
set local role authenticated;
do $$
declare h uuid; other_h uuid; m uuid; foreign_m uuid; sid uuid; foreign_s uuid; rid uuid; v jsonb; before_v jsonb; before_catalog jsonb; keys jsonb; before_mirror text[]; code text; op text; fail_table text; owner_id text:=current_setting('pantry.catalog_owner'); member_id text:=current_setting('pantry.catalog_member');
begin
 select id,invite_code into h,code from public.create_household('Catalog transaction scratch','Fixture');
 select id into other_h from public.create_household('Catalog other scratch','Fixture');
 v:=public.get_household_aisles(h);
 if jsonb_array_length(v->'aisles')<>17 then raise exception 'Default aisle mismatch'; end if;
 insert into public.household_aisles(household_id,key,label,sort_order) values(other_h,'custom','Custom',1);
 if jsonb_array_length(public.get_household_aisles(other_h)->'aisles')<>1 then raise exception 'Custom-only aisles reseeded'; end if;
 v:=public.ensure_catalog_entries(h,'[{"normalized_name":"milk","display_name":"Custom Milk","sort_order":-20,"category":"dairy"}]',false);
 m:=(v->'items'->0->>'id')::uuid;
 perform public.ensure_catalog_entries(h,'[{"normalized_name":"milk","display_name":"Overwrite","category":"other"},{"normalized_name":"tea","display_name":"Tea"}]',false);
 if not exists(select 1 from public.ingredient_metadata where id=m and display_name='Custom Milk' and category='dairy' and sort_order=-20) or not exists(select 1 from public.ingredient_metadata where household_id=h and normalized_name='tea' and sort_order=-10) then raise exception 'Ensure preservation/negative order mismatch'; end if;
 perform public.ensure_catalog_entries(h,'[{"normalized_name":"seed","display_name":"Seed"}]',true);
 if not exists(select 1 from public.ingredient_metadata where household_id=h and normalized_name='seed' and sort_order=10) then raise exception 'Seed zero clamp mismatch'; end if;
 perform public.ensure_catalog_entries(h,'[{"normalized_name":"zero","display_name":"Zero","sort_order":0}]',false);
 insert into public.ingredient_metadata(household_id,normalized_name,display_name,sort_order) values(h,'max','Max',2147483647);
 perform public.ensure_catalog_entries(h,'[{"normalized_name":"milk","display_name":"Overwrite"}]',false);
 before_catalog:=public.get_catalog(h);
 begin
  perform public.ensure_catalog_entries(h,'[{"normalized_name":"first","display_name":"First","sort_order":1},{"normalized_name":"overflow","display_name":"Overflow"}]',false);
  raise exception 'Expected overflow';
 exception when numeric_value_out_of_range then null; end;
 if public.get_catalog(h)<>before_catalog then raise exception 'Partial seed survived overflow'; end if;
 delete from public.ingredient_metadata where household_id=h and normalized_name='max';
 v:=public.create_household_aisle(h,'Custom','custom');
 v:=public.create_household_aisle(h,'Custom again','custom');
 if not exists(select 1 from public.household_aisles where household_id=h and key='custom_2') then raise exception 'Collision suffix mismatch'; end if;
 perform public.update_catalog_ingredient(h,m,'Edited milk','custom');
 insert into public.recipes(household_id,created_by,title) values(h,owner_id::uuid,'Unaffected recipe') returning id into rid;
 insert into public.recipe_ingredients(recipe_id,name) values(rid,'milk');
 if jsonb_array_length(public.catalog_seed_source(h)->'names')<>1 then raise exception 'Recipe seed source mismatch'; end if;
 before_v:=public.get_household_aisles(h);before_catalog:=public.get_catalog(h);
 select aisle_category_order into before_mirror from public.households where id=h;
 select jsonb_agg(value->>'key' order by ordinality desc) into keys from jsonb_array_elements(before_v->'aisles') with ordinality;
 foreach op in array array['create','order','remove'] loop
  perform set_config('pantry.catalog_fail','households',true);
  begin
   case op when 'create' then perform public.create_household_aisle(h,'Rollback','rollback');
    when 'order' then perform public.save_household_aisle_order(h,before_v->>'revision',keys);
    when 'remove' then perform public.remove_household_aisle(h,'custom'); end case;
   raise exception 'Mirror failure was ignored';
  exception when check_violation then null; end;
  perform set_config('pantry.catalog_fail','',true);
  if public.get_household_aisles(h)<>before_v or public.get_catalog(h)<>before_catalog or (select aisle_category_order from public.households where id=h) is distinct from before_mirror then raise exception 'Partial aisle/mirror/catalog commit'; end if;
 end loop;
 foreach fail_table in array array['ingredient_metadata','household_aisles'] loop
  perform set_config('pantry.catalog_fail',fail_table,true);
  begin perform public.remove_household_aisle(h,'custom');raise exception 'Expected delete failure';exception when check_violation then null;end;
  perform set_config('pantry.catalog_fail','',true);
  if public.get_household_aisles(h)<>before_v or public.get_catalog(h)<>before_catalog then raise exception 'Partial delete survived';end if;
 end loop;
 foreach keys in array array['["other"]'::jsonb,'["other","other"]'::jsonb] loop
  begin perform public.save_household_aisle_order(h,before_v->>'revision',keys);raise exception 'Incomplete order accepted';exception when invalid_parameter_value then null;end;
 end loop;
 select jsonb_agg(case when ordinality=1 then 'other' else value->>'key' end order by ordinality) into keys from jsonb_array_elements(before_v->'aisles') with ordinality;
 begin perform public.save_household_aisle_order(h,before_v->>'revision',keys);raise exception 'Full-length duplicate accepted';exception when invalid_parameter_value then null;end;
 select jsonb_agg(case when ordinality=1 then 'foreign_key' else value->>'key' end order by ordinality) into keys from jsonb_array_elements(before_v->'aisles') with ordinality;
 begin perform public.save_household_aisle_order(h,before_v->>'revision',keys);raise exception 'Full-length foreign key accepted';exception when invalid_parameter_value then null;end;
 select jsonb_agg(value->>'key' order by ordinality desc) into keys from jsonb_array_elements(before_v->'aisles') with ordinality;
 v:=public.save_household_aisle_order(h,before_v->>'revision',keys);
 if v->'aisles'->-1->>'key'<>'other' then raise exception 'Other not last';end if;
 begin perform public.save_household_aisle_order(h,before_v->>'revision',keys);raise exception 'Stale order accepted';exception when serialization_failure then null;end;
 insert into public.ingredient_metadata(household_id,normalized_name,display_name) values(other_h,'foreign','Foreign') returning id into foreign_m;
 v:=public.add_household_store(other_h,'Foreign');foreign_s:=(v->'stores'->0->>'id')::uuid;
 begin perform public.remove_catalog_ingredient(h,foreign_m);raise exception 'Foreign catalog accepted';exception when invalid_parameter_value then null;end;
 begin perform public.update_catalog_ingredient(h,foreign_m,'Bad','other');raise exception 'Foreign edit accepted';exception when invalid_parameter_value then null;end;
 begin perform public.remove_household_store(h,foreign_s);raise exception 'Foreign store accepted';exception when invalid_parameter_value then null;end;
 v:=public.add_household_store(h,'Shop');sid:=(v->'stores'->0->>'id')::uuid;
 if (v->'stores'->0->>'sort_order')::integer<>0 then raise exception 'Store order mismatch';end if;
 insert into public.ingredient_store_availability(ingredient_metadata_id,store_id) values(m,sid),(foreign_m,foreign_s);
 perform public.remove_household_store(h,sid);
 if exists(select 1 from public.ingredient_store_availability where store_id=sid) or not exists(select 1 from public.ingredient_store_availability where store_id=foreign_s) then raise exception 'Store cascade scope mismatch';end if;
 -- Non-owner can mirror only persisted aisles, never arbitrary household fields.
 perform set_config('request.jwt.claim.sub',member_id,true);
 perform public.join_household_by_invite(code,'Member');
 perform public.create_household_aisle(h,'Member aisle','member_aisle');
 perform pantry_internal.mirror_household_aisles(h);
 if (select aisle_category_order from public.households where id=h) is distinct from (select array_agg(key order by (key='other'),sort_order,key) from public.household_aisles where household_id=h) then raise exception 'Member mirror not persisted';end if;
 update public.households set name='Forbidden',created_by=member_id::uuid where id=h;
 if exists(select 1 from public.households where id=h and (name='Forbidden' or created_by=member_id::uuid)) then raise exception 'Member household UPDATE broadened';end if;
 perform public.remove_household_aisle(h,'custom');
 if not exists(select 1 from public.ingredient_metadata where id=m and category='other' and display_name='Edited milk') then raise exception 'Delete reassignment mismatch';end if;
 v:=public.add_household_store(h,'Remaining shop');sid:=(v->'stores'->0->>'id')::uuid;
 insert into public.ingredient_store_availability(ingredient_metadata_id,store_id) values(m,sid);
 perform public.remove_catalog_ingredient(h,m);
 if exists(select 1 from public.ingredient_store_availability where ingredient_metadata_id=m) or not exists(select 1 from public.stores where id=sid) then raise exception 'Catalog cascade scope mismatch';end if;
 if not exists(select 1 from public.recipe_ingredients where recipe_id=rid and name='milk') then raise exception 'Catalog deletion altered recipes';end if;
 foreach op in array array['catalog','source','ensure','edit','remove','aisles','create','delete aisle','order','settings','store','delete store','mirror'] loop
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  begin
   case op when 'catalog' then perform public.get_catalog(h);when 'source' then perform public.catalog_seed_source(h);when 'ensure' then perform public.ensure_catalog_entries(h,'[]',false);
    when 'edit' then perform public.update_catalog_ingredient(h,m,'Bad','other');when 'remove' then perform public.remove_catalog_ingredient(h,m);when 'aisles' then perform public.get_household_aisles(h);
    when 'create' then perform public.create_household_aisle(h,'Bad','bad');when 'delete aisle' then perform public.remove_household_aisle(h,'member_aisle');when 'order' then perform public.save_household_aisle_order(h,'bad','[]');
    when 'settings' then perform public.get_household_settings(h);when 'store' then perform public.add_household_store(h,'Bad');when 'delete store' then perform public.remove_household_store(h,sid);when 'mirror' then perform pantry_internal.mirror_household_aisles(h);end case;
   raise exception 'Outsider accepted';
  exception when insufficient_privilege then null;end;
 end loop;
 perform set_config('request.jwt.claim.sub','',true);
 begin perform pantry_internal.mirror_household_aisles(h);raise exception 'Missing identity accepted';exception when insufficient_privilege then null;end;
end; $$;
reset role;
do $$ declare f text;begin
 foreach f in array array['get_catalog(uuid)','catalog_seed_source(uuid)','ensure_catalog_entries(uuid,jsonb,boolean)','update_catalog_ingredient(uuid,uuid,text,text)','remove_catalog_ingredient(uuid,uuid)','get_household_aisles(uuid)','save_household_aisle_order(uuid,text,jsonb)','create_household_aisle(uuid,text,text)','remove_household_aisle(uuid,text)','get_household_settings(uuid)','add_household_store(uuid,text)','remove_household_store(uuid,uuid)'] loop
  if has_function_privilege('anon','public.'||f,'EXECUTE') or not has_function_privilege('authenticated','public.'||f,'EXECUTE') then raise exception 'Unexpected public grants';end if;
 end loop;
 if has_schema_privilege('anon','pantry_internal','USAGE') or has_schema_privilege('authenticated','pantry_internal','CREATE') or has_function_privilege('anon','pantry_internal.mirror_household_aisles(uuid)','EXECUTE') or not has_function_privilege('authenticated','pantry_internal.mirror_household_aisles(uuid)','EXECUTE') then raise exception 'Unexpected private grants';end if;
end; $$;
rollback;
select 'Catalog/settings owner/member/outsider, exact/stale ordering, scoped cascades, parser-independent seed/ensure ordering, atomic failure rollback and private mirror privileges passed; all fixtures rolled back' as gate;
