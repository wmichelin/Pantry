/**
 * Plan (and optionally print SQL for) cleaning ingredient_metadata + recipe_ingredients
 * with the current parseIngredient / catalogNameFromRaw logic.
 *
 * Usage:
 *   bun run scripts/backfill-catalog-names.ts plan.json > backfill.sql
 *
 * plan.json shape:
 * {
 *   "catalog": [{ "id", "household_id", "normalized_name", "display_name" }],
 *   "recipe_ingredients": [{ "id", "raw_string", "name", "quantity", "unit" }]
 * }
 *
 * Apply the SQL via Supabase MCP execute_sql (or psql). Does not need a service role key.
 */

import { normalizeIngredient, titleCaseIngredient } from "../lib/normalize-ingredient";
import { parseIngredient } from "../lib/parse-ingredient";

/** Same logic as lib/ingredient-catalog.catalogNameFromRaw (kept local to avoid supabase client import). */
function catalogNameFromRaw(raw: string): { normalized: string; display: string } | null {
  const parsed = parseIngredient(raw);
  const normalized = normalizeIngredient(parsed.name);
  if (!normalized || normalized.endsWith(":")) return null;
  const display =
    parsed.name.trim() && parsed.name.trim() !== normalized
      ? parsed.name.trim()
      : titleCaseIngredient(normalized);
  return { normalized, display };
}

const planPath = process.argv[2];
if (!planPath) {
  console.error("Usage: bun run scripts/backfill-catalog-names.ts plan.json");
  process.exit(1);
}

const plan = JSON.parse(await Bun.file(planPath).text()) as {
  catalog: {
    id: string;
    household_id: string;
    normalized_name: string;
    display_name: string;
  }[];
  recipe_ingredients: {
    id: string;
    raw_string: string | null;
    name: string;
    quantity: number | string | null;
    unit: string | null;
  }[];
};

type CatalogRow = (typeof plan.catalog)[number];

const byHousehold = new Map<string, CatalogRow[]>();
for (const row of plan.catalog) {
  const list = byHousehold.get(row.household_id) ?? [];
  list.push(row);
  byHousehold.set(row.household_id, list);
}

const sql: string[] = ["begin;"];

let catalogUpdated = 0;
let catalogMerged = 0;
let catalogDeleted = 0;
let recipeUpdated = 0;

for (const [householdId, rows] of byHousehold) {
  const byNorm = new Map(rows.map((r) => [r.normalized_name, r]));
  const processed = new Set<string>();

  // First pass: compute intended target for each row
  type Intent =
    | { kind: "delete" }
    | { kind: "keep"; display: string }
    | { kind: "rename"; normalized: string; display: string };

  const intents = new Map<string, Intent>();

  for (const row of rows) {
    const cleaned = catalogNameFromRaw(row.display_name || row.normalized_name);
    if (!cleaned) {
      intents.set(row.id, { kind: "delete" });
      continue;
    }
    if (cleaned.normalized === row.normalized_name) {
      if (cleaned.display !== row.display_name) {
        intents.set(row.id, { kind: "keep", display: cleaned.display });
      }
      continue;
    }
    intents.set(row.id, {
      kind: "rename",
      normalized: cleaned.normalized,
      display: cleaned.display,
    });
  }

  // Apply deletes (section headers etc.)
  for (const row of rows) {
    const intent = intents.get(row.id);
    if (intent?.kind !== "delete") continue;
    sql.push(
      `-- delete junk catalog row: ${JSON.stringify(row.display_name)}`,
      `delete from public.ingredient_store_availability where ingredient_metadata_id = '${row.id}';`,
      `delete from public.ingredient_metadata where id = '${row.id}';`
    );
    byNorm.delete(row.normalized_name);
    catalogDeleted++;
    processed.add(row.id);
  }

  // Apply renames / merges
  for (const row of rows) {
    if (processed.has(row.id)) continue;
    const intent = intents.get(row.id);
    if (!intent) continue;

    if (intent.kind === "keep") {
      sql.push(
        `update public.ingredient_metadata set display_name = ${sqlStr(intent.display)} where id = '${row.id}';`
      );
      catalogUpdated++;
      continue;
    }

    if (intent.kind !== "rename") continue;

    const target = byNorm.get(intent.normalized);
    if (target && target.id !== row.id) {
      // Merge into existing clean row
      sql.push(
        `-- merge ${JSON.stringify(row.normalized_name)} → ${JSON.stringify(intent.normalized)}`,
        `update public.ingredient_store_availability isa
           set ingredient_metadata_id = '${target.id}'
         where ingredient_metadata_id = '${row.id}'
           and not exists (
             select 1 from public.ingredient_store_availability x
             where x.ingredient_metadata_id = '${target.id}' and x.store_id = isa.store_id
           );`,
        `delete from public.ingredient_store_availability where ingredient_metadata_id = '${row.id}';`,
        `update public.shopping_list_checks
           set normalized_name = ${sqlStr(intent.normalized)}
         where household_id = '${householdId}'
           and normalized_name = ${sqlStr(row.normalized_name)}
           and not exists (
             select 1 from public.shopping_list_checks c2
             where c2.household_id = '${householdId}'
               and c2.normalized_name = ${sqlStr(intent.normalized)}
           );`,
        `delete from public.shopping_list_checks
         where household_id = '${householdId}' and normalized_name = ${sqlStr(row.normalized_name)};`,
        `update public.shopping_list_manual_items
           set normalized_name = ${sqlStr(intent.normalized)}
         where household_id = '${householdId}'
           and normalized_name = ${sqlStr(row.normalized_name)}
           and not exists (
             select 1 from public.shopping_list_manual_items m2
             where m2.household_id = '${householdId}'
               and m2.normalized_name = ${sqlStr(intent.normalized)}
           );`,
        `delete from public.shopping_list_manual_items
         where household_id = '${householdId}' and normalized_name = ${sqlStr(row.normalized_name)};`,
        `delete from public.ingredient_metadata where id = '${row.id}';`
      );
      // Prefer cleaned display if target still looks title-cased from initcap
      sql.push(
        `update public.ingredient_metadata
           set display_name = ${sqlStr(intent.display)}
         where id = '${target.id}'
           and display_name is distinct from ${sqlStr(intent.display)};`
      );
      byNorm.delete(row.normalized_name);
      catalogMerged++;
    } else {
      sql.push(
        `-- rename ${JSON.stringify(row.normalized_name)} → ${JSON.stringify(intent.normalized)}`,
        `update public.shopping_list_checks
           set normalized_name = ${sqlStr(intent.normalized)}
         where household_id = '${householdId}'
           and normalized_name = ${sqlStr(row.normalized_name)};`,
        `update public.shopping_list_manual_items
           set normalized_name = ${sqlStr(intent.normalized)}
         where household_id = '${householdId}'
           and normalized_name = ${sqlStr(row.normalized_name)};`,
        `update public.ingredient_metadata
           set normalized_name = ${sqlStr(intent.normalized)},
               display_name = ${sqlStr(intent.display)}
         where id = '${row.id}';`
      );
      byNorm.delete(row.normalized_name);
      byNorm.set(intent.normalized, {
        ...row,
        normalized_name: intent.normalized,
        display_name: intent.display,
      });
      catalogUpdated++;
    }
  }
}

// Recipe ingredients: re-parse from raw_string when present, else from name
for (const row of plan.recipe_ingredients) {
  const source = (row.raw_string && row.raw_string.trim()) || row.name;
  if (!source?.trim()) continue;
  const parsed = parseIngredient(source);
  const newName = parsed.name.toLowerCase().trim();
  if (!newName) continue;

  const qtyChanged = String(parsed.quantity) !== String(row.quantity);
  const unitChanged = (parsed.unit ?? null) !== (row.unit ?? null);
  const nameChanged = newName !== row.name;

  if (!qtyChanged && !unitChanged && !nameChanged) continue;

  sql.push(
    `update public.recipe_ingredients set
       quantity = ${parsed.quantity == null ? "null" : parsed.quantity},
       unit = ${parsed.unit == null ? "null" : sqlStr(parsed.unit)},
       name = ${sqlStr(newName)}
     where id = '${row.id}';`
  );
  recipeUpdated++;
}

sql.push("commit;");

console.error(
  JSON.stringify(
    {
      catalogUpdated,
      catalogMerged,
      catalogDeleted,
      recipeUpdated,
      statements: sql.length - 2,
    },
    null,
    2
  )
);

console.log(sql.join("\n"));

function sqlStr(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}
