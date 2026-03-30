export type ParsedIngredient = {
  quantity: number | null;
  unit: string | null;
  name: string;
  raw_string: string;
};

const UNITS = new Set([
  // Volume
  "cup", "cups", "c",
  "tablespoon", "tablespoons", "tbsp", "tbs",
  "teaspoon", "teaspoons", "tsp",
  "fluid ounce", "fluid ounces", "fl oz",
  "pint", "pints", "pt",
  "quart", "quarts", "qt",
  "gallon", "gallons", "gal",
  "milliliter", "milliliters", "ml",
  "liter", "liters", "l",
  // Weight
  "ounce", "ounces", "oz",
  "pound", "pounds", "lb", "lbs",
  "gram", "grams", "g",
  "kilogram", "kilograms", "kg",
  // Count
  "clove", "cloves",
  "can", "cans",
  "jar", "jars",
  "package", "packages", "pkg",
  "slice", "slices",
  "piece", "pieces",
  "stalk", "stalks",
  "sprig", "sprigs",
  "bunch", "bunches",
  "head", "heads",
  "pinch", "pinches",
  "dash", "dashes",
  "handful", "handfuls",
  "strip", "strips",
]);

// Convert fraction strings to decimals
function parseFraction(s: string): number {
  // Unicode fractions
  const unicodeMap: Record<string, number> = {
    "½": 0.5, "⅓": 0.333, "⅔": 0.667,
    "¼": 0.25, "¾": 0.75,
    "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875,
  };
  if (unicodeMap[s]) return unicodeMap[s];

  // ASCII fraction: "1/2", "3/4"
  const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac) return parseInt(frac[1]) / parseInt(frac[2]);

  // Mixed number: "1 1/2"
  const mixed = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) return parseInt(mixed[1]) + parseInt(mixed[2]) / parseInt(mixed[3]);

  return parseFloat(s);
}

function parseQuantity(s: string): number | null {
  const trimmed = s.trim();
  if (!trimmed) return null;

  // Range: "2-3" → take first
  const range = trimmed.match(/^(\d+(?:\.\d+)?)\s*[-–]\s*\d/);
  if (range) return parseFloat(range[1]);

  // Number + fraction: "1 1/2"
  const mixed = trimmed.match(/^(\d+)\s+(\d+\/\d+|[½⅓⅔¼¾⅛⅜⅝⅞])$/);
  if (mixed) return parseFraction(mixed[1]) + parseFraction(mixed[2]);

  // Plain fraction or number
  if (/^[\d./]+$/.test(trimmed) || /^[½⅓⅔¼¾⅛⅜⅝⅞]$/.test(trimmed)) {
    const val = parseFraction(trimmed);
    return isNaN(val) ? null : val;
  }

  return null;
}

export function parseIngredient(raw: string): ParsedIngredient {
  let s = raw.trim();

  // Strip leading bullet / dash
  s = s.replace(/^[-•–]\s*/, "");

  // Remove parenthetical size notes like "(14.5 oz)" that appear mid-string
  // but keep the ingredient name
  s = s.replace(/\s*\(\s*[\d.]+\s*oz\s*\)/gi, "");

  // ── Quantity ──────────────────────────────────────────────────────────────

  // Match: optional number + optional fraction (e.g. "1 1/2", "½", "2")
  const qtyPattern = /^([\d½⅓⅔¼¾⅛⅜⅝⅞]+(?:\s+[\d]+\/[\d]+)?(?:\/[\d]+)?(?:\.\d+)?)\s*/;
  const qtyMatch = s.match(qtyPattern);
  let quantity: number | null = null;
  if (qtyMatch) {
    quantity = parseQuantity(qtyMatch[1]);
    s = s.slice(qtyMatch[0].length);
  }

  // ── Unit ──────────────────────────────────────────────────────────────────

  let unit: string | null = null;
  // Try multi-word units first ("fluid ounce", "fl oz"), then single-word
  const sLower = s.toLowerCase();
  const sortedUnits = [...UNITS].sort((a, b) => b.length - a.length);
  for (const u of sortedUnits) {
    if (sLower.startsWith(u) && (sLower[u.length] === " " || sLower[u.length] === "." || sLower.length === u.length)) {
      unit = u;
      s = s.slice(u.length).replace(/^[.\s]+/, "");
      break;
    }
  }

  // ── Name ──────────────────────────────────────────────────────────────────

  // Strip trailing preparation notes after comma: ", minced", ", chopped"
  let name = s.replace(/\s*,\s*(minced|chopped|diced|sliced|grated|shredded|crushed|peeled|trimmed|halved|quartered|roughly|finely|thinly|coarsely|lightly|packed|fresh|frozen|thawed|drained|rinsed|cooked|softened|melted|room temperature).*$/i, "").trim();

  // If nothing was parsed, the whole string is the name
  if (!name) name = raw.trim();

  return { quantity, unit, name, raw_string: raw };
}

export function parseIngredients(raws: string[]): ParsedIngredient[] {
  return raws.map(parseIngredient);
}
