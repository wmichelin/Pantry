import { formatQuantity } from "./format-quantity";
import {
  DEFAULT_INGREDIENT_CATEGORY,
  type IngredientCategory,
} from "./ingredient-categories";
import { coerceIngredientCategory } from "./sort-shopping-list-by-aisle";

export type ShoppingListExportItem = {
  normalizedName: string;
  /** Prefer this over title-casing normalizedName when set. */
  displayName?: string;
  checked: boolean;
  storeIds: string[];
  category?: string | null;
  occurrences: { quantity: number | null; unit: string | null }[];
};

export type FormatShoppingListOptions = {
  /** When true, emit aisle headers in aisleOrder (must match on-screen grouping). */
  groupByAisle?: boolean;
  aisleOrder?: IngredientCategory[] | null;
};

const formatQty = (quantity: number | null, unit: string | null): string => {
  const parts: string[] = [];
  if (quantity) parts.push(formatQuantity(quantity));
  if (unit) parts.push(unit);
  if (parts.length === 0) return "";
  return `(${parts.join(" ")})`;
};

const titleCase = (name: string) =>
  name.replace(/\b\w/g, (c) => c.toUpperCase());

/** Plain-text line for Share (Messages, Notes paste, etc.). */
const formatLine = (item: ShoppingListExportItem): string => {
  const name = item.displayName?.trim() || titleCase(item.normalizedName);
  const qtys = item.occurrences
    .map((o) => formatQty(o.quantity, o.unit))
    .filter(Boolean);
  return qtys.length > 0 ? `${name} ${qtys.join(" ")}` : name;
};

const withHeader = (body: string) =>
  body ? `Shopping List\n\n${body}` : "";

/**
 * Format a shopping list as plain text for Share.
 * Matches the shopping-list screen: flat order by default; aisle headers only
 * when `groupByAisle` is set (Sort by aisle mode). Checked items are omitted.
 */
export function formatShoppingList(
  items: ShoppingListExportItem[],
  options?: FormatShoppingListOptions | IngredientCategory[] | null
): string {
  // Back-compat: second arg used to be aisleOrder alone (always grouped).
  const opts: FormatShoppingListOptions = Array.isArray(options)
    ? { groupByAisle: true, aisleOrder: options }
    : options?.groupByAisle || options?.aisleOrder
      ? {
          groupByAisle: options.groupByAisle ?? true,
          aisleOrder: options.aisleOrder,
        }
      : options ?? {};

  if (items.length === 0) return "";

  const unchecked = items.filter((item) => !item.checked);
  if (unchecked.length === 0) return "";

  if (!opts.groupByAisle) {
    const lines = unchecked.map((item) => `• ${formatLine(item)}`);
    return withHeader(lines.join("\n"));
  }

  const order = opts.aisleOrder ?? [];
  if (order.length === 0) {
    const lines = unchecked.map((item) => `• ${formatLine(item)}`);
    return withHeader(lines.join("\n"));
  }

  const known = new Set(order.map((c) => c.id));

  // Preserve relative order within each aisle from the input list.
  const byCategory = new Map<string, ShoppingListExportItem[]>();
  for (const cat of order) byCategory.set(cat.id, []);

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
    sections.push(
      [cat.label, ...group.map((item) => `• ${formatLine(item)}`)].join("\n")
    );
  }

  return withHeader(sections.join("\n\n"));
}
