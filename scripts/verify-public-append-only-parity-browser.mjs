// Public, append-only behavior comparison for staging and production. This
// script never uses administrator credentials and never deletes or clears data.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { stagingBrowser } from './staging-browser.mjs';

const target = process.env.PANTRY_PARITY_TARGET;
assert(['staging', 'production'].includes(target), 'Set PANTRY_PARITY_TARGET to staging or production');
if (target === 'production') {
  assert.equal(process.env.PANTRY_ALLOW_PRODUCTION_APPEND_ONLY, 'confirmed',
    'Production comparison requires PANTRY_ALLOW_PRODUCTION_APPEND_ONLY=confirmed');
}
const origin = target === 'production'
  ? 'https://pantry.waltermichelin.com'
  : 'https://pantry-staging.waltermichelin.com';

async function publicConfig() {
  const htmlResponse = await fetch(origin);
  assert.equal(htmlResponse.status, 200, `${target} application entrypoint unavailable`);
  const html = await htmlResponse.text();
  const asset = html.match(/src="([^"]*\/_expo\/static\/js\/web\/entry-[^"]+\.js)"/)?.[1];
  assert(asset, `${target} application bundle missing`);
  const bundleResponse = await fetch(new URL(asset, origin));
  assert.equal(bundleResponse.status, 200, `${target} application bundle unavailable`);
  const bundle = await bundleResponse.text();
  const projectRef = target === 'production' ? 'uyuswprxolsktmiraala' : 'fncsyvsgolbpviidmpuc';
  const database = `https://${projectRef}.supabase.co`;
  const key = bundle.match(/sb_publishable_[A-Za-z0-9_-]+/)?.[0];
  assert(bundle.includes(database), `${target} bundle does not use the approved Supabase project`);
  assert(key, `${target} public client key missing`);
  return { database, key, fingerprint: createHash('sha256').update(bundle).digest('hex').slice(0, 12) };
}

async function createIdentity(config) {
  const email = `pantry-parity-${target}-${Date.now()}-${randomBytes(5).toString('hex')}@example.invalid`;
  const password = randomBytes(24).toString('hex');
  const response = await fetch(config.database + '/auth/v1/signup', {
    method: 'POST',
    headers: { apikey: config.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, data: { display_name: `Parity ${target}` } }),
  });
  assert.equal(response.status, 200, `${target} disposable signup failed`);
  const session = await response.json();
  assert(session.access_token, `${target} signup requires email confirmation; stopping without a test household`);
  return { email, password, token: session.access_token };
}

async function scopedRows(config, identity, path) {
  const response = await fetch(config.database + '/rest/v1/' + path, {
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${identity.token}`,
      Accept: 'application/json',
    },
  });
  assert(response.ok, `${target} scoped persistence read failed: ${response.status}`);
  return response.json();
}

const config = await publicConfig();
let identity;
const suffix = `${Date.now()}-${randomBytes(3).toString('hex')}`;
const householdName = `Parity ${target} ${suffix}`;
const recipeTitle = `Parity recipe ${suffix}`;
const ingredientName = `parity milk ${suffix}`;
const manualName = `parity tea ${suffix}`;
const storeName = `Parity store ${suffix}`;
const catalogName = `parity catalog ${suffix}`;
const tagName = `parity-${randomBytes(3).toString('hex')}`;
function allowAppendOnlyRequest(request) {
  return request.method !== 'DELETE' && !/(?:^|\/)(?:Delete|Remove|Clear)[^/]*$/.test(request.path);
}

const browser = await stagingBrowser(origin, { requestGuard: allowAppendOnlyRequest });
let householdID;
const comparisonFailures = [];

async function waitForResponse(predicate, label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const match = browser.responses.find(predicate);
    if (match) return match;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`${target} response missing: ${label}`);
}

try {
  await browser.until("!!document.querySelector('input[type=email]')");
  const guardProbe = await browser.evaluate(`Promise.all([
    fetch('/__pantry_append_only_guard_probe__/safe', { method: 'DELETE' }),
    fetch('/__pantry_append_only_guard_probe__/ClearProbe', { method: 'POST' }),
  ].map(request => request.then(() => 'sent', () => 'blocked')))`);
  assert.deepEqual(guardProbe, ['blocked', 'blocked'], 'Append-only request guard did not fail closed');
  assert.deepEqual(browser.blockedRequests.map(request => [request.method, request.path]), [
    ['DELETE', '/__pantry_append_only_guard_probe__/safe'],
    ['POST', '/__pantry_append_only_guard_probe__/ClearProbe'],
  ]);
  browser.blockedRequests.length = 0;
  identity = await createIdentity(config);
  await browser.fill('input[type=email]', identity.email);
  await browser.fill('input[type=password]', identity.password);
  await browser.click('Sign In');
  await browser.until("document.body.innerText.includes('Welcome to Pantry')");
  await browser.navigate('/create-household');
  await browser.until("!!document.querySelector('input[placeholder*=Michelins]')");
  await browser.fill('input[placeholder*=Michelins]', householdName);
  await browser.click('Create Household');
  await browser.until("location.pathname === '/household' && new URLSearchParams(location.search).has('id')");
  householdID = await browser.evaluate("new URLSearchParams(location.search).get('id')");
  assert.match(householdID, /^[0-9a-f-]{36}$/i);
  await browser.until(`document.body.innerText.includes(${JSON.stringify(householdName)})`);

  await browser.navigate('/household-edit?id=' + householdID);
  await browser.until("document.body.innerText.includes('Members (1)')");
  await browser.fill('input[placeholder="Add a store…"]', storeName);
  await browser.click('Add');
  await browser.until(`document.body.innerText.includes(${JSON.stringify(storeName)})`);

  await browser.navigate('/create-recipe?' + new URLSearchParams({ householdId: householdID }));
  await browser.until("!!document.querySelector('input[placeholder=\"e.g. Sheet Pan Chicken Fajitas\"]')");
  await browser.fill('input[placeholder="e.g. Sheet Pan Chicken Fajitas"]', recipeTitle);
  await browser.fill('input[placeholder="Ingredient"]', ingredientName);
  await browser.fill('input[placeholder="Qty"]', '0');
  await browser.fill('input[placeholder="Unit"]', 'cups');
  const saveOffset = browser.responses.length;
  await browser.click('Save Recipe');
  const saveResponse = await waitForResponse(response =>
    browser.responses.indexOf(response) >= saveOffset &&
    ((response.path.endsWith('/SaveRecipe') && response.status === 200) ||
      (response.path === '/rest/v1/recipe_ingredients' && response.method === 'POST' && response.status === 201)),
  'manual persistence');
  assert(saveResponse);
  await browser.navigate('/household?id=' + householdID);
  await browser.until("!!document.querySelector('input[placeholder=\"Search by title or ingredient…\"]')");
  await browser.fill('input[placeholder="Search by title or ingredient…"]', ingredientName);
  await browser.until(`document.body.innerText.includes(${JSON.stringify(recipeTitle)})`);
  await browser.click(recipeTitle);
  await browser.until("document.body.innerText.includes('Edit tags')");
  assert(await browser.evaluate(`document.body.innerText.includes(${JSON.stringify(ingredientName)})`));
  await browser.click('Edit tags');
  await browser.fill('input[placeholder="Add custom tag…"]', tagName);
  await browser.click('Add');
  await browser.click('Save');
  await browser.until(`document.body.innerText.includes(${JSON.stringify(tagName)})`);
  await browser.click('+ Add to queue');
  await browser.until("document.body.innerText.includes('✓ In queue')");

  await browser.navigate('/shopping-list?' + new URLSearchParams({ householdId: householdID }));
  await browser.until(`document.body.innerText.toLowerCase().includes(${JSON.stringify(ingredientName)})`);
  await browser.fill('input[placeholder="Add item…"]', manualName);
  await browser.click('Add');
  await browser.until(`document.body.innerText.toLowerCase().includes(${JSON.stringify(manualName)})`);
  const checkbox = `[...document.querySelectorAll('[role="checkbox"]')].find(element => element.getAttribute('aria-label')?.toLowerCase() === ${JSON.stringify(ingredientName)})`;
  await browser.evaluate(`${checkbox}.click()`);
  let shoppingCheckUI = true;
  try {
    await browser.until(`${checkbox}.getAttribute('aria-checked') === 'true'`);
  } catch {
    shoppingCheckUI = false;
  }
  await browser.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await browser.navigate('/shopping-list?' + new URLSearchParams({ householdId: householdID }));
  await browser.until(`document.body.innerText.toLowerCase().includes(${JSON.stringify(manualName)})`);
  const shoppingCheckReloaded = await browser.evaluate(`${checkbox}?.getAttribute('aria-checked') === 'true'`);

  await browser.navigate('/ingredients?' + new URLSearchParams({ householdId: householdID }));
  await browser.until("!!document.querySelector('input[placeholder=\"Add ingredient…\"]')");
  await browser.fill('input[placeholder="Add ingredient…"]', catalogName);
  await browser.click('Add');
  await browser.until(`document.body.innerText.toLowerCase().includes(${JSON.stringify(catalogName)})`);
  const seedOffset = browser.responses.length;
  await browser.click('Seed from recipes');
  await waitForResponse(response =>
    browser.responses.indexOf(response) >= seedOffset &&
    ((response.path.endsWith('/SeedCatalogFromRecipes') && response.status === 200) ||
      (response.path === '/rest/v1/recipe_ingredients' && response.method === 'GET' && response.status === 200)),
  'catalog seed');

  await browser.navigate('/import-recipe?' + new URLSearchParams({ householdId: householdID }));
  await browser.until("!!document.querySelector('input[placeholder=\"https://...\"]')");
  await browser.fill('input[placeholder="https://..."]', 'https://example.com');
  await browser.click('Import');
  await browser.until("location.pathname === '/review-recipe'", 300);
  await browser.until("[...document.querySelectorAll('[tabindex=\"0\"]')].some(element => element.innerText.trim() === 'Save to Household')");
  const importSaveOffset = browser.responses.length;
  await browser.click('Save to Household');
  await waitForResponse(response =>
    browser.responses.indexOf(response) >= importSaveOffset &&
    (((response.path.endsWith('/ImportRecipe') || response.path.endsWith('/ImportRawRecipe')) && response.status === 200) ||
      (response.path === '/rest/v1/recipes' && response.method === 'POST' && response.status === 201)),
  'import persistence');
  await browser.navigate('/household?id=' + householdID);
  await browser.until("!!document.querySelector('input[placeholder=\"Search by title or ingredient…\"]')");

  const encodedHousehold = encodeURIComponent(householdID);
  const recipes = await scopedRows(config, identity,
    `recipes?select=id,title,tags,source_type,source_url,recipe_ingredients(name,quantity,unit)&household_id=eq.${encodedHousehold}&order=created_at.asc`);
  const manual = await scopedRows(config, identity,
    `shopping_list_manual_items?select=normalized_name&household_id=eq.${encodedHousehold}`);
  const checks = await scopedRows(config, identity,
    `shopping_list_checks?select=normalized_name&household_id=eq.${encodedHousehold}`);
  const stores = await scopedRows(config, identity,
    `stores?select=name&household_id=eq.${encodedHousehold}`);
  const catalog = await scopedRows(config, identity,
    `ingredient_metadata?select=normalized_name,display_name,category&household_id=eq.${encodedHousehold}`);
  const queue = await scopedRows(config, identity,
    `week_queues?select=recipe_id&household_id=eq.${encodedHousehold}`);

  const manualRecipe = recipes.find(recipe => recipe.title === recipeTitle);
  const importedRecipe = recipes.find(recipe => recipe.source_url === 'https://example.com');
  assert(manualRecipe && importedRecipe, `${target} did not persist both compared recipe paths`);
  assert.deepEqual(manualRecipe.tags, [tagName]);
  assert.deepEqual(manualRecipe.recipe_ingredients, [{ name: ingredientName, quantity: 0, unit: 'cups' }]);
  assert.equal(importedRecipe.source_type, 'url');
  assert.equal(queue.length, 1);
  assert(manual.some(item => item.normalized_name === manualName));
  const shoppingCheckPersisted = checks.some(item => item.normalized_name === ingredientName);
  if (!shoppingCheckPersisted) comparisonFailures.push('shopping check did not persist');
  if (!shoppingCheckReloaded) comparisonFailures.push('persisted shopping check was not rendered after reload');
  const observedDifferences = shoppingCheckUI ? [] : [`${target} checkmark is stale until reload`];
  assert(stores.some(store => store.name === storeName));
  assert(catalog.some(item => item.normalized_name === catalogName));

  await browser.navigate('/household-edit?id=' + householdID);
  await browser.until("document.body.innerText.includes('Sign Out')");
  await browser.click('Sign Out');
  await browser.until("location.pathname === '/login'");
  await new Promise(resolve => setTimeout(resolve, 500));

  const unsafe = browser.responses.filter(response =>
    response.method === 'DELETE' || /\/(Delete|Remove|Clear)[A-Za-z]+$/.test(response.path));
  assert.deepEqual(browser.blockedRequests, [],
    `${target} comparison attempted a destructive request that was blocked before transmission`);
  assert.deepEqual(unsafe, [], `${target} comparison attempted a destructive request`);
  assert.deepEqual(browser.errors, []);

  console.log(JSON.stringify({
    target,
    bundleFingerprint: config.fingerprint,
    signupAndLogin: true,
    householdCreateAndReload: true,
    settingsAndStoreAdd: true,
    manualRecipeZeroAndTag: true,
    searchAndDetail: true,
    queueAndShoppingAggregation: true,
    manualShoppingItem: true,
    shoppingCheckUI,
    shoppingCheckPersisted,
    shoppingCheckReloaded,
    responsiveReload: true,
    catalogAddAndSeed: true,
    websiteScrapeReviewAndSave: true,
    scopedPersistenceReadback: true,
    signOut: true,
    destructiveRequests: 0,
    uncaughtExceptions: 0,
    comparisonFailures,
    observedDifferences,
  }));
  assert.deepEqual(comparisonFailures, [], `${target} public behavior comparison failed`);
} finally {
  await browser.close();
}
