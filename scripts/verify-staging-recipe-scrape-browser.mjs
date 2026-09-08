// Staging-only public browser acceptance for the scraper cutover. Disposable
// credentials remain in memory and scraped previews are never persisted.
import assert from 'node:assert/strict';
import { identity, publicKey, rpc } from './verify-staging-recipe-import.mjs';
import { stagingBrowser } from './staging-browser.mjs';

const websiteURL = 'https://example.com';
const pinURL = process.env.PANTRY_STAGING_PIN_URL ?? 'https://www.pinterest.com/pin/311522499209575573/';
const boardURL = process.env.PANTRY_STAGING_BOARD_URL ?? 'https://www.pinterest.com/allrecipes/recipes/';
const key = await publicKey();
const user = await identity(key, 'scrape-browser');
const created = await rpc(user.token, 'HouseholdService/CreateHousehold', { name: 'Recipe Scrape Browser Proof' });
assert.equal(created.status, 200);
const household = created.body.household.id;
const browser = await stagingBrowser();

function relevantCalls(offset) {
  return browser.responses.slice(offset).filter(response =>
    response.path.endsWith('/pantry.v1.RecipeScrapeService/ScrapeRecipe') ||
    response.path.endsWith('/functions/v1/scrape-recipe'));
}

async function scrape(url, expectedPath, expectedType, doubleActivate = false) {
  await browser.navigate('/import-recipe?' + new URLSearchParams({ householdId: household }));
  await browser.until("!!document.querySelector('input[placeholder=\"https://...\"]')");
  await browser.fill('input[placeholder="https://..."]', url);
  const offset = browser.responses.length;
  if (doubleActivate) {
    await browser.evaluate(`(() => {
      const button = [...document.querySelectorAll('[tabindex="0"]')].find(element => element.innerText.trim() === 'Import');
      if (!button) throw new Error('Import control missing');
      button.click();
      button.click();
    })()`);
  } else {
    await browser.click('Import');
  }
  await browser.until(`location.pathname === ${JSON.stringify(expectedPath)}`, 300);
  const params = await browser.evaluate("Object.fromEntries(new URLSearchParams(location.search))");
  const value = JSON.parse(params[expectedPath === '/review-board' ? 'recipesJson' : 'recipeJson']);
  if (expectedPath === '/review-board') {
    assert(Array.isArray(value) && value.length > 0, 'Pinterest board returned no recipe previews');
    assert(value.every(recipe => recipe.source_type === expectedType), 'Pinterest board returned an unexpected source type');
  } else {
    assert.equal(value.source_type, expectedType);
  }
  const calls = relevantCalls(offset);
  const connect = calls.filter(response => response.path.endsWith('/pantry.v1.RecipeScrapeService/ScrapeRecipe'));
  assert.equal(connect.length, 1, 'Scrape activation did not produce exactly one Go request');
  assert.equal(connect[0].status, 200);
  assert.equal(connect[0].contentType, 'application/proto');
  assert.equal(calls.filter(response => response.path.endsWith('/functions/v1/scrape-recipe')).length, 0,
    'Staging scraper fell back to the legacy Edge Function');
  return expectedPath === '/review-board' ? value.length : 1;
}

try {
  await browser.login(user);
  const websiteRecipes = await scrape(websiteURL, '/review-recipe', 'url', true);
  await browser.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const pinRecipes = await scrape(pinURL, '/review-recipe', 'pinterest_pin');
  const boardRecipes = await scrape(boardURL, '/review-board', 'pinterest_pin');
  assert.deepEqual(browser.errors, []);
  console.log(JSON.stringify({
    websiteRecipes,
    pinRecipes,
    boardRecipes,
    sameTickSubmissionLocked: true,
    desktopAndTouchWidth: true,
    binaryConnectScrapes: 3,
    legacyEdgeCalls: 0,
    previewsPersisted: false,
    uncaughtExceptions: 0,
  }));
} finally {
  await browser.close();
}
