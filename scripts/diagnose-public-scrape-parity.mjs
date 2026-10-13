// Append-only scrape-output diagnosis across the public staging and production
// transports. Disposable credentials remain in memory. No recipe is saved.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const target = process.env.PANTRY_SCRAPE_DIAGNOSTIC_TARGET;
assert(['staging', 'production'].includes(target),
  'Set PANTRY_SCRAPE_DIAGNOSTIC_TARGET to staging or production');
if (target === 'production') {
  assert.equal(process.env.PANTRY_ALLOW_PRODUCTION_APPEND_ONLY, 'confirmed',
    'Production diagnosis requires PANTRY_ALLOW_PRODUCTION_APPEND_ONLY=confirmed');
}

const origin = target === 'production'
  ? 'https://pantry.waltermichelin.com'
  : 'https://pantry-staging.waltermichelin.com';

async function publicConfig() {
  const html = await (await fetch(origin)).text();
  const asset = html.match(/src="([^"]*\/_expo\/static\/js\/web\/entry-[^"]+\.js)"/)?.[1];
  assert(asset, `${target} application bundle missing`);
  const bundle = await (await fetch(new URL(asset, origin))).text();
  const projectRef = target === 'production' ? 'uyuswprxolsktmiraala' : 'fncsyvsgolbpviidmpuc';
  const database = `https://${projectRef}.supabase.co`;
  const key = bundle.match(/sb_publishable_[A-Za-z0-9_-]+/)?.[0];
  assert(bundle.includes(database), `${target} bundle does not use the approved Supabase project`);
  assert(key, `${target} public client key missing`);
  return { database, key };
}

async function createIdentity(config) {
  const response = await fetch(config.database + '/auth/v1/signup', {
    method: 'POST',
    headers: { apikey: config.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `pantry-scrape-${target}-${Date.now()}-${randomBytes(4).toString('hex')}@example.invalid`,
      password: randomBytes(24).toString('hex'),
    }),
  });
  assert.equal(response.status, 200, `${target} disposable signup failed`);
  const body = await response.json();
  assert(body.access_token, `${target} disposable signup has no session`);
  return body.access_token;
}

async function request(path, token, input, key) {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(path.startsWith(origin) ? { 'Connect-Protocol-Version': '1' } : {}),
    },
    body: JSON.stringify(input),
  });
  let body = {};
  try { body = await response.json(); } catch {}
  return { status: response.status, body };
}

const config = await publicConfig();
const token = await createIdentity(config);
let householdId = '';
if (target === 'staging') {
  const created = await request(
    origin + '/api/rpc/pantry.v1.HouseholdService/CreateHousehold', token,
    { name: 'Public scrape parity diagnosis' }, config.key);
  assert.equal(created.status, 200, 'Staging diagnostic household creation failed');
  householdId = created.body.household?.id;
  assert(householdId, 'Staging diagnostic household missing');
}

const cases = [
  ['website', 'https://example.com'],
  ['pin', process.env.PANTRY_PIN_URL ?? 'https://www.pinterest.com/pin/311522499209575573/'],
  ['board', process.env.PANTRY_BOARD_URL ?? 'https://www.pinterest.com/allrecipes/recipes/'],
];

for (const [name, url] of cases) {
  const result = target === 'staging'
    ? await request(origin + '/api/rpc/pantry.v1.RecipeScrapeService/ScrapeRecipe', token,
      { householdId, url }, config.key)
    : await request(config.database + '/functions/v1/scrape-recipe', token, { url }, config.key);
  const recipe = result.body.recipe;
  const board = result.body.board ?? (result.body.type === 'board' ? result.body : undefined);
  const recipes = board?.recipes ?? [];
  console.log(JSON.stringify({
    target,
    name,
    status: result.status,
    result: recipe ? 'recipe' : board ? 'board' : 'error',
    recipeCount: recipe ? 1 : board ? recipes.length : 0,
  }));
}
