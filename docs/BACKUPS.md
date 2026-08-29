# Database Backup, Restore, and Recovery Gate

Production data lives in Supabase Postgres (project ref `uyuswprxolsktmiraala`).
We do **not** rely on Supabase managed backups/PITR (Pro add-on cost). Instead a
nightly logical dump runs on the DigitalOcean droplet we already pay for, and is
copied offsite to cheap object storage.

## Recovery gate

Do not run a database migration, RLS change, destructive repair, or production
deployment until this gate has passed:

1. `backup-preflight.sh` confirms the required tools and offsite bucket are reachable.
2. A fresh dump passes custom-archive validation, uploads offsite, and its remote
   size matches the local artifact.
3. The artifact is restored into a **separate, empty Supabase project** using
   `backup-verify-restore.sh`; representative table counts are recorded.
4. A success and a simulated failure both reach the configured alert receiver.

The target project for a restore drill must have a different project ref from
production. The verifier rejects a same-ref target and requires an explicit
`RESTORE_TO_ISOLATED_SCRATCH_ONLY` confirmation. It never drops, cleans, or
overwrites any database.

### Current status (audited 2026-08-29)

**Blocked — not installed on production.** The production droplet has no backup
environment file, cron entry, backup directory, Postgres client tools, or AWS CLI.
No database backup or restore command was run during this audit.

## What runs

- `scripts/scheduled-do-pg-backup.sh` — `pg_dump -Fc` (custom format) of the full
  database to `BACKUP_OUTPUT_DIR` (default `/var/backups/pantry-pg`), validates the
  archive, uploads it offsite, verifies the remote byte count, then prunes old local
  dumps only after the remote copy succeeds.
- `scripts/backup-upload-spaces.sh` — uploads and size-verifies the dump in an
  S3-compatible bucket.
- `scripts/backup-notify.sh` — sends a credential-free success or failure event to
  the required alert webhook.
- `scripts/backup-preflight.sh` — read-only configuration and bucket-reachability
  check; it never connects to Postgres or writes objects.
- `scripts/backup-verify-restore.sh` — restores a selected dump into an explicitly
  separate scratch Supabase project and verifies `households` and `recipes` exist.
- `scripts/pantry-backup.cron` — runs the above nightly at 03:00 UTC.

## Offsite target (cost)

Default is **Cloudflare R2 free tier** (10 GB storage, no egress fees → **$0** at
our scale; dumps are KB–MB). R2 is S3-compatible, so the same script works with
AWS S3, DigitalOcean Spaces, or Backblaze B2 by changing the bucket/endpoint.

Zero-setup alternative: a private Supabase Storage bucket (free 1 GB) — but it
shares a failure domain with the database, so it is weaker for disaster recovery.

## One-time droplet setup

```bash
# 1. Put the repo at /opt/pantry (or edit the path in pantry-backup.cron)
sudo mkdir -p /opt/pantry && sudo git clone <repo> /opt/pantry   # or rsync the checkout

# 2. Tools
sudo apt-get update -y && sudo apt-get install -y postgresql-client awscli curl

# 3. Secrets (root-only; never commit)
sudo tee /etc/pantry-backup.env >/dev/null <<'ENV'
DATABASE_URL=postgresql://postgres:<password>@db.uyuswprxolsktmiraala.supabase.co:5432/postgres?sslmode=require
BACKUP_OUTPUT_DIR=/var/backups/pantry-pg
BACKUP_RETENTION_DAYS=14
BACKUP_S3_BUCKET=pantry-backups
BACKUP_S3_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
AWS_ACCESS_KEY_ID=<r2-access-key>
AWS_SECRET_ACCESS_KEY=<r2-secret-key>
AWS_REGION=auto
BACKUP_ALERT_WEBHOOK_URL=https://<alert-receiver>/pantry-backup
ENV
sudo chmod 600 /etc/pantry-backup.env
sudo mkdir -p /var/backups/pantry-pg

# 4. Install the cron job
sudo cp /opt/pantry/scripts/pantry-backup.cron /etc/cron.d/pantry-backup
sudo chmod 644 /etc/cron.d/pantry-backup

# 5. Read-only preflight: tools and bucket only
sudo bash -c 'set -a; . /etc/pantry-backup.env; set +a; /opt/pantry/scripts/backup-preflight.sh'

# 6. Backup smoke test (runs immediately, prints the dump path)
sudo bash -c 'set -a; . /etc/pantry-backup.env; set +a; /opt/pantry/scripts/scheduled-do-pg-backup.sh'
```

Get the `DATABASE_URL` from Supabase Dashboard → Project Settings → Database →
Connection string (URI), never the anon key. Use the Supavisor session-pooler
connection by default from the IPv4-only droplet; use the direct connection only if
the host has the required IPv6 reachability or the project has the IPv4 add-on.

## Alert receiver

`BACKUP_ALERT_WEBHOOK_URL` must be an HTTPS endpoint owned by the team that accepts
a JSON `POST`. The only fields sent are service name, success/failure status, host,
timestamp, and a short operational message. Never put the database URI, dump path,
bucket credential, or customer data in an alert payload.

Test both a successful delivery and a controlled failure before declaring the backup
gate passed. The notification endpoint and its credential belong in
`/etc/pantry-backup.env`, never in this repository.

## Restore verification runbook

**Never restore over production.** Create a new, empty Supabase project dedicated to
the restore drill. It must not share the production project ref, credentials, or
public URL. The logical archive can contain real customer data, so keep the target
private, restrict access, and destroy it only under the documented data-retention
procedure after the drill evidence is retained.

```bash
# Download the specific offsite object to a protected host. Do not use a developer
# workstation or a shared directory.
aws s3 cp s3://pantry-backups/pantry-pg/pantry-supabase-<stamp>.dump ./pantry-supabase-<stamp>.dump \
  --endpoint-url https://<accountid>.r2.cloudflarestorage.com

# The source ref is production. The restore ref and URL MUST belong to the separate,
# empty scratch project. The confirmation value is intentionally exact.
export BACKUP_FILE="$PWD/pantry-supabase-<stamp>.dump"
export BACKUP_SOURCE_PROJECT_REF=uyuswprxolsktmiraala
export BACKUP_RESTORE_PROJECT_REF=<separate-scratch-project-ref>
export BACKUP_RESTORE_DATABASE_URL='postgresql://postgres:<password>@<scratch-session-pooler>:5432/postgres?sslmode=require'
export BACKUP_RESTORE_CONFIRM=RESTORE_TO_ISOLATED_SCRATCH_ONLY
./scripts/backup-verify-restore.sh
```

The verification script runs `pg_restore` with `--single-transaction` and exits on
the first error. A failed restore is evidence that recovery is not ready; keep the
error log, repair the backup/restore design, and repeat in a new empty scratch
project. Do not try to “fix” the failure by running a partial restore on production.

For a real disaster, stop and use an incident-specific recovery plan with explicit
approval, a verified latest artifact, a maintenance window, and the current
Supabase restore guidance. Supabase documents logical dumps as the portable option
and notes that recovery can require a new project rather than in-place overwrite.

## Verify the backups are actually working

A backup you have never restored is not a backup. Monthly:
1. Run the read-only preflight and record the timestamp and bucket result.
2. Pull the latest dump from the offsite bucket to a protected restore host.
3. Run `backup-verify-restore.sh` against a newly created isolated scratch project;
   record its project ref, artifact key, table-count output, and completion time.
4. Verify the success alert and a controlled failure alert arrived.
5. Check `/var/backups/pantry-pg/backup.log` for `backup complete` lines and no
   `ERROR`, then retain the drill record with the delivery issue.
