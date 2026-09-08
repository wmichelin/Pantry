// Staging-only live dependency diagnostic. It creates an isolated household,
// does not persist any scraped preview, and prints no credentials or URLs.
import { identity, publicKey, rpc } from './verify-staging-recipe-import.mjs';

const key = await publicKey();
const user = await identity(key, 'scrape-diagnostic');
const created = await rpc(user.token, 'HouseholdService/CreateHousehold', { name: 'Recipe Scrape Diagnostic' });
const cases = [
  ['website', 'https://example.com'],
  ['pin', process.env.PANTRY_STAGING_PIN_URL ?? 'https://www.pinterest.com/pin/311522499209575573/'],
  ['board', process.env.PANTRY_STAGING_BOARD_URL ?? 'https://www.pinterest.com/allrecipes/recipes/'],
];

for (const [name, url] of cases) {
  const result = await rpc(user.token, 'RecipeScrapeService/ScrapeRecipe', {
    householdId: created.body.household.id,
    url,
  });
  console.log(JSON.stringify({
    name,
    status: result.status,
    result: result.body.recipe ? 'recipe' : result.body.board ? 'board' : 'error',
    recipeCount: result.body.board?.recipes?.length ?? (result.body.recipe ? 1 : 0),
    code: result.body.code ?? null,
  }));
}
