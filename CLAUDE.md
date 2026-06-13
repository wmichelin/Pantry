# Pantry

Mobile + web app for household meal planning and grocery shopping.

## Stack (as implemented)

- **Expo** (React Native, SDK 54) with **Expo Router** (file-based routing) — runs on iOS/Android and as a static web build.
- **Supabase** — Postgres + Auth (email/password), accessed directly via **`supabase-js`** (raw client). RLS scopes all data to household members.
- **Supabase Edge Functions** (Deno) — `scrape-recipe` for recipe/Pinterest import.
- Client state via **React hooks + Context** (`lib/auth-context.tsx`). No global state library yet.
- **Claude API** — used (planned) as the scraping fallback in the Edge Function.
- Deployed as a Docker/Nginx static web build to a DigitalOcean droplet (`pantry.waltermichelin.com`); see `deploy.sh` and `terraform/`.

## Roadmap (NOT yet implemented — do not assume these exist)

The following were part of the original design but are **not** wired up today. Treat
them as future direction, not current architecture:

- Offline-first with **Expo SQLite** + **PowerSync** sync (app is currently online-first, reads/writes go straight to Supabase).
- **Drizzle ORM** for schema/queries (schema currently lives in `supabase/migrations/*.sql`).
- **tRPC** for client-server calls (currently raw `supabase-js`).
- **Zustand** / **TanStack Query** (currently React hooks).

## Project structure

- `app/` — Expo Router screens (`(auth)/`, `(app)/`)
- `components/` — shared UI
- `lib/` — Supabase client, auth context, ingredient parsing (`parse-ingredient.ts`)
- `supabase/migrations/` — SQL schema migrations (source of truth for the DB)
- `supabase/functions/` — Edge Functions
- `scripts/` — DB backup tooling (see `docs/BACKUPS.md`)
- `design/` — design docs and planning artifacts
- `terraform/`, `deploy.sh`, `Dockerfile` — infra & deploy

## Conventions

- TypeScript everywhere (app + Edge Functions); `tsc --noEmit` must pass.
- All DB schema changes go through a migration in `supabase/migrations/` (keep the repo in sync with production — see `docs/BACKUPS.md` and CI).
- Data access via `supabase-js`; **always check the `error` field** on every query/mutation and surface failures to the user.
- RLS-first: every table has policies scoping rows to household members.
