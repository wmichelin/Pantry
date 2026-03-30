# Pantry

Offline-first mobile app for meal planning, recipe management, and grocery shopping — built around a shared household model.

## What it does

- **Recipe import** — Paste a URL (recipe site, Pinterest pin, or full Pinterest board) and get a structured recipe with parsed ingredients and suggested tags.
- **Shopping lists** — Aggregate ingredients across recipes, add one-off items, and shop across multiple stores with automatic carry-forward of missing items.
- **Household sharing** — Recipes, lists, and plans belong to a household. Multiple members see and edit the same data in real time.
- **Offline-first** — Everything works without internet. Sync happens when connectivity is available.

## Tech stack

| Layer | Choice |
|-------|--------|
| Framework | Expo (React Native) |
| Local DB | Expo SQLite + Drizzle ORM |
| Sync | PowerSync (SQLite <-> Supabase) |
| Backend | Supabase (Postgres + Edge Functions + Auth) |
| API | tRPC on Edge Functions |
| State | Zustand (client) + TanStack Query (server) |
| AI | Claude API (scraping fallback, ingredient parsing, tag suggestions) |

## Docs

- [Design document](design/DESIGN.md)
