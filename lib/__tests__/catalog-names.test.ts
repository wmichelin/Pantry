import { expect, it } from "bun:test";
import fixtures from "../../contracts/fixtures/catalog-names.json";
import { parseIngredient } from "../parse-ingredient";
import { catalogNameFromRaw } from "../catalog-name";
for (const f of fixtures) it(`pins legacy catalog parser: ${f.raw}`, () => {
 expect(parseIngredient(f.raw)).toEqual({ name: f.name, quantity: f.quantity, unit: f.unit, raw_string: f.raw });
 expect(catalogNameFromRaw(f.raw)).toEqual(f.normalized === null ? null : { normalized: f.normalized, display: f.display });
});
