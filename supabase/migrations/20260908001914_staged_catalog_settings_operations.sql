-- Staging-only additive capability. No exposed table grants/policies change.
begin;
create schema pantry_internal;
revoke all on schema pantry_internal from public,anon,authenticated;
grant usage on schema pantry_internal to authenticated;

create function pantry_internal.lock_household(p_household_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.household_members where household_id=p_household_id and user_id=auth.uid()) then raise exception 'Household membership required' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_household_id::text,817));
end;
$$;

-- Derived mirror only: members already manage aisles, but household UPDATE RLS
-- is owner-only. Never accept caller fields/arrays or broaden the table policy.
create function pantry_internal.mirror_household_aisles(p_household_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.household_members where household_id=p_household_id and user_id=auth.uid()) then raise exception 'Household membership required' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_household_id::text,817));
 update public.households set aisle_category_order=coalesce((select array_agg(key order by (key='other'),sort_order,key) from public.household_aisles where household_id=p_household_id),'{}'::text[]) where id=p_household_id;
 if not found then raise exception 'Household unavailable' using errcode='22023'; end if;
end;
$$;

create function public.get_catalog(p_household_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v jsonb;
begin
 perform pantry_internal.lock_household(p_household_id);
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'normalized_name',normalized_name,'display_name',display_name,'sort_order',sort_order,'category',category) order by display_name,id),'[]'::jsonb) into v from public.ingredient_metadata where household_id=p_household_id;
 if jsonb_array_length(v)>10000 or octet_length(v::text)>8388608 then raise exception 'Catalog too large' using errcode='54000'; end if;
 return jsonb_build_object('items',v);
end;
$$;
create function public.catalog_seed_source(p_household_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v jsonb; names jsonb;
begin
 v:=public.get_catalog(p_household_id);
 select coalesce(jsonb_agg(i.name order by r.created_at,r.id,i.created_at,i.id),'[]'::jsonb) into names from public.recipes r join public.recipe_ingredients i on i.recipe_id=r.id where r.household_id=p_household_id;
 if jsonb_array_length(names)>10000 or octet_length(names::text)>8388608 then raise exception 'Catalog seed too large' using errcode='54000'; end if;
 return v||jsonb_build_object('names',names);
end;
$$;
create function public.ensure_catalog_entries(p_household_id uuid,p_entries jsonb,p_seed boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e jsonb; highest integer; next_order integer; added integer:=0; inserted integer; result jsonb:='[]'; item jsonb;
begin
 perform pantry_internal.lock_household(p_household_id);
 if jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries)>10000 or p_seed is null then raise exception 'Invalid catalog entries' using errcode='22023'; end if;
 select coalesce(max(sort_order),0) into highest from public.ingredient_metadata where household_id=p_household_id;
 if p_seed then highest:=greatest(0,highest); end if;
 for e in select value from jsonb_array_elements(p_entries) loop
  if coalesce(e->>'normalized_name','')='' or e->>'display_name' is null or right(e->>'normalized_name',1)=':' then raise exception 'Invalid catalog entry' using errcode='22023'; end if;
  if not exists(select 1 from public.ingredient_metadata where household_id=p_household_id and normalized_name=e->>'normalized_name') then
   next_order:=coalesce((e->>'sort_order')::integer,highest+10);
   insert into public.ingredient_metadata(household_id,normalized_name,display_name,sort_order,category) values(p_household_id,e->>'normalized_name',e->>'display_name',next_order,coalesce(nullif(btrim(e->>'category'),''),'other')) on conflict(household_id,normalized_name) do nothing;
   get diagnostics inserted=row_count; added:=added+inserted;
   if inserted>0 then highest:=greatest(highest,next_order); end if;
  end if;
  select jsonb_build_object('id',id,'normalized_name',normalized_name,'display_name',display_name,'sort_order',sort_order,'category',category) into item from public.ingredient_metadata where household_id=p_household_id and normalized_name=e->>'normalized_name';
  if item is null then raise exception 'Catalog changed; retry' using errcode='40001'; end if;
  result:=result||jsonb_build_array(item);
 end loop;
 -- Gate inside the write transaction, so oversized results cannot partially commit.
 perform public.get_catalog(p_household_id);
 return jsonb_build_object('items',result,'added',added);
end;
$$;
create function public.update_catalog_ingredient(p_household_id uuid,p_id uuid,p_display text,p_category text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v jsonb;
begin
 perform pantry_internal.lock_household(p_household_id);
 if coalesce(btrim(p_display),'')='' or p_category is null then raise exception 'Invalid catalog edit' using errcode='22023'; end if;
 update public.ingredient_metadata set display_name=p_display,category=p_category where id=p_id and household_id=p_household_id;
 if not found then raise exception 'Catalog item unavailable' using errcode='22023'; end if;
 select jsonb_build_object('id',id,'normalized_name',normalized_name,'display_name',display_name,'sort_order',sort_order,'category',category) into v from public.ingredient_metadata where id=p_id and household_id=p_household_id;
 perform public.get_catalog(p_household_id);
 return v;
end;
$$;
create function public.remove_catalog_ingredient(p_household_id uuid,p_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 perform pantry_internal.lock_household(p_household_id);
 if exists(select 1 from public.ingredient_metadata where id=p_id and household_id<>p_household_id) then raise exception 'Catalog item does not belong to household' using errcode='22023'; end if;
 delete from public.ingredient_metadata where household_id=p_household_id and id=p_id;
 return '{}'::jsonb;
end;
$$;

create function public.get_household_aisles(p_household_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v jsonb;
begin
 perform pantry_internal.lock_household(p_household_id);
 if not exists(select 1 from public.household_aisles where household_id=p_household_id) then
  insert into public.household_aisles(household_id,key,label,sort_order)
  select p_household_id,d.key,d.label,d.pitch from (values
   ('produce','Produce',10),('meat_seafood','Meat & Seafood',20),('condiments','Condiments',30),('canned_pasta','Canned Goods & Pasta',40),('snacks','Snacks',50),('beverages','Beverages',60),('bread','Bread',70),('baking','Baking',80),('dairy','Dairy',90),('frozen','Frozen',100),('household','Household Care',110),('pet_general','Pet & General',120),('breakfast_international','Breakfast & International',130),('wine','Wine',140),('deli_bakery','Deli & Bakery',150),('health_beauty','Health & Beauty',160),('other','Other',999)
  )d(key,label,pitch) on conflict(household_id,key) do nothing;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('key',key,'label',label,'sort_order',sort_order) order by (key='other'),sort_order,key),'[]'::jsonb) into v from public.household_aisles where household_id=p_household_id;
 if jsonb_array_length(v)>1000 or octet_length(v::text)>1048576 then raise exception 'Too many aisles' using errcode='54000'; end if;
 return jsonb_build_object('aisles',v,'revision',md5(v::text));
end;
$$;
create function public.save_household_aisle_order(p_household_id uuid,p_revision text,p_keys jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v jsonb; key_count integer;
begin
 v:=public.get_household_aisles(p_household_id);
 if p_revision is distinct from v->>'revision' then raise exception 'Aisles changed; reload' using errcode='40001'; end if;
 if jsonb_typeof(p_keys) is distinct from 'array' then raise exception 'Invalid aisle order' using errcode='22023'; end if;
 key_count:=jsonb_array_length(p_keys);
 if key_count<>jsonb_array_length(v->'aisles') or key_count>1000 or exists(select 1 from jsonb_array_elements(p_keys) e where jsonb_typeof(e)<>'string') or (select count(distinct value) from jsonb_array_elements_text(p_keys))<>key_count then raise exception 'Incomplete or duplicate aisle order' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements_text(p_keys) k where not exists(select 1 from public.household_aisles a where a.household_id=p_household_id and a.key=k.value)) then raise exception 'Unknown aisle key' using errcode='22023'; end if;
 with ordered as(select value as key,row_number() over(order by (value='other'),ordinality)*10 as pitch from jsonb_array_elements_text(p_keys) with ordinality)
 update public.household_aisles a set sort_order=o.pitch::integer from ordered o where a.household_id=p_household_id and a.key=o.key;
 perform pantry_internal.mirror_household_aisles(p_household_id);
 return public.get_household_aisles(p_household_id);
end;
$$;
create function public.create_household_aisle(p_household_id uuid,p_label text,p_base text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare candidate text; suffix integer:=2; next_order integer; v jsonb; keys jsonb;
begin
 v:=public.get_household_aisles(p_household_id);
 if coalesce(btrim(p_label),'')='' or p_base is null or p_base!~'^[a-z0-9_]{1,54}$' or p_base='other' then raise exception 'Invalid aisle label or key' using errcode='22023'; end if;
 candidate:=p_base;
 while exists(select 1 from public.household_aisles where household_id=p_household_id and key=candidate) loop candidate:=p_base||'_'||suffix::text;suffix:=suffix+1; end loop;
 select coalesce(max(sort_order),0)+10 into next_order from public.household_aisles where household_id=p_household_id and key<>'other';
 insert into public.household_aisles(household_id,key,label,sort_order) values(p_household_id,candidate,p_label,next_order);
 v:=public.get_household_aisles(p_household_id);
 select jsonb_agg(value->>'key' order by ordinality) into keys from jsonb_array_elements(v->'aisles') with ordinality;
 return public.save_household_aisle_order(p_household_id,v->>'revision',keys);
end;
$$;
create function public.remove_household_aisle(p_household_id uuid,p_key text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v jsonb; keys jsonb;
begin
 perform pantry_internal.lock_household(p_household_id);
 if p_key is null or p_key='' or p_key='other' then raise exception 'Cannot delete the Other aisle or an empty key' using errcode='22023'; end if;
 update public.ingredient_metadata set category='other' where household_id=p_household_id and category=p_key;
 delete from public.household_aisles where household_id=p_household_id and key=p_key;
 v:=public.get_household_aisles(p_household_id);
 select jsonb_agg(value->>'key' order by ordinality) into keys from jsonb_array_elements(v->'aisles') with ordinality;
 return public.save_household_aisle_order(p_household_id,v->>'revision',keys);
end;
$$;

create function public.get_household_settings(p_household_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v jsonb;
begin
 perform pantry_internal.lock_household(p_household_id);
 select jsonb_build_object('household',jsonb_build_object('id',h.id,'name',h.name,'invite_code',h.invite_code),'members',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'display_name',m.display_name,'role',m.role) order by m.id) from public.household_members m where m.household_id=p_household_id),'[]'::jsonb),'stores',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'sort_order',s.sort_order) order by s.sort_order,s.created_at,s.id) from public.stores s where s.household_id=p_household_id),'[]'::jsonb)) into v from public.households h where h.id=p_household_id;
 if v is null then raise exception 'Household unavailable' using errcode='42501'; end if;
 if jsonb_array_length(v->'members')>10000 or jsonb_array_length(v->'stores')>10000 or octet_length(v::text)>8388608 then raise exception 'Settings too large' using errcode='54000'; end if;
 return v;
end;
$$;
create function public.add_household_store(p_household_id uuid,p_name text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare next_order integer;
begin
 perform pantry_internal.lock_household(p_household_id);
 if coalesce(btrim(p_name),'')='' then raise exception 'Store name required' using errcode='22023'; end if;
 select (count(*)*10)::integer into next_order from public.stores where household_id=p_household_id;
 insert into public.stores(household_id,name,sort_order) values(p_household_id,p_name,next_order);
 return public.get_household_settings(p_household_id);
end;
$$;
create function public.remove_household_store(p_household_id uuid,p_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 perform pantry_internal.lock_household(p_household_id);
 if exists(select 1 from public.stores where id=p_id and household_id<>p_household_id) then raise exception 'Store does not belong to household' using errcode='22023'; end if;
 delete from public.stores where household_id=p_household_id and id=p_id;
 return public.get_household_settings(p_household_id);
end;
$$;
revoke all on function pantry_internal.lock_household(uuid),pantry_internal.mirror_household_aisles(uuid) from public,anon;
grant execute on function pantry_internal.lock_household(uuid),pantry_internal.mirror_household_aisles(uuid) to authenticated;
revoke execute on function public.get_catalog(uuid),public.catalog_seed_source(uuid),public.ensure_catalog_entries(uuid,jsonb,boolean),public.update_catalog_ingredient(uuid,uuid,text,text),public.remove_catalog_ingredient(uuid,uuid),public.get_household_aisles(uuid),public.save_household_aisle_order(uuid,text,jsonb),public.create_household_aisle(uuid,text,text),public.remove_household_aisle(uuid,text),public.get_household_settings(uuid),public.add_household_store(uuid,text),public.remove_household_store(uuid,uuid) from public,anon;
grant execute on function public.get_catalog(uuid),public.catalog_seed_source(uuid),public.ensure_catalog_entries(uuid,jsonb,boolean),public.update_catalog_ingredient(uuid,uuid,text,text),public.remove_catalog_ingredient(uuid,uuid),public.get_household_aisles(uuid),public.save_household_aisle_order(uuid,text,jsonb),public.create_household_aisle(uuid,text,text),public.remove_household_aisle(uuid,text),public.get_household_settings(uuid),public.add_household_store(uuid,text),public.remove_household_store(uuid,uuid) to authenticated;
commit;
