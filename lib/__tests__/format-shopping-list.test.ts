import { describe, expect, it } from "bun:test";
import { formatShoppingList } from "../format-shopping-list";

describe("formatShoppingList", () => {
  it("formats a flat list with unchecked then checked", () => {
    const text = formatShoppingList(
      [
        {
          normalizedName: "milk",
          checked: false,
          storeIds: [],
          occurrences: [{ quantity: 1, unit: "gallon" }],
        },
        {
          normalizedName: "eggs",
          checked: true,
          storeIds: [],
          occurrences: [],
        },
      ],
      []
    );
    expect(text).toBe("- [ ] Milk · 1 gallon\n\n## Got it\n- [x] Eggs");
  });

  it("groups by store sections then Other", () => {
    const text = formatShoppingList(
      [
        {
          normalizedName: "apples",
          checked: false,
          storeIds: ["s1"],
          occurrences: [],
        },
        {
          normalizedName: "paper towels",
          checked: false,
          storeIds: [],
          occurrences: [],
        },
      ],
      [
        { id: "s1", name: "Trader Joe's", sort_order: 0 },
        { id: "s2", name: "Costco", sort_order: 1 },
      ]
    );
    expect(text).toBe(
      "## Trader Joe's\n- [ ] Apples\n\n## Other\n- [ ] Paper Towels"
    );
  });

  it("returns empty string for empty list", () => {
    expect(formatShoppingList([], [])).toBe("");
    expect(formatShoppingList([], [{ id: "s1", name: "A", sort_order: 0 }])).toBe("");
  });
});
