import { formatQuantity } from "./format-quantity";

export type ShoppingListExportItem = {
  normalizedName: string;
  checked: boolean;
  storeIds: string[];
  occurrences: { quantity: number | null; unit: string | null }[];
};

export type ShoppingListExportStore = {
  id: string;
  name: string;
  sort_order: number;
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

const formatSection = (
  label: string | null,
  unchecked: ShoppingListExportItem[],
  checked: ShoppingListExportItem[]
): string[] => {
  if (unchecked.length === 0 && checked.length === 0) return [];
  const lines: string[] = [];
  if (label) lines.push(`## ${label}`);
  for (const item of unchecked) lines.push(formatLine(item));
  for (const item of checked) lines.push(formatLine(item));
  return lines;
};

/** Format a shopping list as Markdown task lists for Share / Copy (Apple Notes, Messages, etc.). */
export function formatShoppingList(
  items: ShoppingListExportItem[],
  stores: ShoppingListExportStore[]
): string {
  const unchecked = items.filter((i) => !i.checked);
  const checked = items.filter((i) => i.checked);
  const lines: string[] = [];

  if (stores.length === 0) {
    lines.push(...formatSection(null, unchecked, []));
    if (checked.length > 0) {
      if (lines.length > 0) lines.push("");
      lines.push(...formatSection("Got it", [], checked));
    }
  } else {
    for (const store of stores) {
      const section = formatSection(
        store.name,
        unchecked.filter((i) => i.storeIds.includes(store.id)),
        checked.filter((i) => i.storeIds.includes(store.id))
      );
      if (section.length > 0) {
        if (lines.length > 0) lines.push("");
        lines.push(...section);
      }
    }
    const other = formatSection(
      "Other",
      unchecked.filter((i) => i.storeIds.length === 0),
      checked.filter((i) => i.storeIds.length === 0)
    );
    if (other.length > 0) {
      if (lines.length > 0) lines.push("");
      lines.push(...other);
    }
  }

  return lines.join("\n");
}
