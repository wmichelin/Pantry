import { expect, it } from "bun:test";
import fixture from "../../contracts/fixtures/shopping-aggregation.json";
import { legacyShopping } from "../../scripts/shopping-legacy-reference.mjs";
import { normalizeIngredient, titleCaseIngredient } from "../normalize-ingredient";
it("characterizes legacy shopping occurrences and independent row identities", () => {
  expect(legacyShopping(fixture.snapshot)).toEqual(fixture.expected);
});
it("pins JavaScript Unicode normalization and ASCII display casing", () => {
  for (const name of fixture.names) {
    expect(normalizeIngredient(name.raw)).toBe(name.normalized);
    expect(titleCaseIngredient(name.normalized)).toBe(name.display);
  }
});
