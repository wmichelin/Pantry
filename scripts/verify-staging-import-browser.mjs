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
        const requestPath = new URL(requestUrl, location.href).pathname;
        if (!failed && requestPath.endsWith('/ParseImportIngredients')) {
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
  assert.equal(await browser.evaluate("!!window.__parserFailureInjected"), true,
    `Preview interceptor was not installed before the request: ${JSON.stringify(browser.responses)}`);
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
      const requestPath = new URL(requestUrl, location.href).pathname;
      if (!failed && requestPath.endsWith('/ImportRawRecipe')) {
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
    single, // Already stored, but deliberately deselected.
    { ...single, title: 'Board valid', source_url: 'https://example.invalid/board' },
    { ...single, title: 'Board duplicate', source_url: 'https://example.invalid/board' },
    { ...single, title: 'Board not selected', source_url: 'https://example.invalid/not-selected' },
    { ...single, title: 'Board URL-less', source_url: '' },
  ];
  const boardResponseOffset = browser.responses.length;
  const interruptionKey = `pantry-board-interrupted-${household}`;
  await browser.call('Page.addScriptToEvaluateOnNewDocument', { source: `
    (() => {
      const original = window.fetch;
      window.fetch = async (...args) => {
        const requestUrl = args[0] instanceof Request ? args[0].url : String(args[0]);
        const requestPath = new URL(requestUrl, location.href).pathname;
        if (!requestPath.endsWith('/pantry.v1.BoardImportService/ImportBoard') || sessionStorage.getItem(${JSON.stringify(interruptionKey)})) {
          return original(...args);
        }
        const response = await original(...args);
        const reader = response.body.getReader();
        let buffered = new Uint8Array(0);
        let frames = 0;
        let cutting = false;
        const body = new ReadableStream({
          async pull(controller) {
            if (cutting) return;
            while (true) {
              const part = await reader.read();
              if (part.done) { controller.close(); return; }
              const joined = new Uint8Array(buffered.length + part.value.length);
              joined.set(buffered);
              joined.set(part.value, buffered.length);
              buffered = joined;
              while (buffered.length >= 5) {
                const size = new DataView(buffered.buffer, buffered.byteOffset + 1, 4).getUint32(0);
                if (buffered.length < size + 5) break;
                controller.enqueue(buffered.slice(0, size + 5));
                buffered = buffered.slice(size + 5);
                frames++;
                if (frames === 2) {
                  cutting = true;
                  window.__boardItemForwarded = true;
                  sessionStorage.setItem(${JSON.stringify(interruptionKey)}, 'done');
                  setTimeout(() => { reader.cancel(); controller.close(); }, 1000);
                  return;
                }
              }
              if (frames > 0) return;
            }
          },
          cancel(reason) { return reader.cancel(reason); },
        });
        return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
      };
    })();
  ` });
  await browser.navigate('/review-board?' + new URLSearchParams({ householdId: household, recipesJson: JSON.stringify(board) }));
  await browser.until("document.body.innerText.includes('Save 5 recipes')");
  await browser.evaluate(`(() => {
    for (const title of ['Imported browser recipe', 'Board not selected']) {
      const card = [...document.querySelectorAll('[tabindex="0"]')].find(element => element.innerText.includes(title) && element.innerText.includes('ingredients'));
      if (!card) throw new Error('Board card missing: ' + title);
      card.click();
    }
  })()`);
  await browser.until("document.body.innerText.includes('Save 3 recipes')");
  await browser.evaluate(`(() => {
    const card = [...document.querySelectorAll('[tabindex="0"]')].find(element => element.innerText.includes('Board valid') && element.innerText.includes('ingredients'));
    const tag = card && [...card.querySelectorAll('[tabindex="0"]')].find(element => element.innerText.trim()==='dinner');
    if (!tag) throw new Error('Board tag missing');
    tag.click();
  })()`);
  await browser.evaluate(`(() => {
    const card = [...document.querySelectorAll('[tabindex="0"]')].find(element => element.innerText.includes('Board valid') && element.innerText.includes('ingredients'));
    const add = card && [...card.querySelectorAll('[tabindex="0"]')].find(element => element.innerText.trim()==='+');
    if (!add) throw new Error('Board custom-tag control missing');
    add.click();
  })()`);
  await browser.until("!!document.querySelector('input[placeholder=\"Add custom tag…\"]')");
  await browser.fill('input[placeholder="Add custom tag…"]', 'browser-edited');
  await browser.click('Add');
  await browser.until("document.body.innerText.includes('browser-edited')");
  await browser.click('Done');
  await browser.until("document.body.innerText.includes('Save 3 recipes')");
  await browser.evaluate(`(() => {
    const button = [...document.querySelectorAll('[tabindex="0"]')].find(element => element.innerText.trim()==='Save 3 recipes');
    if (!button) throw new Error('Board save control missing');
    button.click();
    button.click();
  })()`);
  await browser.until("window.__boardItemForwarded && document.body.innerText.includes('Saving 1 / 3')");
  await browser.until("document.body.innerText.includes('Import interrupted')");
  const recoveryLocation = await browser.evaluate("location.pathname + location.search");
  const recoveryParams = new URL(recoveryLocation, 'https://example.invalid').searchParams;
  assert.match(recoveryParams.get('boardOperationId'), /^[0-9a-f-]{36}$/i);
  assert.deepEqual(JSON.parse(recoveryParams.get('boardSelectionJson')), [1, 2, 4]);
  assert.deepEqual(JSON.parse(recoveryParams.get('boardTagsJson'))['1'], ['browser-edited']);
  assert.equal(browser.responses.slice(boardResponseOffset).filter(r => r.path.endsWith('/pantry.v1.BoardImportService/ImportBoard')).length, 1,
    'Double-click started more than one board stream');
  await browser.call('Page.reload');
  await browser.until("document.body.innerText.includes('Resume 3 recipes')");
  assert.equal(await browser.evaluate("location.search.includes('boardOperationId=')"), true, 'Reload lost board operation identity');
  await browser.click('Resume 3 recipes');
  await browser.until("location.pathname==='/household'");
  const persisted = await rest(key, user.token, `recipes?select=id,title,tags,source_url&household_id=eq.${household}`);
  assert.deepEqual(persisted.map(r => r.title).sort(), ['Board URL-less', 'Board valid', 'Edited imported recipe']);
  assert.deepEqual(persisted.find(r => r.title === 'Board valid').tags, ['browser-edited']);
  assert.equal(persisted.find(r => r.title === 'Board URL-less').source_url, '');
  const boardResponses = browser.responses.slice(boardResponseOffset);
  const boardCalls = boardResponses.filter(r => r.path === '/api/rpc/pantry.v1.BoardImportService/ImportBoard');
  assert.equal(boardCalls.length, 2);
  assert(boardCalls.every(r => r.status === 200 && r.contentType === 'application/connect+proto'));
  assert.equal(boardResponses.filter(r => r.path === '/api/rpc/pantry.v1.RecipeService/ImportRawRecipe').length, 0);
  assert.equal(boardResponses.filter(r => r.path === '/api/rpc/pantry.v1.RecipeService/ImportRecipe').length, 0);
  assert(browser.responses.some(r => r.path.endsWith('/ParseImportIngredients') && r.status === 200 && r.contentType === 'application/proto'));
  assert(!boardResponses.some(r => r.method === 'POST' && ['/rest/v1/recipes', '/rest/v1/recipe_ingredients'].includes(r.path)), 'Direct recipe writes remain');

  const callsBeforeInvalidRecovery = browser.responses.length;
  await browser.navigate('/review-board?' + new URLSearchParams({
    householdId: household,
    recipesJson: JSON.stringify(board),
    boardOperationId: crypto.randomUUID(),
  }));
  await browser.until("document.body.innerText.includes('Import recovery unavailable')");
  assert.equal(browser.responses.slice(callsBeforeInvalidRecovery).filter(r => r.path.endsWith('/pantry.v1.BoardImportService/ImportBoard')).length, 0,
    'Invalid recovery state started a new operation');
  await browser.click('Return to recipes');
  await browser.until("location.pathname==='/household'");
  assert.deepEqual(browser.errors, []);
  console.log(JSON.stringify({ singleImportMetadata: true, mobileBoardImport: true, editedTagsAndDeselection: true,
    interruptedReloadResume: true, stableOperationInURL: true, urlLessNoDuplicate: true,
    doubleClickSingleStream: true, invalidRecoveryFailsClosed: true, previewFailureRetry: true,
    visibleRawSaveFailure: true, binaryBoardConnectStreams: boardCalls.length,
    legacyBoardImportCalls: 0, directRecipeWrites: false, uncaughtExceptions: 0 }));
} finally { await browser.close(); }
