/**
 * Re-parses all recipe_ingredients rows using the current parseIngredient logic
 * and writes the updated quantity/unit/name back to the database.
 *
 * Usage:
 *   bun run scripts/migrate-ingredients.ts           # live run
 *   bun run scripts/migrate-ingredients.ts --dry-run # preview only
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in .env (Project Settings → API → service_role).
 */

import { createClient } from "@supabase/supabase-js";
import { parseIngredient } from "../lib/parse-ingredient";

const DRY_RUN = process.argv.includes("--dry-run");

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

// ── Fetch ──────────────────────────────────────────────────────────────────

const { data: rows, error: fetchError } = await supabase
  .from("recipe_ingredients")
  .select("id, raw_string, quantity, unit, name")
  .not("raw_string", "is", null);

if (fetchError) {
  console.error("Fetch failed:", fetchError.message);
  process.exit(1);
}

console.log(`Fetched ${rows.length} rows.\n`);

// ── Parse & diff ───────────────────────────────────────────────────────────

type Update = {
  id: string;
  quantity: number | null;
  unit: string | null;
  name: string;
  prev: { quantity: string | null; unit: string | null; name: string };
};

const updates: Update[] = [];

for (const row of rows) {
  const parsed = parseIngredient(row.raw_string);
  const newName = parsed.name.toLowerCase();

  const qtyChanged = String(parsed.quantity) !== String(row.quantity);
  const unitChanged = (parsed.unit ?? null) !== (row.unit ?? null);
  const nameChanged = newName !== row.name;

  if (qtyChanged || unitChanged || nameChanged) {
    updates.push({
      id: row.id,
      quantity: parsed.quantity,
      unit: parsed.unit,
      name: newName,
      prev: { quantity: row.quantity, unit: row.unit, name: row.name },
    });
  }
}

console.log(`${updates.length} rows will change${DRY_RUN ? " (dry run)" : ""}:\n`);

for (const u of updates) {
  console.log(`  raw: ${JSON.stringify(rows.find(r => r.id === u.id)!.raw_string)}`);
  if (String(u.quantity) !== String(u.prev.quantity))
    console.log(`    qty:  ${u.prev.quantity} → ${u.quantity}`);
  if (u.unit !== u.prev.unit)
    console.log(`    unit: ${u.prev.unit ?? "(null)"} → ${u.unit ?? "(null)"}`);
  if (u.name !== u.prev.name)
    console.log(`    name: ${JSON.stringify(u.prev.name)} → ${JSON.stringify(u.name)}`);
  console.log();
}

if (DRY_RUN) {
  console.log("Dry run complete — no changes written.");
  process.exit(0);
}

// ── Write ──────────────────────────────────────────────────────────────────

let ok = 0;
let fail = 0;

for (const u of updates) {
  const { error } = await supabase
    .from("recipe_ingredients")
    .update({ quantity: u.quantity, unit: u.unit, name: u.name })
    .eq("id", u.id);

  if (error) {
    console.error(`  FAILED ${u.id}: ${error.message}`);
    fail++;
  } else {
    ok++;
  }
}

console.log(`\nDone. ${ok} updated, ${fail} failed.`);
