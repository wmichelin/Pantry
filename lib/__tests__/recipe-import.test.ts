import { describe, expect, it } from "bun:test";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { ImportRawRecipeRequestSchema, ImportRawRecipeResponseSchema, ImportRecipeRequestSchema, ImportRecipeResponseSchema, ParseImportIngredientsRequestSchema, ParseImportIngredientsResponseSchema } from "../gen/pantry/v1/recipe_pb";
import { importRecipe, parseImportIngredients, stagingImportParserAPIOrigin, stagingRecipeImportAPIOrigin, type RecipeImport } from "../pantry-api";
import { importedRecipeInput, saveImportedBoard, saveImportedRecipe } from "../recipe-import";

const fixture = (): RecipeImport => importedRecipeInput("h", {
  title: "Original", source_url: "https://example.com/r", source_type: "pinterest_pin",
  image_url: "", instructions: ["Step two", "Step one"], suggested_tags: ["unused"],
  servings: 0, cook_time_minutes: 5, raw_ingredients: ["salt", "0 cups water"],
}, "Edited", ["chosen", "tag"]);

describe("recipe import transport", () => {
  it("stays off until explicitly enabled", () => expect(stagingRecipeImportAPIOrigin()).toBeNull());
  it("keeps the parser off by default and fails closed when enabled without a valid import API", () => {
    expect(stagingImportParserAPIOrigin()).toBeNull();
    for (const config of [
      { EXPO_PUBLIC_PANTRY_API_RECIPE_IMPORTS: "", EXPO_PUBLIC_PANTRY_API_URL: "https://example.com" },
      { EXPO_PUBLIC_PANTRY_API_RECIPE_IMPORTS: "enabled", EXPO_PUBLIC_PANTRY_API_URL: "" },
      { EXPO_PUBLIC_PANTRY_API_RECIPE_IMPORTS: "enabled", EXPO_PUBLIC_PANTRY_API_URL: "http://example.com" },
    ]) {
      const child = Bun.spawnSync([
        process.execPath,
        "-e",
        "import {stagingImportParserAPIOrigin as origin} from './lib/pantry-api.ts'; try { origin(); process.exit(1); } catch { process.exit(0); }",
      ], { env: { ...process.env, EXPO_PUBLIC_PANTRY_API_IMPORT_PARSER: "enabled", ...config } });
      expect(child.exitCode).toBe(0);
    }
  });
  it("preserves metadata, edited title/tags, order and null/zero through binary Connect", async () => {
    const input = fixture();
    let decoded: ReturnType<typeof fromBinary<typeof ImportRecipeRequestSchema>> | undefined;
    const saved = await importRecipe("https://pantry-staging.waltermichelin.com", "test-token", input, async (url, init) => {
      expect(String(url)).toEndWith("/api/rpc/pantry.v1.RecipeService/ImportRecipe");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-token");
      expect(new Headers(init?.headers).get("Content-Type")).toBe("application/proto");
      decoded = fromBinary(ImportRecipeRequestSchema, new Uint8Array(await new Response(init?.body).arrayBuffer()));
      return new Response(toBinary(ImportRawRecipeResponseSchema, create(ImportRawRecipeResponseSchema, {
        recipe: { id: "r", title: "Edited", ingredientCount: 2 },
      })), { headers: { "Content-Type": "application/proto" } });
    });
    expect(saved).toEqual({ id: "r", title: "Edited", ingredient_count: 2 });
    expect(decoded?.title).toBe("Edited");
    expect(decoded?.metadata).toMatchObject({ sourceUrl: input.metadata.source_url, sourceType: "pinterest_pin", imageUrl: "", instructions: ["Step two", "Step one"], tags: ["chosen", "tag"], servings: 0, cookTimeMinutes: 5 });
    expect(decoded?.metadata?.prepTimeMinutes).toBeUndefined();
    expect(decoded?.ingredients[0].quantity).toBeUndefined();
    expect(decoded?.ingredients[0].unit).toBeUndefined();
    expect(decoded?.ingredients[1].quantity).toBe(0);
  });
  it("rejects invalid numeric metadata before encoding or making a request", async () => {
    for (const value of [NaN, Infinity, 2.5, 2147483648]) {
      const input = fixture(); input.metadata.servings = value;
      await expect(importRecipe("https://example.com", "token", input, async () => { throw new Error("network called"); })).rejects.toThrow("whole numbers");
    }
  });
  it("returns a safe error for proxy failures", async () => {
    await expect(importRecipe("https://example.com", "token", fixture(), async () => new Response("private proxy details", { status: 502 }))).rejects.toThrow("Pantry could not import");
  });
  it("uses the household-scoped Go parser for preview and raw persistence", async () => {
    const parsed = [{ name: "salt", rawString: "Salt" }, { name: "water", quantity: 0, unit: "cups", rawString: "0 cups Water" }];
    const preview = await parseImportIngredients("https://example.com", "token", "h", ["Salt", "0 cups Water"], async (url, init) => {
      expect(String(url)).toEndWith("/ParseImportIngredients");
      const request = fromBinary(ParseImportIngredientsRequestSchema, new Uint8Array(await new Response(init?.body).arrayBuffer()));
      expect(request).toMatchObject({ householdId: "h", rawIngredients: ["Salt", "0 cups Water"] });
      return new Response(toBinary(ParseImportIngredientsResponseSchema, create(ParseImportIngredientsResponseSchema, { ingredients: parsed })), { headers: { "Content-Type": "application/proto" } });
    });
    expect(preview).toEqual([
      { name: "salt", quantity: null, unit: null, raw_string: "Salt" },
      { name: "water", quantity: 0, unit: "cups", raw_string: "0 cups Water" },
    ]);

    const input = importedRecipeInput("h", { ...fixtureSource(), raw_ingredients: ["Salt", "0 cups Water"] }, "Edited", ["chosen"], true);
    let request: ReturnType<typeof fromBinary<typeof ImportRawRecipeRequestSchema>> | undefined;
    const saved = await importRecipe("https://example.com", "token", input, async (url, init) => {
      expect(String(url)).toEndWith("/ImportRawRecipe");
      request = fromBinary(ImportRawRecipeRequestSchema, new Uint8Array(await new Response(init?.body).arrayBuffer()));
      return new Response(toBinary(ImportRecipeResponseSchema, create(ImportRecipeResponseSchema, {
        recipe: { id: "r", title: "Edited", ingredientCount: 2 }, ingredients: parsed,
      })), { headers: { "Content-Type": "application/proto" } });
    });
    expect(request).toMatchObject({ rawIngredients: ["Salt", "0 cups Water"] });
    expect(saved.ingredients).toEqual(preview);
  });
});

function fixtureSource() {
  return {
    title: "Original", source_url: "https://example.com/r", source_type: "pinterest_pin" as const,
    image_url: "", instructions: ["Step"], suggested_tags: ["unused"], raw_ingredients: ["salt"],
  };
}

describe("import orchestration", () => {
  it("keeps a saved recipe successful when catalog enrichment fails", async () => {
    let warned = 0;
    await expect(saveImportedRecipe(fixture(), {
      save: async () => ({ id: "r", title: "Edited", ingredient_count: 2 }),
      ensureCatalog: async () => { throw new Error("offline"); }, catalogWarning: () => { warned++; },
    })).resolves.toMatchObject({ id: "r" });
    expect(warned).toBe(2);
  });
  it("enriches from authoritative Go-parsed ingredients for raw imports", async () => {
    const names: string[] = [];
    const input = importedRecipeInput("h", { ...fixtureSource(), raw_ingredients: ["Salt and Pepper"] }, "Edited", [], true);
    const saved = await saveImportedRecipe(input, {
      save: async () => ({
        id: "r", title: "Edited", ingredient_count: 2,
        ingredients: [
          { name: "salt", quantity: null, unit: null, raw_string: "Salt" },
          { name: "pepper", quantity: null, unit: null, raw_string: "Pepper" },
        ],
      }),
      ensureCatalog: async (name) => { names.push(name); },
      catalogWarning: () => {},
    });
    expect(input.ingredients).toEqual([]);
    expect(names).toEqual(["salt", "pepper"]);
    expect(saved.ingredient_count).toBe(2);
  });
  it("preserves empty ingredients for single imports", () => {
    const input = importedRecipeInput("h", { title: "Empty", source_url: "", source_type: "url", instructions: [], raw_ingredients: [], suggested_tags: [] }, "Empty", []);
    expect(input.ingredients).toEqual([]);
  });
  it("counts complete saves only, skips stored/batch duplicates, and retries failed URLs", async () => {
    const make = (title: string, url: string) => ({ ...fixture(), title, metadata: { ...fixture().metadata, source_url: url } });
    const inputs = [make("existing", "old"), make("failed", "new"), make("retry", "new"), make("duplicate", "new"), make("no URL 1", ""), make("no URL 2", "")];
    const calls: string[] = []; const progress: number[] = [];
    const result = await saveImportedBoard(inputs, {
      existingURLs: async () => ["old"],
      save: async (input) => { calls.push(input.title); if (input.title === "failed") throw new Error("injected failure"); return { id: "r", title: input.title, ingredient_count: 2 }; },
      ensureCatalog: async () => {}, catalogWarning: () => {}, progress: (saved) => progress.push(saved),
    });
    expect(result).toEqual({ saved: 3, skipped: 2, failed: ["failed"] });
    expect(calls).toEqual(["failed", "retry", "no URL 1", "no URL 2"]);
    expect(progress).toEqual([1, 2, 3]);
  });
  it("does not write anything after a duplicate lookup failure", async () => {
    let writes = 0;
    await expect(saveImportedBoard([fixture()], {
      existingURLs: async () => { throw new Error("lookup failed"); },
      save: async () => { writes++; return { id: "r", title: "r", ingredient_count: 0 }; },
      ensureCatalog: async () => {}, catalogWarning: () => {}, progress: () => {},
    })).rejects.toThrow("lookup failed");
    expect(writes).toBe(0);
  });
});
