/**
 * Export a household ingredient catalog + aisle category ids for offline LLM assignment.
 *
 * Usage:
 *   bun run scripts/export-ingredient-categories.ts <householdId> [out.json]
 *
 * Requires EXPO_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.
 */

import { createClient } from "@supabase/supabase-js";
import { INGREDIENT_CATEGORIES } from "../lib/ingredient-categories";

const householdId = process.argv[2];
const outPath = process.argv[3] ?? `ingredient-categories-${householdId ?? "export"}.json`;

if (!householdId) {
  console.error(
    "Usage: bun run scripts/export-ingredient-categories.ts <householdId> [out.json]"
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

const { data, error } = await supabase
  .from("ingredient_metadata")
  .select("id, normalized_name, display_name, category")
  .eq("household_id", householdId)
  .order("display_name");

if (error) {
  console.error("Fetch failed:", error.message);
  process.exit(1);
}

const payload = {
  household_id: householdId,
  categories: INGREDIENT_CATEGORIES.map(({ id, label }) => ({ id, label })),
  ingredients: data ?? [],
};

await Bun.write(outPath, JSON.stringify(payload, null, 2) + "\n");
console.log(
  `Wrote ${payload.ingredients.length} ingredients + ${payload.categories.length} categories → ${outPath}`
);
