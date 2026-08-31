import type { RecipeInstruction } from "../../lib/scrape-types.ts";

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

function extractInstructionText(item: unknown): string[] {
  if (Array.isArray(item)) return item.flatMap(extractInstructionText);

  if (typeof item === "string") {
    const value = item.trim();

    // Some sites serialize HowToStep objects as single-quoted pseudo-dicts.
    // Extract their text without evaluating site-controlled content.
    if (value.startsWith("{") && (value.includes("'text'") || value.includes('"text"'))) {
      const match = value.match(/['"]text['"]\s*:\s*['"](.+)/s);
      if (match) {
        const text = match[1].replace(/['"]\s*[,}]?\s*$/, "").trim();
        if (text) return [decodeHtmlEntities(text)];
      }
    }

    return value ? [decodeHtmlEntities(value)] : [];
  }

  if (!item || typeof item !== "object") return [];

  const record = item as Record<string, unknown>;
  if (Array.isArray(record.itemListElement)) {
    return record.itemListElement.flatMap(extractInstructionText);
  }

  const text = typeof record.text === "string"
    ? record.text
    : typeof record.name === "string"
      ? record.name
      : "";
  const trimmed = text.trim();
  return trimmed ? [decodeHtmlEntities(trimmed)] : [];
}

export function extractInstructions(raw: unknown): RecipeInstruction[] {
  if (!raw) return [];

  const items = Array.isArray(raw) ? raw : [raw];
  return items.flatMap((item): RecipeInstruction[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return extractInstructionText(item);
    }

    const record = item as Record<string, unknown>;
    if (record["@type"] !== "HowToSection") {
      return extractInstructionText(record);
    }

    const steps = extractInstructionText(record.itemListElement);
    const rawTitle = typeof record.name === "string" ? record.name.trim() : "";
    const title = rawTitle ? decodeHtmlEntities(rawTitle) : "";

    // A nameless section carries no useful hierarchy, so retain its steps as a
    // legacy flat sequence instead of manufacturing an empty heading.
    if (!title) return steps;
    if (steps.length === 0) return [];

    return [{ type: "section", title, steps }];
  });
}

export function extractIngredients(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];

  // Ingredient position is meaningful: identical entries may belong to separate
  // recipe sections, so preserve the source list exactly instead of deduplicating it.
  return raw
    .map((item) => (typeof item === "string" ? decodeHtmlEntities(item.trim()) : ""))
    .filter(Boolean);
}
