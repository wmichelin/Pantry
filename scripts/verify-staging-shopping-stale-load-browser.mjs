// Separate SPA refocus regression: an old read must not undo a newer check.
import assert from 'node:assert/strict';
import { publicKey, identity, rpc } from './verify-staging-recipe-import.mjs';
import { stagingBrowser } from './staging-browser.mjs';
const key = await publicKey(), user = await identity(key, 'shopping-stale-load');
const created = await rpc(user.token, 'HouseholdService/CreateHousehold', { name: 'Shopping Stale Load Browser Proof' });
assert.equal(created.status, 200); const householdId = created.body.household.id;
assert.equal((await rpc(user.token, 'ShoppingService/AddShoppingManualItem', { householdId, name: 'Milk' })).status, 200);
const browser = await stagingBrowser();
const milk = "document.querySelector('[role=checkbox][aria-label=Milk]')";
try {
  await browser.login(user);
  await browser.navigate('/shopping-list?' + new URLSearchParams({ householdId }));
  await browser.until(`!!${milk}`);
  await browser.click('Edit aisles');
  await browser.until("location.pathname==='/edit-aisles' && !!document.querySelector('input[placeholder=\"New aisle name…\"]')");
  await browser.evaluate(`(() => {
    const original=window.fetch; window.__heldList=false;window.__releasedList=false;
    window.fetch=async (...args)=>{if(String(args[0]).endsWith('/GetShoppingList')){
      window.fetch=original; const response=await original(...args);window.__heldList=true;
      await new Promise(resolve=>{window.__releaseList=resolve;});window.__releasedList=true;return response;
    }return original(...args);};
    history.back();
  })()`);
  await browser.until(`location.pathname==='/shopping-list' && window.__heldList && !!${milk}`);
  assert.equal(await browser.evaluate(`${milk}.getAttribute('aria-checked')`), 'false');
  await browser.evaluate(`${milk}.click()`);
  for (let i = 0; i < 100; i++) {
    if (browser.responses.some(r => r.path.endsWith('/SetShoppingItemChecked') && r.status === 200)) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(browser.responses.some(r => r.path.endsWith('/SetShoppingItemChecked') && r.status === 200));
  await browser.evaluate('window.__releaseList()');
  await browser.until(`window.__releasedList && ${milk}.getAttribute('aria-checked')==='true'`);
  // Allow React to commit the released stale response before asserting again.
  await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  assert.equal(await browser.evaluate(`${milk}.getAttribute('aria-checked')`), 'true');
  const list = await rpc(user.token, 'ShoppingService/GetShoppingList', { householdId });
  assert.equal(list.body.list.items[0].checked, true);
  assert.deepEqual(browser.errors, []);
  console.log(JSON.stringify({ delayedRefocusReadDiscarded: true, newerCheckPreservedInUIAndDatabase: true, uncaughtExceptions: 0 }));
} finally { await browser.close(); }
