# Database Backups & Restore

Production data lives in Supabase Postgres (project ref `uyuswprxolsktmiraala`).
We do **not** rely on Supabase managed backups/PITR (Pro add-on cost). Instead a
nightly logical dump runs on the DigitalOcean droplet we already pay for, and is
copied offsite to cheap object storage.

## What runs

- `scripts/scheduled-do-pg-backup.sh` — `pg_dump -Fc` (custom format) of the full
  database to `BACKUP_OUTPUT_DIR` (default `/var/backups/pantry-pg`), prunes dumps
  older than `BACKUP_RETENTION_DAYS`, then calls the upload script.
- `scripts/backup-upload-spaces.sh` — uploads the dump to an S3-compatible bucket.
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
sudo apt-get update -y && sudo apt-get install -y postgresql-client awscli

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
ENV
sudo chmod 600 /etc/pantry-backup.env
sudo mkdir -p /var/backups/pantry-pg

# 4. Install the cron job
sudo cp /opt/pantry/scripts/pantry-backup.cron /etc/cron.d/pantry-backup
sudo chmod 644 /etc/cron.d/pantry-backup

# 5. Smoke test (runs immediately, prints the dump path)
sudo bash -c 'set -a; . /etc/pantry-backup.env; set +a; /opt/pantry/scripts/scheduled-do-pg-backup.sh'
```

Get the `DATABASE_URL` from Supabase Dashboard → Project Settings → Database →
Connection string (URI). Use the direct/session connection, not the anon key.

## Restore runbook

**Always restore into a scratch database first — never straight over production.**

```bash
# Into a throwaway local DB to verify the dump is good:
createdb pantry_restore_test
pg_restore --no-owner --no-acl -d pantry_restore_test pantry-supabase-<stamp>.dump
psql pantry_restore_test -c '\dt'        # tables present?
psql pantry_restore_test -c 'select count(*) from recipes;'

# Into a fresh Supabase project (disaster recovery):
pg_restore --no-owner --no-acl \
  -d 'postgresql://postgres:<pw>@db.<newref>.supabase.co:5432/postgres?sslmode=require' \
  pantry-supabase-<stamp>.dump
```

## Verify the backups are actually working

A backup you have never restored is not a backup. Monthly:
1. Pull the latest dump from the offsite bucket.
2. `pg_restore` it into `pantry_restore_test` and confirm row counts look right.
3. Check `/var/backups/pantry-pg/backup.log` for `backup complete` lines and no `ERROR`.
