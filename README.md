# Pantry

Shared, online-first meal-planning beta for households. Pantry currently requires
network access for reads and writes; offline sync and real-time collaboration are
future work, not product guarantees.

## What it does

- **Recipe import** — Paste a recipe URL, Pinterest pin, or supported board and
  review the parsed recipe before saving it.
- **Household sharing** — Recipes, queues, and shopping lists belong to a shared
  household protected by Supabase row-level security.
- **Shopping lists** — Aggregate ingredients across queued recipes and add
  one-off items.

## Tech stack

| Layer | Choice |
|-------|--------|
| Client | Expo, Expo Router, React Native, and TypeScript |
| Data and auth | Supabase Postgres, Auth, and row-level security; the client uses `supabase-js` for Auth and compatibility paths |
| Staging business API | Go with Protobuf and Connect; caller JWTs are forwarded to Supabase so RLS remains authoritative |
| Recipe scraping | Authenticated, bounded Go scraper in staging; the legacy Edge Function remains the production/rollback path during rollout |
| Web delivery | Static Expo export in a Docker/Nginx image |

## Docs

- [Design document](design/DESIGN.md)
- [Deployment and staging guide](docs/DEPLOY.md)
- [Execution plan](docs/EXECUTION_PLAN.md)
