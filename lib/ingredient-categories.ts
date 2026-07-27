/**
 * Ingredient / aisle categories.
 *
 * Defaults seed new households; live aisle lists come from `household_aisles`.
 */

export const DEFAULT_INGREDIENT_CATEGORY = "other";

/** Built-in seed catalog (used when creating/seeding household aisles). */
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

/** Aisle key stored on ingredient_metadata.category (built-in or custom). */
export type IngredientCategoryId = string;

export type IngredientCategory = {
  id: IngredientCategoryId;
  label: string;
  /** Sort weight — lower walks first. */
  pitch: number;
};

const defaultById = new Map<string, IngredientCategory>(
  INGREDIENT_CATEGORIES.map((c) => [c.id, c])
);

export function isReservedOtherAisle(id: string): boolean {
  return id === DEFAULT_INGREDIENT_CATEGORY;
}

/** True for known built-in ids (scripts / legacy validation). */
export function isBuiltinIngredientCategoryId(value: string): boolean {
  return defaultById.has(value);
}

/** @deprecated Prefer household aisle list; kept for scripts that validate builtins. */
export function isIngredientCategoryId(value: string): boolean {
  return isBuiltinIngredientCategoryId(value);
}

export function getIngredientCategory(
  id: string | null | undefined,
  aisles?: IngredientCategory[] | null
): IngredientCategory {
  if (id && aisles?.length) {
    const found = aisles.find((c) => c.id === id);
    if (found) return found;
  }
  if (id && defaultById.has(id)) return defaultById.get(id)!;
  return defaultById.get(DEFAULT_INGREDIENT_CATEGORY)!;
}

/** Default pitch; unknown ids sort last with Other. */
export function categoryPitch(
  id: string | null | undefined,
  aisles?: IngredientCategory[] | null
): number {
  return getIngredientCategory(id, aisles).pitch;
}

export function compareCategoryPitch(
  a: string | null | undefined,
  b: string | null | undefined,
  aisles?: IngredientCategory[] | null
): number {
  return categoryPitch(a, aisles) - categoryPitch(b, aisles);
}

/**
 * Merge a saved household order with the known default catalog.
 * Empty/null → default pitch order. Unknown ids dropped; new catalog ids appended.
 * Prefer `listHouseholdAisles` when aisles live in the DB.
 */
export function resolveAisleCategoryOrder(
  saved: string[] | null | undefined
): IngredientCategory[] {
  const result: IngredientCategory[] = [];
  const seen = new Set<string>();

  for (const id of saved ?? []) {
    const cat = defaultById.get(id);
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

/** Slugify a label into an aisle key (a-z0-9_). */
export function aisleKeyFromLabel(label: string): string {
  const base = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return base || "aisle";
}
