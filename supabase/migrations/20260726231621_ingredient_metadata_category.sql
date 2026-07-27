-- Per-ingredient aisle category (1:1 with fixed catalog in lib/ingredient-categories.ts).
alter table public.ingredient_metadata
  add column if not exists category text not null default 'other';

alter table public.ingredient_metadata
  drop constraint if exists ingredient_metadata_category_check;

alter table public.ingredient_metadata
  add constraint ingredient_metadata_category_check
  check (category in (
    'produce',
    'meat_seafood',
    'condiments',
    'canned_pasta',
    'snacks',
    'beverages',
    'bread',
    'baking',
    'dairy',
    'frozen',
    'household',
    'pet_general',
    'breakfast_international',
    'wine',
    'deli_bakery',
    'health_beauty',
    'other'
  ));

comment on column public.ingredient_metadata.category is
  'Aisle/department id from app INGREDIENT_CATEGORIES; used for shopping-list aisle sort.';
