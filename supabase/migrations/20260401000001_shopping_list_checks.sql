create table public.shopping_list_checks (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households(id) on delete cascade,
  week_start      date not null,
  normalized_name text not null,
  checked_at      timestamptz not null default now(),
  unique (household_id, week_start, normalized_name)
);

alter table public.shopping_list_checks enable row level security;

create policy "household members can read shopping_list_checks"
  on public.shopping_list_checks for select
  using (
    exists (select 1 from public.household_members hm
      where hm.household_id = shopping_list_checks.household_id and hm.user_id = auth.uid())
  );

create policy "household members can insert shopping_list_checks"
  on public.shopping_list_checks for insert
  with check (
    exists (select 1 from public.household_members hm
      where hm.household_id = shopping_list_checks.household_id and hm.user_id = auth.uid())
  );

create policy "household members can delete shopping_list_checks"
  on public.shopping_list_checks for delete
  using (
    exists (select 1 from public.household_members hm
      where hm.household_id = shopping_list_checks.household_id and hm.user_id = auth.uid())
  );
