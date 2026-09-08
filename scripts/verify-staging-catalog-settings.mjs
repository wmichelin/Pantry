// Staging-only live parity, using fresh identities and generated households.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  publicKey,
  identity,
  rpc,
  rest,
  origin,
} from "./verify-staging-recipe-import.mjs";

export async function catalogFixture() {
  const key = await publicKey(),
    owner = await identity(key, "catalog-owner"),
    member = await identity(key, "catalog-member"),
    outsider = await identity(key, "catalog-outsider");
  async function call(user, method, input) {
    const r = await rpc(user?.token, method, input);
    assert.equal(r.status, 200, `${method} failed (${r.status})`);
    return r.body;
  }
  const { household } = await call(owner, "HouseholdService/CreateHousehold", {
    name: "Go Catalog Acceptance",
    displayName: "Owner",
  });
  const { household: other } = await call(
    owner,
    "HouseholdService/CreateHousehold",
    { name: "Go Catalog Other", displayName: "Owner" },
  );
  await call(member, "HouseholdService/JoinHousehold", {
    inviteCode: household.inviteCode,
    displayName: "Member",
  });
  return { key, owner, member, outsider, household, other, call };
}
async function verify() {
  const { key, owner, member, outsider, household, other, call } =
      await catalogFixture(),
    h = household.id;
  const input = { householdId: h };
  const get = async () =>
    (await call(owner, "CatalogService/GetCatalog", input)).items ?? [];
  const fixtures = JSON.parse(
    await readFile(
      new URL("../contracts/fixtures/catalog-names.json", import.meta.url),
      "utf8",
    ),
  );
  const seen = new Map();
  for (const f of fixtures) {
    const { item } = await call(
      member,
      "CatalogService/EnsureCatalogIngredient",
      { ...input, rawName: f.raw },
    );
    if (f.normalized === null) {
      assert.equal(item, undefined);
      continue;
    }
    if (seen.has(f.normalized))
      assert.equal(
        item.id,
        seen.get(f.normalized).id,
        "Duplicate lost identity",
      );
    else {
      assert.equal(item.normalizedName, f.normalized);
      assert.equal(item.displayName, f.display);
      seen.set(f.normalized, item);
    }
  }
  assert.equal((await get()).length, seen.size);
  const flour = seen.get("flour");
  await call(member, "CatalogService/UpdateCatalogIngredient", {
    ...input,
    ingredientId: flour.id,
    displayName: " My Flour ",
    category: " custom ",
  });
  const preserved = (
    await call(owner, "CatalogService/EnsureCatalogIngredient", {
      ...input,
      rawName: "3 cups flour",
      displayName: "Overwrite",
      sortOrder: 0,
      category: "other",
    })
  ).item;
  assert.equal(preserved.id, flour.id);
  assert.equal(preserved.displayName, "My Flour");
  assert.equal(preserved.category, "custom");
  assert.equal(preserved.sortOrder, flour.sortOrder);
  const legacy = await rest(
    key,
    owner.token,
    `ingredient_metadata?household_id=eq.${h}&select=id,normalized_name,display_name,category,sort_order&order=display_name,id`,
  );
  assert.deepEqual(
    (await get()).map((i) => ({
      id: i.id,
      normalized_name: i.normalizedName,
      display_name: i.displayName ?? "",
      category: i.category ?? "other",
      sort_order: i.sortOrder ?? 0,
    })),
    legacy,
  );
  let view = (await call(member, "AisleService/GetHouseholdAisles", input))
    .view;
  assert.equal(view.aisles.length, 17);
  await call(member, "AisleService/CreateHouseholdAisle", {
    ...input,
    label: "Custom",
  });
  view = (
    await call(member, "AisleService/CreateHouseholdAisle", {
      ...input,
      label: "Custom",
    })
  ).view;
  assert(view.aisles.some((a) => a.key === "custom_2"));
  view = (
    await call(member, "AisleService/CreateHouseholdAisle", {
      ...input,
      label: "酒",
    })
  ).view;
  assert(view.aisles.some((a) => a.key === "aisle"));
  view = (
    await call(member, "AisleService/CreateHouseholdAisle", {
      ...input,
      label: "Other",
    })
  ).view;
  assert(view.aisles.some((a) => a.key === "aisle_other"));
  const stale = view.revision;
  view = (
    await call(member, "AisleService/SaveHouseholdAisleOrder", {
      ...input,
      revision: view.revision,
      keys: view.aisles.map((a) => a.key).reverse(),
    })
  ).view;
  assert.equal(view.aisles.at(-1).key, "other");
  assert.notEqual(
    (
      await rpc(owner.token, "AisleService/SaveHouseholdAisleOrder", {
        ...input,
        revision: stale,
        keys: view.aisles.map((a) => a.key),
      })
    ).status,
    200,
  );
  const [mirror] = await rest(
    key,
    owner.token,
    `households?id=eq.${h}&select=aisle_category_order`,
  );
  assert.deepEqual(
    mirror.aisle_category_order,
    view.aisles.map((a) => a.key),
  );
  const { recipe } = await call(owner, "RecipeService/SaveRecipe", {
    ...input,
    title: "Catalog removal preserves recipe",
    ingredients: [{ name: "flour" }],
  });
  await call(member, "AisleService/RemoveHouseholdAisle", {
    ...input,
    key: "custom",
  });
  assert.equal((await get()).find((i) => i.id === flour.id).category, "other");
  let settings = (
    await call(member, "HouseholdSettingsService/GetHouseholdSettings", input)
  ).settings;
  assert.equal(settings.household.inviteCode, household.inviteCode);
  assert.equal(settings.members.length, 2);
  settings = (
    await call(member, "HouseholdSettingsService/AddHouseholdStore", {
      ...input,
      name: " Shop ",
    })
  ).settings;
  const store = settings.stores[0];
  assert.equal(store.name, "Shop");
  assert.equal(store.sortOrder ?? 0, 0);
  await rest(key, owner.token, "ingredient_store_availability", "POST", {
    ingredient_metadata_id: flour.id,
    store_id: store.id,
  });
  await call(member, "HouseholdSettingsService/RemoveHouseholdStore", {
    ...input,
    storeId: store.id,
  });
  assert.deepEqual(
    await rest(
      key,
      owner.token,
      `ingredient_store_availability?store_id=eq.${store.id}`,
    ),
    [],
  );
  await call(member, "CatalogService/RemoveCatalogIngredient", {
    ...input,
    ingredientId: flour.id,
  });
  assert.equal(
    (
      await rest(
        key,
        owner.token,
        `recipe_ingredients?recipe_id=eq.${recipe.id}&select=name`,
      )
    )[0].name,
    "flour",
  );
  assert.equal(
    (await call(member, "CatalogService/SeedCatalogFromRecipes", input)).added,
    1,
  );
  assert.equal(
    (await call(owner, "CatalogService/SeedCatalogFromRecipes", input)).added ??
      0,
    0,
  );
  const foreign = (
    await call(owner, "CatalogService/EnsureCatalogIngredient", {
      householdId: other.id,
      rawName: "foreign",
    })
  ).item;
  for (const method of ["RemoveCatalogIngredient", "UpdateCatalogIngredient"])
    assert.notEqual(
      (
        await rpc(owner.token, "CatalogService/" + method, {
          ...input,
          ingredientId: foreign.id,
          displayName: "Bad",
          category: "other",
        })
      ).status,
      200,
    );
  const methods = [
    ["CatalogService/GetCatalog", {}],
    ["CatalogService/EnsureCatalogIngredient", { rawName: "bad" }],
    ["CatalogService/SeedCatalogFromRecipes", {}],
    [
      "CatalogService/UpdateCatalogIngredient",
      { ingredientId: foreign.id, displayName: "bad" },
    ],
    ["CatalogService/RemoveCatalogIngredient", { ingredientId: foreign.id }],
    ["AisleService/GetHouseholdAisles", {}],
    ["AisleService/CreateHouseholdAisle", { label: "bad" }],
    ["AisleService/RemoveHouseholdAisle", { key: "custom_2" }],
    [
      "AisleService/SaveHouseholdAisleOrder",
      { revision: view.revision, keys: ["other"] },
    ],
    ["HouseholdSettingsService/GetHouseholdSettings", {}],
    ["HouseholdSettingsService/AddHouseholdStore", { name: "bad" }],
    ["HouseholdSettingsService/RemoveHouseholdStore", { storeId: store.id }],
  ];
  const before = await get();
  for (const [method, extra] of methods) {
    assert.equal((await rpc(null, method, { ...input, ...extra })).status, 401);
    assert.notEqual(
      (await rpc(outsider.token, method, { ...input, ...extra })).status,
      200,
    );
  }
  assert.deepEqual(await get(), before);
  // >1,000 source rows and >1,000 catalog rows must not inherit PostgREST truncation.
  const [bulk] = await rest(key, owner.token, "recipes", "POST", {
    household_id: h,
    created_by: owner.id,
    title: "Catalog bulk seed fixture",
  });
  await rest(
    key,
    owner.token,
    "recipe_ingredients",
    "POST",
    Array.from({ length: 1001 }, (_, i) => ({
      recipe_id: bulk.id,
      name: `bulk item ${i}`,
    })),
  );
  try {
    assert.equal(
      (await call(member, "CatalogService/SeedCatalogFromRecipes", input))
        .added,
      1001,
    );
    const large = await get();
    assert.equal(large.length, before.length + 1001);
    assert(large.some((i) => i.normalizedName === "bulk item 1000"));
    assert.equal(
      (await call(owner, "CatalogService/SeedCatalogFromRecipes", input))
        .added ?? 0,
      0,
    );
  } finally {
    await rest(
      key,
      owner.token,
      `ingredient_metadata?household_id=eq.${h}&normalized_name=like.bulk%20item%20*`,
      "DELETE",
    );
    await rest(
      key,
      owner.token,
      `recipes?id=eq.${bulk.id}&household_id=eq.${h}`,
      "DELETE",
    );
  }
  console.log(
    JSON.stringify({
      staging: origin,
      parserFixtures: fixtures.length,
      ownerMember: true,
      anonymousOutsiderDenied: methods.length,
      metadataParity: true,
      aisleMirrorAndStaleGuard: true,
      scopedCascades: true,
      largeSeedAndRead: 1001,
      bulkFixturesRemoved: true,
      productionTouched: false,
    }),
  );
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  await verify();
