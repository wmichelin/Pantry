import assert from 'node:assert/strict';
import { publicKey, identity, rpc, rest } from './verify-staging-recipe-import.mjs';
import { stagingBrowser } from './staging-browser.mjs';

const key = await publicKey();
const user = await identity(key, 'management-browser');
const created = await rpc(user.token, 'HouseholdService/CreateHousehold', { name: 'Recipe Management Browser Proof' });
assert.equal(created.status, 200);
const household = created.body.household.id;
const imported = await rpc(user.token, 'RecipeService/ImportRecipe', {
  householdId: household, title: 'Management Browser Recipe', metadata: { sourceType: 'url', tags: ['dinner'], instructions: ['Mix and serve'] },
  ingredients: [{ name: 'salt', rawString: 'salt' }],
});
assert.equal(imported.status, 200);
const id = imported.body.recipe.id;
const browser = await stagingBrowser();
try {
  await browser.login(user);
  // Tagged sections start collapsed. Search exposes the matching recipe without
  // depending on that presentation state.
  await browser.until("!!document.querySelector('input[placeholder=\"Search by title or ingredient…\"]')");
  assert(browser.responses.some(r => r.path.endsWith('/ListHouseholds') && r.status === 200 && r.contentType === 'application/proto'),
    'Dashboard household read did not use binary Connect');
  assert(!browser.responses.some(r => r.path === '/rest/v1/households'), 'Dashboard retained a direct household read');
  await browser.fill('input[placeholder="Search by title or ingredient…"]', 'salt');
  await browser.until("document.body.innerText.includes('Management Browser Recipe') && !document.body.innerText.includes('Searching…')");
  // Search is debounced; wait for its completed RPC before changing the route.
  for (let i = 0; i < 100 && !browser.responses.some(r => r.path.endsWith('/SearchRecipeIngredients')); i++) await new Promise(resolve => setTimeout(resolve, 100));
  await browser.navigate('/recipe/' + id);
  await browser.until("document.body.innerText.includes('Edit tags')");
  assert(await browser.evaluate("document.body.innerText.includes('Mix and serve') && document.body.innerText.includes('salt')"));
  await browser.click('Edit tags');
  await browser.fill('input[placeholder="Add custom tag…"]', 'verified');
  await browser.click('Add');
  await browser.click('Save');
  await browser.until("document.body.innerText.includes('Edit tags')");
  const [saved] = await rest(key, user.token, `recipes?select=tags&id=eq.${id}`);
  assert.deepEqual(saved.tags, ['dinner', 'verified']);
  await browser.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await browser.click('Delete Recipe');
  await browser.click('Yes, delete');
  await browser.until("location.pathname==='/household'");
  assert.deepEqual(await rest(key, user.token, `recipes?select=id&id=eq.${id}`), []);
  assert.deepEqual(await rest(key, user.token, `recipe_ingredients?select=id&recipe_id=eq.${id}`), []);
  for (const method of ['ListRecipes', 'GetRecipe', 'SearchRecipeIngredients', 'UpdateRecipeTags', 'DeleteRecipe']) {
    assert(browser.responses.some(r => r.path.endsWith('/' + method) && r.status === 200 && r.contentType === 'application/proto'), method + ' not verified through binary Connect');
  }
  assert(!browser.responses.some(r => ['/rest/v1/recipes', '/rest/v1/recipe_ingredients'].includes(r.path)), 'Direct recipe reads/writes remain in this journey');
  assert.deepEqual(browser.errors, []);
  console.log(JSON.stringify({ dashboardListHouseholdsConnect: true, directHouseholdReads: false, browserListDetailSearch: true, tagsPersisted: true, mobileDelete: true, fiveBinaryConnectMethods: true, directRecipeDataCalls: false, uncaughtExceptions: 0 }));
} finally { await browser.close(); }
