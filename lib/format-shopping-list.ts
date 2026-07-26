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
  return parts.join(" ");
};

const displayName = (name: string) =>
  name.replace(/\b\w/g, (c) => c.toUpperCase());

/** Markdown task-list line — Apple Notes converts these to interactive checklists on .md import (and on paste in newer iOS). */
const formatLine = (item: ShoppingListExportItem): string => {
  const mark = item.checked ? "- [x]" : "- [ ]";
  const name = displayName(item.normalizedName);
  const first = item.occurrences[0];
  const qty = first ? formatQty(first.quantity, first.unit) : "";
  return qty ? `${mark} ${name} · ${qty}` : `${mark} ${name}`;
};

/** Format a shopping list as Markdown task lists for Share / Copy (Apple Notes, Messages, etc.). */
export function formatShoppingList(items: ShoppingListExportItem[]): string {
  return items.map(formatLine).join("\n");
}
