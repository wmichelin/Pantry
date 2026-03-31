import { load } from "npm:cheerio@1.0.0";
import type { ScrapedRecipe, ScrapeResponse } from "../../lib/scrape-types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ─── Entry point ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { url } = await req.json();
    if (!url || typeof url !== "string") {
      return json({ error: "url is required" }, 400);
    }

    const result = await scrape(url.trim());
    return json(result);
  } catch (err) {
    console.error(err);
    return json({ error: String(err) }, 500);
  }
});

// ─── URL type detection ───────────────────────────────────────────────────────

function detectUrlType(url: string): "pin" | "board" | "recipe" {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "pin.it") return "pin";
    if (host === "pinterest.com" || host === "pinterest.co.uk") {
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts[0] === "pin") return "pin";
      // Board: /<user>/<board>/ — exactly 2 path segments
      if (parts.length >= 2) return "board";
    }
  } catch {
    // fall through
  }
  return "recipe";
}

async function scrape(url: string): Promise<ScrapeResponse> {
  const type = detectUrlType(url);
  if (type === "board") return scrapeBoard(url);
  if (type === "pin") return scrapePin(url);
  const recipe = await scrapeRecipeUrl(url);
  return { type: "single", recipe };
}

// ─── Fetch helper ─────────────────────────────────────────────────────────────

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// ─── Pinterest board scraping ─────────────────────────────────────────────────

async function scrapeBoard(boardUrl: string): Promise<ScrapeResponse> {
  const html = await fetchHtml(boardUrl);
  const pinSourceUrls = extractPinSourceUrlsFromBoard(html);

  // Scrape each recipe concurrently, cap at 50
  const limited = pinSourceUrls.slice(0, 50);
  const results = await Promise.allSettled(
    limited.map((url) => scrapeRecipeUrl(url))
  );

  const recipes: ScrapedRecipe[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") recipes.push(r.value);
  }

  return { type: "board", recipes, total_found: pinSourceUrls.length };
}

function extractPinSourceUrlsFromBoard(html: string): string[] {
  // Pinterest embeds board data in __PWS_INITIAL_PROPS__ script tag
  const match = html.match(
    /<script\s+id="__PWS_INITIAL_PROPS__"[^>]*>([\s\S]*?)<\/script>/
  );
  if (!match) {
    // Fallback: try __PWS_DATA__
    const m2 = html.match(/window\.__PWS_DATA__\s*=\s*(\{[\s\S]*?\})(?:\s*;)/);
    if (!m2) return [];
    try {
      const data = JSON.parse(m2[1]);
      return collectPinLinks(data);
    } catch {
      return [];
    }
  }

  try {
    const data = JSON.parse(match[1]);
    return collectPinLinks(data);
  } catch {
    return [];
  }
}

// Recursively walk the Pinterest JSON to find pin link URLs
function collectPinLinks(obj: unknown, seen = new Set<string>()): string[] {
  if (!obj || typeof obj !== "object") return [];
  if (Array.isArray(obj)) {
    return obj.flatMap((item) => collectPinLinks(item, seen));
  }

  const record = obj as Record<string, unknown>;
  const urls: string[] = [];

  // Pinterest pin objects have a "link" field pointing to the source recipe URL
  if (
    typeof record.link === "string" &&
    record.link.startsWith("http") &&
    !record.link.includes("pinterest.com") &&
    !seen.has(record.link)
  ) {
    seen.add(record.link);
    urls.push(record.link);
  }

  for (const val of Object.values(record)) {
    urls.push(...collectPinLinks(val, seen));
  }

  return urls;
}

// ─── Pinterest pin scraping ───────────────────────────────────────────────────

async function scrapePin(pinUrl: string): Promise<ScrapeResponse> {
  // pin.it is a redirect — follow it first
  const html = await fetchHtml(pinUrl);
  const sourceUrl = extractSourceUrlFromPin(html, pinUrl);

  if (!sourceUrl) {
    // No source URL found — return a minimal recipe placeholder
    const $ = load(html);
    const title =
      $('meta[property="og:title"]').attr("content") ||
      $("title").text() ||
      "Pinterest Recipe";
    return {
      type: "single",
      recipe: {
        title,
        source_url: pinUrl,
        source_type: "pinterest_pin",
        raw_ingredients: [],
        instructions: [],
        suggested_tags: [],
      },
    };
  }

  const recipe = await scrapeRecipeUrl(sourceUrl, "pinterest_pin");
  return { type: "single", recipe };
}

function extractSourceUrlFromPin(html: string, fallbackUrl: string): string | null {
  // Try PWS_INITIAL_PROPS first
  const match = html.match(
    /<script\s+id="__PWS_INITIAL_PROPS__"[^>]*>([\s\S]*?)<\/script>/
  );
  if (match) {
    try {
      const data = JSON.parse(match[1]);
      const link = findFirstPinLink(data);
      if (link) return link;
    } catch {
      // ignore
    }
  }

  // Fallback: og:see_also or og:url pointing to an external domain
  const $ = load(html);
  const seeAlso = $('meta[property="og:see_also"]').attr("content");
  if (seeAlso && !seeAlso.includes("pinterest.com")) return seeAlso;

  return null;
}

function findFirstPinLink(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const r = findFirstPinLink(item);
      if (r) return r;
    }
    return null;
  }
  const record = obj as Record<string, unknown>;
  if (
    typeof record.link === "string" &&
    record.link.startsWith("http") &&
    !record.link.includes("pinterest.com")
  ) {
    return record.link;
  }
  for (const val of Object.values(record)) {
    const r = findFirstPinLink(val);
    if (r) return r;
  }
  return null;
}

// ─── Recipe URL scraping ──────────────────────────────────────────────────────

async function scrapeRecipeUrl(
  url: string,
  sourceType: ScrapedRecipe["source_type"] = "url"
): Promise<ScrapedRecipe> {
  const html = await fetchHtml(url);
  const $ = load(html);

  // Fast path: JSON-LD
  const jsonLdRecipe = extractJsonLd($);
  if (jsonLdRecipe) {
    return { ...jsonLdRecipe, source_url: url, source_type: sourceType };
  }

  // Fallback: Open Graph
  const title =
    $('meta[property="og:title"]').attr("content") ||
    $("title").text().trim() ||
    "Untitled Recipe";
  const image_url = $('meta[property="og:image"]').attr("content");

  return {
    title,
    source_url: url,
    source_type: sourceType,
    image_url,
    raw_ingredients: [],
    instructions: [],
    suggested_tags: suggestTags(title, []),
  };
}

// ─── JSON-LD extraction ───────────────────────────────────────────────────────

function extractJsonLd($: ReturnType<typeof load>): Omit<ScrapedRecipe, "source_url" | "source_type"> | null {
  const scripts = $('script[type="application/ld+json"]');
  let recipe: Record<string, unknown> | null = null;

  scripts.each((_i, el) => {
    if (recipe) return;
    try {
      const parsed = JSON.parse($(el).html() ?? "");
      recipe = findRecipeNode(parsed);
    } catch {
      // ignore malformed JSON-LD
    }
  });

  if (!recipe) return null;

  const title = str(recipe.name) ?? "Untitled Recipe";
  const image_url = extractImage(recipe.image);
  const servings = parseServings(recipe.recipeYield);
  const prep_time_minutes = parseDuration(str(recipe.prepTime));
  const cook_time_minutes = parseDuration(str(recipe.cookTime));
  const instructions = extractInstructions(recipe.recipeInstructions);
  const raw_ingredients = extractIngredients(recipe.recipeIngredient);
  const suggested_tags = suggestTags(title, instructions);

  return {
    title,
    image_url,
    servings,
    prep_time_minutes,
    cook_time_minutes,
    instructions,
    raw_ingredients,
    suggested_tags,
  };
}

function findRecipeNode(obj: unknown): Record<string, unknown> | null {
  if (!obj || typeof obj !== "object") return null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const r = findRecipeNode(item);
      if (r) return r;
    }
    return null;
  }
  const record = obj as Record<string, unknown>;
  const type = record["@type"];
  if (type === "Recipe" || (Array.isArray(type) && type.includes("Recipe"))) {
    return record;
  }
  // Check @graph
  if (Array.isArray(record["@graph"])) {
    return findRecipeNode(record["@graph"]);
  }
  return null;
}

function extractImage(image: unknown): string | undefined {
  if (!image) return undefined;
  if (typeof image === "string") return image;
  if (Array.isArray(image)) return extractImage(image[0]);
  if (typeof image === "object") {
    const img = image as Record<string, unknown>;
    return str(img.url) ?? str(img.contentUrl);
  }
}

function extractInstructions(raw: unknown): string[] {
  if (!raw) return [];
  const items = Array.isArray(raw) ? raw : [raw];
  return items.flatMap((item) => {
    if (typeof item === "string") return [item.trim()].filter(Boolean);
    if (typeof item === "object" && item !== null) {
      const rec = item as Record<string, unknown>;
      if (rec["@type"] === "HowToSection" && Array.isArray(rec.itemListElement)) {
        return extractInstructions(rec.itemListElement);
      }
      const text = str(rec.text) ?? str(rec.name) ?? "";
      return text ? [text.trim()] : [];
    }
    return [];
  });
}

function extractIngredients(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function parseServings(raw: unknown): number | undefined {
  if (!raw) return undefined;
  const s = Array.isArray(raw) ? String(raw[0]) : String(raw);
  const match = s.match(/\d+/);
  return match ? parseInt(match[0]) : undefined;
}

// ISO 8601 duration: PT1H30M → 90
function parseDuration(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const hours = s.match(/(\d+)H/);
  const minutes = s.match(/(\d+)M/);
  const h = hours ? parseInt(hours[1]) : 0;
  const m = minutes ? parseInt(minutes[1]) : 0;
  return h * 60 + m || undefined;
}

function str(val: unknown): string | undefined {
  return typeof val === "string" ? val : undefined;
}

// ─── Tag suggestions ──────────────────────────────────────────────────────────

const TAG_RULES: [RegExp, string][] = [
  [/sheet[\s-]pan/i, "Sheet Pan"],
  [/slow[\s-]cooker|crock[\s-]pot/i, "Crock Pot"],
  [/instant[\s-]pot|pressure[\s-]cook/i, "Instant Pot"],
  [/one[\s-]pot|one[\s-]pan/i, "One Pot"],
  [/\bsalad\b/i, "Salad"],
  [/\bgrill(ed|ing)?\b|bbq|barbecue/i, "Grill"],
  [/stir[\s-]fry|stir[\s-]fried/i, "Stir Fry"],
  [/\bsoup\b|\bstew\b|\bchili\b|\bchilli\b/i, "Soup / Stew"],
  [/no[\s-]bake|no[\s-]cook/i, "No Cook"],
  [/\bbake\b|\bbaked\b|\bbaking\b|\bcookies\b|\bcake\b|\bbread\b/i, "Baking"],
];

function suggestTags(title: string, instructions: string[]): string[] {
  const text = [title, ...instructions].join(" ");
  const tags: string[] = [];
  for (const [pattern, tag] of TAG_RULES) {
    if (pattern.test(text)) tags.push(tag);
  }
  return tags;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
