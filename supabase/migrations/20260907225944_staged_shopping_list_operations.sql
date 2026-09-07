-- Additive staging-only shopping operations. Caller-scoped invoker/RLS.
create or replace function public.shopping_snapshot(p_household_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.household_members where household_id=p_household_id and user_id=auth.uid()) then raise exception 'Household membership required' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_household_id::text,817));
  if not exists(select 1 from public.household_aisles where household_id=p_household_id) then
    insert into public.household_aisles(household_id,key,label,sort_order)
    select p_household_id,d.key,d.label,d.pitch from (values
      ('produce','Produce',10),('meat_seafood','Meat & Seafood',20),('condiments','Condiments',30),
      ('canned_pasta','Canned Goods & Pasta',40),('snacks','Snacks',50),('beverages','Beverages',60),
      ('bread','Bread',70),('baking','Baking',80),('dairy','Dairy',90),('frozen','Frozen',100),
      ('household','Household Care',110),('pet_general','Pet & General',120),
      ('breakfast_international','Breakfast & International',130),('wine','Wine',140),
      ('deli_bakery','Deli & Bakery',150),('health_beauty','Health & Beauty',160),('other','Other',999)
    ) d(key,label,pitch) on conflict(household_id,key) do nothing;
  end if;
  select jsonb_build_object(
    'ingredients',coalesce((select jsonb_agg(jsonb_build_object('name',i.name,'recipe_title',r.title,'quantity',i.quantity,'unit',i.unit) order by q.created_at,q.id,i.created_at,i.id)
      from public.week_queues q join public.recipes r on r.id=q.recipe_id and r.household_id=p_household_id join public.recipe_ingredients i on i.recipe_id=r.id where q.household_id=p_household_id),'[]'::jsonb),
    'manuals',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'normalized_name',m.normalized_name,'quantity',m.quantity,'unit',m.unit,'sort_order',m.sort_order) order by m.created_at,m.id) from public.shopping_list_manual_items m where m.household_id=p_household_id),'[]'::jsonb),
    'catalog',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'normalized_name',m.normalized_name,'display_name',m.display_name,'sort_order',m.sort_order,'category',m.category) order by m.display_name,m.id) from public.ingredient_metadata m where m.household_id=p_household_id),'[]'::jsonb),
    'checks',coalesce((select jsonb_agg(c.normalized_name order by c.normalized_name) from public.shopping_list_checks c where c.household_id=p_household_id),'[]'::jsonb),
    'aisles',coalesce((select jsonb_agg(jsonb_build_object('key',a.key,'label',a.label,'sort_order',a.sort_order) order by (a.key='other'),a.sort_order,a.key) from public.household_aisles a where a.household_id=p_household_id),'[]'::jsonb)
  ) into v;
  -- Scalar JSON bypasses PostgREST row caps; excess is an explicit error, never truncation.
  if jsonb_array_length(v->'ingredients')>10000 or jsonb_array_length(v->'catalog')>10000 or jsonb_array_length(v->'manuals')>10000 or octet_length(v::text)>8388608 then raise exception 'Shopping snapshot exceeds supported size' using errcode='54000'; end if;
  return v || jsonb_build_object('revision',md5((v-'checks')::text));
end;
$$;
create or replace function public.ensure_shopping_catalog(p_household_id uuid,p_entries jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e jsonb; next_order integer;
begin
  perform public.shopping_snapshot(p_household_id);
  if jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries)>10000 then raise exception 'Invalid catalog entries' using errcode='22023'; end if;
  select greatest(0,coalesce(max(sort_order),0)) into next_order from public.ingredient_metadata where household_id=p_household_id;
  for e in select value from jsonb_array_elements(p_entries) loop
    if e->>'normalized_name' is null or e->>'display_name' is null then raise exception 'Invalid catalog entry' using errcode='22023'; end if;
    if not exists(select 1 from public.ingredient_metadata where household_id=p_household_id and normalized_name=e->>'normalized_name') then
      next_order:=next_order+10;
      insert into public.ingredient_metadata(household_id,normalized_name,display_name,sort_order) values(p_household_id,e->>'normalized_name',e->>'display_name',next_order) on conflict(household_id,normalized_name) do nothing;
    end if;
  end loop;
  return '{}'::jsonb;
end;
$$;
create or replace function public.add_shopping_manual_item(p_household_id uuid,p_revision text,p_name text,p_display text,p_sort_order integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v jsonb; catalog_order integer;
begin
  v:=public.shopping_snapshot(p_household_id);
  if p_revision is distinct from v->>'revision' then raise exception 'Shopping list changed; reload' using errcode='40001'; end if;
  if p_name is null or btrim(p_name)='' or right(p_name,1)=':' or p_display is null or p_sort_order is null then raise exception 'Invalid manual item' using errcode='22023'; end if;
  if not exists(select 1 from public.ingredient_metadata where household_id=p_household_id and normalized_name=p_name) then
    select greatest(0,coalesce(max(sort_order),0))+10 into catalog_order from public.ingredient_metadata where household_id=p_household_id;
    insert into public.ingredient_metadata(household_id,normalized_name,display_name,sort_order) values(p_household_id,p_name,p_display,catalog_order) on conflict(household_id,normalized_name) do nothing;
  end if;
  -- Re-add preserves UUID and quantity/unit.
  insert into public.shopping_list_manual_items(household_id,normalized_name,sort_order) values(p_household_id,p_name,p_sort_order) on conflict(household_id,normalized_name) do update set sort_order=excluded.sort_order;
  return public.shopping_snapshot(p_household_id);
end;
$$;
create or replace function public.remove_shopping_manual_item(p_household_id uuid,p_manual_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  perform public.shopping_snapshot(p_household_id);
  if exists(select 1 from public.shopping_list_manual_items where id=p_manual_id and household_id<>p_household_id) then raise exception 'Manual item does not belong to household' using errcode='22023'; end if;
  delete from public.shopping_list_manual_items where id=p_manual_id and household_id=p_household_id;
  return public.shopping_snapshot(p_household_id);
end;
$$;
create or replace function public.save_shopping_order(p_household_id uuid,p_revision text,p_metadata jsonb,p_manuals jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v jsonb; e jsonb;
begin
  v:=public.shopping_snapshot(p_household_id);
  -- Go resolved every row from this snapshot. Recheck in the write transaction.
  if p_revision is distinct from v->>'revision' then raise exception 'Shopping list changed; reload' using errcode='40001'; end if;
  if jsonb_typeof(p_metadata) is distinct from 'array' or jsonb_typeof(p_manuals) is distinct from 'array' or jsonb_array_length(p_metadata)>10000 or jsonb_array_length(p_manuals)>10000 then raise exception 'Invalid order' using errcode='22023'; end if;
  for e in select value from jsonb_array_elements(p_metadata) loop
    if e->>'category' is null or e->>'sort_order' is null then raise exception 'Invalid order entry' using errcode='22023'; end if;
    update public.ingredient_metadata set sort_order=(e->>'sort_order')::integer,category=e->>'category' where id=(e->>'id')::uuid and household_id=p_household_id;
    if not found then raise exception 'Catalog item does not belong to household' using errcode='22023'; end if;
  end loop;
  for e in select value from jsonb_array_elements(p_manuals) loop
    if e->>'sort_order' is null then raise exception 'Invalid manual order' using errcode='22023'; end if;
    update public.shopping_list_manual_items set sort_order=(e->>'sort_order')::integer where id=(e->>'id')::uuid and household_id=p_household_id;
    if not found then raise exception 'Manual item does not belong to household' using errcode='22023'; end if;
  end loop;
  return public.shopping_snapshot(p_household_id);
end;
$$;
revoke execute on function public.shopping_snapshot(uuid),public.ensure_shopping_catalog(uuid,jsonb),public.add_shopping_manual_item(uuid,text,text,text,integer),public.remove_shopping_manual_item(uuid,uuid),public.save_shopping_order(uuid,text,jsonb,jsonb) from public,anon;
grant execute on function public.shopping_snapshot(uuid),public.ensure_shopping_catalog(uuid,jsonb),public.add_shopping_manual_item(uuid,text,text,text,integer),public.remove_shopping_manual_item(uuid,uuid),public.save_shopping_order(uuid,text,jsonb,jsonb) to authenticated;
