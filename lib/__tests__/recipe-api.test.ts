import { expect, it } from "bun:test";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { recipeAPI, stagingRecipeManagementAPIOrigin } from "../recipe-api";
import {
  GetRecipeResponseSchema, ListRecipesResponseSchema, SearchRecipeIngredientsResponseSchema,
  UpdateRecipeTagsRequestSchema, UpdateRecipeTagsResponseSchema, DeleteRecipeResponseSchema,
} from "../gen/pantry/v1/recipe_pb";

it("keeps recipe management off without its staging flag", () => expect(stagingRecipeManagementAPIOrigin()).toBeNull());
it("maps nullable recipe/ingredient values without collapsing zero or empty arrays", async () => {
  const client = recipeAPI("https://example.com", "caller", (async (url, init) => {
    expect(String(url)).toEndWith("/pantry.v1.RecipeService/GetRecipe");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer caller");
    return new Response(toBinary(GetRecipeResponseSchema, create(GetRecipeResponseSchema, {
      recipe: { id: "r", title: "Recipe", householdId: "h", sourceType: "url", sourceUrl: "", servings: 0, instructions: { values: [] } },
      ingredients: [{ id: "i", name: "salt", quantity: 0 }],
    })), { headers: { "Content-Type": "application/proto" } });
  }));
  const loaded = await client.get("r");
  expect(loaded.recipe).toMatchObject({ id: "r", source_url: "", image_url: null, servings: 0, prep_time_minutes: null, instructions: [], tags: null });
  expect(loaded.ingredients).toEqual([{ id: "i", name: "salt", quantity: 0, unit: null }]);
});
it("preserves list ordering and null versus empty tags", async () => {
  const client = recipeAPI("https://example.com", "caller", (async () => new Response(toBinary(ListRecipesResponseSchema, create(ListRecipesResponseSchema, {
    recipes: [{ id: "new", tags: { values: [] } }, { id: "old" }],
  })), { headers: { "Content-Type": "application/proto" } })));
  expect(await client.list("h")).toEqual([{ id: "new", title: "", tags: [], source_url: null }, { id: "old", title: "", tags: null, source_url: null }]);
});
it("sends empty tag replacement and deletion through binary Connect", async () => {
  const paths: string[] = [];
  const client = recipeAPI("https://example.com", "caller", (async (url, init) => {
    paths.push(String(url).split("/").pop()!);
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/proto");
    if (String(url).endsWith("UpdateRecipeTags")) {
      const request = fromBinary(UpdateRecipeTagsRequestSchema, new Uint8Array(await new Response(init?.body).arrayBuffer()));
      expect(request.recipeId).toBe("r"); expect(request.tags).toEqual([]);
      return new Response(toBinary(UpdateRecipeTagsResponseSchema, create(UpdateRecipeTagsResponseSchema)), { headers: { "Content-Type": "application/proto" } });
    }
    return new Response(toBinary(DeleteRecipeResponseSchema, create(DeleteRecipeResponseSchema)), { headers: { "Content-Type": "application/proto" } });
  }));
  await client.updateTags("r", []); await client.delete("r");
  expect(paths).toEqual(["UpdateRecipeTags", "DeleteRecipe"]);
});
it("returns ingredient matches and safe upstream errors", async () => {
  const client = recipeAPI("https://example.com", "caller", (async () => new Response(toBinary(SearchRecipeIngredientsResponseSchema, create(SearchRecipeIngredientsResponseSchema, { recipeIds: ["r"] })), { headers: { "Content-Type": "application/proto" } })));
  expect(await client.searchIngredients("h", "salt")).toEqual(["r"]);
  const failed = recipeAPI("https://example.com", "caller", (async () => new Response("private detail", { status: 503 })));
  await expect(failed.list("h")).rejects.toThrow("Pantry could not load recipes");
  await expect(failed.get("r")).rejects.toThrow("Pantry could not load the recipe");
  await expect(failed.searchIngredients("h", "salt")).rejects.toThrow("Pantry could not search ingredients");
  await expect(failed.updateTags("r", [])).rejects.toThrow("Pantry could not save tags");
  await expect(failed.delete("r")).rejects.toThrow("Pantry could not delete the recipe");
});
