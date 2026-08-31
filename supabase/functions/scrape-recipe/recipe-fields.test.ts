import { describe, expect, it } from "bun:test";
import { extractIngredients } from "./recipe-fields";

describe("extractIngredients", () => {
  it("preserves repeated ingredients in their source order", () => {
    const brownSugar = "1/2 cup (100 grams) light brown sugar";

    expect(extractIngredients([
      brownSugar,
      "2 cups (254 grams) all-purpose flour",
      brownSugar,
    ])).toEqual([
      brownSugar,
      "2 cups (254 grams) all-purpose flour",
      brownSugar,
    ]);
  });

  it("decodes entities, trims strings, and ignores non-string entries", () => {
    expect(extractIngredients([" 1 cup macaroni &amp; cheese ", null, 2, ""])).toEqual([
      "1 cup macaroni & cheese",
    ]);
  });

  it("returns an empty list for a non-array value", () => {
    expect(extractIngredients("1 cup flour")).toEqual([]);
  });
});
