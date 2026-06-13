-- SECURITY: get_my_household_ids() is SECURITY DEFINER and was executable by `anon`
-- via /rest/v1/rpc, so an unauthenticated caller could invoke it. It is only needed
-- by RLS policies, which run as `authenticated`. Remove anon/public EXECUTE; keep
-- authenticated so the policies that depend on it keep working.
--
-- NOT YET APPLIED TO PRODUCTION. Apply only after backups are confirmed, then verify
-- household reads still work (advisor: 0028/0029).
revoke execute on function public.get_my_household_ids() from public, anon;
grant  execute on function public.get_my_household_ids() to authenticated;
