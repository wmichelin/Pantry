-- SECURITY: the previous households SELECT policy used USING (true), letting any
-- signed-in user enumerate every household (names + invite codes). Replace it with
-- membership/creator-scoped reads, and add a parameterized exact-match lookup so the
-- join-by-invite flow no longer needs broad read access. This also resolves the
-- "multiple permissive policies" performance warning on households SELECT.
--
-- NOT YET APPLIED TO PRODUCTION. Ship together with the join-household.tsx change
-- that calls lookup_household_by_invite() instead of selecting households directly.

drop policy if exists "Anyone can look up household by invite code" on public.households;
drop policy if exists "Members can view their households" on public.households;

-- One policy: you can read a household if you created it (covers create read-back
-- before membership exists) or you are a member of it.
create policy "Members and creators can view households"
  on public.households for select to authenticated
  using (
    created_by = (select auth.uid())
    or id in (select get_my_household_ids())
  );

-- Exact-match invite lookup. SECURITY DEFINER so it can read past RLS, but it only
-- ever returns the single row whose invite_code matches the supplied argument.
create or replace function public.lookup_household_by_invite(p_code text)
  returns table (id uuid, name text)
  language sql
  stable
  security definer
  set search_path to 'public'
as $$
  select h.id, h.name
  from households h
  where h.invite_code = upper(trim(p_code))
  limit 1;
$$;

revoke execute on function public.lookup_household_by_invite(text) from public, anon;
grant  execute on function public.lookup_household_by_invite(text) to authenticated;
