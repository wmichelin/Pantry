import {
  DEFAULT_INGREDIENT_CATEGORY,
  type IngredientCategory,
  type IngredientCategoryId,
} from "./ingredient-categories";
import { coerceIngredientCategory } from "./sort-shopping-list-by-aisle";
import { moveItemBefore } from "./sortable-reorder";

export type AisleSectionItem = {
  listKey: string;
  category: string | null | undefined;
};

export type AisleSectionHeaderRow = {
  kind: "header";
  categoryId: IngredientCategoryId;
  label: string;
};

export type AisleSectionItemRow<T extends AisleSectionItem> = {
  kind: "item";
  item: T;
};

export type AisleSectionRow<T extends AisleSectionItem> =
  | AisleSectionHeaderRow
  | AisleSectionItemRow<T>;

export function aisleSectionRowKey<T extends AisleSectionItem>(
  row: AisleSectionRow<T>
): string {
  return row.kind === "header" ? `header:${row.categoryId}` : row.item.listKey;
}

/** One header per aisle (including empty), then that aisle's items in given order. */
export function buildAisleSectionRows<T extends AisleSectionItem>(
  items: T[],
  aisleOrder: IngredientCategory[]
): AisleSectionRow<T>[] {
  const known = new Set(aisleOrder.map((c) => c.id));
  const byCategory = new Map<string, T[]>();
  for (const cat of aisleOrder) byCategory.set(cat.id, []);

  for (const item of items) {
    let id = coerceIngredientCategory(item.category);
    if (!known.has(id)) id = DEFAULT_INGREDIENT_CATEGORY;
    byCategory.get(id)!.push(item);
  }

  const rows: AisleSectionRow<T>[] = [];
  for (const cat of aisleOrder) {
    rows.push({ kind: "header", categoryId: cat.id, label: cat.label });
    for (const item of byCategory.get(cat.id) ?? []) {
      rows.push({ kind: "item", item });
    }
  }
  return rows;
}

/**
 * After a library reorder of mixed header+item rows: take item order as moved,
 * assign each item's category from the nearest preceding header, rebuild
 * canonical header+item rows. Headers never stay "out of place".
 */
export function normalizeAisleRows<T extends AisleSectionItem>(
  rows: AisleSectionRow<T>[],
  aisleOrder: IngredientCategory[]
): { items: T[]; rows: AisleSectionRow<T>[] } {
  let currentCategory: IngredientCategoryId =
    aisleOrder[0]?.id ?? ("other" as IngredientCategoryId);

  const items: T[] = [];
  for (const row of rows) {
    if (row.kind === "header") {
      currentCategory = row.categoryId;
      continue;
    }
    items.push({ ...row.item, category: currentCategory } as T);
  }

  return {
    items,
    rows: buildAisleSectionRows(items, aisleOrder),
  };
}

/**
 * Move an item row within a mixed list (headers fixed in payload sense).
 * `from`/`to` are indices in the mixed rows array; if `from` is a header, no-op.
 * Uses insert-before semantics via moveItemBefore, then normalizes.
 */
export function applyItemReorder<T extends AisleSectionItem>(
  rows: AisleSectionRow<T>[],
  from: number,
  insertBefore: number,
  aisleOrder: IngredientCategory[]
): { items: T[]; rows: AisleSectionRow<T>[] } {
  if (from < 0 || from >= rows.length) {
    return { items: extractItems(rows), rows: buildAisleSectionRows(extractItems(rows), aisleOrder) };
  }
  if (rows[from].kind === "header") {
    return {
      items: extractItems(rows),
      rows: buildAisleSectionRows(extractItems(rows), aisleOrder),
    };
  }

  const moved = moveItemBefore(rows, from, insertBefore);
  return normalizeAisleRows(moved, aisleOrder);
}

function extractItems<T extends AisleSectionItem>(
  rows: AisleSectionRow<T>[]
): T[] {
  return rows.filter((r): r is AisleSectionItemRow<T> => r.kind === "item").map((r) => r.item);
}
