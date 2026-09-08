import assert from "node:assert/strict";
import { catalogFixture } from "./verify-staging-catalog-settings.mjs";
import { stagingBrowser } from "./staging-browser.mjs";
const { owner, member, household, call } = await catalogFixture(),
  h = household.id;
const b = await stagingBrowser();
const text = (s) => `document.body.innerText.includes(${JSON.stringify(s)})`;
async function fault() {
  await b.evaluate(
    `(()=>{const original=window.fetch;window.fetch=async(...args)=>{if(String(args[0]).endsWith('/EnsureCatalogIngredient')){window.fetch=original;return new Response('{}',{status:503,headers:{'Content-Type':'application/json'}});}return original(...args);};})()`,
  );
}
async function recipes() {
  return (
    (await call(owner, "RecipeService/ListRecipes", { householdId: h }))
      .recipes ?? []
  );
}
const scraped = (title, name) => ({
  title,
  source_url: "https://example.invalid/" + encodeURIComponent(title),
  source_type: "url",
  instructions: ["Mix."],
  raw_ingredients: ["2 cups " + name],
  suggested_tags: [],
});
try {
  await b.login(member);
  b.responses.length = 0;
  // Successful manual save reads autocomplete from Go and enriches through Go.
  await b.navigate("/create-recipe?householdId=" + h);
  await b.until("!!document.querySelector('input[placeholder=Ingredient]')");
  await b.fill(
    'input[placeholder="e.g. Sheet Pan Chicken Fajitas"]',
    "Manual success",
  );
  await b.fill("input[placeholder=Ingredient]", "manual flour");
  await b.click("Save Recipe");
  await b.until("location.pathname!='/create-recipe'");
  assert((await recipes()).some((r) => r.title === "Manual success"));
  // Enrichment errors occur after the recipe commit and must not invite a resave.
  await b.navigate("/create-recipe?householdId=" + h);
  await b.until("!!document.querySelector('input[placeholder=Ingredient]')");
  await b.fill(
    'input[placeholder="e.g. Sheet Pan Chicken Fajitas"]',
    "Manual warning",
  );
  await b.fill("input[placeholder=Ingredient]", "warning flour");
  await fault();
  await b.click("Save Recipe");
  await b.until(text("do not save the recipe again"));
  assert.equal(
    (await recipes()).filter((r) => r.title === "Manual warning").length,
    1,
  );
  await b.click("Continue to recipes");
  for (const kind of ["single", "board"])
    for (const fail of [false, true]) {
      const title = kind + (fail ? " warning" : " success"),
        r = scraped(title, title + " flour");
      const query = new URLSearchParams({
        householdId: h,
        [kind === "single" ? "recipeJson" : "recipesJson"]: JSON.stringify(
          kind === "single" ? r : [r],
        ),
      });
      await b.navigate(
        "/" +
          (kind === "single" ? "review-recipe" : "review-board") +
          "?" +
          query,
      );
      await b.until(text(title));
      if (fail) await fault();
      await b.click(kind === "single" ? "Save to Household" : "Save 1 recipe");
      if (fail) {
        await b.until(text("do not save the recipe again"));
        assert.equal(
          (await recipes()).filter((r) => r.title === title).length,
          1,
        );
        await b.click("Continue to recipes");
      } else await b.until("location.pathname==='/household'");
      assert.equal(
        (await recipes()).filter((r) => r.title === title).length,
        1,
      );
    }
  // All failed enrichments can be repaired without duplicating recipes.
  const count = (await recipes()).length;
  const result = await call(member, "CatalogService/SeedCatalogFromRecipes", {
    householdId: h,
  });
  assert(result.added >= 3);
  assert.equal((await recipes()).length, count);
  const direct = [
    "ingredient_metadata",
    "household_aisles",
    "recipes",
    "recipe_ingredients",
  ].map((t) => "/rest/v1/" + t);
  assert.deepEqual(
    b.responses.filter((r) => direct.includes(r.path)),
    [],
  );
  assert(
    b.responses.some(
      (r) =>
        r.path.endsWith("/GetCatalog") && r.contentType === "application/proto",
    ),
  );
  assert(
    b.responses.some(
      (r) =>
        r.path.endsWith("/EnsureCatalogIngredient") &&
        r.contentType === "application/proto" &&
        r.status === 200,
    ),
  );
  assert.deepEqual(b.errors, []);
  console.log(
    JSON.stringify({
      manualSingleBoardSaveAndEnrichment: true,
      postCommitWarningsVisible: true,
      noDuplicateRecipes: true,
      seedRepairsEnrichment: true,
      autocompleteGo: true,
      directRecipeCatalogCalls: 0,
      uncaughtExceptions: 0,
      productionTouched: false,
    }),
  );
} finally {
  await b.close();
}
