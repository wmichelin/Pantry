# Deployment

Two ways to deploy the static web build to the DigitalOcean droplet
(`pantry.waltermichelin.com`):

1. **`./deploy.sh`** — runs from the G5/t3.code server using Docker, Terraform,
   SSH access, and the Terraform state stored on that server.
2. **GitHub Actions `Deploy` workflow** (`.github/workflows/deploy.yml`) — runs on
   GitHub's runners using repo **secrets**, so it can be triggered without your
   laptop. This is how Claude Code can deploy: it has no droplet access or secrets
   in its sandbox, but it can start this workflow via the GitHub API.

Both build the same image (`ghcr.io/wmichelin/pantry:latest`) and restart the
`pantry` container on the droplet, mirroring `deploy.sh`.

## Set up the G5/t3.code server

Install Git, Docker, Terraform 1.9.8 (or use `tfenv`, which reads
`.terraform-version`), and the DigitalOcean credentials used by Terraform. Then
clone the repository and initialize Terraform:

```sh
git clone <repository-url> Pantry
cd Pantry
terraform -chdir=terraform init
```

Move the existing `terraform/terraform.tfstate` and
`terraform/terraform.tfstate.backup` files to the G5 server, or configure a
remote Terraform backend before running `terraform apply`. Do not commit state
files or tokens. If the state is not available, import the existing resources
before applying so Terraform does not attempt to recreate production.

The G5 server needs Docker and SSH access to the droplet. Configure the
deployment environment:

```sh
export DROPLET_HOST="<droplet-ip-or-hostname>"
export GITHUB_TOKEN="<ghcr-push-and-pull-token>"
export EXPO_PUBLIC_SUPABASE_URL="<supabase-url>"
export EXPO_PUBLIC_SUPABASE_ANON_KEY="<supabase-anon-key>"
./deploy.sh
```

`deploy.sh` now requires Terraform and automatically runs `terraform init`, then
gets the deployment host from `terraform output -raw droplet_ip`. The optional
`DROPLET_HOST` override is useful only for emergency targeting; normal G5
deployments should use Terraform state.

The image is built explicitly for `linux/amd64`, matching standard G5 x86
servers; the remote host only needs to pull and run the image.

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
| `GHCR_PAT` | Classic PAT with `read:packages` + `write:packages` (used to push/pull `ghcr.io/wmichelin/pantry`) |

Notes:
- The values for the two `EXPO_PUBLIC_*` secrets are the same ones in your local
  `.env`. They are **public** by design (anon key + URL ship to the browser), but
  storing them as secrets keeps the workflow file clean.
- `GHCR_PAT` is required because the default Actions `GITHUB_TOKEN` cannot push to
  this package in practice; rotate the PAT if it is ever exposed.

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
