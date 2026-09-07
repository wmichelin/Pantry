import assert from 'node:assert/strict';
import { publicKey, identity, rpc, rest } from './verify-staging-recipe-import.mjs';

const key = await publicKey();
const owner = await identity(key, 'queue-owner');
const member = await identity(key, 'queue-member');
const outsider = await identity(key, 'queue-outsider');
const household = await rpc(owner.token, 'HouseholdService/CreateHousehold', { name: 'Go Queue Acceptance' });
const other = await rpc(owner.token, 'HouseholdService/CreateHousehold', { name: 'Go Queue Other Household' });
assert.equal(household.status, 200); assert.equal(other.status, 200);
const h = household.body.household.id, otherID = other.body.household.id;
assert.equal((await rpc(member.token, 'HouseholdService/JoinHousehold', { inviteCode: household.body.household.inviteCode })).status, 200);
async function recipe(householdId, title) {
  const result = await rpc(owner.token, 'RecipeService/ImportRecipe', { householdId, title, metadata: { sourceType: 'url' } });
  assert.equal(result.status, 200); return result.body.recipe.id;
}
const old = await recipe(h, 'Older queue recipe'), next = await recipe(h, 'Newer queue recipe'), foreign = await recipe(otherID, 'Foreign recipe');
const [baseline] = await rest(key, owner.token, 'week_queues', 'POST', { household_id: h, recipe_id: old, added_by: owner.id });
const duplicate = await rpc(member.token, 'QueueService/AddQueueRecipe', { householdId: h, recipeId: old });
assert.equal(duplicate.status, 200); assert.equal(duplicate.body.entry.id, baseline.id);
assert.equal((await rpc(member.token, 'QueueService/AddQueueRecipe', { householdId: h, recipeId: next })).status, 200);
const listed = await rpc(member.token, 'QueueService/ListQueue', { householdId: h });
assert.equal(listed.status, 200);
const direct = await rest(key, owner.token, `week_queues?select=id,recipe_id,recipes(title)&household_id=eq.${h}&order=created_at.asc`);
assert.deepEqual(listed.body.entries.map(e => ({ id: e.id, recipe_id: e.recipeId, recipes: { title: e.recipeTitle } })), direct);
const exact = await rpc(member.token, 'QueueService/ListQueue', { householdId: h, recipeId: next });
assert.equal(exact.status, 200); assert.deepEqual(exact.body.entries.map(e => e.recipeId), [next]);
assert((await rpc(owner.token, 'QueueService/AddQueueRecipe', { householdId: h, recipeId: foreign })).status >= 400, 'Cross-household link accepted');
assert((await rpc(outsider.token, 'QueueService/AddQueueRecipe', { householdId: h, recipeId: old })).status >= 400);
assert((await rpc(outsider.token, 'QueueService/ClearQueueAndChecks', { householdId: h })).status >= 400);
const hidden = await rpc(outsider.token, 'QueueService/ListQueue', { householdId: h });
assert.equal(hidden.status, 200); assert.deepEqual(hidden.body.entries ?? [], []);
// Remove is desired-state/idempotent, including zero visible rows, but may never
// remove another household's row.
assert.equal((await rpc(outsider.token, 'QueueService/RemoveQueueRecipe', { householdId: h, recipeId: old })).status, 200);
assert.equal((await rest(key, owner.token, `week_queues?select=id&household_id=eq.${h}`)).length, 2);
for (let i = 0; i < 2; i++) assert.equal((await rpc(member.token, 'QueueService/RemoveQueueRecipe', { householdId: h, recipeId: old })).status, 200);
assert.equal((await rest(key, owner.token, `week_queues?select=id&household_id=eq.${h}`)).length, 1);
assert.equal((await rpc(owner.token, 'QueueService/AddQueueRecipe', { householdId: otherID, recipeId: foreign })).status, 200);
for (const id of [h, otherID]) {
  await rest(key, owner.token, 'shopping_list_checks', 'POST', { household_id: id, normalized_name: 'queue sentinel' });
  await rest(key, owner.token, 'shopping_list_manual_items', 'POST', { household_id: id, normalized_name: 'queue sentinel' });
}
assert.equal((await rpc('', 'QueueService/ClearQueueAndChecks', { householdId: h })).status, 401);
assert.equal((await rpc(member.token, 'QueueService/ClearQueueAndChecks', { householdId: h })).status, 200);
assert.deepEqual(await rest(key, owner.token, `week_queues?select=id&household_id=eq.${h}`), []);
assert.deepEqual(await rest(key, owner.token, `shopping_list_checks?select=id&household_id=eq.${h}`), []);
assert.equal((await rest(key, owner.token, `shopping_list_manual_items?select=id&household_id=eq.${h}`)).length, 1);
for (const table of ['week_queues', 'shopping_list_checks', 'shopping_list_manual_items']) assert.equal((await rest(key, owner.token, `${table}?select=id&household_id=eq.${otherID}`)).length, 1);
assert.equal((await rest(key, owner.token, `recipes?select=id&household_id=eq.${h}`)).length, 2);
console.log(JSON.stringify({ orderedListParity: true, targetedLookup: true, duplicateAdd: true, repeatedRemove: true, callerIsolation: true, crossHouseholdRejected: true, clearPreservesManuals: true, foreignHouseholdUntouched: true }));
