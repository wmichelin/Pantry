import { createClient } from "@connectrpc/connect";
import { RecipeService } from "./gen/pantry/v1/recipe_pb";
import { pantryConnectTransport, safeConnectError, stagingAPIOrigin } from "./pantry-api";

const enabled = process.env.EXPO_PUBLIC_PANTRY_API_RECIPE_MANAGEMENT?.trim() === "enabled";
export function stagingRecipeManagementAPIOrigin(): string | null { return enabled ? stagingAPIOrigin() : null; }

export function recipeAPI(apiURL: string, token: string, fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = (input, init) => fetch(input, init)) {
  const client = createClient(RecipeService, pantryConnectTransport(apiURL, token, fetcher));
  return {
    async list(householdID: string) {
      try {
        return (await client.listRecipes({ householdId: householdID })).recipes.map(r => ({ id: r.id, title: r.title, tags: r.tags?.values ?? null, source_url: r.sourceUrl ?? null }));
      } catch (error) { throw safeConnectError(error, "Pantry could not load recipes right now."); }
    },
    async get(recipeID: string) {
      try {
        const response = await client.getRecipe({ recipeId: recipeID });
        const r = response.recipe;
        if (!r) throw new Error("Recipe not found.");
        return { recipe: {
          id: r.id, title: r.title, household_id: r.householdId, created_at: r.createdAt,
          source_type: r.sourceType, source_url: r.sourceUrl ?? null, image_url: r.imageUrl ?? null,
          servings: r.servings ?? null, prep_time_minutes: r.prepTimeMinutes ?? null,
          cook_time_minutes: r.cookTimeMinutes ?? null, instructions: r.instructions?.values ?? null, tags: r.tags?.values ?? null,
        }, ingredients: response.ingredients.map(i => ({ id: i.id, name: i.name, quantity: i.quantity ?? null, unit: i.unit ?? null })) };
      } catch (error) { throw safeConnectError(error, "Pantry could not load the recipe right now."); }
    },
    async searchIngredients(householdID: string, query: string) {
      try { return (await client.searchRecipeIngredients({ householdId: householdID, query })).recipeIds; }
      catch (error) { throw safeConnectError(error, "Pantry could not search ingredients right now."); }
    },
    async updateTags(recipeID: string, tags: string[]) {
      try { await client.updateRecipeTags({ recipeId: recipeID, tags }); }
      catch (error) { throw safeConnectError(error, "Pantry could not save tags right now."); }
    },
    async delete(recipeID: string) {
      try { await client.deleteRecipe({ recipeId: recipeID }); }
      catch (error) { throw safeConnectError(error, "Pantry could not delete the recipe right now."); }
    },
  };
}
