// Staging-only acceptance for the Go import-array parser and fail-closed raw
// persistence contract. Test credentials remain in memory and are never printed.
import assert from 'node:assert/strict';
import { publicKey, identity, origin, rpc, rest } from './verify-staging-recipe-import.mjs';

const normalize = (ingredient) => ({
  name: ingredient.name,
  quantity: ingredient.quantity ?? null,
  unit: ingredient.unit ?? null,
  raw_string: ingredient.rawString ?? ingredient.raw_string,
});

async function verify() {
  const key = await publicKey();
  const owner = await identity(key, 'raw-parser-owner');
  const member = await identity(key, 'raw-parser-member');
  const outsider = await identity(key, 'raw-parser-outsider');
  const created = await rpc(owner.token, 'HouseholdService/CreateHousehold', {
    name: 'Go Raw Parser Acceptance', displayName: 'Owner',
  });
  assert.equal(created.status, 200, 'Parser fixture household creation failed');
  const householdId = created.body.household.id;
  const joined = await rpc(member.token, 'HouseholdService/JoinHousehold', {
    inviteCode: created.body.household.inviteCode, displayName: 'Member',
  });
  assert.equal(joined.status, 200, 'Parser fixture member join failed');

  const raws = [
    'For The Sauce:',
    'Additional Cilantro And Sesame Seeds For Topping',
    '0 cups Water',
    'İ AND SUGAR',
    'salt and pepper\rcumin',
  ];
  const preview = await rpc(owner.token, 'RecipeService/ParseImportIngredients', {
    householdId, rawIngredients: raws,
  });
  assert.equal(preview.status, 200, 'Owner parser preview failed');
  const expected = [
    { name: 'cilantro', quantity: null, unit: null, raw_string: 'Cilantro' },
    { name: 'sesame seeds', quantity: null, unit: null, raw_string: 'Sesame Seeds' },
    { name: 'water', quantity: 0, unit: 'cups', raw_string: '0 cups Water' },
    { name: 'i̇ and sugar', quantity: null, unit: null, raw_string: 'İ AND SUGAR' },
    { name: 'salt and pepper\rcumin', quantity: null, unit: null, raw_string: 'salt and pepper\rcumin' },
  ];
  assert.deepEqual(preview.body.ingredients.map(normalize), expected, 'Hosted Go parser differs from the pinned contract');

  const metadata = {
    sourceUrl: `https://example.invalid/raw-parser-${Date.now()}`,
    sourceType: 'url', imageUrl: '', instructions: ['Second', 'First'],
    tags: ['chosen', 'tag'], servings: 0, prepTimeMinutes: 0, cookTimeMinutes: 8,
  };
  const imported = await rpc(owner.token, 'RecipeService/ImportRawRecipe', {
    householdId, title: 'Raw parser owner recipe', rawIngredients: raws, metadata,
  });
  assert.equal(imported.status, 200, 'Owner raw import failed');
  assert.equal(imported.body.recipe.ingredientCount, expected.length);
  assert.deepEqual(imported.body.ingredients.map(normalize), expected, 'Preview and raw persistence parser results differ');
  const [stored] = await rest(key, owner.token,
    `recipes?select=title,source_url,source_type,image_url,instructions,tags,servings,prep_time_minutes,cook_time_minutes,recipe_ingredients(name,quantity,unit,raw_string)&id=eq.${imported.body.recipe.id}`);
  assert.deepEqual({
    title: stored.title, source_url: stored.source_url, source_type: stored.source_type,
    image_url: stored.image_url, instructions: stored.instructions, tags: stored.tags,
    servings: stored.servings, prep_time_minutes: stored.prep_time_minutes,
    cook_time_minutes: stored.cook_time_minutes,
  }, {
    title: 'Raw parser owner recipe', source_url: metadata.sourceUrl,
    source_type: metadata.sourceType, image_url: '', instructions: metadata.instructions,
    tags: metadata.tags, servings: 0, prep_time_minutes: 0, cook_time_minutes: 8,
  });
  assert.deepEqual(stored.recipe_ingredients.map(normalize).sort((a, b) => a.raw_string.localeCompare(b.raw_string)),
    [...expected].sort((a, b) => a.raw_string.localeCompare(b.raw_string)), 'Persisted parser fields differ');

  const filtered = await rpc(member.token, 'RecipeService/ImportRawRecipe', {
    householdId, title: 'Filtered member recipe', rawIngredients: ['For Sauce:', 'for serving garnish'],
    metadata: { ...metadata, sourceUrl: `${metadata.sourceUrl}-filtered` },
  });
  assert.equal(filtered.status, 200, 'Member filtered-only raw import failed');
  assert.equal(filtered.body.recipe.ingredientCount ?? 0, 0);
  assert.deepEqual(filtered.body.ingredients ?? [], []);

  const longPreview = await rpc(owner.token, 'RecipeService/ParseImportIngredients', {
    householdId, rawIngredients: ['x'.repeat(20 << 10)],
  });
  assert.equal(longPreview.status, 200, 'Preview incorrectly retained the ordinary 16 KiB limit');
  assert.equal(longPreview.body.ingredients[0].rawString.length, 20 << 10);

  const before = await rest(key, owner.token, `recipes?select=id&household_id=eq.${householdId}`);
  assert((await rpc(outsider.token, 'RecipeService/ParseImportIngredients', { householdId, rawIngredients: ['salt'] })).status >= 400,
    'Outsider parser preview was accepted');
  assert((await rpc(outsider.token, 'RecipeService/ImportRawRecipe', {
    householdId, title: 'Outsider', rawIngredients: ['salt'], metadata,
  })).status >= 400, 'Outsider raw import was accepted');
  assert.equal((await rpc('', 'RecipeService/ImportRawRecipe', {
    householdId, title: 'Anonymous', rawIngredients: ['salt'], metadata,
  })).status, 401, 'Anonymous raw import was accepted');
  assert((await rpc(owner.token, 'RecipeService/ParseImportIngredients', {
    householdId, rawIngredients: ['x'.repeat(300 << 10)],
  })).status >= 400, 'Oversized parser preview was accepted');
  assert((await rpc(owner.token, 'RecipeService/ImportRawRecipe', {
    householdId, title: 'Oversized', rawIngredients: ['x'.repeat(300 << 10)], metadata,
  })).status >= 400, 'Oversized raw import was accepted');
  assert.deepEqual(await rest(key, owner.token, `recipes?select=id&household_id=eq.${householdId}`), before,
    'Rejected parser/raw requests changed recipe data');

  console.log(JSON.stringify({
    origin, previewPersistenceParity: true, exactHouseholdScope: true,
    memberFilteredImport: true, nullZeroRawOrder: true, longPreview: true,
    outsiderDenied: true, anonymousDenied: true, oversizedDenied: true,
  }));
}

await verify();
