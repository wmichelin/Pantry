-- Staging running-queue operations. No week/date parameter. Caller-scoped RLS
-- remains authoritative; the invoker RPC also rejects cross-household recipes.
create or replace function public.add_recipe_to_queue(p_household_id uuid, p_recipe_id uuid)
returns table(id uuid, recipe_id uuid, recipe_title text)
language plpgsql security invoker set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.household_members where household_id=p_household_id and user_id=auth.uid()
  ) then raise exception 'Household membership required' using errcode='42501'; end if;
  -- Keep the validated household relationship stable through the insert.
  perform r.id from public.recipes r where r.id=p_recipe_id and r.household_id=p_household_id for share;
  if not found then
    raise exception 'Recipe does not belong to this household' using errcode='22023';
  end if;
  insert into public.week_queues(household_id,recipe_id,added_by)
    values(p_household_id,p_recipe_id,auth.uid())
    on conflict on constraint week_queues_household_id_recipe_id_key do nothing;
  return query select q.id,q.recipe_id,r.title from public.week_queues q
    join public.recipes r on r.id=q.recipe_id
    where q.household_id=p_household_id and q.recipe_id=p_recipe_id;
end;
$$;

create or replace function public.clear_queue_and_checks(p_household_id uuid)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.household_members where household_id=p_household_id and user_id=auth.uid()
  ) then raise exception 'Household membership required' using errcode='42501'; end if;
  delete from public.week_queues where household_id=p_household_id;
  delete from public.shopping_list_checks where household_id=p_household_id;
  return '{}'::jsonb;
end;
$$;

revoke execute on function public.add_recipe_to_queue(uuid,uuid) from public,anon;
grant execute on function public.add_recipe_to_queue(uuid,uuid) to authenticated;
revoke execute on function public.clear_queue_and_checks(uuid) from public,anon;
grant execute on function public.clear_queue_and_checks(uuid) to authenticated;
