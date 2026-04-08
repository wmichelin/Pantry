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
  const unicodeMap: Record<string, number> = {
    "½": 0.5, "⅓": 0.333, "⅔": 0.667,
    "¼": 0.25, "¾": 0.75,
    "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875,
  };
  if (unicodeMap[s] !== undefined) return unicodeMap[s];

  const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac) return parseInt(frac[1]) / parseInt(frac[2]);

  return parseFloat(s);
}

export function parseIngredient(raw: string): ParsedIngredient {
  let s = raw.trim();

  // ── Pre-processing ────────────────────────────────────────────────────────

  // Strip leading bullet / dash
  s = s.replace(/^[-•–]\s*/, "");

  // Strip "for serving:" prefix — keep the first item as the ingredient name
  s = s.replace(/^for serving\s*:\s*/i, "");

  // Strip "to taste X" prefix (inverted order from some scrapers)
  s = s.replace(/^to taste\s+/i, "");

  // Strip em dash / en dash inline descriptions ("soy sauce – Adds umami…")
  s = s.replace(/\s+[–—]\s+.+$/, "");

  // Strip parentheticals — loop handles nested parens, then strip unclosed
  let prev = "";
  while (prev !== s) {
    prev = s;
    s = s.replace(/\s*\([^()]*\)/g, "");
  }
  s = s.replace(/\s*\([^)]*$/, ""); // unclosed paren at end

  // Strip inline "N-oz" / "N-ounce" size descriptors (e.g. "14-oz can" → "can")
  s = s.replace(/\b\d+\s*-\s*(?:oz|ounce)s?\b\s*/gi, "");

  // Rewrite dash-notation mixed numbers before qty parsing ("1-1/2" → "1 1/2")
  s = s.replace(/^(\d+)-(\d+\/\d+)(\s|$)/, "$1 $2$3");

  // Collapse multiple spaces left by stripping
  s = s.replace(/\s{2,}/g, " ").trim();

  // ── Quantity ──────────────────────────────────────────────────────────────

  let quantity: number | null = null;
  let m: RegExpMatchArray | null;

  // Fraction–fraction range: 1/4-1/2 → take upper bound
  if ((m = s.match(/^(\d+\/\d+)\s*[-–]\s*(\d+\/\d+)\s+/))) {
    quantity = parseFraction(m[2]);
    s = s.slice(m[0].length);
  // Fraction–integer range: 1/2-1 → take upper bound
  } else if ((m = s.match(/^(\d+\/\d+)\s*[-–]\s*(\d+)\s+/))) {
    quantity = parseFloat(m[2]);
    s = s.slice(m[0].length);
  // Integer–integer range: 2-3 → take upper bound
  } else if ((m = s.match(/^(\d+)\s*[-–]\s*(\d+)\s+/))) {
    quantity = parseFloat(m[2]);
    s = s.slice(m[0].length);
  // Mixed number: "1 1/2" or "1 ½"
  } else if ((m = s.match(/^(\d+)\s+(\d+\/\d+|[½⅓⅔¼¾⅛⅜⅝⅞])\s+/))) {
    quantity = parseInt(m[1]) + parseFraction(m[2]);
    s = s.slice(m[0].length);
  // Single value: "½", "1/2", "2", "2.5"
  } else if ((m = s.match(/^([½⅓⅔¼¾⅛⅜⅝⅞]|\d+(?:\/\d+)?(?:\.\d+)?)\s+/))) {
    const val = parseFraction(m[1]);
    if (!isNaN(val)) { quantity = val; s = s.slice(m[0].length); }
  }

  // ── Unit ──────────────────────────────────────────────────────────────────

  let unit: string | null = null;
  const sLower = s.toLowerCase();
  const sortedUnits = [...UNITS].sort((a, b) => b.length - a.length);
  for (const u of sortedUnits) {
    if (sLower.startsWith(u) && (sLower[u.length] === " " || sLower[u.length] === "." || sLower.length === u.length)) {
      unit = u;
      s = s.slice(u.length).replace(/^[.\s]+/, "").replace(/^of\s+/i, "");
      break;
    }
  }

  // ── Name ──────────────────────────────────────────────────────────────────

  let name = s;

  // Strip trailing prep / qualifier notes after comma
  name = name.replace(
    /\s*,\s*(minced|chopped|diced|sliced|grated|shredded|crushed|peeled|trimmed|halved|quartered|roughly|finely|thinly|coarsely|lightly|packed|fresh|frozen|thawed|drained|rinsed|cooked|softened|melted|room temperature|juiced|julienned|divided|optional|to taste|as needed|use more as needed|or more|or to taste|if desired|for garnish|for serving).*$/i,
    ""
  ).trim();

  // Strip "inch piece of" measurement descriptor (e.g. "inch piece of fresh ginger")
  name = name.replace(/^(?:\d+(?:\.\d+)?[\s-])?inch\s+piece\s+of\s+/i, "").trim();

  // Strip leading prep verbs when they precede the actual ingredient
  name = name.replace(/^(?:minced|beaten)\s+/i, "").trim();

  // Strip trailing footnote markers
  name = name.replace(/\*+$/, "").trim();

  if (!name) name = raw.trim();

  return { quantity, unit, name, raw_string: raw };
}

// Expand compound ingredients ("salt and pepper", "red pepper flakes or sriracha")
// into separate raw strings. Only splits when both sides start alphabetically
// (i.e., no leading quantity), to avoid splitting "4 tbsp oil or vinegar".
function expandCompound(raw: string): string[] {
  const stripped = raw.trim().replace(/^[-•–]\s*/, "");
  const match = stripped.match(/^([a-zA-Z][^,]*?)\s+(?:and|or)\s+([a-zA-Z].*)$/i);
  if (match) return [match[1].trim(), match[2].trim()];
  return [raw];
}

export function parseIngredients(raws: string[]): ParsedIngredient[] {
  return raws
    .filter((raw) => {
      const stripped = raw.trim().replace(/^[-•–]\s*/, "");
      if (stripped.endsWith(":")) return false;
      if (/^for serving\b/i.test(stripped)) return false;
      return true;
    })
    .flatMap(expandCompound)
    .map((raw) => {
      const parsed = parseIngredient(raw);
      // Lowercase names for consistent shopping list grouping
      return { ...parsed, name: parsed.name.toLowerCase() };
    });
}
