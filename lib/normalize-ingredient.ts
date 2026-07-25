/** Shared normalize for ingredient / shopping-list keys. */
export const normalizeIngredient = (name: string) => name.toLowerCase().trim();

/** Simple title-case for display when no preferred casing is known. */
export const titleCaseIngredient = (name: string) =>
  name.replace(/\b\w/g, (c) => c.toUpperCase());
