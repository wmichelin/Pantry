import {
  INGREDIENT_CATEGORIES,
  categoryPitch,
  compareCategoryPitch,
  getIngredientCategory,
  isIngredientCategoryId,
  resolveAisleCategoryOrder,
} from "../ingredient-categories";

describe("ingredient categories", () => {
  it("has unique ids and strictly increasing pitches", () => {
    const ids = INGREDIENT_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (let i = 1; i < INGREDIENT_CATEGORIES.length; i++) {
      expect(INGREDIENT_CATEGORIES[i].pitch).toBeGreaterThan(
        INGREDIENT_CATEGORIES[i - 1].pitch
      );
    }
  });

  it("defaults to produce-first walk order", () => {
    expect(INGREDIENT_CATEGORIES[0].id).toBe("produce");
    expect(categoryPitch("produce")).toBeLessThan(categoryPitch("meat_seafood"));
    expect(categoryPitch("condiments")).toBeLessThan(categoryPitch("canned_pasta"));
    expect(categoryPitch("canned_pasta")).toBeLessThan(categoryPitch("snacks"));
    expect(categoryPitch("beverages")).toBeLessThan(categoryPitch("bread"));
    expect(categoryPitch("bread")).toBeLessThan(categoryPitch("baking"));
    expect(categoryPitch("health_beauty")).toBeLessThan(categoryPitch("other"));
  });

  it("treats unknown ids as other", () => {
    expect(isIngredientCategoryId("produce")).toBe(true);
    expect(isIngredientCategoryId("not-a-dept")).toBe(false);
    expect(getIngredientCategory("not-a-dept").id).toBe("other");
    expect(compareCategoryPitch("produce", "mystery")).toBeLessThan(0);
  });

  it("resolveAisleCategoryOrder seeds defaults and merges saved order", () => {
    const defaults = resolveAisleCategoryOrder(null);
    expect(defaults.map((c) => c.id)).toEqual(
      INGREDIENT_CATEGORIES.map((c) => c.id)
    );

    const custom = resolveAisleCategoryOrder(["dairy", "produce", "bogus"]);
    expect(custom.map((c) => c.id).slice(0, 2)).toEqual(["dairy", "produce"]);
    expect(custom.map((c) => c.id)).toContain("frozen");
    expect(custom.map((c) => c.id)).not.toContain("bogus");
    expect(custom).toHaveLength(INGREDIENT_CATEGORIES.length);
  });
});
