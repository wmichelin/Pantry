/**
 * Ingredient categories mapped to store departments.
 *
 * Default pitch = household walk order (produce-first). Households can override
 * via `households.aisle_category_order`.
 */

export const INGREDIENT_CATEGORIES = [
  { id: "produce", label: "Produce", pitch: 10 },
  { id: "meat_seafood", label: "Meat & Seafood", pitch: 20 },
  { id: "condiments", label: "Condiments", pitch: 30 },
  { id: "canned_pasta", label: "Canned Goods & Pasta", pitch: 40 },
  { id: "snacks", label: "Snacks", pitch: 50 },
  { id: "beverages", label: "Beverages", pitch: 60 },
  { id: "bread", label: "Bread", pitch: 70 },
  { id: "baking", label: "Baking", pitch: 80 },
  { id: "dairy", label: "Dairy", pitch: 90 },
  { id: "frozen", label: "Frozen", pitch: 100 },
  { id: "household", label: "Household Care", pitch: 110 },
  { id: "pet_general", label: "Pet & General", pitch: 120 },
  { id: "breakfast_international", label: "Breakfast & International", pitch: 130 },
  { id: "wine", label: "Wine", pitch: 140 },
  { id: "deli_bakery", label: "Deli & Bakery", pitch: 150 },
  { id: "health_beauty", label: "Health & Beauty", pitch: 160 },
  { id: "other", label: "Other", pitch: 999 },
] as const;

export type IngredientCategoryId = (typeof INGREDIENT_CATEGORIES)[number]["id"];

export type IngredientCategory = (typeof INGREDIENT_CATEGORIES)[number];

const byId = new Map<string, IngredientCategory>(
  INGREDIENT_CATEGORIES.map((c) => [c.id, c])
);

export const DEFAULT_INGREDIENT_CATEGORY: IngredientCategoryId = "other";

export function isIngredientCategoryId(value: string): value is IngredientCategoryId {
  return byId.has(value);
}

export function getIngredientCategory(
  id: string | null | undefined
): IngredientCategory {
  if (id && byId.has(id)) return byId.get(id)!;
  return byId.get(DEFAULT_INGREDIENT_CATEGORY)!;
}

/** Default pitch; unknown ids sort last with Other. */
export function categoryPitch(id: string | null | undefined): number {
  return getIngredientCategory(id).pitch;
}

export function compareCategoryPitch(
  a: string | null | undefined,
  b: string | null | undefined
): number {
  return categoryPitch(a) - categoryPitch(b);
}

/**
 * Merge a saved household order with the known catalog.
 * Empty/null → default pitch order. Unknown ids dropped; new catalog ids appended.
 */
export function resolveAisleCategoryOrder(
  saved: string[] | null | undefined
): IngredientCategory[] {
  const result: IngredientCategory[] = [];
  const seen = new Set<string>();

  for (const id of saved ?? []) {
    const cat = byId.get(id);
    if (!cat || seen.has(id)) continue;
    result.push(cat);
    seen.add(id);
  }

  for (const cat of INGREDIENT_CATEGORIES) {
    if (seen.has(cat.id)) continue;
    result.push(cat);
    seen.add(cat.id);
  }

  return result;
}
