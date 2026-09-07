import { describe, expect, it } from "bun:test";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { ImportRecipeRequestSchema, ImportRecipeResponseSchema } from "../gen/pantry/v1/recipe_pb";
import { importRecipe, stagingRecipeImportAPIOrigin, type RecipeImport } from "../pantry-api";
import { importedRecipeInput, saveImportedBoard, saveImportedRecipe } from "../recipe-import";

const fixture = (): RecipeImport => importedRecipeInput("h", {
  title: "Original", source_url: "https://example.com/r", source_type: "pinterest_pin",
  image_url: "", instructions: ["Step two", "Step one"], suggested_tags: ["unused"],
  servings: 0, cook_time_minutes: 5, raw_ingredients: ["salt", "0 cups water"],
}, "Edited", ["chosen", "tag"]);

describe("recipe import transport", () => {
  it("stays off until explicitly enabled", () => expect(stagingRecipeImportAPIOrigin()).toBeNull());
  it("preserves metadata, edited title/tags, order and null/zero through binary Connect", async () => {
    const input = fixture();
    let decoded: ReturnType<typeof fromBinary<typeof ImportRecipeRequestSchema>> | undefined;
    const saved = await importRecipe("https://pantry-staging.waltermichelin.com", "test-token", input, async (url, init) => {
      expect(String(url)).toEndWith("/api/rpc/pantry.v1.RecipeService/ImportRecipe");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-token");
      expect(new Headers(init?.headers).get("Content-Type")).toBe("application/proto");
      decoded = fromBinary(ImportRecipeRequestSchema, new Uint8Array(await new Response(init?.body).arrayBuffer()));
      return new Response(toBinary(ImportRecipeResponseSchema, create(ImportRecipeResponseSchema, {
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
});

describe("import orchestration", () => {
  it("keeps a saved recipe successful when catalog enrichment fails", async () => {
    let warned = 0;
    await expect(saveImportedRecipe(fixture(), {
      save: async () => ({ id: "r", title: "Edited", ingredient_count: 2 }),
      ensureCatalog: async () => { throw new Error("offline"); }, catalogWarning: () => { warned++; },
    })).resolves.toMatchObject({ id: "r" });
    expect(warned).toBe(2);
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
