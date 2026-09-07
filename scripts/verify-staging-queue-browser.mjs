import assert from 'node:assert/strict';
import { publicKey, identity, rpc, rest } from './verify-staging-recipe-import.mjs';
import { stagingBrowser } from './staging-browser.mjs';

const key = await publicKey();
const user = await identity(key, 'queue-browser');
const created = await rpc(user.token, 'HouseholdService/CreateHousehold', { name: 'Queue Browser Proof' });
assert.equal(created.status, 200);
const h = created.body.household.id;
const recipe = await rpc(user.token, 'RecipeService/ImportRecipe', { householdId: h, title: 'Queue Browser Recipe', metadata: { sourceType: 'url' } });
assert.equal(recipe.status, 200);
const id = recipe.body.recipe.id;
await rest(key, user.token, 'shopping_list_checks', 'POST', { household_id: h, normalized_name: 'queue browser check' });
await rest(key, user.token, 'shopping_list_manual_items', 'POST', { household_id: h, normalized_name: 'queue browser manual' });
const browser = await stagingBrowser();
async function waitCall(method, count = 1) {
  for (let i = 0; i < 100; i++) {
    if (browser.responses.filter(r => r.path.endsWith('/' + method) && r.status === 200).length >= count) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Queue browser call missing: ' + method);
}
try {
  await browser.login(user);
  await browser.until("!!document.querySelector('input[placeholder=\"Search by title or ingredient…\"]')");
  await browser.fill('input[placeholder="Search by title or ingredient…"]', 'Queue Browser');
  await browser.until("document.body.innerText.includes('Queue Browser Recipe')");
  await browser.click('○');
  await waitCall('AddQueueRecipe');
  await browser.navigate('/recipe/' + id);
  await browser.until("document.body.innerText.includes('✓ In queue')");
  await browser.click('✓ In queue');
  await waitCall('RemoveQueueRecipe');
  await browser.until("document.body.innerText.includes('+ Add to queue')");
  await browser.click('+ Add to queue');
  await waitCall('AddQueueRecipe', 2);
  await browser.navigate('/week-queue?' + new URLSearchParams({ householdId: h }));
  await browser.until("document.body.innerText.includes('Remove')");
  await browser.click('Remove'); await browser.click('Yes');
  await waitCall('RemoveQueueRecipe', 2);
  assert.deepEqual(await rest(key, user.token, `week_queues?select=id&household_id=eq.${h}`), []);
  await browser.navigate('/recipe/' + id);
  await browser.until("document.body.innerText.includes('+ Add to queue')");
  await browser.click('+ Add to queue'); await waitCall('AddQueueRecipe', 3);
  await browser.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await browser.navigate('/week-queue?' + new URLSearchParams({ householdId: h }));
  await browser.until("document.body.innerText.includes('Clear week')");
  await browser.click('Clear week'); await browser.click('Clear all');
  await waitCall('ClearQueueAndChecks');
  assert.deepEqual(await rest(key, user.token, `week_queues?select=id&household_id=eq.${h}`), []);
  assert.deepEqual(await rest(key, user.token, `shopping_list_checks?select=id&household_id=eq.${h}`), []);
  assert.equal((await rest(key, user.token, `shopping_list_manual_items?select=id&household_id=eq.${h}`)).length, 1);
  assert(!browser.responses.some(r => ['/rest/v1/week_queues', '/rest/v1/shopping_list_checks'].includes(r.path)), 'Direct queue/check data calls remain');
  for (const method of ['ListQueue', 'AddQueueRecipe', 'RemoveQueueRecipe', 'ClearQueueAndChecks']) assert(browser.responses.some(r => r.path.endsWith('/' + method) && r.contentType === 'application/proto' && r.status === 200));
  assert.deepEqual(browser.errors, []);
  console.log(JSON.stringify({ householdAdd: true, detailToggle: true, queueRemove: true, mobileClear: true, manualItemPreserved: true, binaryConnect: true, directQueueCalls: false, uncaughtExceptions: 0 }));
} finally { await browser.close(); }
