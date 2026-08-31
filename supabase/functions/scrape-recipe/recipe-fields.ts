export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (entity, hexCode, decimalCode) => {
      const codePoint = parseInt(hexCode ?? decimalCode, hexCode ? 16 : 10);

      // String.fromCodePoint throws for invalid Unicode scalar values. Preserve
      // malformed entities as text instead of failing an otherwise valid import.
      if (
        codePoint === 0 ||
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ) {
        return entity;
      }

      return String.fromCodePoint(codePoint);
    })
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
