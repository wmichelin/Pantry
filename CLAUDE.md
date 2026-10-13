# Pantry

Read and follow [ENGINEERING_PHILOSOPHY.md](ENGINEERING_PHILOSOPHY.md) before making changes.

Mobile + web app for household meal planning and grocery shopping.

## Stack (as implemented)

- **Expo** (React Native, SDK 54) with **Expo Router** (file-based routing) — runs on iOS/Android and as a static web build.
- **Supabase** — Postgres + Auth (email/password). RLS scopes all data to household members; the client uses `supabase-js` for Auth and compatibility paths.
- **Staging Go API** — Protobuf/Connect business services in `cmd/` and `internal/`; caller JWTs are forwarded so Supabase RLS remains authoritative.
- **Supabase Edge Functions** (Deno) — the production/rollback `scrape-recipe` implementation while the Go scraper remains staging-only.
- Client state via **React hooks + Context** (`lib/auth-context.tsx`). No global state library yet.
- **Claude API** — used (planned) as the scraping fallback in the Edge Function.
- Deployed as a Docker/Nginx static web build to a DigitalOcean droplet (`pantry.waltermichelin.com`); see `deploy.sh` and `terraform/`.

## Roadmap (NOT yet implemented — do not assume these exist)

The following were part of the original design but are **not** wired up today. Treat
them as future direction, not current architecture:

- Offline-first with **Expo SQLite** + **PowerSync** sync (app is currently online-first, reads/writes go straight to Supabase).
- **Drizzle ORM** for schema/queries (schema currently lives in `supabase/migrations/*.sql`).
- **tRPC** for client-server calls (staging uses Protobuf/Connect instead).
- **Zustand** / **TanStack Query** (currently React hooks).

## Project structure

- `app/` — Expo Router screens (`(auth)/`, `(app)/`)
- `components/` — shared UI
- `lib/` — Supabase client, auth context, ingredient parsing (`parse-ingredient.ts`)
- `proto/`, `cmd/`, `internal/` — Protobuf contracts and the staging Go API
- `supabase/migrations/` — SQL schema migrations (source of truth for the DB)
- `supabase/functions/` — Edge Functions
- `scripts/` — DB backup tooling (see `docs/BACKUPS.md`)
- `design/` — design docs and planning artifacts
- `terraform/`, `deploy.sh`, `Dockerfile` — infra & deploy

## Conventions

- TypeScript for the app/Edge compatibility path and Go for the staging API;
  `tsc --noEmit`, `go vet ./...`, and `go test -race ./...` must pass.
- All DB schema changes go through a migration in `supabase/migrations/` (keep the repo in sync with production — see `docs/BACKUPS.md` and CI).
- Staging business calls use generated Protobuf/Connect clients. Supabase Auth and
  retained compatibility calls use `supabase-js`; always surface safe failures.
- RLS-first: every table has policies scoping rows to household members.
