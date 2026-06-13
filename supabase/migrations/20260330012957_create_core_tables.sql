-- Core schema: households, members, recipes, recipe ingredients.
-- Reconstructed from production to bring the repo in sync with the deployed DB.
-- Helper-dependent and recursion-sensitive policies are added in the next migration
-- (20260330014223_fix_household_members_rls_recursion).

create table public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  invite_code text not null unique,
  created_by  uuid not null references auth.users(id),
  created_at  timestamptz default now()
);

create table public.household_members (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  role         text not null check (role in ('owner', 'member')),
  joined_at    timestamptz default now(),
  unique (household_id, user_id)
);

create table public.recipes (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title        text not null,
  created_by   uuid not null references auth.users(id),
  created_at   timestamptz default now()
);

create table public.recipe_ingredients (
  id         uuid primary key default gen_random_uuid(),
  recipe_id  uuid not null references public.recipes(id) on delete cascade,
  name       text not null,
  quantity   numeric,
  unit       text,
  category   text,
  raw_string text,
  created_at timestamptz default now()
);

alter table public.households          enable row level security;
alter table public.household_members   enable row level security;
alter table public.recipes             enable row level security;
alter table public.recipe_ingredients  enable row level security;

-- Policies that depend only on auth.uid() (no recursion).
create policy "Authenticated users can create households"
  on public.households for insert to authenticated
  with check (auth.uid() = created_by);

create policy "Users can join households"
  on public.household_members for insert to authenticated
  with check (auth.uid() = user_id);
