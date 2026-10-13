import { describe, expect, it } from "bun:test";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";

import { ScrapeRecipeRequestSchema, ScrapeRecipeResponseSchema } from "../gen/pantry/v1/scrape_pb";
import { scrapeRecipe, stagingRecipeScrapeAPIOrigin } from "../pantry-api";

describe("recipe scrape transport", () => {
  it("is independently disabled by default", () => {
    expect(stagingRecipeScrapeAPIOrigin()).toBeNull();
  });

  it("uses authenticated binary Connect and preserves oneof, order, zero, empty, and absence", async () => {
    let request: ReturnType<typeof fromBinary<typeof ScrapeRecipeRequestSchema>> | undefined;
    const result = await scrapeRecipe("https://example.com", "token", "household", "https://recipe.example", async (url, init) => {
      expect(String(url)).toEndWith("/pantry.v1.RecipeScrapeService/ScrapeRecipe");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer token");
      request = fromBinary(ScrapeRecipeRequestSchema, new Uint8Array(await new Response(init?.body).arrayBuffer()));
      return new Response(toBinary(ScrapeRecipeResponseSchema, create(ScrapeRecipeResponseSchema, {
        result: { case: "recipe", value: {
          title: "Recipe", sourceUrl: "https://recipe.example", sourceType: "url", imageUrl: "", servings: 0,
          instructions: ["Second", "First"], rawIngredients: [], suggestedTags: ["One Pot"],
        } },
      })), { headers: { "Content-Type": "application/proto" } });
    });
    expect(request).toMatchObject({ householdId: "household", url: "https://recipe.example" });
    expect(result).toEqual({ type: "single", recipe: {
      title: "Recipe", source_url: "https://recipe.example", source_type: "url", image_url: "", servings: 0,
      instructions: ["Second", "First"], raw_ingredients: [], suggested_tags: ["One Pot"],
    } });
    expect(result.type === "single" && result.recipe.prep_time_minutes).toBeUndefined();
  });

  it("preserves an empty board and fails closed on an unset oneof", async () => {
    const response = (payload: Parameters<typeof create<typeof ScrapeRecipeResponseSchema>>[1]) => async () =>
      new Response(toBinary(ScrapeRecipeResponseSchema, create(ScrapeRecipeResponseSchema, payload)), { headers: { "Content-Type": "application/proto" } });
    await expect(scrapeRecipe("https://example.com", "token", "h", "https://pinterest.com/u/b", response({
      result: { case: "board", value: { recipes: [], totalFound: 0 } },
    }))).resolves.toEqual({ type: "board", recipes: [], total_found: 0 });
    await expect(scrapeRecipe("https://example.com", "token", "h", "https://recipe.example", response({}))).rejects.toThrow("invalid scrape response");
  });
});
