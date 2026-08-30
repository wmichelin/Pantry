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
| Data and auth | Supabase Postgres, Auth, and row-level security via `supabase-js` |
| Server work | Supabase Edge Functions for recipe scraping |
| Web delivery | Static Expo export in a Docker/Nginx image |

## Docs

- [Design document](design/DESIGN.md)
- [Deployment and staging guide](docs/DEPLOY.md)
- [Execution plan](docs/EXECUTION_PLAN.md)
