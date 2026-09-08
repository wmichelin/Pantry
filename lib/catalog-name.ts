import { normalizeIngredient, titleCaseIngredient } from "./normalize-ingredient";
import { parseIngredient } from "./parse-ingredient";

/** Legacy catalog identity; shopping manual input intentionally stays literal. */
export function catalogNameFromRaw(raw: string): { normalized: string; display: string } | null {
  const parsed = parseIngredient(raw);
  const normalized = normalizeIngredient(parsed.name);
  if (!normalized || normalized.endsWith(":")) return null;
  const display = parsed.name.trim() && parsed.name.trim() !== normalized
    ? parsed.name.trim() : titleCaseIngredient(normalized);
  return { normalized, display };
}
