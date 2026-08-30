# Staging

Staging runs on the production DigitalOcean droplet with isolated application
and data boundaries:

- URL: `https://staging.45.55.214.46.sslip.io`
- Container: `pantry-staging`, bound only to `127.0.0.1:8081`
- nginx vhost: `/etc/nginx/sites-available/pantry-staging`
- Supabase: the separate `pantry-staging` project; it contains Pantry's schema
  only and no copied production rows or users.
- GitHub Actions: `deploy-staging.yml`, which uses only
  `STAGING_SUPABASE_URL` and `STAGING_SUPABASE_ANON_KEY` for the web build.

## Operating boundary

The droplet is a shared host, so a host outage affects both staging and
production. The staging workflow never removes the `pantry` production
container, uses a separate image tag and concurrency group, and proxies only to
the staging loopback port. It must not receive production Supabase values.

The Supabase staging project permits redirects only to the staging URL. Use
synthetic accounts and data there. Do not copy production customer data into
staging.

## Deploy and verify

After `deploy-staging.yml` is present on the repository default branch, dispatch
it through `scripts/pantry-actions.sh` with an approved ref. Verify the workflow
run, then visit the staging URL and confirm the application uses the staging
Supabase project. Roll back by dispatching the previous known-good ref; this
replaces only `pantry-staging`.
