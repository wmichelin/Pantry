import assert from 'node:assert/strict';
import { publicKey, identity, rpc, rest } from './verify-staging-recipe-import.mjs';
import { stagingBrowser } from './staging-browser.mjs';

const key = await publicKey(), user = await identity(key, 'shopping-list-browser');
const created = await rpc(user.token, 'HouseholdService/CreateHousehold', { name: 'Shopping List Browser Proof' });
assert.equal(created.status, 200); const h = created.body.household.id;
const recipe = await rpc(user.token, 'RecipeService/ImportRecipe', { householdId: h, title: 'Added', metadata: { sourceType: 'url' }, ingredients: [{ name: 'milk', quantity: 0, unit: '' }, { name: 'rice', quantity: 0.5, unit: 'cups' }] });
assert.equal(recipe.status, 200);
assert.equal((await rpc(user.token, 'QueueService/AddQueueRecipe', { householdId: h, recipeId: recipe.body.recipe.id })).status, 200);
await rest(key, user.token, 'household_aisles', 'POST', [{ household_id: h, key: 'produce', label: 'Produce', sort_order: 10 }, { household_id: h, key: 'dairy', label: 'Dairy', sort_order: 20 }, { household_id: h, key: 'other', label: 'Other', sort_order: 999 }]);
await rest(key, user.token, 'ingredient_metadata', 'POST', [{ household_id: h, normalized_name: 'milk', display_name: 'Milk', category: 'dairy', sort_order: 10 }, { household_id: h, normalized_name: 'rice', display_name: 'Rice', category: 'other', sort_order: 20 }]);
await rest(key, user.token, 'shopping_list_manual_items', 'POST', { household_id: h, normalized_name: 'rice', quantity: 0, unit: 'cups', sort_order: 25 });
const browser = await stagingBrowser();
const path = '/shopping-list?' + new URLSearchParams({ householdId: h });
const item = name => `document.querySelector('[role="checkbox"][aria-label="${name}"]')`;
const listKeys = "[...document.querySelectorAll('[data-sortable-id]')].map(e=>e.dataset.sortableId).filter(k=>!k.startsWith('header:'))";
async function db() { const r = await rpc(user.token, 'ShoppingService/GetShoppingList', { householdId: h }); assert.equal(r.status, 200); return r.body.list; }
async function waitCall(method, count = 1) {
  for (let i = 0; i < 100; i++) { if (browser.responses.filter(r => r.path.endsWith('/' + method) && r.status === 200).length >= count) return; await new Promise(r => setTimeout(r, 100)); }
  throw new Error('Missing browser call: ' + method);
}
async function fault(method, delay = false) {
  await browser.evaluate(`(() => {
    const original=window.fetch; window.__shoppingIntercepted=false;
    window.fetch=async (...args)=>{ if(String(args[0]).endsWith('/${method}')) {
      window.fetch=original;window.__shoppingIntercepted=true;
      ${delay ? 'await new Promise(resolve=>{window.__releaseShopping=resolve;});return original(...args);' : 'return new Response("{}",{status:503,headers:{"Content-Type":"application/json"}});'}
    }return original(...args);};
  })()`);
}
async function add(name) { await browser.fill('input[placeholder="Add item…"]', name); await browser.click('Add'); }
async function drag(from, to, mobile = false, after = false) {
  const points = await browser.evaluate(`(() => {
    const a=document.querySelector('[data-sortable-id="${from}"]'),b=document.querySelector('[data-sortable-id="${to}"]');
    if(!a||!b)throw new Error('Drag row missing');
    const target=${mobile ? "a.querySelector('[data-drag-handle]')" : "a"};
    const r=target.getBoundingClientRect(),s=b.getBoundingClientRect();
    return {x:${mobile ? 'r.left+r.width/2' : 'r.left+r.width/2'},y:r.top+r.height/2,tx:s.left+s.width/2,ty:${after ? 's.bottom-2' : 's.top+2'}};
  })()`);
  await browser.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: points.x, y: points.y, button: 'left', buttons: 1, clickCount: 1 });
  for (let n = 1; n <= 8; n++) await browser.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: points.x + (points.tx - points.x) * n / 8, y: points.y + (points.ty - points.y) * n / 8, button: 'left', buttons: 1 });
  await browser.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: points.tx, y: points.ty, button: 'left', buttons: 0, clickCount: 1 });
}
try {
  await browser.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await browser.call('Emulation.setTouchEmulationEnabled', { enabled: false });
  await browser.login(user); browser.responses.length = 0;
  await browser.navigate(path); await browser.until(`!!${item('Milk')} && !!${item('Rice')}`); await waitCall('GetShoppingList');
  assert.equal(await browser.evaluate("document.querySelectorAll('[data-drag-handle]').length"), 0, 'Expected desktop row dragging');
  await add('Tea'); await waitCall('AddShoppingManualItem'); await browser.until(`!!${item('Tea')}`);
  let state = await db(); const tea = state.items.find(i => i.normalizedName === 'tea');
  assert.equal(state.items[0].listKey, tea.listKey);
  await drag('recipe:rice', tea.listKey); await waitCall('SaveShoppingOrder');
  await browser.until(`${listKeys}[0]==='recipe:rice'`);
  assert.equal((await db()).items[0].listKey, 'recipe:rice');
  await browser.click('Sort by aisle'); await waitCall('SaveShoppingOrder', 2);
  await browser.until("!!document.querySelector('[data-sortable-id=\"header:produce\"]')");
  await drag('recipe:milk', 'header:produce', false, true); await waitCall('SaveShoppingOrder', 3);
  assert.equal((await db()).items.find(i => i.listKey === 'recipe:milk').category, 'produce');
  // Inject failures before upstream writes; UI restores the authoritative state.
  const beforeFailure = await db();
  await fault('SaveShoppingOrder'); await drag('recipe:milk', 'header:other', false, true);
  await browser.until('window.__shoppingIntercepted'); await waitCall('GetShoppingList', 2);
  assert.deepEqual(await db(), beforeFailure);
  await browser.until(`${listKeys}[0]==='recipe:milk'`);
  await fault('AddShoppingManualItem'); await add('Failed item'); await browser.until("window.__shoppingIntercepted && document.querySelector('input[placeholder=\"Add item…\"]').value==='Failed item'");
  assert(!(await db()).items.some(i => i.normalizedName === 'failed item'));
  await fault('RemoveShoppingManualItem'); await browser.evaluate("document.querySelector('[aria-label=\"Remove Rice\"]').click()");
  await browser.until('window.__shoppingIntercepted'); assert((await db()).items.find(i => i.normalizedName === 'rice').isManual);
  await browser.evaluate("document.querySelector('[aria-label=\"Remove Rice\"]').click()"); await waitCall('RemoveShoppingManualItem');
  await browser.until("!document.querySelector('[aria-label=\"Remove Rice\"]')");
  assert.equal((await db()).items.find(i => i.normalizedName === 'rice').occurrences[0].recipeTitle, 'Added');
  // Controlled delayed check: add/clear cannot race its optimistic intent.
  await fault('SetShoppingItemChecked', true); await browser.evaluate(`${item('Milk')}.click()`); await browser.until('window.__shoppingIntercepted');
  const beforeAddCount = browser.responses.filter(r => r.path.endsWith('/AddShoppingManualItem')).length;
  const beforeClearCount = browser.responses.filter(r => r.path.endsWith('/ClearShoppingChecks')).length;
  await add('After check'); await browser.click('Clear checks');
  assert.equal(browser.responses.filter(r => r.path.endsWith('/AddShoppingManualItem')).length, beforeAddCount);
  assert.equal(browser.responses.filter(r => r.path.endsWith('/ClearShoppingChecks')).length, beforeClearCount);
  await browser.evaluate('window.__releaseShopping()'); await waitCall('SetShoppingItemChecked');
  await add('After check'); await waitCall('AddShoppingManualItem', 2); await browser.until(`!!${item('After check')}`);
  assert.equal(await browser.evaluate(`${item('Milk')}.getAttribute('aria-checked')`), 'true');
  assert.equal((await db()).items.find(i => i.normalizedName === 'milk').checked, true);
  // A failed order plus failed refresh must not restore pre-check rollback state.
  await browser.evaluate(`(() => {const original=window.fetch;window.__failedRefresh=false;window.fetch=async(...args)=>{const url=String(args[0]);if(url.endsWith('/SaveShoppingOrder'))return new Response('{}',{status:503,headers:{'Content-Type':'application/json'}});if(url.endsWith('/GetShoppingList')){window.fetch=original;window.__failedRefresh=true;return new Response('{}',{status:503,headers:{'Content-Type':'application/json'}});}return original(...args);};})()`);
  await browser.click('Sort by aisle'); await browser.until('window.__failedRefresh');
  assert.equal(await browser.evaluate(`${item('Milk')}.getAttribute('aria-checked')`), 'true');
  // Mobile-width/coarse pointer uses a real handle drag, preserving checks.
  await browser.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await browser.call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await browser.navigate(path); await browser.until(`!!${item('Milk')} && !!document.querySelector('[data-drag-handle]')`);
  state = await db(); const first = state.items[0].listKey, last = state.items.at(-1).listKey;
  const orderCalls = browser.responses.filter(r => r.path.endsWith('/SaveShoppingOrder') && r.status === 200).length;
  await drag(last, first, true); await waitCall('SaveShoppingOrder', orderCalls + 1);
  assert.equal((await db()).items[0].listKey, last);
  await browser.navigate(path); await browser.until(`${listKeys}[0]===${JSON.stringify(last)}`);
  assert.equal(await browser.evaluate(`${item('Milk')}.getAttribute('aria-checked')`), 'true');
  // Delayed add excludes clear-week until the committed response is accepted.
  await fault('AddShoppingManualItem', true); await add('Before clear'); await browser.until('window.__shoppingIntercepted');
  await browser.click('Clear week'); await browser.click('Clear all');
  assert(!browser.responses.some(r => r.path.endsWith('/ClearShoppingWeek')));
  await browser.evaluate('window.__releaseShopping()'); await browser.until(`!!${item('Before clear')}`);
  await browser.click('Clear all'); await waitCall('ClearShoppingWeek'); await browser.until("document.body.innerText.includes('No items yet.')");
  assert.deepEqual((await db()).items ?? [], []);
  const tables = ['/rest/v1/week_queues','/rest/v1/recipes','/rest/v1/recipe_ingredients','/rest/v1/ingredient_metadata','/rest/v1/household_aisles','/rest/v1/shopping_list_checks','/rest/v1/shopping_list_manual_items'];
  assert.deepEqual(browser.responses.filter(r => tables.includes(r.path)), [], 'Shopping screen still calls direct tables');
  for (const method of ['GetShoppingList','AddShoppingManualItem','RemoveShoppingManualItem','SaveShoppingOrder','SetShoppingItemChecked','ClearShoppingWeek']) assert(browser.responses.some(r => r.path.endsWith('/'+method) && r.contentType==='application/proto' && r.status===200));
  assert.deepEqual(browser.errors, []);
  console.log(JSON.stringify({ desktopDrag: true, emptyAisleDrop: true, mobileHandleDrag: true, manualAddRemove: true, realAddedRecipePreserved: true, failedMutationsRecover: true, delayedCheckAndAddSerialized: true, rollbackSnapshotRetainsChecks: true, delayedAddAndClearSerialized: true, binaryConnect: true, directShoppingTableCalls: 0, uncaughtExceptions: 0 }));
} finally { await browser.close(); }
