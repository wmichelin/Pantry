import { describe, expect, test } from "bun:test";
import { searchableIngredient } from "../normalize-ingredient";

describe("searchableIngredient", () => {
  test("collapses hyphens so spaced query matches hyphenated catalog name", () => {
    expect(searchableIngredient("all-purpose flour")).toBe("all purpose flour");
    expect(searchableIngredient("all purpose flour")).toBe("all purpose flour");
    expect(
      searchableIngredient("all-purpose flour").includes(
        searchableIngredient("all purpose flour")
      )
    ).toBe(true);
  });

  test("collapses en/em dashes and underscores", () => {
    expect(searchableIngredient("all–purpose flour")).toBe("all purpose flour");
    expect(searchableIngredient("all_purpose flour")).toBe("all purpose flour");
  });
});
