import { describe, expect, it } from "bun:test";
import { formatShoppingList } from "../format-shopping-list";

describe("formatShoppingList", () => {
  it("formats a flat list with unchecked then checked", () => {
    const text = formatShoppingList([
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
    ]);
    expect(text).toBe("- [ ] Milk · 1 gallon\n\n## Got it\n- [x] Eggs");
  });

  it("stays flat even when items have storeIds", () => {
    const text = formatShoppingList([
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
    ]);
    expect(text).toBe("- [ ] Apples\n- [ ] Paper Towels");
  });

  it("returns empty string for empty list", () => {
    expect(formatShoppingList([])).toBe("");
  });

  it("formats fractional quantities as fractions", () => {
    const text = formatShoppingList([
      {
        normalizedName: "tahini",
        checked: false,
        storeIds: [],
        occurrences: [{ quantity: 1 / 3, unit: "cup" }],
      },
    ]);
    expect(text).toBe("- [ ] Tahini · 1/3 cup");
  });
});
