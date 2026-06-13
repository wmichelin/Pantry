# Deployment

Two ways to deploy the static web build to the DigitalOcean droplet
(`pantry.waltermichelin.com`):

1. **`./deploy.sh`** — runs from your laptop using your local `.env`, SSH key, and
   `terraform/` state. Unchanged; still works.
2. **GitHub Actions `Deploy` workflow** (`.github/workflows/deploy.yml`) — runs on
   GitHub's runners using repo **secrets**, so it can be triggered without your
   laptop. This is how Claude Code can deploy: it has no droplet access or secrets
   in its sandbox, but it can start this workflow via the GitHub API.

Both build the same image (`ghcr.io/wmichelin/pantry:latest`) and restart the
`pantry` container on the droplet, mirroring `deploy.sh`.

## One-time setup: add repo secrets

In GitHub → **Settings → Secrets and variables → Actions → New repository secret**,
add these four. (GHCR auth uses the built-in `GITHUB_TOKEN`, so no registry secret
is needed.)

| Secret | Value |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL (baked into the web bundle at build time) |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `DROPLET_HOST` | The droplet's public IP (same value as `terraform output -raw droplet_ip`) |
| `DROPLET_SSH_KEY` | A **private** SSH key whose public half is authorized for `root` on the droplet (paste the full key, including the BEGIN/END lines) |

Notes:
- The values for the two `EXPO_PUBLIC_*` secrets are the same ones in your local
  `.env`. They are **public** by design (anon key + URL ship to the browser), but
  storing them as secrets keeps the workflow file clean.
- The droplet pulls the private GHCR image using the workflow's `GITHUB_TOKEN`, so
  no Personal Access Token is required on the droplet.
- `permissions: packages: write` in the workflow lets the runner push the image.

## How to deploy

- **From the GitHub UI:** Actions → **Deploy** → **Run workflow** → branch `main`.
- **Via Claude Code:** ask it to deploy; it triggers the `Deploy` workflow on `main`
  through the GitHub API and reports the run status. (The workflow must already be
  merged to `main` — `workflow_dispatch` only triggers workflows on the default
  branch.)

The workflow is **manual-only** (`workflow_dispatch`) so deploys are always
intentional. To auto-deploy on every merge to `main`, add a `push: { branches:
[main] }` trigger to `deploy.yml`.

## First run vs. subsequent runs

On the very first run for a fresh droplet the workflow writes the nginx vhost and
provisions a Let's Encrypt cert via certbot. Once `/etc/letsencrypt/live/$DOMAIN`
exists, later runs skip that and only `nginx -t && systemctl reload nginx`, so they
never clobber the HTTPS config.
