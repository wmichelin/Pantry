export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export function extractIngredients(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];

  // Ingredient position is meaningful: identical entries may belong to separate
  // recipe sections, so preserve the source list exactly instead of deduplicating it.
  return raw
    .map((item) => (typeof item === "string" ? decodeHtmlEntities(item.trim()) : ""))
    .filter(Boolean);
}
