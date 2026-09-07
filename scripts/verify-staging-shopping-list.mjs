import assert from 'node:assert/strict';
import { publicKey, identity, rpc, rest } from './verify-staging-recipe-import.mjs';
import { legacyShopping } from './shopping-legacy-reference.mjs';

const key = await publicKey();
const owner = await identity(key, 'shopping-list-owner');
const member = await identity(key, 'shopping-list-member');
const outsider = await identity(key, 'shopping-list-outsider');
async function call(method, body, token = owner.token) { return rpc(token, 'ShoppingService/' + method, body); }
async function success(method, body, token = owner.token) { const result = await call(method, body, token); assert.equal(result.status, 200, method + ' status'); return result.body.list; }
async function household(name) { const r = await rpc(owner.token, 'HouseholdService/CreateHousehold', { name }); assert.equal(r.status, 200); return r.body.household; }
const h = await household('Go Shopping List Acceptance'), other = await household('Go Shopping List Other');
assert.equal((await rpc(member.token, 'HouseholdService/JoinHousehold', { inviteCode: h.inviteCode })).status, 200);
async function snapshot(id = h.id) { return rest(key, owner.token, 'rpc/shopping_snapshot', 'POST', { p_household_id: id }); }
function normalized(items = []) {
  return items.map(i => ({ list_key: i.listKey, normalized_name: i.normalizedName ?? '', display_name: i.displayName ?? '', metadata_id: i.metadataId ?? '', sort_order: i.sortOrder ?? null, category: i.category ?? '', occurrences: (i.occurrences ?? []).map(o => ({ recipe_title: o.recipeTitle ?? '', quantity: o.quantity ?? null, unit: o.unit ?? null })), checked: i.checked ?? false, is_manual: i.isManual ?? false, manual_item_id: i.manualItemId ?? '' }));
}
async function parity(token = member.token) {
  const list = await success('GetShoppingList', { householdId: h.id }, token);
  const snap = await snapshot();
  assert.deepEqual(normalized(list.items), legacyShopping(snap));
  assert.equal(list.revision, snap.revision);
  return list;
}
const empty = await success('GetShoppingList', { householdId: h.id });
assert.deepEqual(empty.items ?? [], []); assert.equal(empty.aisles.length, 17);
await rest(key, owner.token, 'household_aisles', 'POST', { household_id: other.id, key: 'custom', label: 'My Store', sort_order: 1 });
assert.equal((await success('GetShoppingList', { householdId: other.id })).aisles.length, 1);
const ingredients = [{ name: ' Milk ', quantity: 0, unit: '' }, { name: 'milk' }, { name: 'rice', quantity: 0.5, unit: 'cups' }, { name: 'For sauce:' }, { name: 'ΟΣ' }, { name: 'İ' }, { name: '\u00a0éclair\ufeff' }, { name: 'green  onion' }];
const imported = await rpc(owner.token, 'RecipeService/ImportRecipe', { householdId: h.id, title: 'Added', metadata: { sourceType: 'url' }, ingredients });
assert.equal(imported.status, 200); const recipe = imported.body.recipe.id;
assert.equal((await rpc(owner.token, 'QueueService/AddQueueRecipe', { householdId: h.id, recipeId: recipe })).status, 200);
await rest(key, owner.token, 'ingredient_metadata', 'POST', [{ household_id: h.id, normalized_name: 'milk', display_name: 'Custom Milk', sort_order: 10, category: 'custom' }, { household_id: h.id, normalized_name: 'rice', display_name: '', sort_order: 20, category: 'other' }]);
await rest(key, owner.token, 'shopping_list_manual_items', 'POST', [{ household_id: h.id, normalized_name: 'milk', sort_order: 15 }, { household_id: h.id, normalized_name: 'rice', quantity: 0, unit: 'cups', sort_order: 25 }, { household_id: h.id, normalized_name: 'tea', quantity: 0, unit: '  ' }]);
await rest(key, owner.token, 'shopping_list_checks', 'POST', [{ household_id: h.id, normalized_name: 'milk' }, { household_id: h.id, normalized_name: 'milk::manual' }, { household_id: h.id, normalized_name: 'tea' }]);
let list = await parity(); assert.equal(list.catalog.find(m => m.normalizedName === 'milk').displayName, 'Custom Milk');
assert.deepEqual(await parity(), list, 'first/repeated seeded loads differ');
const manual = (await snapshot()).manuals.find(m => m.normalized_name === 'rice');
list = await success('AddShoppingManualItem', { householdId: h.id, name: 'RICE' }, member.token);
const readded = (await snapshot()).manuals.find(m => m.normalized_name === 'rice');
assert.equal(readded.id, manual.id); assert.equal(readded.quantity, 0); assert.equal(readded.unit, 'cups');
list = await success('AddShoppingManualItem', { householdId: h.id, name: ' 2 cups Flour ' });
const literal = list.items.find(i => i.normalizedName === '2 cups flour'); assert(literal?.isManual); assert(literal.metadataId);
await parity();
const otherManual = await success('AddShoppingManualItem', { householdId: other.id, name: 'other sentinel' });
const foreignID = otherManual.items[0].manualItemId; const otherBefore = await snapshot(other.id);
const beforeDenied = await snapshot();
for (const token of ['', outsider.token]) for (const [method, body] of [
  ['GetShoppingList', {}], ['AddShoppingManualItem', { name: 'outsider' }], ['RemoveShoppingManualItem', { manualItemId: manual.id }], ['SaveShoppingOrder', { revision: list.revision, rows: [] }],
]) assert((await call(method, { householdId: h.id, ...body }, token)).status >= 400);
assert((await call('RemoveShoppingManualItem', { householdId: h.id, manualItemId: foreignID })).status >= 400);
for (const name of ['', 'For sauce:', 'x'.repeat(20 * 1024)]) assert((await call('AddShoppingManualItem', { householdId: h.id, name })).status >= 400);
for (const rows of [[], [list.items[0], list.items[0]], list.items.map((i, n) => ({ listKey: n === 0 ? 'foreign' : i.listKey, category: i.category }))]) assert((await call('SaveShoppingOrder', { householdId: h.id, revision: list.revision, rows })).status >= 400);
assert.deepEqual(await snapshot(), beforeDenied);
// Reverse complete list with shared metadata: recipe owns metadata position;
// separate manual owns its own position; last same-name category wins.
const rows = [...list.items].reverse().map((i, n) => ({ listKey: i.listKey, category: n % 2 ? 'dairy' : 'other' }));
const oldRevision = list.revision;
list = await success('SaveShoppingOrder', { householdId: h.id, revision: oldRevision, rows }, member.token);
assert.equal(list.items.find(i => i.listKey === 'recipe:milk').displayName, 'Custom Milk');
assert.deepEqual(list.items.map(i => i.listKey), rows.map(i => i.listKey));
const sameName = list.items.filter(i => i.normalizedName === 'milk'); assert.equal(sameName[0].category, sameName[1].category);
assert((await call('SaveShoppingOrder', { householdId: h.id, revision: oldRevision, rows })).status >= 400);
await parity();
list = await success('RemoveShoppingManualItem', { householdId: h.id, manualItemId: manual.id });
const rice = list.items.find(i => i.listKey === 'recipe:rice'); assert.equal(rice.occurrences.length, 1); assert.equal(rice.occurrences[0].recipeTitle, 'Added'); assert(!rice.isManual);
await success('RemoveShoppingManualItem', { householdId: h.id, manualItemId: manual.id });
await parity(); assert.deepEqual(await snapshot(other.id), otherBefore);
// >1000 row snapshot and >16KiB reorder: no PostgREST truncation or global cap.
const large = Array.from({ length: 1001 }, (_, n) => ({ household_id: h.id, normalized_name: 'bulk ' + n, sort_order: 1000 + n }));
await rest(key, owner.token, 'shopping_list_manual_items', 'POST', large);
list = await parity(); assert(list.items.length > 1000); assert(list.catalog.length > 1000);
const largeRows = [...list.items].reverse().map(i => ({ listKey: i.listKey, category: 'other' }));
assert(JSON.stringify(largeRows).length > 16384);
list = await success('SaveShoppingOrder', { householdId: h.id, revision: list.revision, rows: largeRows });
assert.equal(list.items.length, largeRows.length); await parity();
// Remove only generated bulk fixtures to keep staging acceptance households small.
await rest(key, owner.token, `shopping_list_manual_items?household_id=eq.${h.id}&normalized_name=like.bulk%20*`, 'DELETE');
await rest(key, owner.token, `ingredient_metadata?household_id=eq.${h.id}&normalized_name=like.bulk%20*`, 'DELETE');
console.log(JSON.stringify({ independentLegacyParity: true, unicodeNullZeroAndUnitParity: true, catalogAndCustomAislesPreserved: true, literalManualIdentity: true, repeatAddRemove: true, addedTitlePreserved: true, completeReorder: true, duplicateMetadataResolved: true, staleAndForeignRejected: true, callerIsolation: true, rowsBeyondRESTCap: true, largeOrder: true }));
