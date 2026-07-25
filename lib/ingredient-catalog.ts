import { supabase } from "./supabase";
import { normalizeIngredient, titleCaseIngredient } from "./normalize-ingredient";
import { parseIngredient } from "./parse-ingredient";

export type CatalogIngredient = {
  id: string;
  normalized_name: string;
  display_name: string;
  sort_order: number;
};

/** Strip qty/units/bullets from a raw ingredient string for catalog use. */
export function catalogNameFromRaw(raw: string): { normalized: string; display: string } | null {
  const parsed = parseIngredient(raw);
  const normalized = normalizeIngredient(parsed.name);
  if (!normalized || normalized.endsWith(":")) return null;
  // Prefer parser's casing when it kept letters; otherwise title-case the key.
  const display =
    parsed.name.trim() && parsed.name.trim() !== normalized
      ? parsed.name.trim()
      : titleCaseIngredient(normalized);
  return { normalized, display };
}

/** Ensure a catalog row exists. Does not overwrite display_name on existing rows. */
export async function ensureCatalogIngredient(
  householdId: string,
  name: string,
  opts?: { displayName?: string; sortOrder?: number }
): Promise<CatalogIngredient | null> {
  const cleaned = catalogNameFromRaw(name);
  if (!cleaned) return null;
  const { normalized, display } = cleaned;

  const { data: existing, error: existingError } = await supabase
    .from("ingredient_metadata")
    .select("id, normalized_name, display_name, sort_order")
    .eq("household_id", householdId)
    .eq("normalized_name", normalized)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return existing;

  const display_name = opts?.displayName?.trim() || display;

  let sort_order = opts?.sortOrder;
  if (sort_order == null) {
    const { data: maxRow } = await supabase
      .from("ingredient_metadata")
      .select("sort_order")
      .eq("household_id", householdId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    sort_order = (maxRow?.sort_order ?? 0) + 10;
  }

  const { data, error } = await supabase
    .from("ingredient_metadata")
    .insert({
      household_id: householdId,
      normalized_name: normalized,
      display_name,
      sort_order,
    })
    .select("id, normalized_name, display_name, sort_order")
    .single();

  if (error) {
    // Race: another client inserted the same key.
    if (error.code === "23505") {
      const { data: raced, error: raceError } = await supabase
        .from("ingredient_metadata")
        .select("id, normalized_name, display_name, sort_order")
        .eq("household_id", householdId)
        .eq("normalized_name", normalized)
        .single();
      if (raceError) throw raceError;
      return raced;
    }
    throw error;
  }
  return data;
}

/**
 * Seed the household catalog from recipe ingredient names.
 * Names are cleaned via parseIngredient (qty/units stripped) before insert.
 * Only inserts missing catalog rows — never touches recipes.
 */
export async function seedCatalogFromRecipes(householdId: string): Promise<number> {
  const { data: recipes, error: recipesError } = await supabase
    .from("recipes")
    .select("id")
    .eq("household_id", householdId);
  if (recipesError) throw recipesError;

  const recipeIds = (recipes ?? []).map((r) => r.id);
  if (recipeIds.length === 0) return 0;

  const { data: ings, error: ingsError } = await supabase
    .from("recipe_ingredients")
    .select("name")
    .in("recipe_id", recipeIds);
  if (ingsError) throw ingsError;

  const { data: existing, error: existingError } = await supabase
    .from("ingredient_metadata")
    .select("normalized_name, sort_order")
    .eq("household_id", householdId);
  if (existingError) throw existingError;

  const existingKeys = new Set((existing ?? []).map((m) => m.normalized_name));
  let maxOrder = Math.max(0, ...(existing ?? []).map((m) => m.sort_order));

  const toInsert: {
    household_id: string;
    normalized_name: string;
    display_name: string;
    sort_order: number;
  }[] = [];

  const seen = new Set<string>();
  for (const ing of ings ?? []) {
    const cleaned = catalogNameFromRaw(ing.name ?? "");
    if (!cleaned) continue;
    const { normalized, display } = cleaned;
    if (existingKeys.has(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    maxOrder += 10;
    toInsert.push({
      household_id: householdId,
      normalized_name: normalized,
      display_name: display,
      sort_order: maxOrder,
    });
  }

  if (toInsert.length === 0) return 0;

  const { error } = await supabase
    .from("ingredient_metadata")
    .upsert(toInsert, {
      onConflict: "household_id,normalized_name",
      ignoreDuplicates: true,
    });
  if (error) throw error;
  return toInsert.length;
}

export async function listCatalogIngredients(
  householdId: string
): Promise<CatalogIngredient[]> {
  const { data, error } = await supabase
    .from("ingredient_metadata")
    .select("id, normalized_name, display_name, sort_order")
    .eq("household_id", householdId)
    .order("display_name");
  if (error) throw error;
  return data ?? [];
}
