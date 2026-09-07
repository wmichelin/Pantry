import assert from 'node:assert/strict';
import { publicKey, identity, rpc, rest } from './verify-staging-recipe-import.mjs';
import { stagingBrowser } from './staging-browser.mjs';

const key = await publicKey();
const user = await identity(key, 'shopping-checks-browser');
const created = await rpc(user.token, 'HouseholdService/CreateHousehold', { name: 'Shopping Checks Browser Proof' });
assert.equal(created.status, 200);
const h = created.body.household.id;
const recipe = await rpc(user.token, 'RecipeService/ImportRecipe', { householdId: h, title: 'Shopping Checks Browser Recipe', metadata: { sourceType: 'url' }, ingredients: [{ name: 'milk', quantity: 0, unit: '' }] });
assert.equal(recipe.status, 200);
const id = recipe.body.recipe.id;
assert.equal((await rpc(user.token, 'QueueService/AddQueueRecipe', { householdId: h, recipeId: id })).status, 200);
await rest(key, user.token, 'ingredient_metadata', 'POST', [
  { household_id: h, normalized_name: 'milk', display_name: 'Milk', sort_order: 10 },
  { household_id: h, normalized_name: 'tea', display_name: 'Tea', sort_order: 30 },
]);
await rest(key, user.token, 'shopping_list_manual_items', 'POST', [
  { household_id: h, normalized_name: 'milk', sort_order: 20 },
  { household_id: h, normalized_name: 'tea', sort_order: 30 },
]);
await rest(key, user.token, 'shopping_list_checks', 'POST', [
  { household_id: h, normalized_name: 'milk' },
  { household_id: h, normalized_name: 'milk::manual' },
  { household_id: h, normalized_name: 'tea' },
]);
const browser = await stagingBrowser();
const path = '/shopping-list?' + new URLSearchParams({ householdId: h });
const milk = "[...document.querySelectorAll('[role=checkbox][aria-label=Milk]')]";
const tea = "document.querySelector('[role=checkbox][aria-label=Tea]')";
async function checks() { return rest(key, user.token, `shopping_list_checks?select=normalized_name&household_id=eq.${h}&order=normalized_name`); }
async function waitCall(method, count = 1) {
  for (let i = 0; i < 100; i++) {
    if (browser.responses.filter(r => r.path.endsWith('/' + method) && r.status === 200).length >= count) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Shopping browser call missing: ' + method);
}
async function loaded() { await browser.until(`${milk}.length===2 && !!${tea}`); }
async function failNext(method) {
  await browser.evaluate(`(() => {
    const original=window.fetch; window.__shoppingFailures=0;
    window.fetch=async (...args)=>{if(String(args[0]).endsWith('/${method}')){window.fetch=original;window.__shoppingFailures++;return new Response('{}',{status:503,headers:{'Content-Type':'application/json'}});}return original(...args);};
  })()`);
}
try {
  await browser.login(user);
  await browser.navigate(path); await loaded();
  assert.equal(await browser.evaluate(`${milk}[0].getAttribute('aria-checked')`), 'true');
  assert.equal(await browser.evaluate(`${milk}[1].getAttribute('aria-checked')`), 'true');
  await browser.evaluate(`${milk}[1].click()`); await waitCall('SetShoppingItemChecked');
  await browser.evaluate(`${tea}.click()`); await waitCall('SetShoppingItemChecked', 2);
  assert.deepEqual(await checks(), [{ normalized_name: 'milk' }]);
  await browser.navigate(path); await loaded();
  assert.equal(await browser.evaluate(`${milk}[0].getAttribute('aria-checked')`), 'true');
  assert.equal(await browser.evaluate(`${milk}[1].getAttribute('aria-checked')`), 'false');
  assert.equal(await browser.evaluate(`${tea}.getAttribute('aria-checked')`), 'false');
  // Network failures must restore optimistic state, not issue legacy writes.
  await failNext('SetShoppingItemChecked');
  await browser.evaluate(`${milk}[0].click()`);
  await browser.until(`window.__shoppingFailures===1 && ${milk}[0].getAttribute('aria-checked')==='true'`);
  assert.deepEqual(await checks(), [{ normalized_name: 'milk' }]);
  await failNext('ClearShoppingChecks'); await browser.click('Clear checks');
  await browser.until(`window.__shoppingFailures===1 && ${milk}[0].getAttribute('aria-checked')==='true'`);
  assert.deepEqual(await checks(), [{ normalized_name: 'milk' }]);
  await browser.click('Clear checks'); await waitCall('ClearShoppingChecks');
  assert.deepEqual(await checks(), []);
  assert.equal((await rest(key, user.token, `week_queues?select=id&household_id=eq.${h}`)).length, 1);
  assert.equal((await rest(key, user.token, `shopping_list_manual_items?select=id&household_id=eq.${h}`)).length, 2);
  await browser.evaluate(`${milk}[0].click()`); await waitCall('SetShoppingItemChecked', 3);
  // Confirm cancellation sends nothing, then exercise failure and success mobile-width.
  await browser.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await browser.navigate(path); await loaded();
  await browser.click('Clear week'); await browser.click('Cancel');
  assert(!browser.responses.some(r => r.path.endsWith('/ClearShoppingWeek')));
  await failNext('ClearShoppingWeek');
  await browser.click('Clear week'); await browser.click('Clear all');
  await browser.until("window.__shoppingFailures===1 && [...document.querySelectorAll('[tabindex=\"0\"]')].some(e=>e.innerText.trim()==='Clear all')");
  assert.equal((await rest(key, user.token, `week_queues?select=id&household_id=eq.${h}`)).length, 1);
  assert.equal((await rest(key, user.token, `shopping_list_manual_items?select=id&household_id=eq.${h}`)).length, 2);
  assert.deepEqual(await checks(), [{ normalized_name: 'milk' }]);
  await browser.click('Clear all'); await waitCall('ClearShoppingWeek');
  await browser.until("document.body.innerText.includes('No items yet.')");
  for (const table of ['week_queues', 'shopping_list_checks', 'shopping_list_manual_items']) assert.deepEqual(await rest(key, user.token, `${table}?select=id&household_id=eq.${h}`), []);
  assert.equal((await rest(key, user.token, `recipes?select=id&household_id=eq.${h}`)).length, 1);
  assert.equal((await rest(key, user.token, `ingredient_metadata?select=id&household_id=eq.${h}`)).length, 2);
  const targetTables = ['/rest/v1/week_queues', '/rest/v1/shopping_list_checks', '/rest/v1/shopping_list_manual_items'];
  // Legacy reads remain in this scoped slice. CORS OPTIONS preflights and HEAD
  // requests are not writes; report only real mutation verbs.
  const directWrites = browser.responses.filter(r => targetTables.includes(r.path) && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method));
  assert.deepEqual(directWrites, [], 'Direct check/clear write remains');
  for (const method of ['SetShoppingItemChecked', 'ClearShoppingChecks', 'ClearShoppingWeek']) assert(browser.responses.some(r => r.path.endsWith('/' + method) && r.contentType === 'application/proto' && r.status === 200));
  assert.deepEqual(browser.errors, []);
  console.log(JSON.stringify({ separateChecksPersist: true, legacyUncheckPersists: true, optimisticFailureRecovery: true, cancellationSafe: true, mobileClear: true, failedClearPreservesList: true, recipesCatalogPreserved: true, binaryConnect: true, directCheckClearWrites: false, legacyReadMethods: [...new Set(browser.responses.filter(r => targetTables.includes(r.path)).map(r => r.method))], uncaughtExceptions: 0 }));
} finally { await browser.close(); }
