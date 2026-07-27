/**
 * Import an LLM-generated aisle-category assignment dump into ingredient_metadata.
 *
 * Usage:
 *   bun run scripts/import-ingredient-categories.ts assignments.json [--dry-run]
 *
 * Dump shape:
 * {
 *   "household_id"?: string,          // required when matching by normalized_name
 *   "assignments": [
 *     { "id": "<uuid>", "category": "dairy" },
 *     { "normalized_name": "milk", "category": "dairy" }
 *   ]
 * }
 *
 * Requires EXPO_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.
 */

import { createClient } from "@supabase/supabase-js";
import { isIngredientCategoryId } from "../lib/ingredient-categories";

const DRY_RUN = process.argv.includes("--dry-run");
const fileArg = process.argv.find((a, i) => i >= 2 && !a.startsWith("--"));

if (!fileArg) {
  console.error(
    "Usage: bun run scripts/import-ingredient-categories.ts assignments.json [--dry-run]"
  );
  process.exit(1);
}

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "Missing env vars. Ensure EXPO_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in .env"
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false },
});

type Assignment = {
  id?: string;
  normalized_name?: string;
  category: string;
};

const dump = JSON.parse(await Bun.file(fileArg).text()) as {
  household_id?: string;
  assignments?: Assignment[];
};

const assignments = dump.assignments ?? [];
if (assignments.length === 0) {
  console.error("No assignments found in dump.");
  process.exit(1);
}

type Update = { id: string; category: string; label: string };
const updates: Update[] = [];
let skipped = 0;

for (const row of assignments) {
  if (!isIngredientCategoryId(row.category)) {
    console.warn(`Skip invalid category "${row.category}"`);
    skipped++;
    continue;
  }

  if (row.id) {
    updates.push({
      id: row.id,
      category: row.category,
      label: row.id,
    });
    continue;
  }

  if (!row.normalized_name) {
    console.warn("Skip assignment missing id and normalized_name");
    skipped++;
    continue;
  }

  if (!dump.household_id) {
    console.warn(
      `Skip "${row.normalized_name}" — household_id required for name match`
    );
    skipped++;
    continue;
  }

  const { data, error } = await supabase
    .from("ingredient_metadata")
    .select("id")
    .eq("household_id", dump.household_id)
    .eq("normalized_name", row.normalized_name)
    .maybeSingle();

  if (error) {
    console.error(`Lookup failed for ${row.normalized_name}:`, error.message);
    process.exit(1);
  }
  if (!data) {
    console.warn(`Skip unknown ingredient "${row.normalized_name}"`);
    skipped++;
    continue;
  }

  updates.push({
    id: data.id,
    category: row.category,
    label: row.normalized_name,
  });
}

console.log(
  `${DRY_RUN ? "[dry-run] " : ""}Would update ${updates.length} rows (${skipped} skipped).\n`
);

if (DRY_RUN) {
  for (const u of updates.slice(0, 20)) {
    console.log(`  ${u.label} → ${u.category}`);
  }
  if (updates.length > 20) console.log(`  …and ${updates.length - 20} more`);
  process.exit(0);
}

const BATCH = 50;
let applied = 0;
for (let i = 0; i < updates.length; i += BATCH) {
  const batch = updates.slice(i, i + BATCH);
  const results = await Promise.all(
    batch.map((u) =>
      supabase
        .from("ingredient_metadata")
        .update({ category: u.category })
        .eq("id", u.id)
    )
  );
  for (const { error } of results) {
    if (error) {
      console.error("Update failed:", error.message);
      process.exit(1);
    }
  }
  applied += batch.length;
  console.log(`Updated ${applied}/${updates.length}`);
}

console.log("Done.");
