// Staging-only public API acceptance. Credentials stay in memory and are never
// printed. Uses isolated test identities; no administrator or production access.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

export const origin = 'https://pantry-staging.waltermichelin.com';
export const database = 'https://fncsyvsgolbpviidmpuc.supabase.co';
export async function publicKey() {
  const html = await (await fetch(origin)).text();
  const asset = html.match(/src="([^"]*\/_expo\/static\/js\/web\/entry-[^"]+\.js)"/)?.[1];
  assert(asset, 'Staging bundle missing');
  const bundle = await (await fetch(new URL(asset, origin))).text();
  assert(bundle.includes(database), 'Bundle is not using the approved staging database');
  const key = bundle.match(/sb_publishable_[A-Za-z0-9_-]+/)?.[0];
  assert(key, 'Staging publishable key missing');
  return key;
}
export async function identity(key, suffix) {
  const email = `go-import-${Date.now()}-${suffix}@example.invalid`;
  const password = randomBytes(24).toString('hex');
  const response = await fetch(database + '/auth/v1/signup', {
    method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200, 'Isolated staging signup failed');
  const session = await response.json();
  assert(session.access_token, 'Staging test identity has no session');
  return { email, password, token: session.access_token, id: session.user.id };
}
export async function rpc(token, method, input) {
  const response = await fetch(origin + '/api/rpc/pantry.v1.' + method, {
    method: 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1' },
    body: JSON.stringify(input),
  });
  return { status: response.status, body: await response.json() };
}
export async function rest(key, token, path, method = 'GET', body) {
  const response = await fetch(database + '/rest/v1/' + path, {
    method, headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert(response.ok, `Staging fixture ${method} failed: ${response.status}`);
  return response.status === 204 ? null : response.json();
}

async function verify() {
  const key = await publicKey();
  const owner = await identity(key, 'owner');
  const member = await identity(key, 'member');
  const outsider = await identity(key, 'outsider');
  const created = await rpc(owner.token, 'HouseholdService/CreateHousehold', { name: 'Go Import Acceptance', displayName: 'Fixture' });
  assert.equal(created.status, 200);
  const household = created.body.household.id;
  assert.equal((await rpc(member.token, 'HouseholdService/JoinHousehold', { inviteCode: created.body.household.inviteCode })).status, 200);

  const metadata = { sourceUrl: 'https://example.invalid/' + 'p'.repeat(2100), sourceType: 'url', imageUrl: '', instructions: ['step '.repeat(5000), 'last'], tags: ['second', 'first'], servings: 0, cookTimeMinutes: 8 };
  const input = { householdId: household, title: 'Long ' + 'x'.repeat(300), metadata,
    ingredients: [{ name: 'salt', rawString: 'salt' }, { name: 'water', quantity: 0, unit: 'cups', rawString: '0 cups water' }] };
  const legacyData = { household_id: household, created_by: owner.id, title: input.title,
    source_url: metadata.sourceUrl, source_type: metadata.sourceType, image_url: '', instructions: metadata.instructions,
    tags: metadata.tags, servings: 0, cook_time_minutes: 8 };
  const [legacy] = await rest(key, owner.token, 'recipes', 'POST', legacyData);
  await rest(key, owner.token, 'recipe_ingredients', 'POST', [
    { recipe_id: legacy.id, name: 'salt', quantity: null, unit: null, raw_string: 'salt' },
    { recipe_id: legacy.id, name: 'water', quantity: 0, unit: 'cups', raw_string: '0 cups water' },
  ]);
  const imported = await rpc(owner.token, 'RecipeService/ImportRecipe', input);
  assert.equal(imported.status, 200, 'Owner import failed');
  const fields = 'title,source_url,source_type,image_url,instructions,tags,servings,prep_time_minutes,cook_time_minutes,created_by,recipe_ingredients(name,quantity,unit,raw_string)';
  async function projection(id) {
    const [recipe] = await rest(key, owner.token, `recipes?select=${fields}&id=eq.${id}`);
    recipe.recipe_ingredients.sort((a, b) => a.name.localeCompare(b.name));
    return recipe;
  }
  assert.deepEqual(await projection(imported.body.recipe.id), await projection(legacy.id), 'Legacy versus Go persisted-state diff');
  const empty = await rpc(member.token, 'RecipeService/ImportRecipe', { ...input, ingredients: [], title: 'Member empty import' });
  assert.equal(empty.status, 200, 'Member/empty import failed');
  const [savedEmpty] = await rest(key, member.token, `recipes?select=created_by,recipe_ingredients(id)&id=eq.${empty.body.recipe.id}`);
  assert.equal(savedEmpty.created_by, member.id);
  assert.deepEqual(savedEmpty.recipe_ingredients, []);
  const before = await rest(key, owner.token, `recipes?select=id&household_id=eq.${household}`);
  assert((await rpc(outsider.token, 'RecipeService/ImportRecipe', input)).status >= 400, 'Outsider import accepted');
  assert.equal((await rpc('', 'RecipeService/ImportRecipe', input)).status, 401);
  assert((await rpc(owner.token, 'RecipeService/ImportRecipe', { ...input, metadata: { ...metadata, instructions: ['x'.repeat(300000)] } })).status >= 400, 'Oversized import accepted');
  assert.deepEqual(await rest(key, owner.token, `recipes?select=id&household_id=eq.${household}`), before, 'Rejected import changed data');
  console.log(JSON.stringify({ legacyGoPersistenceParity: true, longText: true, nullZero: true, memberEmptyImport: true, outsiderDenied: true, anonymousDenied: true, oversizedDenied: true }));
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) await verify();
