-- Additive, caller-scoped shopping operations. No production migration is part
-- of this release. All deletes stay inside one requested household.
create or replace function public.set_shopping_item_checked(
  p_household_id uuid, p_normalized_name text, p_standalone_manual boolean, p_checked boolean
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_key text;
  -- ECMAScript trim characters, matching the existing ingredient key contract.
  v_trim text := U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff';
begin
  if auth.uid() is null or not exists (
    select 1 from public.household_members where household_id=p_household_id and user_id=auth.uid()
  ) then raise exception 'Household membership required' using errcode='42501'; end if;
  if p_normalized_name is null or btrim(p_normalized_name,v_trim)='' or
     p_standalone_manual is null or p_checked is null then
    raise exception 'A shopping item and checked state are required' using errcode='22023';
  end if;
  v_key := p_normalized_name || case when p_standalone_manual then '::manual' else '' end;
  if p_checked then
    insert into public.shopping_list_checks(household_id,normalized_name)
      values(p_household_id,v_key)
      on conflict(household_id,normalized_name) do nothing;
  else
    delete from public.shopping_list_checks where household_id=p_household_id and normalized_name=v_key;
    -- Old clients stored standalone manual checks under the bare name. Do not
    -- remove that check when it belongs to a currently queued recipe row.
    if p_standalone_manual and not exists (
      select 1 from public.week_queues q
      join public.recipes r on r.id=q.recipe_id and r.household_id=p_household_id
      join public.recipe_ingredients i on i.recipe_id=r.id
      where q.household_id=p_household_id
        and right(btrim(i.name,v_trim),1)<>':'
        -- Pin language-neutral full Unicode casing rather than inheriting a
        -- database/column locale (dotted I and Greek final sigma matter).
        and lower(btrim(i.name,v_trim) collate pg_catalog."und-x-icu")=p_normalized_name
    ) then
      delete from public.shopping_list_checks where household_id=p_household_id and normalized_name=p_normalized_name;
    end if;
  end if;
  return '{}'::jsonb;
end;
$$;

create or replace function public.clear_shopping_checks(p_household_id uuid)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.household_members where household_id=p_household_id and user_id=auth.uid()
  ) then raise exception 'Household membership required' using errcode='42501'; end if;
  delete from public.shopping_list_checks where household_id=p_household_id;
  return '{}'::jsonb;
end;
$$;

create or replace function public.clear_shopping_week(p_household_id uuid)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.household_members where household_id=p_household_id and user_id=auth.uid()
  ) then raise exception 'Household membership required' using errcode='42501'; end if;
  delete from public.week_queues where household_id=p_household_id;
  delete from public.shopping_list_checks where household_id=p_household_id;
  delete from public.shopping_list_manual_items where household_id=p_household_id;
  return '{}'::jsonb;
end;
$$;

revoke execute on function public.set_shopping_item_checked(uuid,text,boolean,boolean) from public,anon;
grant execute on function public.set_shopping_item_checked(uuid,text,boolean,boolean) to authenticated;
revoke execute on function public.clear_shopping_checks(uuid) from public,anon;
grant execute on function public.clear_shopping_checks(uuid) to authenticated;
revoke execute on function public.clear_shopping_week(uuid) from public,anon;
grant execute on function public.clear_shopping_week(uuid) to authenticated;
