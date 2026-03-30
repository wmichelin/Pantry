# Pantry — Design Document

## Vision

Pantry is an offline-first mobile app that streamlines the full cycle of home cooking: importing recipes, building shopping lists, shopping efficiently across multiple stores, and preparing meals. It removes the friction between "I found a recipe I like" and "dinner is on the table."

The app is built around the concept of a **Household** — a shared space where recipes, shopping lists, and meal plans live. Multiple people in a household see and interact with the same data.

---

## Core Concepts

### Household Model

A Household is the central unit of ownership. Recipes, shopping lists, meal plans, and store configurations all belong to a Household — not to an individual user.

```
Household
├── name ("The Michelins", "Apt 4B", etc.)
├── members[]
│       ├── user_id
│       ├── display_name
│       └── role: owner | member
├── recipes[]
├── shopping_lists[]
├── meal_plans[]
└── stores[]
```

**Key rules:**
- A user can belong to multiple households (e.g., main family + shared meal prep group).
- Any member can add recipes, edit lists, and start grocery trips.
- The owner can invite/remove members and delete the household.
- All data syncs across members — if one person checks off an item at the store, everyone sees it.

### Data Model

```
Recipe
├── title
├── source_url (Pinterest pin, manual entry, etc.)
├── source_type: pinterest | url | manual
├── tags[] (Sheet Pan, Crock Pot, Salad, One Pot, Grill, etc.)
├── servings
├── prep_time / cook_time
├── image_url
├── instructions[]
├── ingredients[]
│       ├── name (normalized — "chicken breast", not "2 lbs chicken breast")
│       ├── quantity
│       ├── unit
│       └── category (produce, dairy, meat, pantry staple, etc.)
└── added_by (user_id)

ShoppingList (one active list per household at a time)
├── created_from_meal_plan_id (optional)
└── items[]
        ├── ingredient (linked or free-text for one-offs)
        ├── quantity (aggregated across recipes)
        ├── unit
        ├── category
        ├── status: needed | in_cart | purchased | unavailable
        ├── source_recipes[] (which recipes need this)
        ├── store_preference (optional)
        └── added_by (user_id)

GroceryTrip
├── store_name
├── started_by (user_id)
├── started_at / completed_at
└── item_results[]
        ├── item_id
        └── outcome: purchased | unavailable | skipped

Store
├── name (Costco, Food Lion, Trader Joe's, etc.)
└── aisle_order[] (user-defined category ordering for that store's layout)

MealPlan
├── week_start_date
└── slots[]
        ├── day (Mon–Sun)
        ├── meal_type (breakfast, lunch, dinner, snack)
        └── recipe_id
```

---

## Feature Breakdown

### 1. Recipe Import (Primary Feature)

This is the most important feature in the app. Getting recipes into Pantry needs to be fast and frictionless.

#### Pinterest Import (No API Required)

Pinterest pins and boards are scrapable — no OAuth or API review needed.

**Single pin import:**
1. User pastes a Pinterest pin URL (or shares it to Pantry via share sheet).
2. Server scrapes the pin page, extracts the source recipe URL.
3. Server scrapes the recipe page for structured data.
4. User reviews and confirms. Recipe saved to household.

**Board bulk import:**
1. User pastes a Pinterest board URL.
2. Server scrapes the board page to extract all pin URLs. (Board pages are JS-rendered, so this requires headless browser — Puppeteer/Playwright on the server.)
3. For each pin, extract the source recipe URL, then scrape the recipe.
4. User is presented with a list of imported recipes to review, edit tags, and confirm in batch.
5. All confirmed recipes saved to household.

**Scraping considerations:**
- Pinterest boards are JS-heavy — server-side headless rendering is required for board scraping. Individual pin pages are lighter and may work with static HTML parsing.
- Rate limiting: board scrapes should be throttled to avoid being blocked. A board with 200 pins should be processed as a background job with progress updates pushed to the client.
- Pin pages contain the outbound recipe URL in the page metadata — this is the key link that connects Pinterest to the actual recipe site.

#### URL Import

**Flow:**
1. User pastes or shares a URL into Pantry.
2. App scrapes the page for recipe data.
3. Same review/confirm flow as Pinterest.

This also enables **share sheet integration** — user taps "Share" on a recipe page in Safari/Chrome and sends it to Pantry.

#### Recipe Scraping Strategy

Two-tier approach, handled in a Supabase Edge Function:

1. **JSON-LD extraction (fast path, ~80% of recipe sites)** — Most recipe sites embed `schema.org/Recipe` structured data as JSON-LD. A thin Cheerio-based extractor parses this directly — reliable, fast, and cheap.
2. **Claude API fallback (remaining ~20%)** — For sites without structured data, send the raw HTML to Claude with a prompt to extract title, ingredients, instructions, and metadata. More expensive per call but handles essentially any page layout.

All scraping runs server-side in Edge Functions. This handles sites that block mobile user agents and avoids shipping a scraping library to the client.

#### Ingredient Parsing

Raw ingredient strings like "2 lbs boneless skinless chicken breast, cut into cubes" need to be decomposed:

```
Input:  "2 lbs boneless skinless chicken breast, cut into cubes"
Output: { quantity: 2, unit: "lb", name: "chicken breast", category: "meat" }
```

**Approach:**
- All ingredient strings for a recipe are batched into a single Claude API call during import. Claude parses quantity, unit, name, and assigns a category.
- Example: "1 (14.5 oz) can diced tomatoes" → `{quantity: 1, unit: "can", name: "diced tomatoes", size: "14.5 oz", category: "canned goods"}`
- This runs once at import time — the structured result is stored locally and never needs re-parsing.

#### Intelligent Tag Suggestions

When a recipe is imported, Pantry suggests tags based on:
- **Keywords in title/instructions** — "sheet pan" in the title → `Sheet Pan`
- **Cooking method detection** — instructions mentioning "slow cooker" or "6-8 hours on low" → `Crock Pot`
- **Ingredient profile** — mostly raw vegetables + dressing → `Salad`

**Starter tag taxonomy:**
Sheet Pan, Crock Pot / Slow Cooker, Instant Pot / Pressure Cooker, One Pot, Salad, Grill, Stir Fry, Soup / Stew, Baking, No Cook, Meal Prep Friendly

Users can create custom tags and manually tag any recipe.

### 2. Shopping List & Grocery Trips

#### The Shopping List Lifecycle

1. **Build** — User selects recipes (from meal plan or ad-hoc). Pantry aggregates ingredients, deduplicates, and normalizes quantities (two recipes each needing 1 cup milk → 2 cups milk). One-off items (paper towels, dog food) can be added freely.

2. **Organize** — Items grouped by category. If the user has set up aisle ordering for a store, items re-sort to match that store's layout.

3. **Shop** — User starts a grocery trip at a specific store. They check off items as they go. If an item is unavailable, they mark it — it stays on the list for the next store.

4. **Carry Forward** — After completing a trip, any `needed` or `unavailable` items remain. Next trip at a different store, those items are ready. Nothing falls through the cracks.

5. **Complete** — Once all items are purchased across however many trips, the list can be archived.

#### Multi-Store Example

```
Shopping list has 30 items.

Trip 1: Costco
  → 18 items purchased, 3 unavailable, 9 skipped (not worth buying at Costco)
  → 12 items remain on list

Trip 2: Food Lion
  → 10 items purchased, 2 unavailable
  → 2 items remain

Trip 3: Trader Joe's
  → 2 items purchased
  → List complete → archive
```

#### Real-Time Household Sync During Trips

Because the household is shared, two members can shop at different stores simultaneously. Both see the same list updating in real time — if one person buys the milk at Costco, the other doesn't buy it again at Food Lion.

### 3. Meal Preparation Assistance (Bonus)

- **Cook mode:** Large text, step-by-step display. Keep screen awake. Minimal interaction.
- **Prep view:** For multiple recipes, group common prep steps ("Dice 3 onions total").
- **Timelines:** "Start crock pot at 8 AM. Begin sheet pan prep at 5:30 PM."

---

## Architecture

### Offline-First Design

The app must be fully functional with no internet connection. Users are often in stores with poor signal.

**Local database:**
- All household data is replicated to each member's device via PowerSync.
- Expo SQLite is the local data store, with Drizzle ORM for type-safe queries and migrations.
- The app never blocks on network — all reads and writes hit local DB first.

**Sync model (PowerSync):**
- PowerSync handles SQLite ↔ Supabase Postgres sync out of the box.
- Tracks dirty records, manages upload queues, handles retry on reconnect.
- Conflict resolution: last-write-wins per field, with timestamps. Two people checking off different items on the shopping list won't conflict (different fields). If two people edit the same field, the later write wins.
- Eliminates the need to build custom sync logic — dirty record tracking, queue management, and offline→online reconciliation are all handled.

**What requires network (gracefully degraded when offline):**
- Recipe URL scraping — Pinterest pins, boards, and recipe sites (can be queued — "import pending" state).
- Household sync.
- Account creation / login.

### Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Framework | Expo (React Native) | Cross-platform iOS + Android, managed builds |
| Navigation | Expo Router | File-based routing, deep linking |
| Local DB | Expo SQLite + Drizzle ORM | Type-safe queries, TS-native schema, auditable AI output |
| Sync | PowerSync (SQLite ↔ Supabase) | Purpose-built offline-first sync, eliminates custom sync logic |
| Backend | Supabase (Postgres + Edge Functions + Auth) | Managed Postgres, built-in auth, edge functions for scraping |
| API layer | tRPC on Edge Functions | End-to-end type safety, zero boilerplate |
| Server state | TanStack Query | Cache management, background refetching |
| Client state | Zustand | Lightweight, snappy for shopping list UI |
| Scraping | Edge Function: JSON-LD extractor → Claude API fallback | Cheerio for structured data, Claude for the messy 20% |
| AI features | Claude API | Ingredient parsing, tag suggestions, recipe extraction fallback |
| Auth | Supabase Auth (email, Apple, Google) | No Pinterest OAuth needed — we scrape instead |
| Dev tooling | Drizzle Studio (`expo-drizzle-studio-plugin`), Expo Dev Tools | Visual DB browser for sanity-checking migrations |

### Server Components (Supabase Edge Functions)

Supabase provides auth, Postgres, and real-time sync infrastructure. Edge Functions handle the app-specific logic:

1. **Recipe scraper** — Accepts a URL (recipe site, Pinterest pin, or Pinterest board). Extracts JSON-LD structured data via Cheerio. Falls back to Claude API with raw HTML for sites without structured data. Board scraping (JS-rendered) runs as a background job with progress pushed to client.
2. **Ingredient parser** — Claude API call to decompose raw ingredient strings into structured data (quantity, unit, name, category). Batched per recipe import.
3. **Tag suggester** — Claude API call with recipe title + ingredients + instructions → suggested tags. Runs during import.

Auth, household management, and sync are handled by Supabase's built-in services + PowerSync.

---

## User Flows

### Recipe Import (Pinterest Pin)
```
Copy Pinterest pin URL → open Pantry → "Import from URL"
  → Paste pin URL (or use share sheet from Pinterest app)
  → Server extracts recipe source URL from pin, scrapes recipe
  → Review: title, ingredients, tags
  → "Save to Household"
```

### Recipe Import (Pinterest Board — Bulk)
```
Copy Pinterest board URL → open Pantry → "Import Board"
  → Paste board URL
  → Server scrapes board, extracts all pins (progress bar)
  → List of discovered recipes appears
  → Select which to import, review tags in batch
  → "Save All to Household"
```

### Recipe Import (URL / Share Sheet)
```
In browser, viewing a recipe → tap Share → "Pantry"
  → App opens with recipe preview
  → Review: title, ingredients, tags
  → "Save to Household"
```

### Shopping Flow
```
Open shopping list → "Start Trip" → select "Costco"
  → List re-sorts to Costco's aisle order
  → Check off items as you shop
  → "Nope" on items you can't find → marked unavailable
  → "Done with Costco"
  → 8 items remaining → they persist for next trip
  → Next day: "Start Trip" → select "Food Lion"
  → Only remaining items shown, sorted for Food Lion
```

### Household Setup
```
Create account → "Create Household" → name it
  → "Invite Member" → share invite link/code
  → Partner opens link → creates account → joins household
  → Both now see shared recipes, lists, and plans
```

---

## MVP Scope

**Phase 1 — Household + Recipe Import:**
- User accounts (email + password)
- Household creation, invites, membership
- Recipe import via URL (share sheet + paste)
- Recipe scraping (JSON-LD + heuristic fallback)
- Ingredient parsing and normalization
- Auto-tag suggestions
- Manual recipe creation and editing
- Local DB with household sync

**Phase 2 — Shopping Lists:**
- Build shopping lists from selected recipes
- Add one-off items
- Multi-store grocery trips with carry-forward
- Real-time list sync across household members
- Store aisle ordering

**Phase 3 — Pinterest + Planning:**
- Pinterest pin URL import (single recipe)
- Pinterest board URL import (bulk scrape)
- Weekly meal planner
- Aggregated shopping list from meal plan

**Phase 4 — Prep & Polish:**
- Cook mode
- Prep view with consolidated steps
- Cooking timelines
- Recipe scaling (adjust servings → recalculate ingredients)

---

## Open Questions

1. ~~**Pinterest API access**~~ — No API needed. We scrape pin pages for recipe source URLs and board pages for bulk import. Server-side headless browser handles JS-rendered boards.
2. ~~**Ingredient normalization depth**~~ — Keep ingredients as-parsed. Users can manually merge ("2% milk" + "whole milk" → "milk") or split items as needed.
3. **Store aisle ordering UX** — How do users set this up without tedium? Could we learn from shopping patterns over time? Or start with a sensible default category order and let users drag to reorder?
4. ~~**Sync architecture**~~ — Last-write-wins with an operational log. Upgrade to CRDTs only if real-world usage shows problematic conflicts.
5. **Household permissions** — MVP has owner + member. Do we need finer roles (e.g., read-only guest for a friend visiting for dinner)?
