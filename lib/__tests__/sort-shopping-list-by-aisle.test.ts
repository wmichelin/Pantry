import { INGREDIENT_CATEGORIES, resolveAisleCategoryOrder } from "../ingredient-categories";
import { sortShoppingListByAisle } from "../sort-shopping-list-by-aisle";

describe("sortShoppingListByAisle", () => {
  it("orders by household aisle order then display name", () => {
    const aisleOrder = resolveAisleCategoryOrder(["dairy", "produce"]);
    const sorted = sortShoppingListByAisle(
      [
        { category: "produce", displayName: "Zucchini" },
        { category: "dairy", displayName: "Milk" },
        { category: "produce", displayName: "Apples" },
        { category: "other", displayName: "Mystery" },
      ],
      aisleOrder
    );

    expect(sorted.map((i) => i.displayName)).toEqual([
      "Milk",
      "Apples",
      "Zucchini",
      "Mystery",
    ]);
  });

  it("treats unknown categories as other", () => {
    const aisleOrder = resolveAisleCategoryOrder(null);
    const otherIndex = aisleOrder.findIndex((c) => c.id === "other");
    expect(otherIndex).toBe(aisleOrder.length - 1);

    const sorted = sortShoppingListByAisle(
      [
        { category: "not-a-dept", displayName: "Weird" },
        { category: "produce", displayName: "Lettuce" },
        { category: null, displayName: "Nullish" },
      ],
      aisleOrder
    );

    expect(sorted[0].displayName).toBe("Lettuce");
    expect(sorted.slice(1).map((i) => i.displayName).sort()).toEqual([
      "Nullish",
      "Weird",
    ]);
  });

  it("covers every known category id in default order", () => {
    const aisleOrder = resolveAisleCategoryOrder(null);
    expect(aisleOrder.map((c) => c.id)).toEqual(
      INGREDIENT_CATEGORIES.map((c) => c.id)
    );
  });
});
