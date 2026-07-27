import { formatQuantity } from "./format-quantity";
import {
  DEFAULT_INGREDIENT_CATEGORY,
  resolveAisleCategoryOrder,
  type IngredientCategory,
} from "./ingredient-categories";
import { coerceIngredientCategory } from "./sort-shopping-list-by-aisle";

export type ShoppingListExportItem = {
  normalizedName: string;
  checked: boolean;
  storeIds: string[];
  category?: string | null;
  occurrences: { quantity: number | null; unit: string | null }[];
};

const formatQty = (quantity: number | null, unit: string | null): string => {
  const parts: string[] = [];
  if (quantity) parts.push(formatQuantity(quantity));
  if (unit) parts.push(unit);
  if (parts.length === 0) return "";
  return `(${parts.join(" ")})`;
};

const displayName = (name: string) =>
  name.replace(/\b\w/g, (c) => c.toUpperCase());

/** Plain-text line for Share (Messages, Notes paste, etc.). */
const formatLine = (item: ShoppingListExportItem): string => {
  const name = displayName(item.normalizedName);
  const qtys = item.occurrences
    .map((o) => formatQty(o.quantity, o.unit))
    .filter(Boolean);
  return qtys.length > 0 ? `${name} ${qtys.join(" ")}` : name;
};

/**
 * Format a shopping list as plain text grouped by aisle headers.
 * Headers have no bullet; items are bulleted. Sections separated by a blank line.
 */
export function formatShoppingList(
  items: ShoppingListExportItem[],
  aisleOrder?: IngredientCategory[] | null
): string {
  if (items.length === 0) return "";

  const unchecked = items.filter((item) => !item.checked);
  if (unchecked.length === 0) return "";

  const order =
    aisleOrder && aisleOrder.length > 0
      ? aisleOrder
      : resolveAisleCategoryOrder(null);

  const known = new Set(order.map((c) => c.id));

  const byCategory = new Map<string, ShoppingListExportItem[]>();
  for (const item of unchecked) {
    let id = coerceIngredientCategory(item.category);
    if (!known.has(id)) id = DEFAULT_INGREDIENT_CATEGORY;
    const group = byCategory.get(id);
    if (group) group.push(item);
    else byCategory.set(id, [item]);
  }

  const sections: string[] = [];
  for (const cat of order) {
    const group = byCategory.get(cat.id);
    if (!group?.length) continue;
    const lines = [
      cat.label,
      ...group.map((item) => `• ${formatLine(item)}`),
    ];
    sections.push(lines.join("\n"));
  }

  return `Shopping List\n\n${sections.join("\n\n")}`;
}
