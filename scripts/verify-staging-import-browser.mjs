import assert from 'node:assert/strict';
import { publicKey, identity, rpc, rest } from './verify-staging-recipe-import.mjs';
import { stagingBrowser } from './staging-browser.mjs';

const key = await publicKey();
const user = await identity(key, 'browser');
const created = await rpc(user.token, 'HouseholdService/CreateHousehold', { name: 'Go Import Browser Proof' });
assert.equal(created.status, 200);
const household = created.body.household.id;
const browser = await stagingBrowser();
try {
  await browser.login(user);
  await browser.call('Page.enable');
  const previewFailureScript = await browser.call('Page.addScriptToEvaluateOnNewDocument', { source: `
    (() => {
      const original = window.fetch;
      let failed = false;
      window.fetch = async (...args) => {
        const requestUrl = args[0] instanceof Request ? args[0].url : String(args[0]);
        if (!failed && requestUrl.endsWith('/ParseImportIngredients')) {
          failed = true;
          window.__parserFailureInjected = true;
          return new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } });
        }
        return original(...args);
      };
    })();
  ` });
  const single = { title: 'Imported browser recipe', source_url: 'https://example.invalid/single', source_type: 'url',
    instructions: ['First', 'Second'], suggested_tags: ['dinner'], servings: 0, cook_time_minutes: 9,
    raw_ingredients: ['salt', '0 cups water'] };
  await browser.navigate('/review-recipe?' + new URLSearchParams({ householdId: household, recipeJson: JSON.stringify(single) }));
  await browser.until("window.__parserFailureInjected || document.body.innerText.includes('Ingredients (2)') || document.body.innerText.includes('Try again')");
  assert.equal(await browser.evaluate("!!window.__parserFailureInjected"), true, 'Preview interceptor was not installed before the request');
  await browser.until("document.body.innerText.includes('Try again')");
  assert(!browser.responses.some(r => r.path.endsWith('/ImportRawRecipe') || r.path.endsWith('/ImportRecipe')),
    'A failed preview attempted persistence');
  await browser.click('Try again');
  await browser.until("document.body.innerText.includes('Ingredients (2)') && !document.body.innerText.includes('Try again')");
  await browser.call('Page.removeScriptToEvaluateOnNewDocument', { identifier: previewFailureScript.identifier });
  await browser.fill('input', 'Edited imported recipe');
  await browser.evaluate(`(() => {
    const original = window.fetch;
    let failed = false;
    window.fetch = async (...args) => {
      const requestUrl = args[0] instanceof Request ? args[0].url : String(args[0]);
      if (!failed && requestUrl.endsWith('/ImportRawRecipe')) {
        failed = true;
        window.__rawSaveFailureInjected = true;
        return new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } });
      }
      return original(...args);
    };
  })()`);
  await browser.click('Save to Household');
  await browser.until("window.__rawSaveFailureInjected && document.body.innerText.includes('Pantry could not import')");
  assert.equal(await browser.evaluate("document.querySelector('input').value"), 'Edited imported recipe', 'Raw-save failure lost edited title');
  assert(!browser.responses.some(r => r.path.endsWith('/ImportRecipe')), 'Raw-save failure fell back to the legacy import RPC');
  await browser.click('Save to Household');
  await browser.until("location.pathname==='/household'");
  const [saved] = await rest(key, user.token, `recipes?select=title,source_url,source_type,image_url,instructions,tags,servings,prep_time_minutes,cook_time_minutes,recipe_ingredients(name,quantity,unit,raw_string)&household_id=eq.${household}`);
  assert.equal(saved.title, 'Edited imported recipe');
  assert.equal(saved.source_url, single.source_url);
  assert.equal(saved.source_type, 'url');
  assert.equal(saved.image_url, null);
  assert.deepEqual(saved.instructions, single.instructions);
  assert.deepEqual(saved.tags, single.suggested_tags);
  assert.equal(saved.servings, 0);
  assert.equal(saved.prep_time_minutes, null);
  assert.equal(saved.cook_time_minutes, 9);
  saved.recipe_ingredients.sort((a, b) => a.name.localeCompare(b.name));
  assert.deepEqual(saved.recipe_ingredients, [{ name: 'salt', quantity: null, unit: null, raw_string: 'salt' }, { name: 'water', quantity: 0, unit: 'cups', raw_string: '0 cups water' }]);

  await browser.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const board = [
    single, // Already stored: skipped.
    { ...single, title: 'Board valid', source_url: 'https://example.invalid/board' },
    { ...single, title: 'Board duplicate', source_url: 'https://example.invalid/board' },
    { ...single, title: 'Board failure', source_url: 'https://example.invalid/bad', servings: 2.5 },
    { ...single, title: 'Board after failure', source_url: '' },
  ];
  await browser.navigate('/review-board?' + new URLSearchParams({ householdId: household, recipesJson: JSON.stringify(board) }));
  await browser.until("document.body.innerText.includes('Save 5 recipes')");
  await browser.click('Save 5 recipes');
  await browser.until("document.body.innerText.includes('Not saved:')");
  await browser.click('Continue to recipes');
  await browser.until("location.pathname==='/household'");
  const persisted = await rest(key, user.token, `recipes?select=title&household_id=eq.${household}`);
  assert.deepEqual(persisted.map(r => r.title).sort(), ['Board after failure', 'Board valid', 'Edited imported recipe']);
  const calls = browser.responses.filter(r => r.path === '/api/rpc/pantry.v1.RecipeService/ImportRawRecipe');
  assert.equal(calls.length, 3);
  assert(calls.every(r => r.status === 200 && r.contentType === 'application/proto'));
  assert(browser.responses.some(r => r.path.endsWith('/ParseImportIngredients') && r.status === 200 && r.contentType === 'application/proto'));
  assert(!browser.responses.some(r => r.path.endsWith('/ImportRecipe')), 'Legacy parsed import RPC remains active');
  assert(!browser.responses.some(r => r.method === 'POST' && ['/rest/v1/recipes', '/rest/v1/recipe_ingredients'].includes(r.path)), 'Direct recipe writes remain');
  assert.deepEqual(browser.errors, []);
  console.log(JSON.stringify({ singleImportMetadata: true, mobileBoardImport: true, storedAndBatchDedup: true,
    continuesAfterFailure: true, previewFailureRetry: true, visibleRawSaveFailure: true,
    binaryRawConnectSaves: calls.length, legacyImportCalls: 0, directRecipeWrites: false, uncaughtExceptions: 0 }));
} finally { await browser.close(); }
