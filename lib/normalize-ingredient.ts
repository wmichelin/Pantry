/** Shared normalize for ingredient / shopping-list keys. */
export const normalizeIngredient = (name: string) => name.toLowerCase().trim();

/**
 * Looser form for autocomplete matching only (not DB keys).
 * Collapses hyphens/dashes and whitespace so "all purpose" matches "all-purpose".
 */
export const searchableIngredient = (name: string) =>
  normalizeIngredient(name)
    .replace(/[-–—_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Simple title-case for display when no preferred casing is known. */
export const titleCaseIngredient = (name: string) =>
  name.replace(/\b\w/g, (c) => c.toUpperCase());
