import { formatQuantity } from "./format-quantity";

export type ShoppingListExportItem = {
  normalizedName: string;
  checked: boolean;
  storeIds: string[];
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
  const first = item.occurrences[0];
  const qty = first ? formatQty(first.quantity, first.unit) : "";
  return qty ? `${name} ${qty}` : name;
};

/** Format a shopping list as a bulleted plain-text list for the share sheet. */
export function formatShoppingList(items: ShoppingListExportItem[]): string {
  return items.map((item) => `• ${formatLine(item)}`).join("\n");
}
