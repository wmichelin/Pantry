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
hostname. If the replacement fails after the new container starts, it restores
the previously running staging image when one is available.

The separate **Publish staging on approved domain** workflow is only for the
staging Nginx vhost and certificate. It may be needed once for a new hostname.
Because Nginx is shared, it verifies the production container and HTTPS endpoint
before and after every staging-scoped reload. It must never modify the production
vhost, certificate, container, port, or application configuration.

Before a material staging change, record the current image as the last known-good
rollback target. If a staging deployment cannot be repaired forward, restore that
image and verify both staging routes before reporting the incident.

### Go API foundation (staging only)

The Go port begins as a separate `pantry-api-staging` container bound only to
`127.0.0.1:18083`. Use **Actions → Deploy Go API foundation to staging → Run
workflow** to publish an immutable
`ghcr.io/wmichelin/pantry:staging-api-<full-commit-sha>` image and probe its
loopback `/healthz` and `/readyz` endpoints.

The foundational deployment deliberately does not change the Expo client, add
database credentials, run migrations, or make a production change. The
container receives the public Supabase origin and publishable/anon API key at
runtime—never a service credential—and verifies user JWTs using the Supabase
JWKS endpoint.

After the staging RLS/database feasibility gate passes, run **Publish staging on
approved domain** once to proxy the staging-only `/api/` path to this loopback
container. It preserves the caller's `Authorization` header and checks that an
anonymous membership request receives `401`; it adds no service credential.
The staging web workflow builds `EXPO_PUBLIC_PANTRY_API_URL` only for the
approved staging domain, allowing the landing screen to use the Go membership
read route. Production receives no such build value and stays on its current
Supabase client path.

The workflow accepts a strict immutable API rollback tag and restores the prior
API image if its health probes fail. If no prior API image exists, it removes the
failed new API container; the existing staging web service remains untouched.

## Production

Production remains a separate, explicit action through **Actions → Deploy** and
[`deploy.yml`](../.github/workflows/deploy.yml). It is manual-only. Do not use a
staging workflow, staging Supabase values, or staging rollback image to deploy
production.

`deploy.sh` is a legacy operator path. It is not an autonomous deployment
mechanism. Any production database, backup, DNS, TLS, infrastructure, container,
or application change requires a separate instruction that explicitly names
production and must first satisfy the documented backup-recovery gate.
