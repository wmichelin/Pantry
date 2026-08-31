-- Staging parity gate: household creation and joining are atomic, authenticated
-- operations. The client may no longer create a membership or choose an owner
-- role directly. These functions run with definer privileges only to coordinate
-- the two writes; they derive the caller exclusively from auth.uid().
--
-- Decision record: PostgREST RPC functions must live in the exposed `public`
-- schema. This is a narrow exception to the private-schema preference: the
-- functions have an empty search_path, fully-qualified identifiers, explicit
-- authenticated-only grants, and derive all authority from auth.uid().

alter table public.households
  add column if not exists invite_expires_at timestamptz,
  add column if not exists invite_revoked_at timestamptz;

create schema if not exists pantry_private;

create table if not exists pantry_private.household_invite_attempts (
  id             bigint generated always as identity primary key,
  user_id        uuid not null,
  attempted_code text not null,
  attempted_at   timestamptz not null default now()
);

alter table pantry_private.household_invite_attempts enable row level security;

create index if not exists household_invite_attempts_user_id_attempted_at_idx
  on pantry_private.household_invite_attempts (user_id, attempted_at desc);

revoke all on schema pantry_private from public, anon, authenticated;
revoke all on all tables in schema pantry_private from public, anon, authenticated;

drop policy if exists "Authenticated users can create households" on public.households;
drop policy if exists "Users can join households" on public.household_members;

create or replace function public.create_household(
  p_name text,
  p_display_name text
)
returns table (id uuid, name text, invite_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  created_household public.households%rowtype;
  display_name text := left(coalesce(nullif(trim(p_display_name), ''), 'Owner'), 120);
  household_name text := left(coalesce(trim(p_name), ''), 120);
begin
  if caller_id is null then
    raise exception 'A Pantry session is required' using errcode = '28000';
  end if;
  if household_name = '' then
    raise exception 'Household name is required' using errcode = '22023';
  end if;

  insert into public.households (
    name,
    invite_code,
    created_by,
    invite_expires_at
  )
  values (
    household_name,
    upper(replace(gen_random_uuid()::text, '-', '')),
    caller_id,
    now() + interval '30 days'
  )
  returning * into created_household;

  insert into public.household_members (
    household_id,
    user_id,
    display_name,
    role
  )
  values (created_household.id, caller_id, display_name, 'owner');

  return query
  select created_household.id, created_household.name, created_household.invite_code;
end;
$$;

create or replace function public.join_household_by_invite(
  p_code text,
  p_display_name text
)
returns table (id uuid, name text, already_member boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  matched_household public.households%rowtype;
  display_name text := left(coalesce(nullif(trim(p_display_name), ''), 'Member'), 120);
  normalized_code text := upper(coalesce(trim(p_code), ''));
  recent_attempts integer;
  inserted_membership boolean := false;
begin
  if caller_id is null then
    raise exception 'A Pantry session is required' using errcode = '28000';
  end if;
  if normalized_code = '' then
    raise exception 'Invite code is required' using errcode = '22023';
  end if;

  select count(*) into recent_attempts
  from pantry_private.household_invite_attempts
  where user_id = caller_id
    and attempted_at >= now() - interval '5 minutes';
  if recent_attempts >= 10 then
    raise exception 'Too many invite attempts. Please try again later.' using errcode = '42901';
  end if;

  insert into pantry_private.household_invite_attempts (user_id, attempted_code)
  values (caller_id, normalized_code);

  select * into matched_household
  from public.households
  where invite_code = normalized_code
    and invite_revoked_at is null
    and (invite_expires_at is null or invite_expires_at > now())
  limit 1;
  if not found then
    return;
  end if;

  insert into public.household_members (
    household_id,
    user_id,
    display_name,
    role
  )
  values (matched_household.id, caller_id, display_name, 'member')
  on conflict (household_id, user_id) do nothing
  returning true into inserted_membership;

  return query
  select
    matched_household.id,
    matched_household.name,
    not coalesce(inserted_membership, false);
end;
$$;

revoke execute on function public.create_household(text, text) from public, anon;
revoke execute on function public.join_household_by_invite(text, text) from public, anon;
grant execute on function public.create_household(text, text) to authenticated;
grant execute on function public.join_household_by_invite(text, text) to authenticated;
