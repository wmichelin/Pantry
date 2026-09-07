import assert from 'node:assert/strict';
import { publicKey, identity, rpc, rest } from './verify-staging-recipe-import.mjs';

const key = await publicKey();
const owner = await identity(key, 'shopping-owner');
const member = await identity(key, 'shopping-member');
const outsider = await identity(key, 'shopping-outsider');
async function household(name) {
  const result = await rpc(owner.token, 'HouseholdService/CreateHousehold', { name });
  assert.equal(result.status, 200); return result.body.household;
}
const h = await household('Go Shopping Checks Acceptance'), other = await household('Go Shopping Checks Other');
assert.equal((await rpc(member.token, 'HouseholdService/JoinHousehold', { inviteCode: h.inviteCode })).status, 200);
async function recipe(householdId) {
  const result = await rpc(owner.token, 'RecipeService/ImportRecipe', { householdId, title: 'Shopping check recipe', metadata: { sourceType: 'url' }, ingredients: [
    { name: ' Milk ', quantity: 0, unit: '' }, { name: 'ΟΣ' }, { name: 'İ' }, { name: '\u00a0Rice\ufeff' }, { name: 'green  onion' }, { name: 'For the salad:' },
  ] });
  assert.equal(result.status, 200); return result.body.recipe.id;
}
const r = await recipe(h.id), otherRecipe = await recipe(other.id);
for (const [id, recipeId] of [[h.id, r], [other.id, otherRecipe]]) {
  assert.equal((await rpc(owner.token, 'QueueService/AddQueueRecipe', { householdId: id, recipeId })).status, 200);
  await rest(key, owner.token, 'shopping_list_manual_items', 'POST', [{ household_id: id, normalized_name: 'milk' }, { household_id: id, normalized_name: 'tea' }]);
  await rest(key, owner.token, 'ingredient_metadata', 'POST', { household_id: id, normalized_name: 'milk', display_name: 'Custom Milk', sort_order: 10 });
}
async function checks(id = h.id) {
  return rest(key, owner.token, `shopping_list_checks?select=id,normalized_name&household_id=eq.${id}&order=normalized_name`);
}
async function set(normalizedName, standaloneManual, checked, token = member.token, householdId = h.id) {
  return rpc(token, 'ShoppingService/SetShoppingItemChecked', { householdId, normalizedName, standaloneManual, checked });
}
async function state(id) {
  const tables = ['week_queues', 'shopping_list_checks', 'shopping_list_manual_items', 'recipes', 'ingredient_metadata'];
  return Object.fromEntries(await Promise.all(tables.map(async table => [table, await rest(key, owner.token, `${table}?select=*&household_id=eq.${id}&order=id`)])));
}
assert.equal((await set('other sentinel', false, true, owner.token, other.id)).status, 200);
const otherBefore = await state(other.id);
// Direct-Supabase baseline check versus Go desired-state recheck preserves UUID.
const [direct] = await rest(key, owner.token, 'shopping_list_checks', 'POST', { household_id: h.id, normalized_name: 'milk' });
for (let i = 0; i < 2; i++) assert.equal((await set('milk', false, true)).status, 200);
assert.equal((await checks()).find(c => c.normalized_name === 'milk').id, direct.id);
assert.equal((await set('milk', true, true)).status, 200);
assert.deepEqual((await checks()).map(c => c.normalized_name), ['milk', 'milk::manual']);
for (let i = 0; i < 2; i++) assert.equal((await set('milk', true, false)).status, 200);
assert.deepEqual((await checks()).map(c => c.normalized_name), ['milk']);
await set('tea', false, true);
for (let i = 0; i < 2; i++) assert.equal((await set('tea', true, false)).status, 200);
assert.deepEqual((await checks()).map(c => c.normalized_name), ['milk']);
for (const raw of ['ΟΣ', 'İ', '\u00a0Rice\ufeff', 'green  onion']) {
  const name = raw.toLowerCase().trim();
  assert.equal((await set(name, false, true)).status, 200);
  assert.equal((await set(name, true, false)).status, 200);
  assert((await checks()).some(c => c.normalized_name === name), 'Unicode recipe check removed');
}
await set('for the salad:', false, true);
await set('for the salad:', true, false);
assert(!(await checks()).some(c => c.normalized_name === 'for the salad:'), 'Section header prevented legacy uncheck');
const beforeDenied = await state(h.id);
for (const token of ['', outsider.token]) {
  assert((await set('unauthorized', false, true, token)).status >= 400);
  assert((await set('milk', false, false, token)).status >= 400);
  for (const method of ['ClearShoppingChecks', 'ClearShoppingWeek']) assert((await rpc(token, 'ShoppingService/' + method, { householdId: h.id })).status >= 400);
  assert.deepEqual(await state(h.id), beforeDenied);
}
assert((await set('', false, true)).status >= 400);
assert((await set('x'.repeat(20 * 1024), false, true)).status >= 400);
assert.deepEqual(await state(h.id), beforeDenied);
assert.equal((await rpc(member.token, 'ShoppingService/ClearShoppingChecks', { householdId: h.id })).status, 200);
const afterChecks = await state(h.id);
assert.deepEqual(afterChecks, { ...beforeDenied, shopping_list_checks: [] });
await set('milk', false, true);
for (let i = 0; i < 2; i++) assert.equal((await rpc(member.token, 'ShoppingService/ClearShoppingWeek', { householdId: h.id })).status, 200);
assert.deepEqual(await state(h.id), { ...afterChecks, week_queues: [], shopping_list_checks: [], shopping_list_manual_items: [] });
assert.deepEqual(await state(other.id), otherBefore);
assert.equal((await rest(key, owner.token, `recipe_ingredients?select=id&recipe_id=eq.${r}`)).length, 6);
console.log(JSON.stringify({ checkIdentityParity: true, separateManualCheck: true, legacyUncheck: true, unicodeKeys: true, repeatSafe: true, callerIsolation: true, clearChecksPreservesList: true, clearWeekScope: true, foreignHouseholdUntouched: true }));
