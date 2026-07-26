-- Per-row order for standalone manual items (can sit beside a same-named recipe row).
alter table public.shopping_list_manual_items
  add column if not exists sort_order int not null default 0;
