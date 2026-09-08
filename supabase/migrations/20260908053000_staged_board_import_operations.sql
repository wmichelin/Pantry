-- Additive, staging-first recovery ledger for board imports. The public
-- operations remain caller-scoped SECURITY INVOKER functions. Ledger tables
-- live outside the exposed public schema and retain completed outcomes even if
-- a user later deletes the imported recipe.
begin;

create table pantry_internal.board_import_operations (
  household_id uuid not null references public.households(id) on delete cascade,
  operation_id uuid not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  manifest jsonb not null,
  created_at timestamptz not null default now(),
  primary key (household_id, operation_id),
  check (jsonb_typeof(manifest) = 'array'),
  check (jsonb_array_length(manifest) between 1 and 250),
  check (octet_length(manifest::text) <= 4194304)
);

create table pantry_internal.board_import_completions (
  household_id uuid not null,
  operation_id uuid not null,
  item_index integer not null check (item_index >= 0),
  created_by uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('saved', 'skipped')),
  recipe_id uuid,
  title text not null,
  ingredient_count integer not null check (ingredient_count >= 0),
  ingredients jsonb not null check (jsonb_typeof(ingredients) = 'array'),
  created_at timestamptz not null default now(),
  primary key (household_id, operation_id, item_index),
  foreign key (household_id, operation_id)
    references pantry_internal.board_import_operations(household_id, operation_id)
    on delete cascade,
  check ((status = 'saved' and recipe_id is not null)
    or (status = 'skipped' and recipe_id is null))
);

alter table pantry_internal.board_import_operations enable row level security;
alter table pantry_internal.board_import_operations force row level security;
alter table pantry_internal.board_import_completions enable row level security;
alter table pantry_internal.board_import_completions force row level security;

create policy "board import owners can read operations"
  on pantry_internal.board_import_operations for select to authenticated
  using (
    created_by = (select auth.uid())
    and exists (
      select 1 from public.household_members
      where household_id = board_import_operations.household_id
        and user_id = (select auth.uid())
    )
  );
create policy "board import owners can create operations"
  on pantry_internal.board_import_operations for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1 from public.household_members
      where household_id = board_import_operations.household_id
        and user_id = (select auth.uid())
    )
  );
create policy "board import owners can read completions"
  on pantry_internal.board_import_completions for select to authenticated
  using (
    created_by = (select auth.uid())
    and exists (
      select 1 from public.household_members
      where household_id = board_import_completions.household_id
        and user_id = (select auth.uid())
    )
  );
create policy "board import owners can create completions"
  on pantry_internal.board_import_completions for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1 from public.household_members
      where household_id = board_import_completions.household_id
        and user_id = (select auth.uid())
    )
    and exists (
      select 1
      from pantry_internal.board_import_operations operation,
        jsonb_array_elements(operation.manifest) item
      where operation.household_id = board_import_completions.household_id
        and operation.operation_id = board_import_completions.operation_id
        and operation.created_by = (select auth.uid())
        and (item->>'index')::integer = board_import_completions.item_index
        and item->>'title' = board_import_completions.title
        and item->'ingredients' = board_import_completions.ingredients
    )
    and (
      board_import_completions.recipe_id is null
      or exists (
        select 1 from public.recipes recipe
        where recipe.id = board_import_completions.recipe_id
          and recipe.household_id = board_import_completions.household_id
      )
    )
  );

revoke all on pantry_internal.board_import_operations,
  pantry_internal.board_import_completions from public, anon, authenticated;
grant select, insert on pantry_internal.board_import_operations,
  pantry_internal.board_import_completions to authenticated;

-- Hash indexing preserves the existing unbounded source_url contract. Every
-- lookup also compares the exact URL, so an MD5 collision cannot deduplicate
-- two different sources.
create index recipes_household_source_url_md5_idx
  on public.recipes(household_id, md5(source_url))
  where source_url is not null and source_url <> '';
create index board_import_operations_created_at_idx
  on pantry_internal.board_import_operations(created_at);

create function public.preflight_board_import(
  p_household_id uuid, p_operation_id uuid,
  p_request_manifest jsonb, p_manifest jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  item jsonb;
  stored_manifest jsonb;
  stored_creator uuid;
  stored_fingerprint text;
  v_request_fingerprint text;
  existing_indexes jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.household_members
    where household_id = p_household_id and user_id = auth.uid()
  ) then
    raise exception 'Household membership required' using errcode = '42501';
  end if;
  if p_operation_id is null
     or jsonb_typeof(p_request_manifest) is distinct from 'array'
     or jsonb_array_length(p_request_manifest) not between 1 and 250
     or octet_length(p_request_manifest::text) > 4194304 then
    raise exception 'Invalid board import request manifest' using errcode = '22023';
  end if;
  for item in select value from jsonb_array_elements(p_request_manifest) loop
    if jsonb_typeof(item) is distinct from 'object'
       or jsonb_typeof(item->'index') is distinct from 'number'
       or (item->>'index') !~ '^(0|[1-9][0-9]{0,9})$'
       or (item->>'index')::numeric > 2147483647
       or jsonb_typeof(item->'title') is distinct from 'string'
       or coalesce(btrim(item->>'title'), '') = ''
       or jsonb_typeof(item->'raw_ingredients') is distinct from 'array'
       or exists (
         select 1 from jsonb_array_elements(item->'raw_ingredients') value
         where jsonb_typeof(value) is distinct from 'string'
       )
       or jsonb_typeof(item->'metadata') is distinct from 'object' then
      raise exception 'Invalid board import request item' using errcode = '22023';
    end if;
  end loop;
  if (
    select count(distinct (entry->>'index')::integer)
    from jsonb_array_elements(p_request_manifest) entry
  ) <> jsonb_array_length(p_request_manifest) then
    raise exception 'Board import request indexes must be unique' using errcode = '22023';
  end if;
  v_request_fingerprint := encode(sha256(convert_to(p_request_manifest::text, 'UTF8')), 'hex');

  select operation.manifest, operation.created_by, operation.request_fingerprint
    into stored_manifest, stored_creator, stored_fingerprint
  from pantry_internal.board_import_operations operation
  where operation.household_id = p_household_id
    and operation.operation_id = p_operation_id;
  if found then
    if stored_creator is distinct from auth.uid()
       or stored_fingerprint is distinct from v_request_fingerprint then
      raise exception 'Board import operation payload changed' using errcode = '40001';
    end if;
    p_manifest := stored_manifest;
  elsif jsonb_typeof(p_manifest) is distinct from 'array'
     or jsonb_array_length(p_manifest) <> jsonb_array_length(p_request_manifest)
     or octet_length(p_manifest::text) > 4194304 then
    raise exception 'Invalid board import manifest' using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(p_manifest) loop
    if jsonb_typeof(item) is distinct from 'object'
       or jsonb_typeof(item->'index') is distinct from 'number'
       or (item->>'index') !~ '^(0|[1-9][0-9]{0,9})$'
       or (item->>'index')::numeric > 2147483647
       or jsonb_typeof(item->'title') is distinct from 'string'
       or coalesce(btrim(item->>'title'), '') = ''
       or jsonb_typeof(item->'metadata') is distinct from 'object'
       or jsonb_typeof(item->'metadata'->'source_url') is distinct from 'string'
       or jsonb_typeof(item->'metadata'->'source_type') is distinct from 'string'
       or coalesce(item->'metadata'->>'source_type', '') not in ('url', 'pinterest_pin')
       or jsonb_typeof(item->'metadata'->'instructions') is distinct from 'array'
       or jsonb_typeof(item->'metadata'->'tags') is distinct from 'array'
       or exists (
         select 1 from jsonb_array_elements(item->'metadata'->'instructions') value
         where jsonb_typeof(value) is distinct from 'string'
       )
       or exists (
         select 1 from jsonb_array_elements(item->'metadata'->'tags') value
         where jsonb_typeof(value) is distinct from 'string'
       )
       or exists (
         select 1 from jsonb_each(item->'metadata') field
         where field.key in ('image_url', 'servings', 'prep_time_minutes', 'cook_time_minutes')
           and field.value <> 'null'::jsonb
           and (
             (field.key = 'image_url' and jsonb_typeof(field.value) is distinct from 'string')
             or (field.key <> 'image_url' and case
               when jsonb_typeof(field.value) = 'number' then
                 (field.value#>>'{}')::numeric <> trunc((field.value#>>'{}')::numeric)
                 or (field.value#>>'{}')::numeric not between -2147483648 and 2147483647
               else true
             end)
           )
       )
       or jsonb_typeof(item->'ingredients') is distinct from 'array'
       or exists (
         select 1 from jsonb_array_elements(item->'ingredients') ingredient
         where jsonb_typeof(ingredient) is distinct from 'object'
            or jsonb_typeof(ingredient->'name') is distinct from 'string'
            or coalesce(btrim(ingredient->>'name'), '') = ''
            or jsonb_typeof(ingredient->'raw_string') is distinct from 'string'
            or (ingredient ? 'quantity' and ingredient->'quantity' <> 'null'::jsonb
              and jsonb_typeof(ingredient->'quantity') is distinct from 'number')
            or (ingredient ? 'unit' and ingredient->'unit' <> 'null'::jsonb
              and jsonb_typeof(ingredient->'unit') is distinct from 'string')
       ) then
      raise exception 'Invalid board import item' using errcode = '22023';
    end if;
  end loop;
  if (
    select count(distinct (entry->>'index')::integer)
    from jsonb_array_elements(p_manifest) entry
  ) <> jsonb_array_length(p_manifest) then
    raise exception 'Board import item indexes must be unique' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_manifest) parsed
    where not exists (
      select 1 from jsonb_array_elements(p_request_manifest) requested
      where requested->'index' = parsed->'index'
        and requested->'title' = parsed->'title'
        and requested->'metadata' = parsed->'metadata'
    )
  ) then
    raise exception 'Board import parsed manifest does not match its request' using errcode = '22023';
  end if;

  -- This complete, indexed lookup is part of preflight. Any database failure
  -- aborts before either the immutable manifest or a recipe is committed.
  select coalesce(jsonb_agg((entry->>'index')::integer order by ordinality), '[]'::jsonb)
    into existing_indexes
  from jsonb_array_elements(p_manifest) with ordinality as submitted(entry, ordinality)
  where entry->'metadata'->>'source_url' <> ''
    and exists (
      select 1 from public.recipes recipe
      where recipe.household_id = p_household_id
        and md5(recipe.source_url) = md5(entry->'metadata'->>'source_url')
        and recipe.source_url = entry->'metadata'->>'source_url'
    );

  if stored_manifest is null then
    insert into pantry_internal.board_import_operations(
      household_id, operation_id, created_by, request_fingerprint, manifest
    ) values (p_household_id, p_operation_id, auth.uid(), v_request_fingerprint, p_manifest)
    on conflict (household_id, operation_id) do nothing;

    select operation.manifest, operation.created_by, operation.request_fingerprint
      into stored_manifest, stored_creator, stored_fingerprint
    from pantry_internal.board_import_operations operation
    where operation.household_id = p_household_id
      and operation.operation_id = p_operation_id;
    if not found then
      raise exception 'Board import operation unavailable' using errcode = '42501';
    end if;
    if stored_creator is distinct from auth.uid()
       or stored_fingerprint is distinct from v_request_fingerprint then
      raise exception 'Board import operation payload changed' using errcode = '40001';
    end if;
  end if;

  return jsonb_build_object('existing_indexes', existing_indexes);
end;
$$;

create function public.import_board_item(
  p_household_id uuid, p_operation_id uuid, p_item_index integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  item jsonb;
  item_ingredients jsonb;
  recipe_payload jsonb;
  v_source_url text;
  saved public.recipes%rowtype;
  saved_count integer;
  completed pantry_internal.board_import_completions%rowtype;
begin
  if p_item_index < 0 then
    raise exception 'Invalid board import item' using errcode = '22023';
  end if;
  -- The household lock serializes cooperating board operations, including
  -- different operation IDs importing the same source URL.
  perform pantry_internal.lock_household(p_household_id);

  select * into completed
  from pantry_internal.board_import_completions
  where household_id = p_household_id
    and operation_id = p_operation_id
    and item_index = p_item_index;
  if found then
    return jsonb_build_object(
      'status', completed.status, 'recipe_id', completed.recipe_id,
      'title', completed.title, 'ingredient_count', completed.ingredient_count,
      'ingredients', completed.ingredients
    );
  end if;

  select entry into item
  from pantry_internal.board_import_operations operation,
    jsonb_array_elements(operation.manifest) entry
  where operation.household_id = p_household_id
    and operation.operation_id = p_operation_id
    and operation.created_by = auth.uid()
    and (entry->>'index')::integer = p_item_index;
  if not found then
    raise exception 'Board import operation or item unavailable' using errcode = '42501';
  end if;

  item_ingredients := item->'ingredients';
  v_source_url := item->'metadata'->>'source_url';
  if v_source_url <> '' and exists (
    select 1 from public.recipes recipe
    where recipe.household_id = p_household_id
      and md5(recipe.source_url) = md5(v_source_url)
      and recipe.source_url = v_source_url
  ) then
    insert into pantry_internal.board_import_completions(
      household_id, operation_id, item_index, created_by, status,
      recipe_id, title, ingredient_count, ingredients
    ) values (
      p_household_id, p_operation_id, p_item_index, auth.uid(), 'skipped',
      null, item->>'title', 0, item_ingredients
    ) returning * into completed;
  else
    recipe_payload := (item->'metadata') || jsonb_build_object('title', item->>'title');
    select imported.id, imported.title, imported.ingredient_count
      into saved.id, saved.title, saved_count
    from public.import_recipe_with_ingredients(
      p_household_id, recipe_payload, item_ingredients
    ) imported;
    if saved.id is null then
      raise exception 'Board import returned no recipe' using errcode = 'P0001';
    end if;
    insert into pantry_internal.board_import_completions(
      household_id, operation_id, item_index, created_by, status,
      recipe_id, title, ingredient_count, ingredients
    ) values (
      p_household_id, p_operation_id, p_item_index, auth.uid(), 'saved',
      saved.id, saved.title, saved_count, item_ingredients
    ) returning * into completed;
  end if;

  return jsonb_build_object(
    'status', completed.status, 'recipe_id', completed.recipe_id,
    'title', completed.title, 'ingredient_count', completed.ingredient_count,
    'ingredients', completed.ingredients
  );
end;
$$;

revoke execute on function public.preflight_board_import(uuid, uuid, jsonb, jsonb),
  public.import_board_item(uuid, uuid, integer) from public, anon;
grant execute on function public.preflight_board_import(uuid, uuid, jsonb, jsonb),
  public.import_board_item(uuid, uuid, integer) to authenticated;

commit;
