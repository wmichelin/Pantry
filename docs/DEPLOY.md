# Deployment

Pantry has separate, manual deployment paths for staging and production. A
staging deployment must never become a production deployment by changing an
image name, container, port, hostname, or Supabase configuration.

## Staging

The approved staging environment is
[`https://pantry-staging.waltermichelin.com`](https://pantry-staging.waltermichelin.com).
It uses its own Supabase project and the `pantry-staging` container bound only to
`127.0.0.1:18081` on the shared droplet. Nginx is the only public entrypoint.

Use **Actions → Deploy staging on droplet → Run workflow** to deploy staging.
The workflow accepts either:

- `source_ref` — the Git ref to build. It is checked out and published as
  `ghcr.io/wmichelin/pantry:staging-<full-commit-sha>`.
- `rollback_image` — an earlier image with that exact immutable staging-tag
  format. Supplying it skips the build and restores that staging image.

The workflow builds only with these staging public build values:

| Secret | Purpose |
| --- | --- |
| `STAGING_EXPO_PUBLIC_SUPABASE_URL` | Staging Supabase project URL |
| `STAGING_EXPO_PUBLIC_SUPABASE_ANON_KEY` | Staging Supabase anon key |

It also uses `DROPLET_HOST`, `DROPLET_SSH_KEY`, and `GHCR_PAT` from repository
Actions secrets. Do not place any of these values in tracked files or workflow
logs.

The deployment refuses any non-`staging-<40-character SHA>` image, checks that
the production container is running without changing it, replaces only
`pantry-staging`, and verifies both the loopback route and the configured HTTPS
hostname. If replacement fails at any point after the old staging container is
removed—including a failed `docker run`—it restores the previously running
staging image when one is available.

The separate **Publish staging on approved domain** workflow is only for the
staging Nginx vhost and certificate. It may be needed once for a new hostname.
Because Nginx is shared, it verifies the production container and HTTPS endpoint
before and after every staging-scoped reload. It must never modify the production
vhost, certificate, container, port, or application configuration.

Before a material staging change, record the current image as the last known-good
rollback target. If a staging deployment cannot be repaired forward, restore that
image and verify both staging routes before reporting the incident.

### Go business API (staging only)

The staging Go API runs as `pantry-api-staging`, bound only to
`127.0.0.1:18083`. Use **Actions → Deploy Go API foundation to staging → Run
workflow** to publish an immutable
`ghcr.io/wmichelin/pantry:staging-api-<full-commit-sha>` image and probe its
loopback `/healthz` and `/readyz` endpoints. The historical workflow name is
retained so existing operational links continue to work.

The API container receives the public staging Supabase origin and publishable
key—never a service credential—and verifies caller JWTs with Supabase JWKS. It
uses a read-only container filesystem with all Linux capabilities dropped, and is
constrained to 256 MiB memory with no additional swap, one CPU, and 128 PIDs.
Deployment verifies those limits after startup. `PANTRY_API_DENY_DESTINATIONS`
is required so the scraper refuses the shared droplet destination in addition to
its DNS/IP/port protections.

The approved staging Nginx vhost proxies `/api/` to the loopback container and
preserves `Authorization`. The API exposes generated Connect unary RPCs and the
server-streaming board-import RPC under `/api/rpc/pantry.v1.*`; compatibility
JSON endpoints remain under `/api/v1/`. Both transports authenticate before
request decoding and call the same application services.

The staging web image sets `EXPO_PUBLIC_PANTRY_API_URL` to the approved staging
origin and `EXPO_PUBLIC_PANTRY_API_TRANSPORT=connect`. Each completed capability
also has an independent `enabled` build gate:

- `EXPO_PUBLIC_PANTRY_API_RECIPE_WRITES`
- `EXPO_PUBLIC_PANTRY_API_RECIPE_IMPORTS`
- `EXPO_PUBLIC_PANTRY_API_RECIPE_MANAGEMENT`
- `EXPO_PUBLIC_PANTRY_API_QUEUE`
- `EXPO_PUBLIC_PANTRY_API_SHOPPING_CHECKS`
- `EXPO_PUBLIC_PANTRY_API_SHOPPING_LIST`
- `EXPO_PUBLIC_PANTRY_API_CATALOG_SETTINGS`
- `EXPO_PUBLIC_PANTRY_API_IMPORT_PARSER`
- `EXPO_PUBLIC_PANTRY_API_BOARD_IMPORT`
- `EXPO_PUBLIC_PANTRY_API_RECIPE_SCRAPE`

Production receives none of these staging values. Direct-table and Edge
Function branches are retained in source for production and immutable-image
rollback compatibility; they are not active staging business paths.

The API workflow accepts only an immutable staging API SHA tag and restores the
previous API image if replacement, health, readiness, listener, or resource-limit
validation fails. A functional two-container rollback must restore the web image
first so it stops issuing calls that an older API may not support, then restore
the API image. Removing only the transport flag is not a complete rollback:
restore a previously verified immutable web/API pair and rerun the public and
capability-specific acceptance gates.

## Production

Production remains a separate, explicit action through **Actions → Deploy** and
[`deploy.yml`](../.github/workflows/deploy.yml). It is manual-only. Do not use a
staging workflow, staging Supabase values, or staging rollback image to deploy
production.

`deploy.sh` is a legacy operator path. It is not an autonomous deployment
mechanism. Any production database, backup, DNS, TLS, infrastructure, container,
or application change requires a separate instruction that explicitly names
production and must first satisfy the documented backup-recovery gate.
