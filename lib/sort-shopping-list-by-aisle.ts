import {
  DEFAULT_INGREDIENT_CATEGORY,
  type IngredientCategory,
  type IngredientCategoryId,
} from "./ingredient-categories";

export type AisleSortableItem = {
  category: string | null | undefined;
  displayName: string;
};

/**
 * Sort shopping-list items by household aisle category order, then display name.
 * Unknown/missing categories sort with Other.
 */
export function sortShoppingListByAisle<T extends AisleSortableItem>(
  items: T[],
  aisleOrder: IngredientCategory[]
): T[] {
  const indexById = new Map<string, number>();
  aisleOrder.forEach((cat, i) => indexById.set(cat.id, i));

  const otherIndex =
    indexById.get(DEFAULT_INGREDIENT_CATEGORY) ?? aisleOrder.length;

  const categoryIndex = (category: string | null | undefined): number => {
    if (category && indexById.has(category)) {
      return indexById.get(category)!;
    }
    return otherIndex;
  };

  return [...items].sort((a, b) => {
    const byCat = categoryIndex(a.category) - categoryIndex(b.category);
    if (byCat !== 0) return byCat;
    return a.displayName.localeCompare(b.displayName, undefined, {
      sensitivity: "base",
    });
  });
}

export function coerceIngredientCategory(
  value: string | null | undefined
): IngredientCategoryId {
  const trimmed = value?.trim();
  if (!trimmed) return DEFAULT_INGREDIENT_CATEGORY;
  return trimmed;
}
