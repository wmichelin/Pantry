import { describe, expect, it } from "bun:test";
import { formatShoppingList } from "../format-shopping-list";
import { resolveAisleCategoryOrder } from "../ingredient-categories";

describe("formatShoppingList", () => {
  it("groups by aisle headers in household order without bullets on headers", () => {
    const aisleOrder = resolveAisleCategoryOrder(["dairy", "produce"]);
    const text = formatShoppingList(
      [
        {
          normalizedName: "apples",
          checked: false,
          storeIds: [],
          category: "produce",
          occurrences: [],
        },
        {
          normalizedName: "milk",
          checked: false,
          storeIds: [],
          category: "dairy",
          occurrences: [{ quantity: 1, unit: "gallon" }],
        },
        {
          normalizedName: "lettuce",
          checked: false,
          storeIds: [],
          category: "produce",
          occurrences: [],
        },
      ],
      aisleOrder
    );
    expect(text).toBe(
      [
        "Shopping List",
        "",
        "Dairy",
        "• Milk (1 gallon)",
        "",
        "Produce",
        "• Apples",
        "• Lettuce",
      ].join("\n")
    );
  });

  it("omits checked items from the export", () => {
    const text = formatShoppingList([
      {
        normalizedName: "milk",
        checked: true,
        storeIds: [],
        category: "dairy",
        occurrences: [],
      },
      {
        normalizedName: "eggs",
        checked: false,
        storeIds: [],
        category: "dairy",
        occurrences: [],
      },
    ]);
    expect(text).toBe("Shopping List\n\nDairy\n• Eggs");
    expect(text).not.toContain("Milk");
  });

  it("returns empty string when every item is checked", () => {
    expect(
      formatShoppingList([
        {
          normalizedName: "milk",
          checked: true,
          storeIds: [],
          category: "dairy",
          occurrences: [],
        },
      ])
    ).toBe("");
  });

  it("omits empty aisle sections", () => {
    const text = formatShoppingList([
      {
        normalizedName: "eggs",
        checked: false,
        storeIds: [],
        category: "dairy",
        occurrences: [],
      },
    ]);
    expect(text).toBe("Shopping List\n\nDairy\n• Eggs");
    expect(text).not.toContain("Produce");
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
        category: "condiments",
        occurrences: [{ quantity: 1 / 3, unit: "cup" }],
      },
    ]);
    expect(text).toBe("Shopping List\n\nCondiments\n• Tahini (1/3 cup)");
  });

  it("emits all occurrence quantities as separate parentheses", () => {
    const text = formatShoppingList([
      {
        normalizedName: "milk",
        checked: false,
        storeIds: [],
        category: "dairy",
        occurrences: [
          { quantity: 1, unit: "cup" },
          { quantity: 1, unit: "gallon" },
        ],
      },
    ]);
    expect(text).toBe("Shopping List\n\nDairy\n• Milk (1 cup) (1 gallon)");
  });

  it("puts unknown categories under Other", () => {
    const text = formatShoppingList([
      {
        normalizedName: "mystery",
        checked: false,
        storeIds: [],
        category: "not-a-real-aisle",
        occurrences: [],
      },
    ]);
    expect(text).toBe("Shopping List\n\nOther\n• Mystery");
  });
});
