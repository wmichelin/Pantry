import { describe, expect, it } from "bun:test";
import { decodeHtmlEntities, extractIngredients } from "./recipe-fields";

describe("decodeHtmlEntities", () => {
  it("decodes decimal and hexadecimal Unicode entities", () => {
    expect(decodeHtmlEntities("It doesn&#x27;t change &#39;plain text&#39; &#x1F383;"))
      .toBe("It doesn't change 'plain text' 🎃");
  });

  it("preserves invalid Unicode numeric entities", () => {
    expect(decodeHtmlEntities("&#0; &#xD800; &#x110000;"))
      .toBe("&#0; &#xD800; &#x110000;");
  });

  it("returns markup-looking input as an inert string", () => {
    expect(decodeHtmlEntities("&lt;img src=x onerror=alert(1)&gt;"))
      .toBe("<img src=x onerror=alert(1)>");
  });
});

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
