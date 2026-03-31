create table public.week_queues (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  recipe_id     uuid not null references public.recipes(id) on delete cascade,
  week_start    date not null,
  added_by      uuid not null references auth.users(id),
  created_at    timestamptz not null default now(),
  unique (household_id, recipe_id, week_start)
);

alter table public.week_queues enable row level security;

create policy "household members can read week_queues"
  on public.week_queues for select
  using (
    exists (select 1 from public.household_members hm
      where hm.household_id = week_queues.household_id and hm.user_id = auth.uid())
  );

create policy "household members can insert week_queues"
  on public.week_queues for insert
  with check (
    added_by = auth.uid() and
    exists (select 1 from public.household_members hm
      where hm.household_id = week_queues.household_id and hm.user_id = auth.uid())
  );

create policy "household members can delete week_queues"
  on public.week_queues for delete
  using (
    exists (select 1 from public.household_members hm
      where hm.household_id = week_queues.household_id and hm.user_id = auth.uid())
  );
