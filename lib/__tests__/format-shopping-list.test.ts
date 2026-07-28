import { describe, expect, it } from "bun:test";
import { formatShoppingList } from "../format-shopping-list";
import { resolveAisleCategoryOrder } from "../ingredient-categories";

describe("formatShoppingList", () => {
  it("emits a flat list in given order when not grouping by aisle", () => {
    const text = formatShoppingList([
      {
        normalizedName: "apples",
        displayName: "Apples",
        checked: false,
        storeIds: [],
        category: "produce",
        occurrences: [],
      },
      {
        normalizedName: "milk",
        displayName: "Milk",
        checked: false,
        storeIds: [],
        category: "dairy",
        occurrences: [{ quantity: 1, unit: "gallon" }],
      },
      {
        normalizedName: "lettuce",
        displayName: "Lettuce",
        checked: false,
        storeIds: [],
        category: "produce",
        occurrences: [],
      },
    ]);
    expect(text).toBe(
      ["Shopping List", "", "• Apples", "• Milk (1 gallon)", "• Lettuce"].join(
        "\n"
      )
    );
  });

  it("groups by aisle headers only when groupByAisle is set", () => {
    const aisleOrder = resolveAisleCategoryOrder(["dairy", "produce"]);
    const text = formatShoppingList(
      [
        {
          normalizedName: "apples",
          displayName: "Apples",
          checked: false,
          storeIds: [],
          category: "produce",
          occurrences: [],
        },
        {
          normalizedName: "milk",
          displayName: "Milk",
          checked: false,
          storeIds: [],
          category: "dairy",
          occurrences: [{ quantity: 1, unit: "gallon" }],
        },
        {
          normalizedName: "lettuce",
          displayName: "Lettuce",
          checked: false,
          storeIds: [],
          category: "produce",
          occurrences: [],
        },
      ],
      { groupByAisle: true, aisleOrder }
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

  it("preserves within-aisle order from the input list when grouped", () => {
    const aisleOrder = resolveAisleCategoryOrder(["produce"]);
    const text = formatShoppingList(
      [
        {
          normalizedName: "lettuce",
          displayName: "Lettuce",
          checked: false,
          storeIds: [],
          category: "produce",
          occurrences: [],
        },
        {
          normalizedName: "apples",
          displayName: "Apples",
          checked: false,
          storeIds: [],
          category: "produce",
          occurrences: [],
        },
      ],
      { groupByAisle: true, aisleOrder }
    );
    expect(text).toBe(
      ["Shopping List", "", "Produce", "• Lettuce", "• Apples"].join("\n")
    );
  });

  it("omits checked items from the export", () => {
    const text = formatShoppingList([
      {
        normalizedName: "milk",
        displayName: "Milk",
        checked: true,
        storeIds: [],
        category: "dairy",
        occurrences: [],
      },
      {
        normalizedName: "eggs",
        displayName: "Eggs",
        checked: false,
        storeIds: [],
        category: "dairy",
        occurrences: [],
      },
    ]);
    expect(text).toBe("Shopping List\n\n• Eggs");
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

  it("omits empty aisle sections when grouped", () => {
    const aisleOrder = resolveAisleCategoryOrder(["dairy", "produce"]);
    const text = formatShoppingList(
      [
        {
          normalizedName: "eggs",
          displayName: "Eggs",
          checked: false,
          storeIds: [],
          category: "dairy",
          occurrences: [],
        },
      ],
      { groupByAisle: true, aisleOrder }
    );
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
        displayName: "Tahini",
        checked: false,
        storeIds: [],
        category: "condiments",
        occurrences: [{ quantity: 1 / 3, unit: "cup" }],
      },
    ]);
    expect(text).toBe("Shopping List\n\n• Tahini (1/3 cup)");
  });

  it("emits all occurrence quantities as separate parentheses", () => {
    const text = formatShoppingList([
      {
        normalizedName: "milk",
        displayName: "Milk",
        checked: false,
        storeIds: [],
        category: "dairy",
        occurrences: [
          { quantity: 1, unit: "cup" },
          { quantity: 1, unit: "gallon" },
        ],
      },
    ]);
    expect(text).toBe("Shopping List\n\n• Milk (1 cup) (1 gallon)");
  });

  it("puts unknown categories under Other when grouped", () => {
    const aisleOrder = resolveAisleCategoryOrder(null);
    const text = formatShoppingList(
      [
        {
          normalizedName: "mystery",
          displayName: "Mystery",
          checked: false,
          storeIds: [],
          category: "not-a-real-aisle",
          occurrences: [],
        },
      ],
      { groupByAisle: true, aisleOrder }
    );
    expect(text).toBe("Shopping List\n\nOther\n• Mystery");
  });

  it("accepts legacy aisleOrder array as second arg (grouped)", () => {
    const aisleOrder = resolveAisleCategoryOrder(["dairy"]);
    const text = formatShoppingList(
      [
        {
          normalizedName: "eggs",
          displayName: "Eggs",
          checked: false,
          storeIds: [],
          category: "dairy",
          occurrences: [],
        },
      ],
      aisleOrder
    );
    expect(text).toBe("Shopping List\n\nDairy\n• Eggs");
  });
});
