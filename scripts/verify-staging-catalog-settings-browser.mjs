import assert from "node:assert/strict";
import { catalogFixture } from "./verify-staging-catalog-settings.mjs";
import { stagingBrowser } from "./staging-browser.mjs";
import { rest } from "./verify-staging-recipe-import.mjs";

const { key, owner, member, household, call } = await catalogFixture(),
  h = household.id,
  input = { householdId: h };
await call(owner, "RecipeService/SaveRecipe", {
  ...input,
  title: "Catalog browser recipe",
  ingredients: [{ name: "salt and pepper" }],
});
// Short custom-only aisle list makes both desktop and touch gestures observable.
await rest(key, owner.token, "household_aisles", "POST", [
  { household_id: h, key: "custom", label: "Custom aisle", sort_order: 10 },
  { household_id: h, key: "second", label: "Second aisle", sort_order: 20 },
  { household_id: h, key: "other", label: "Other", sort_order: 999 },
]);
const b = await stagingBrowser();
const text = (s) => `document.body.innerText.includes(${JSON.stringify(s)})`;
const methodCount = (method) =>
  b.responses.filter((r) => r.path.endsWith("/" + method) && r.status === 200)
    .length;
async function waitCall(method, n = 1) {
  for (let i = 0; i < 100; i++) {
    if (methodCount(method) >= n) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Missing browser call " + method);
}
async function aria(label) {
  await b.evaluate(
    `document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(label))}+']').click()`,
  );
}
async function fault(method, delay = false) {
  await b.evaluate(
    `(()=>{const original=window.fetch;window.__intercepted=false;window.fetch=async(...args)=>{if(String(args[0]).endsWith('/${method}')){window.fetch=original;window.__intercepted=true;${delay ? "await new Promise(resolve=>{window.__release=resolve;});return original(...args);" : 'return new Response("{}",{status:503,headers:{"Content-Type":"application/json"}});'}}return original(...args);};})()`,
  );
}
async function addCatalog(name) {
  await b.fill('input[placeholder="Add ingredient…"]', name);
  await b.click("Add");
}
async function drag(from, to, mobile = false) {
  const p = await b.evaluate(
    `(()=>{const a=document.querySelector('[data-sortable-id="${from}"]'),z=document.querySelector('[data-sortable-id="${to}"]');const r=(${mobile ? "a.querySelector('[data-drag-handle]')" : "a"}).getBoundingClientRect(),s=z.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,tx:s.left+s.width/2,ty:s.top+2};})()`,
  );
  if (mobile) {
    await b.call("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: p.x, y: p.y, id: 1 }],
    });
    for (let n = 1; n <= 8; n++)
      await b.call("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x: p.x + ((p.tx - p.x) * n) / 8,
            y: p.y + ((p.ty - p.y) * n) / 8,
            id: 1,
          },
        ],
      });
    await b.call("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } else {
    await b.call("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: p.x,
      y: p.y,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    for (let n = 1; n <= 8; n++)
      await b.call("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: p.x + ((p.tx - p.x) * n) / 8,
        y: p.y + ((p.ty - p.y) * n) / 8,
        button: "left",
        buttons: 1,
      });
    await b.call("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: p.tx,
      y: p.ty,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
  }
}
try {
  await b.call("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await b.call("Emulation.setTouchEmulationEnabled", { enabled: false });
  await b.login(member);
  await b.until(text(household.name)); // Finish the still-legacy dashboard read before measuring these routes.
  b.responses.length = 0;
  await b.navigate("/household-edit?id=" + h);
  await b.until(text("Members (2)"));
  await waitCall("GetHouseholdSettings");
  await b.fill('input[placeholder="Add a store…"]', "Shop");
  await b.click("Add");
  await waitCall("AddHouseholdStore");
  await b.until(text("Shop"));
  await fault("RemoveHouseholdStore");
  await aria("Remove store Shop");
  await b.until(text("Couldn't delete store"));
  assert(
    (await call(owner, "HouseholdSettingsService/GetHouseholdSettings", input))
      .settings.stores.length === 1,
  );
  await aria("Remove store Shop");
  await waitCall("RemoveHouseholdStore");
  await b.until(text("Stores (0)"));
  await b.navigate("/ingredients?householdId=" + h);
  await b.until(
    "!!document.querySelector('input[placeholder=\"Add ingredient…\"]')",
  );
  await waitCall("GetCatalog");
  await addCatalog("2 cups flour");
  await waitCall("EnsureCatalogIngredient");
  await b.until(text("Flour"));
  await b.evaluate(
    "[...document.querySelectorAll('[tabindex=\"0\"]')].find(e=>e.innerText.startsWith('Flour\\n')).click()",
  );
  await b.fill('input[placeholder="Display name"]', "My Flour");
  await b.click("Custom aisle");
  await fault("UpdateCatalogIngredient");
  await b.click("Save");
  await b.until(text("Pantry could not update"));
  await b.click("Save");
  await waitCall("UpdateCatalogIngredient");
  await b.until(text("My Flour"));
  await addCatalog("Tea");
  await b.until(text("2 ingredients"));
  await b.fill('input[placeholder="Filter…"]', "Custom aisle");
  await b.until(text("1 of 2"));
  await b.until(text("My Flour"));
  await b.fill('input[placeholder="Filter…"]', "");
  await b.until(text("2 ingredients"));
  await b.evaluate(
    "[...document.querySelectorAll('[tabindex=\"0\"]')].find(e=>e.innerText.startsWith('Tea\\n')).click()",
  );
  await b.click("Custom aisle");
  await b.click("Save");
  await waitCall("UpdateCatalogIngredient", 2);
  await b.until("!" + text("Edit ingredient"));
  let removes = methodCount("RemoveCatalogIngredient");
  await aria("Remove My Flour from catalog");
  await b.until(text("Remove from catalog?"));
  await b.click("Cancel");
  assert.equal(methodCount("RemoveCatalogIngredient"), removes);
  await aria("Remove My Flour from catalog");
  await fault("RemoveCatalogIngredient");
  await b.click("Remove");
  await b.until(text("Pantry could not remove"));
  assert(
    (await call(owner, "CatalogService/GetCatalog", input)).items.some(
      (i) => i.displayName === "My Flour",
    ),
  );
  await b.click("Remove");
  await waitCall("RemoveCatalogIngredient", removes + 1);
  await b.until("!" + text("Remove from catalog?"));
  await b.click("Seed from recipes");
  await waitCall("SeedCatalogFromRecipes");
  await b.until(text("Salt And Pepper"));
  await b.click("Seed from recipes");
  await waitCall("SeedCatalogFromRecipes", 2);
  await b.until(text("No new names"));
  await fault("GetCatalog");
  await b.click("Seed from recipes");
  await waitCall("SeedCatalogFromRecipes", 3);
  await b.until(text("Pantry could not load the catalog"));
  assert.equal(
    await b.evaluate(text("No new names")),
    false,
    "Seed success hid failed refresh",
  );
  await fault("EnsureCatalogIngredient");
  await addCatalog("Failed ingredient");
  await b.until(text("Pantry could not prepare"));
  assert(
    !(await call(owner, "CatalogService/GetCatalog", input)).items.some(
      (i) => i.normalizedName === "failed ingredient",
    ),
  );
  await fault("EnsureCatalogIngredient", true);
  await addCatalog("Delayed ingredient");
  await b.until("window.__intercepted");
  const seeds = methodCount("SeedCatalogFromRecipes");
  await b.evaluate(
    "[...document.querySelectorAll('[role=button],[tabindex]')].find(e=>e.innerText==='Seed from recipes').click()",
  );
  assert.equal(methodCount("SeedCatalogFromRecipes"), seeds);
  await b.evaluate("window.__release()");
  await b.until(text("Delayed ingredient")); // Preserve caller casing, as the legacy parser does.
  await b.navigate("/edit-aisles?householdId=" + h);
  await b.until("!!document.querySelector('[data-sortable-id=second]')");
  await waitCall("GetHouseholdAisles");
  assert.equal(
    await b.evaluate("document.querySelectorAll('[data-drag-handle]').length"),
    0,
  );
  await drag("second", "custom");
  await waitCall("SaveHouseholdAisleOrder");
  assert.equal(
    (await call(owner, "AisleService/GetHouseholdAisles", input)).view.aisles[0]
      .key,
    "second",
  );
  await fault("SaveHouseholdAisleOrder");
  await drag("custom", "second");
  await b.until(text("Couldn't save aisle order"));
  assert.equal(
    (await call(owner, "AisleService/GetHouseholdAisles", input)).view.aisles[0]
      .key,
    "second",
  );
  await b.fill('input[placeholder="New aisle name…"]', "Custom aisle");
  await b.click("Add");
  await waitCall("CreateHouseholdAisle");
  const created = (
    await call(owner, "AisleService/GetHouseholdAisles", input)
  ).view.aisles.find((a) => a.key === "custom_aisle");
  assert(created);
  let deletes = methodCount("RemoveHouseholdAisle");
  await b.evaluate(
    "document.querySelector('[data-sortable-id=custom] [aria-label=\"Delete Custom aisle\"]').click()",
  );
  await b.until(text("Delete aisle?"));
  await b.click("Cancel");
  assert.equal(methodCount("RemoveHouseholdAisle"), deletes);
  await b.evaluate(
    "document.querySelector('[data-sortable-id=custom] [aria-label=\"Delete Custom aisle\"]').click()",
  );
  await fault("RemoveHouseholdAisle");
  await b.click("Delete");
  await b.until(text("Couldn't delete aisle"));
  await b.click("Delete");
  await waitCall("RemoveHouseholdAisle", deletes + 1);
  await b.until("!" + text("Delete aisle?"));
  assert.equal(
    (await call(owner, "CatalogService/GetCatalog", input)).items.find(
      (i) => i.normalizedName === "tea",
    ).category,
    "other",
  );
  assert(
    (await call(owner, "RecipeService/ListRecipes", input)).recipes.some(
      (r) => r.title === "Catalog browser recipe",
    ),
  );
  await b.call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await b.call("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 1,
  });
  await b.navigate("/edit-aisles?householdId=" + h);
  await b.until("!!document.querySelector('[data-drag-handle]')");
  let view = (await call(owner, "AisleService/GetHouseholdAisles", input)).view;
  const movable = view.aisles.filter((a) => a.key !== "other");
  let orders = methodCount("SaveHouseholdAisleOrder");
  await drag(movable.at(-1).key, movable[0].key, true);
  await waitCall("SaveHouseholdAisleOrder", orders + 1);
  view = (await call(owner, "AisleService/GetHouseholdAisles", input)).view;
  assert.equal(view.aisles[0].key, movable.at(-1).key);
  assert.equal(view.aisles.at(-1).key, "other");
  // Restore an already-mounted aisle route with its refocus read held, then
  // finish a newer mutation before releasing the older snapshot.
  await aria("Shopping list");
  await b.until("location.pathname==='/shopping-list'");
  await waitCall("GetShoppingList");
  await b.evaluate(
    `(()=>{const original=window.fetch;window.__heldAisles=false;window.__releasedAisles=false;window.fetch=async(...args)=>{if(String(args[0]).endsWith('/GetHouseholdAisles')){window.fetch=original;const response=await original(...args);window.__heldAisles=true;await new Promise(resolve=>{window.__releaseAisles=resolve;});window.__releasedAisles=true;return response;}return original(...args);};history.back();})()`,
  );
  await b.until(
    "location.pathname==='/edit-aisles' && window.__heldAisles && !!document.querySelector('input[placeholder=\"New aisle name…\"]')",
  );
  const creates = methodCount("CreateHouseholdAisle");
  await b.fill('input[placeholder="New aisle name…"]', "Newer aisle");
  await b.click("Add");
  await waitCall("CreateHouseholdAisle", creates + 1);
  await b.until(text("Newer aisle"));
  await b.evaluate("window.__releaseAisles()");
  await b.until("window.__releasedAisles");
  await b.evaluate(
    "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
  );
  assert.equal(
    await b.evaluate(text("Newer aisle")),
    true,
    "Older read undid new aisle",
  );
  const direct = [
    "ingredient_metadata",
    "household_aisles",
    "households",
    "household_members",
    "stores",
  ].map((t) => "/rest/v1/" + t);
  assert.deepEqual(
    b.responses.filter((r) => direct.includes(r.path)),
    [],
    "Enabled screens accessed direct tables",
  );
  for (const method of [
    "GetCatalog",
    "EnsureCatalogIngredient",
    "SeedCatalogFromRecipes",
    "UpdateCatalogIngredient",
    "RemoveCatalogIngredient",
    "GetHouseholdAisles",
    "CreateHouseholdAisle",
    "SaveHouseholdAisleOrder",
    "RemoveHouseholdAisle",
    "GetHouseholdSettings",
    "AddHouseholdStore",
    "RemoveHouseholdStore",
  ])
    assert(
      b.responses.some(
        (r) =>
          r.path.endsWith("/" + method) &&
          r.contentType === "application/proto" &&
          r.status === 200,
      ),
      method + " binary coverage missing",
    );
  assert.deepEqual(b.errors, []);
  console.log(
    JSON.stringify({
      catalogEditSeedFilter: true,
      visibleDeleteConfirmCancel: true,
      storeAddDelete: true,
      failedMutationsRecover: true,
      delayedMutationSerialized: true,
      olderRefocusReadDiscarded: true,
      failedSeedRefreshVisible: true,
      desktopAndEmulatedTouchDrag: true,
      binaryMethods: 12,
      directSettingsTableCalls: 0,
      uncaughtExceptions: 0,
      productionTouched: false,
    }),
  );
} finally {
  await b.close();
}
