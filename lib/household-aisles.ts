import { supabase } from "./supabase";
import {
  DEFAULT_INGREDIENT_CATEGORY,
  INGREDIENT_CATEGORIES,
  aisleKeyFromLabel,
  type IngredientCategory,
} from "./ingredient-categories";

export type HouseholdAisleRow = {
  id: string;
  household_id: string;
  key: string;
  label: string;
  sort_order: number;
};

function toCategory(row: { key: string; label: string; sort_order: number }): IngredientCategory {
  return { id: row.key, label: row.label, pitch: row.sort_order };
}

/** Ensure default aisles exist, then return them in walk order. */
export async function listHouseholdAisles(
  householdId: string
): Promise<IngredientCategory[]> {
  await ensureHouseholdAislesSeeded(householdId);

  const { data, error } = await supabase
    .from("household_aisles")
    .select("key, label, sort_order")
    .eq("household_id", householdId)
    .order("sort_order", { ascending: true });
  if (error) throw error;

  const aisles = (data ?? []).map(toCategory);
  // Always keep Other last if present.
  const other = aisles.find((a) => a.id === DEFAULT_INGREDIENT_CATEGORY);
  const rest = aisles.filter((a) => a.id !== DEFAULT_INGREDIENT_CATEGORY);
  return other ? [...rest, other] : rest;
}

export async function ensureHouseholdAislesSeeded(
  householdId: string
): Promise<void> {
  const { count, error: countError } = await supabase
    .from("household_aisles")
    .select("id", { count: "exact", head: true })
    .eq("household_id", householdId);
  if (countError) throw countError;
  if ((count ?? 0) > 0) return;

  const rows = INGREDIENT_CATEGORIES.map((c) => ({
    household_id: householdId,
    key: c.id,
    label: c.label,
    sort_order: c.pitch,
  }));
  const { error } = await supabase.from("household_aisles").upsert(rows, {
    onConflict: "household_id,key",
    ignoreDuplicates: true,
  });
  if (error) throw error;
}

export async function saveHouseholdAisleOrder(
  householdId: string,
  ordered: IngredientCategory[]
): Promise<void> {
  // Keep Other last in persisted order.
  const withoutOther = ordered.filter((c) => c.id !== DEFAULT_INGREDIENT_CATEGORY);
  const other = ordered.find((c) => c.id === DEFAULT_INGREDIENT_CATEGORY);
  const final = other ? [...withoutOther, other] : withoutOther;

  const updates = final.map((cat, i) =>
    supabase
      .from("household_aisles")
      .update({ sort_order: (i + 1) * 10 })
      .eq("household_id", householdId)
      .eq("key", cat.id)
  );
  const results = await Promise.all(updates);
  for (const { error } of results) {
    if (error) throw error;
  }

  // Mirror into legacy column for older readers.
  const { error: mirrorError } = await supabase
    .from("households")
    .update({ aisle_category_order: final.map((c) => c.id) })
    .eq("id", householdId);
  if (mirrorError) throw mirrorError;
}

export async function createHouseholdAisle(
  householdId: string,
  label: string
): Promise<IngredientCategory> {
  const trimmed = label.trim();
  if (!trimmed) throw new Error("Aisle name is required");

  let key = aisleKeyFromLabel(trimmed);
  if (key === DEFAULT_INGREDIENT_CATEGORY) {
    key = `aisle_${key}`;
  }

  const { data: existing } = await supabase
    .from("household_aisles")
    .select("key")
    .eq("household_id", householdId);
  const used = new Set((existing ?? []).map((r) => r.key));
  let candidate = key;
  let n = 2;
  while (used.has(candidate)) {
    candidate = `${key}_${n}`;
    n += 1;
  }

  const { data: maxRow } = await supabase
    .from("household_aisles")
    .select("sort_order")
    .eq("household_id", householdId)
    .neq("key", DEFAULT_INGREDIENT_CATEGORY)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const sort_order = (maxRow?.sort_order ?? 0) + 10;

  const { data, error } = await supabase
    .from("household_aisles")
    .insert({
      household_id: householdId,
      key: candidate,
      label: trimmed,
      sort_order,
    })
    .select("key, label, sort_order")
    .single();
  if (error) throw error;

  // Keep Other last.
  const aisles = await listHouseholdAisles(householdId);
  await saveHouseholdAisleOrder(householdId, aisles);

  return toCategory(data);
}

/**
 * Delete an aisle and move ingredients that used it to Other.
 * Cannot delete Other.
 */
export async function deleteHouseholdAisle(
  householdId: string,
  key: string
): Promise<void> {
  if (key === DEFAULT_INGREDIENT_CATEGORY) {
    throw new Error("Cannot delete the Other aisle");
  }

  const { error: moveError } = await supabase
    .from("ingredient_metadata")
    .update({ category: DEFAULT_INGREDIENT_CATEGORY })
    .eq("household_id", householdId)
    .eq("category", key);
  if (moveError) throw moveError;

  const { error } = await supabase
    .from("household_aisles")
    .delete()
    .eq("household_id", householdId)
    .eq("key", key);
  if (error) throw error;
}
