import assert from 'node:assert/strict';
import { publicKey, identity, rpc, rest } from './verify-staging-recipe-import.mjs';

const key = await publicKey();
const owner = await identity(key, 'management-owner');
const member = await identity(key, 'management-member');
const outsider = await identity(key, 'management-outsider');
const created = await rpc(owner.token, 'HouseholdService/CreateHousehold', { name: 'Go Recipe Management Acceptance' });
assert.equal(created.status, 200);
const household = created.body.household.id;
assert.equal((await rpc(member.token, 'HouseholdService/JoinHousehold', { inviteCode: created.body.household.inviteCode })).status, 200);
const saved = await rpc(owner.token, 'RecipeService/ImportRecipe', {
  householdId: household, title: 'Management fixture', metadata: { sourceUrl: '', sourceType: 'url', tags: ['b', 'a'], instructions: ['step'], servings: 0 },
  ingredients: [{ name: 'salt', rawString: 'salt' }, { name: 'water', quantity: 0, unit: '', rawString: 'water' }],
});
assert.equal(saved.status, 200);
const recipeID = saved.body.recipe.id;
const extra = await rpc(owner.token, 'RecipeService/ImportRecipe', { householdId: household, title: 'Newest fixture', metadata: { sourceType: 'url' } });
assert.equal(extra.status, 200);
const second = await rpc(owner.token, 'HouseholdService/CreateHousehold', { name: 'Go Recipe Management Second Household' });
assert.equal(second.status, 200);
const sibling = await rpc(owner.token, 'RecipeService/ImportRecipe', { householdId: second.body.household.id, title: 'Other household recipe', metadata: { sourceType: 'url' }, ingredients: [{ name: 'salt' }] });
assert.equal(sibling.status, 200);
const [legacy] = await rest(key, owner.token, `recipes?select=id,title,household_id,created_at,source_type,source_url,image_url,servings,prep_time_minutes,cook_time_minutes,instructions,tags,recipe_ingredients(id,name,quantity,unit)&id=eq.${recipeID}`);
const detail = await rpc(member.token, 'RecipeService/GetRecipe', { recipeId: recipeID });
assert.equal(detail.status, 200);
const got = detail.body.recipe;
const projection = {
  id: got.id, title: got.title, household_id: got.householdId, created_at: got.createdAt,
  source_type: got.sourceType, source_url: got.sourceUrl ?? null, image_url: got.imageUrl ?? null,
  servings: got.servings ?? null, prep_time_minutes: got.prepTimeMinutes ?? null, cook_time_minutes: got.cookTimeMinutes ?? null,
  instructions: got.instructions ? got.instructions.values ?? [] : null, tags: got.tags ? got.tags.values ?? [] : null,
  recipe_ingredients: detail.body.ingredients.map(i => ({ id: i.id, name: i.name, quantity: i.quantity ?? null, unit: i.unit ?? null })),
};
projection.recipe_ingredients.sort((a, b) => a.id.localeCompare(b.id));
legacy.recipe_ingredients.sort((a, b) => a.id.localeCompare(b.id));
assert.deepEqual(projection, legacy, 'Recipe detail differs from legacy');
const listed = await rpc(owner.token, 'RecipeService/ListRecipes', { householdId: household });
assert.equal(listed.status, 200);
const directList = await rest(key, owner.token, `recipes?select=id,title,tags,source_url&household_id=eq.${household}&order=created_at.desc`);
assert.deepEqual(listed.body.recipes.map(r => ({ id: r.id, title: r.title, tags: r.tags ? r.tags.values ?? [] : null, source_url: r.sourceUrl ?? null })), directList);
const searched = await rpc(owner.token, 'RecipeService/SearchRecipeIngredients', { householdId: household, query: 'SALT' });
assert.equal(searched.status, 200); assert.deepEqual(searched.body.recipeIds, [recipeID]);
assert.equal((await rpc(member.token, 'RecipeService/UpdateRecipeTags', { recipeId: recipeID, tags: [] })).status, 200);
const [updated] = await rest(key, owner.token, `recipes?select=tags&id=eq.${recipeID}`); assert.deepEqual(updated.tags, []);
for (const method of ['GetRecipe', 'UpdateRecipeTags', 'DeleteRecipe']) {
  assert.equal((await rpc(outsider.token, 'RecipeService/' + method, { recipeId: recipeID, ...(method === 'UpdateRecipeTags' ? { tags: ['forged'] } : {}) })).status, 404, 'Outsider operation did not fail closed');
}
const hidden = await rpc(outsider.token, 'RecipeService/ListRecipes', { householdId: household });
assert.equal(hidden.status, 200); assert.deepEqual(hidden.body.recipes ?? [], []);
assert.equal((await rpc('', 'RecipeService/DeleteRecipe', { recipeId: recipeID })).status, 401);
const [queue] = await rest(key, owner.token, 'week_queues', 'POST', { household_id: household, recipe_id: recipeID, added_by: owner.id });
const unrelated = {};
for (const table of ['ingredient_metadata', 'shopping_list_checks', 'shopping_list_manual_items']) {
  unrelated[table] = await rest(key, owner.token, table, 'POST', { household_id: household, normalized_name: 'salt' });
}
assert.equal((await rpc(member.token, 'RecipeService/DeleteRecipe', { recipeId: recipeID })).status, 200);
assert.deepEqual(await rest(key, owner.token, `recipes?select=id&id=eq.${recipeID}`), []);
assert.deepEqual(await rest(key, owner.token, `recipe_ingredients?select=id&recipe_id=eq.${recipeID}`), []);
assert.deepEqual(await rest(key, owner.token, `week_queues?select=id&id=eq.${queue.id}`), []);
assert.equal((await rpc(owner.token, 'RecipeService/GetRecipe', { recipeId: recipeID })).status, 404);
for (const [table, rows] of Object.entries(unrelated)) {
  assert.deepEqual(await rest(key, owner.token, `${table}?select=*&household_id=eq.${household}`), rows, 'Delete touched unrelated shopping/catalog data');
}
assert.equal((await rpc(owner.token, 'RecipeService/GetRecipe', { recipeId: extra.body.recipe.id })).status, 200);
assert.equal((await rpc(owner.token, 'RecipeService/GetRecipe', { recipeId: sibling.body.recipe.id })).status, 200);
assert.equal((await rpc(member.token, 'RecipeService/GetRecipe', { recipeId: sibling.body.recipe.id })).status, 404);
console.log(JSON.stringify({ recipeDetailParity: true, listOrderParity: true, ingredientSearch: true, memberTagClear: true, outsiderDenied: true, anonymousDenied: true, atomicDeleteCascades: true, unrelatedDataPreserved: true, twoHouseholdScope: true }));
