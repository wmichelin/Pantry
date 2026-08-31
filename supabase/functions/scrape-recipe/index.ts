import { load } from "npm:cheerio@1.0.0";
import type { ScrapedRecipe, ScrapeResponse } from "../../lib/scrape-types.ts";
import { decodeHtmlEntities, extractIngredients } from "./recipe-fields.ts";

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

// ─── Fetch helpers ────────────────────────────────────────────────────────────

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": BROWSER_UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

interface FetchResult {
  html: string;
  cookies: string;
  csrfToken: string;
  appVersion: string;
}

async function fetchHtmlWithCookies(url: string): Promise<FetchResult> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": BROWSER_UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);

  const html = await res.text();

  // Extract cookies — getSetCookie() may not exist in all Deno runtimes
  let cookies = "";
  if (typeof res.headers.getSetCookie === "function") {
    cookies = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  } else {
    // Fallback: get raw set-cookie header
    const raw = res.headers.get("set-cookie") ?? "";
    cookies = raw;
  }

  // CSRF token from cookies
  let csrfToken = cookies.match(/csrftoken=([^;,\s]+)/)?.[1] ?? "";

  // Fallback: Pinterest also embeds CSRF in a meta tag or in the HTML
  if (!csrfToken) {
    const metaCsrf = html.match(/name="csrfmiddlewaretoken"[^>]*value="([^"]+)"/)?.[1]
      ?? html.match(/"csrftoken"\s*:\s*"([^"]+)"/)?.[1]
      ?? "";
    csrfToken = metaCsrf;
  }

  // Extract app version from HTML — Pinterest validates this in API requests
  const appVersionMatch = html.match(/"app_version"\s*:\s*"([^"]+)"/)
    ?? html.match(/appVersion['"]\s*:\s*['"]([^'"]+)/)
    ?? html.match(/client_version=([^&"]+)/);
  const appVersion = appVersionMatch?.[1] ?? "";

  return { html, cookies, csrfToken, appVersion };
}

// ─── Crawler fetch (Pinterest serves SEO-friendly HTML to bots) ──────────────

async function fetchAsCrawler(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        Accept: "text/html",
      },
      redirect: "follow",
    });
    if (!res.ok) return "";
    return res.text();
  } catch {
    return "";
  }
}

// Extract pin source URLs from crawler-served HTML (typically has more <a> links)
function extractLinksFromCrawlerHtml(html: string): string[] {
  if (!html) return [];
  const $ = load(html);
  const seen = new Set<string>();
  const urls: string[] = [];

  // Pinterest's crawler HTML includes pin links as <a> tags with data attributes
  // or as links within pin containers
  $('a[href]').each((_i, el) => {
    const href = $(el).attr("href") ?? "";
    // Skip pinterest.com internal links
    if (!href.startsWith("http") || href.includes("pinterest.com") || href.includes("pinterest.co")) return;
    if (seen.has(href)) return;
    seen.add(href);
    urls.push(href);
  });

  // Also extract from any JSON-LD or embedded data
  const ssrData = parseSsrJson(html);
  if (ssrData) {
    for (const u of collectPinLinks(ssrData)) {
      if (!seen.has(u)) {
        seen.add(u);
        urls.push(u);
      }
    }
  }

  return urls;
}

// ─── Pinterest board scraping ─────────────────────────────────────────────────

const MAX_BOARD_PINS = 250;
const SCRAPE_BATCH_SIZE = 10;

async function scrapeBoard(boardUrl: string): Promise<ScrapeResponse> {
  const { urls: pinSourceUrls, debug } = await fetchBoardPinsPaginated(boardUrl);

  const limited = pinSourceUrls.slice(0, MAX_BOARD_PINS);

  // Scrape recipes in batches to avoid rate limits and stay within timeout
  const recipes: ScrapedRecipe[] = [];
  for (let i = 0; i < limited.length; i += SCRAPE_BATCH_SIZE) {
    const batch = limited.slice(i, i + SCRAPE_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((url) => scrapeRecipeUrl(url))
    );
    for (const r of results) {
      if (r.status === "fulfilled") recipes.push(r.value);
    }
  }

  return { type: "board", recipes, total_found: pinSourceUrls.length, _debug: debug } as ScrapeResponse;
}

// Paginate through Pinterest's BoardFeedResource API to collect all pin URLs
async function fetchBoardPinsPaginated(boardUrl: string): Promise<{ urls: string[]; debug: Record<string, unknown> }> {
  const debug: Record<string, unknown> = {};
  // Strategy 1: Fetch as a crawler to get more pin links from SEO-friendly HTML
  const crawlerHtml = await fetchAsCrawler(boardUrl);
  const crawlerUrls = extractLinksFromCrawlerHtml(crawlerHtml);
  debug.crawlerHtmlLength = crawlerHtml.length;
  debug.crawlerPins = crawlerUrls.length;

  const { html, cookies, csrfToken, appVersion } = await fetchHtmlWithCookies(boardUrl);
  const browserUrls = extractPinSourceUrlsFromHtml(html);

  // Merge both sets of URLs
  const seen = new Set<string>();
  const initialUrls: string[] = [];
  for (const u of [...crawlerUrls, ...browserUrls]) {
    if (!seen.has(u)) {
      seen.add(u);
      initialUrls.push(u);
    }
  }

  debug.htmlLength = html.length;
  debug.browserPins = browserUrls.length;
  debug.mergedPins = initialUrls.length;
  debug.cookieKeys = cookies.split("; ").map((c: string) => c.split("=")[0]);
  debug.hasCsrf = !!csrfToken;
  debug.appVersion = appVersion || "MISSING";
  // Check how many pin objects exist in the SSR data (even without external links)
  debug.initialUrlsSample = initialUrls.slice(0, 3);

  // Extract board path for the API (e.g. /username/boardname/)
  const boardPath = new URL(boardUrl).pathname.replace(/\/?$/, "/");
  debug.boardPath = boardPath;

  // Try to get board ID and initial bookmark from the SSR data
  const ssrData = parseSsrJson(html);
  debug.hasSsrData = !!ssrData;
  if (ssrData) {
    debug.totalPinObjects = countPinObjects(ssrData);
    // Collect ALL external links from pin objects (ignoring ad filters) to see what we're missing
    debug.allPinLinks = collectAllPinLinks(ssrData).length;
  }
  const boardId = ssrData ? findBoardId(ssrData) : null;
  const firstBookmark = ssrData ? findBookmark(ssrData) : null;

  debug.boardId = boardId ?? "MISSING";
  debug.firstBookmark = firstBookmark ? "found" : "MISSING";

  // Debug: find all keys that contain "bookmark" anywhere in the SSR data
  if (ssrData && !firstBookmark) {
    const bookmarkPaths = findAllBookmarkPaths(ssrData);
    debug.bookmarkPaths = bookmarkPaths.slice(0, 20);
  }

  if (!boardId || !firstBookmark || !csrfToken) {
    debug.reason = "cannot paginate";
    return { urls: initialUrls, debug };
  }

  // Paginate via BoardFeedResource
  let bookmark: string | null = firstBookmark;
  const MAX_PAGES = 15;
  const pageResults: string[] = [];

  for (let page = 0; page < MAX_PAGES && bookmark && bookmark !== "-end-"; page++) {
    try {
      const dataObj = {
        options: {
          add_vase: true,
          board_id: boardId,
          board_url: boardPath,
          field_set_key: "react_grid_pin",
          filter_section_pins: false,
          is_react: true,
          page_size: 25,
          prepend: false,
          bookmarks: [bookmark],
        },
        context: {},
      };

      // Try POST first (how Pinterest's JS client sends it)
      const formBody = new URLSearchParams({
        source_url: boardPath,
        data: JSON.stringify(dataObj),
      });

      let res = await fetch("https://www.pinterest.com/resource/BoardFeedResource/get/", {
        method: "POST",
        body: formBody,
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: "application/json, text/javascript, */*, q=0.01",
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Requested-With": "XMLHttpRequest",
          "X-CSRFToken": csrfToken,
          "X-Pinterest-AppState": "active",
          "X-Pinterest-Source": "www",
          "X-APP-VERSION": appVersion || "0",
          Cookie: cookies,
          Referer: boardUrl,
          Origin: "https://www.pinterest.com",
        },
      });

      // Fallback: try GET
      if (!res.ok) {
        const getUrl = `https://www.pinterest.com/resource/BoardFeedResource/get/?source_url=${encodeURIComponent(boardPath)}&data=${encodeURIComponent(JSON.stringify(dataObj))}&_=${Date.now()}`;
        res = await fetch(getUrl, {
          headers: {
            "User-Agent": BROWSER_UA,
            Accept: "application/json, text/javascript, */*, q=0.01",
            "X-Requested-With": "XMLHttpRequest",
            "X-CSRFToken": csrfToken,
            "X-Pinterest-AppState": "active",
            "X-APP-VERSION": appVersion || "0",
            Cookie: cookies,
            Referer: boardUrl,
          },
        });
      }

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        pageResults.push(`page${page + 1}: HTTP ${res.status} ${errBody.slice(0, 200)}`);
        break;
      }

      const json = await res.json();
      const pageUrls = collectPinLinks(json);
      let newCount = 0;

      for (const u of pageUrls) {
        if (!seen.has(u)) {
          seen.add(u);
          initialUrls.push(u);
          newCount++;
        }
      }

      // Extract next bookmark from API response
      bookmark = json?.resource_response?.bookmark
        ?? json?.resource_response?.nextBookmark
        ?? json?.resource?.options?.bookmarks?.[0]
        ?? findBookmark(json)
        ?? null;

      pageResults.push(`page${page + 1}: +${newCount} pins (total: ${initialUrls.length}), next: ${bookmark ? (bookmark === "-end-" ? "end" : "yes") : "none"}`);
    } catch (err) {
      pageResults.push(`page${page + 1}: ERROR ${String(err).slice(0, 100)}`);
      break; // Graceful fallback — return what we have so far
    }
  }

  debug.totalAfterPagination = initialUrls.length;
  debug.pageResults = pageResults;
  return { urls: initialUrls, debug };
}

// Collect ALL external links from pin objects without ad filtering (debug only)
function collectAllPinLinks(obj: unknown, seen = new Set<string>()): string[] {
  if (!obj || typeof obj !== "object") return [];
  if (Array.isArray(obj)) return obj.flatMap((item) => collectAllPinLinks(item, seen));
  const record = obj as Record<string, unknown>;
  const urls: string[] = [];
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
    urls.push(...collectAllPinLinks(val, seen));
  }
  return urls;
}

// Count pin-like objects in the SSR data (objects with an "id" and "type" or "domain")
function countPinObjects(obj: unknown, count = { total: 0, withLink: 0, noLink: 0 }): { total: number; withLink: number; noLink: number } {
  if (!obj || typeof obj !== "object") return count;
  if (Array.isArray(obj)) {
    for (const item of obj) countPinObjects(item, count);
    return count;
  }
  const record = obj as Record<string, unknown>;
  // Detect pin objects: they have "id" + ("type"="pin" OR "domain" OR "pinner")
  if (record.id && (record.type === "pin" || record.domain || record.pinner)) {
    count.total++;
    if (typeof record.link === "string" && record.link.startsWith("http") && !record.link.includes("pinterest.com")) {
      count.withLink++;
    } else {
      count.noLink++;
    }
  }
  for (const val of Object.values(record)) {
    countPinObjects(val, count);
  }
  return count;
}

// Debug: find paths to any "bookmark" keys in a nested object
function findAllBookmarkPaths(obj: unknown, path = ""): string[] {
  if (!obj || typeof obj !== "object") return [];
  if (Array.isArray(obj)) {
    return obj.flatMap((item, i) => findAllBookmarkPaths(item, `${path}[${i}]`));
  }
  const results: string[] = [];
  const record = obj as Record<string, unknown>;
  for (const [key, val] of Object.entries(record)) {
    const p = path ? `${path}.${key}` : key;
    if (key.toLowerCase().includes("bookmark")) {
      results.push(`${p} = ${JSON.stringify(val)?.slice(0, 100)}`);
    }
    results.push(...findAllBookmarkPaths(val, p));
  }
  return results;
}

function parseSsrJson(html: string): unknown {
  // Try __PWS_INITIAL_PROPS__ first
  const match = html.match(
    /<script\s+id="__PWS_INITIAL_PROPS__"[^>]*>([\s\S]*?)<\/script>/
  );
  if (match) {
    try {
      const data = JSON.parse(match[1]);
      console.log("[board] parsed __PWS_INITIAL_PROPS__ OK");
      return data;
    } catch { /* ignore */ }
  }

  // Fallback: __PWS_DATA__ — extract by matching balanced braces
  const startMarker = "window.__PWS_DATA__";
  const idx = html.indexOf(startMarker);
  if (idx !== -1) {
    const braceStart = html.indexOf("{", idx);
    if (braceStart !== -1) {
      const jsonStr = extractBalancedJson(html, braceStart);
      if (jsonStr) {
        try {
          const data = JSON.parse(jsonStr);
          console.log("[board] parsed __PWS_DATA__ OK");
          return data;
        } catch { /* ignore */ }
      }
    }
  }

  console.log("[board] SSR JSON: NONE FOUND");
  return null;
}

// Extract a balanced JSON object starting at the given brace position
function extractBalancedJson(str: string, start: number): string | null {
  let depth = 0;
  for (let i = start; i < str.length; i++) {
    if (str[i] === "{") depth++;
    else if (str[i] === "}") depth--;
    if (depth === 0) return str.slice(start, i + 1);
  }
  return null;
}

function extractPinSourceUrlsFromHtml(html: string): string[] {
  const data = parseSsrJson(html);
  return data ? collectPinLinks(data) : [];
}

// Walk Pinterest SSR JSON to find the board ID
function findBoardId(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const r = findBoardId(item);
      if (r) return r;
    }
    return null;
  }
  const record = obj as Record<string, unknown>;
  // Board object has an "id" field alongside "name" and "url"
  if (
    typeof record.id === "string" &&
    typeof record.url === "string" &&
    typeof record.name === "string" &&
    (record.type === "board" || (record.url as string).split("/").filter(Boolean).length === 2)
  ) {
    return record.id as string;
  }
  for (const val of Object.values(record)) {
    const r = findBoardId(val);
    if (r) return r;
  }
  return null;
}

// Walk Pinterest SSR JSON to find the BoardFeedResource's nextBookmark
function findBookmark(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const r = findBookmark(item);
      if (r) return r;
    }
    return null;
  }
  const record = obj as Record<string, unknown>;

  // Check nextBookmark, bookmark, bookmarks
  for (const key of ["nextBookmark", "bookmark"]) {
    const val = record[key];
    if (typeof val === "string" && val.length > 5 && val !== "-end-") {
      return val;
    }
  }
  if (Array.isArray(record.bookmarks)) {
    const bm = record.bookmarks.find(
      (b: unknown) => typeof b === "string" && b !== "-end-" && (b as string).length > 5
    );
    if (bm) return bm as string;
  }

  for (const val of Object.values(record)) {
    const r = findBookmark(val);
    if (r) return r;
  }
  return null;
}

// ─── Ad / promoted pin detection ─────────────────────────────────────────────

function isPromotedPin(record: Record<string, unknown>): boolean {
  if (record.is_promoted === true) return true;
  if (record.promoted === true) return true;
  if (record.ad_match_reason != null) return true;
  if (record.type === "promotedPin") return true;
  if (typeof record.promotion_id === "string") return true;
  return false;
}

const AD_DOMAINS = new Set([
  "googleadservices.com",
  "doubleclick.net",
  "ad.doubleclick.net",
  "ads.pinterest.com",
  "click.linksynergy.com",
]);

function isAdUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    if (AD_DOMAINS.has(host)) return true;
    if (host.includes(".ads.") || host.includes("tracking.")) return true;
  } catch {
    // malformed URL — skip
  }
  return false;
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
    !seen.has(record.link) &&
    !isPromotedPin(record) &&
    !isAdUrl(record.link)
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

  // Fallback 1: parse ingredients/instructions from article text
  const articleRecipe = extractFromArticleText($);
  if (articleRecipe && (articleRecipe.raw_ingredients.length > 0 || articleRecipe.instructions.length > 0)) {
    return { ...articleRecipe, source_url: url, source_type: sourceType };
  }

  // Fallback 2: Open Graph only (title + image, no recipe data)
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

// ─── Article text extraction (fallback for sites without JSON-LD) ────────────

function extractFromArticleText(
  $: ReturnType<typeof load>
): Omit<ScrapedRecipe, "source_url" | "source_type"> | null {
  // Get raw HTML from content area — we need to insert line breaks ourselves
  // because Cheerio's .text() concatenates adjacent nodes with no separator,
  // turning "snipped</div><div>Directions" into "snippedDirections" (no \b before D).
  const contentSelectors = [
    ".article-body", "article", "main", ".entry-content",
    ".post-content", ".recipe-content", "#content",
  ];
  let rawHtml = "";
  for (const sel of contentSelectors) {
    const h = $(sel).first().html() ?? "";
    if (h.length > 300) { rawHtml = h; break; }
  }
  if (!rawHtml) rawHtml = $("body").html() ?? "";
  if (!rawHtml) return null;

  // Replace block-level tags with newlines so section headers land on their own line
  const text = rawHtml
    .replace(/<\/?(div|p|li|ul|ol|h[1-6]|br|section|article|header|footer)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // ── Locate sections ──────────────────────────────────────────────────────
  const ingrIdx = text.search(/\bingredients?\b/i);
  if (ingrIdx === -1) return null;

  const afterIngr = text.slice(ingrIdx + 11);
  const relDirIdx = afterIngr.search(/\b(?:directions?|instructions?|method|how to make|preparation)\b/i);
  const dirIdx = relDirIdx >= 0 ? ingrIdx + 11 + relDirIdx : -1;

  // ── Parse ingredients ────────────────────────────────────────────────────
  const ingrText = dirIdx > ingrIdx
    ? text.slice(ingrIdx, dirIdx)
    : text.slice(ingrIdx, ingrIdx + 1500);

  // Split on newlines first (each ingredient on its own line)
  let raw_ingredients = ingrText
    .split("\n")
    .map((l) => l.replace(/^[-•*]\s*/, "").trim())
    .filter((l) => l.length > 3 && l.length < 300 && !/^(?:ingredients?|directions?|instructions?)\b/i.test(l));

  if (raw_ingredients.length === 0) {
    // Fallback: dash-separated items in a single line (older CooktopCove style)
    const firstDash = ingrText.indexOf("- ");
    if (firstDash !== -1) {
      raw_ingredients = ingrText
        .slice(firstDash)
        .split(/(?=- )/)
        .map((s) => s.replace(/^-\s*/, "").trim())
        .filter((s) => s.length > 3 && s.length < 300);
    }
  }

  // Deduplicate (case-insensitive) — prevents double-scraping from sub-sections
  const seen = new Set<string>();
  raw_ingredients = raw_ingredients.filter((s) => {
    const key = s.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (raw_ingredients.length === 0) return null;

  // ── Parse instructions ────────────────────────────────────────────────────
  let instructions: string[] = [];
  if (dirIdx !== -1) {
    const noteIdx = text.search(/\b(?:notes?|tips?|variations?)\b/i);
    const dirEnd = noteIdx > dirIdx ? noteIdx : dirIdx + 5000;
    const dirText = text.slice(dirIdx, dirEnd);

    // Try newline-separated numbered steps first
    const stepLines = dirText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^\d+[.)]\s+/.test(l))
      .map((l) => l.replace(/^\d+[.)]\s+/, "").trim());

    if (stepLines.length > 0) {
      instructions = stepLines;
    } else {
      // Fallback: numbered steps in continuous text
      const stepMatches = [...dirText.matchAll(/\d+\.\s+(.+?)(?=\s*\d+\.\s|$)/gs)];
      instructions = stepMatches.map((m) => m[1].trim()).filter((s) => s.length > 5);
    }
  }

  // ── Metadata ──────────────────────────────────────────────────────────────
  const title = decodeHtmlEntities(
    $('meta[property="og:title"]').attr("content") ||
    $("title").text().trim() ||
    "Untitled Recipe"
  );
  const image_url = $('meta[property="og:image"]').attr("content");
  const servingsMatch = text.match(/servings?:?\s*(\d+)/i);

  return {
    title,
    image_url,
    servings: servingsMatch ? parseInt(servingsMatch[1]) : undefined,
    raw_ingredients,
    instructions,
    suggested_tags: suggestTags(title, instructions),
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
    if (typeof item === "string") {
      const s = item.trim();
      // Some sites serialize HowToStep objects as single-quoted pseudo-dicts inside strings
      // e.g. "{'@type': 'HowToStep', 'text': 'Do the thing.'}"
      if (s.startsWith("{") && (s.includes("'text'") || s.includes('"text"'))) {
        const m = s.match(/['"]text['"]\s*:\s*['"](.+)/s);
        if (m) {
          const val = m[1].replace(/['"]\s*[,}]?\s*$/, "").trim();
          if (val) return [decodeHtmlEntities(val)];
        }
      }
      return s ? [decodeHtmlEntities(s)] : [];
    }
    if (typeof item === "object" && item !== null) {
      const rec = item as Record<string, unknown>;
      if (rec["@type"] === "HowToSection" && Array.isArray(rec.itemListElement)) {
        return extractInstructions(rec.itemListElement);
      }
      const text = str(rec.text) ?? str(rec.name) ?? "";
      return text ? [decodeHtmlEntities(text.trim())] : [];
    }
    return [];
  });
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
  [/\bcookies?\b|\bcake\b|\bcupcakes?\b|\bmuffins?\b|\bbrownies?\b|\bpies?\b|\bpastry\b|\bpastries\b|\bscones?\b|\bbread\b|\bbiscuits?\b|\btarts?\b|\bcobbler\b|\brolls?\b|\bdoughnuts?\b|\bdonuts?\b|\bmacarons?\b/i, "Baking"],
];

function suggestTags(title: string, _instructions: string[]): string[] {
  const tags: string[] = [];
  for (const [pattern, tag] of TAG_RULES) {
    if (pattern.test(title)) tags.push(tag);
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
