# Database Backup, Restore, and Recovery Gate

Production data lives in Supabase Postgres (project ref `uyuswprxolsktmiraala`).
Pantry creates a nightly custom-format logical dump on its backup runner and copies
each archive to a dedicated Google Drive folder. The Drive folder is a separate
failure domain from the database and application host.

## Recovery gate

Do not run a database migration, RLS change, destructive repair, or production
deployment until all of these have passed:

1. `backup-preflight.sh` confirms the required tools and dedicated Drive root are
   reachable without connecting to Postgres or writing Drive data.
2. A fresh archive is structurally valid, copied with `rclone copyto --immutable`,
   has the exact expected name and byte size on Drive, and passes read-only
   `rclone check --one-way`.
3. The archive is restored into a **separate, initially empty Supabase project**
   with `backup-verify-restore.sh`; representative table counts are recorded,
   the script restores the minimum `authenticated` and `service_role` runtime
   grants omitted by `pg_restore --no-privileges`, and it proves a restored
   household member can read its membership as `authenticated` while RLS remains
   enabled on every restored Pantry table.
4. A success and a controlled failure both reach the configured alert receiver.

The target project for a restore drill must have a different project ref from
production. Record both refs before restoring and never restore over production.
The scratch project's application schema may be reset during its own restore
drill, but no production database is ever cleaned, dropped, or overwritten.

### Current status (audited 2026-08-30)

**Recovery verification must be re-run before it is treated as proven.** G5 has
current rclone with `copyto --immutable`, PostgreSQL client tools, the non-login
`pantry-backup` identity, protected local archive directories, and a root-only
Drive configuration for the dedicated `pantry-drive` remote. A fresh canonical
archive was structurally validated, uploaded with exact metadata and read-only
content verification, then restored into a separate scratch Supabase project.
All 11 Pantry `public` tables matched production row counts, but that earlier
drill did not verify the public runtime grants that are intentionally omitted by
`pg_restore --no-privileges`. Re-run the isolated restore after this gate is in
place; it must pass both the authenticated-read and RLS-enabled checks.

The scheduler and service configuration are not installed or enabled: a
team-owned alert receiver still has to be configured and both success and
controlled-failure notifications have to be evidenced. Do not treat a local log
as an alert substitute.

## What runs

- `scripts/scheduled-do-pg-backup.sh` — creates the canonical
  `pantry-supabase-YYYYMMDDTHHMMSSZ.dump` archive, validates it with
  `pg_restore --list`, uploads it, and only then considers local retention.
- `scripts/backup-upload-drive.sh` — uses only `rclone copyto --immutable`,
  read-only `rclone lsjson --stat`, and read-only `rclone check --one-way`.
  It never uses `sync`, `move`, `delete`, `purge`, `cleanup`, or `rmdir`.
- `scripts/backup-notify.sh` — sends a credential-free success or failure event.
- `scripts/backup-preflight.sh` — read-only tool/configuration and Drive-root
  reachability check; it never connects to Postgres or writes to Drive.
- `scripts/backup-verify-restore.sh` — restores Pantry's public schema and the
  required source auth identities into an explicitly separate scratch project.
- `scripts/pantry-backup.service` — runs the backup as `pantry-backup` with an
  ephemeral rclone credential file supplied by systemd.
- `scripts/pantry-backup.cron` — schedules that systemd service at 03:00 UTC;
  install it only after every recovery gate passes.

## One-time backup-runner setup

Complete the Drive identity and folder work first. Do not reuse a developer's
personal `gdrive:` rclone remote. Create `pantry-drive`, configure its
`root_folder_id` to the pre-created dedicated backup folder, and use a Pantry-owned
Google OAuth client or a Workspace service-account credential. Never commit the
resulting config, token, or service-account JSON.

```bash
# Packages and a non-login service identity. The Ubuntu rclone package on G5 is
# currently too old for the required copyto --immutable guard; install a reviewed
# current rclone release before proceeding, then verify the guard below.
sudo apt-get update
sudo apt-get install -y postgresql-client jq curl
# Install a reviewed current rclone release using the approved package source.
rclone copyto --help | grep -F -- '--immutable'
sudo /usr/sbin/useradd --system --user-group \
  --home-dir /var/lib/pantry-backup --shell /usr/sbin/nologin pantry-backup

# Root-only configuration and service-writable archive directories.
sudo install -d -o root -g root -m 0700 /etc/pantry-backup
sudo install -d -o pantry-backup -g pantry-backup -m 0700 \
  /var/lib/pantry-backup /var/backups/pantry-pg
sudo install -m 0600 -o root -g root /secure/source/rclone.conf \
  /etc/pantry-backup/rclone.conf
sudo install -m 0600 -o root -g root /secure/source/backup.env \
  /etc/pantry-backup/backup.env

# Install, but do not enable, the dedicated services.
sudo install -m 0644 scripts/pantry-backup.service /etc/systemd/system/pantry-backup.service
sudo install -m 0644 scripts/pantry-backup-preflight.service /etc/systemd/system/pantry-backup-preflight.service
sudo systemctl daemon-reload
```

`backup.env` is root-owned mode `0600` and contains only values such as:

```ini
DATABASE_URL=<Supabase connection URI with sslmode=require>
BACKUP_OUTPUT_DIR=/var/backups/pantry-pg
BACKUP_RETENTION_DAYS=14
BACKUP_DRIVE_REMOTE=pantry-drive
BACKUP_ALERT_WEBHOOK_URL=<team-owned HTTPS receiver>
```

Do not print this file or the rclone config. systemd reads the root-only files and
places a process-private copy of `rclone.conf` in its credential directory, exposed
to the `pantry-backup` process as `RCLONE_CONFIG`. The at-rest configuration remains
`root:root 0600`; root access is unavoidable, but no normal login user can read it.

For a Google Workspace service account, install its JSON file as
`/etc/pantry-backup/google-service-account.json` with `root:root 0600`, add a second
`LoadCredential=` entry to the service, and reference its runtime credential path
from the rclone config. Do not place the JSON path in a world-readable unit.

## Test and schedule sequence

1. Run the read-only preflight. It must pass before any database read or Drive
   write:

   ```bash
   sudo systemctl start --wait pantry-backup-preflight.service
   ```

2. With explicit approval, run one manual backup:

   ```bash
   sudo systemctl start --wait pantry-backup.service
   ```

   Record the canonical archive name, local and remote byte sizes, `rclone check`
   result, and success alert. Trigger a controlled notifier failure and record that
   alert as well.

3. With separate explicit approval, create a new empty scratch Supabase project
   and run `backup-verify-restore.sh` with its required, distinct project ref and
   `BACKUP_RESTORE_CONFIRM=RESTORE_TO_ISOLATED_SCRATCH_ONLY`. Never restore over
   production.

4. Only after all evidence is retained, install the scheduler:

   ```bash
   sudo install -m 0644 scripts/pantry-backup.cron /etc/cron.d/pantry-backup
   ```

## Restore verification runbook

Never restore over production. Download a single named archive to a protected host
with `rclone copyto` (not `sync`), then set `BACKUP_FILE` to that local file. The
source ref is production; the restore ref and URL must belong to a new, empty
scratch project. The archive can contain real customer data, so restrict access and
dispose of the scratch project under the documented retention procedure after the
drill evidence is retained.

The verification script restores the required source auth identities first, then
runs `pg_restore` for the Pantry `public` schema's pre-data, data, and post-data
sections with `--no-privileges`, exiting on the first error. It then explicitly
grants only runtime access needed by `authenticated` and `service_role`: schema
usage, table DML, sequence usage/select/update, and function execution. It does
not disable, replace, or broaden any RLS policy.

Before reporting success, the script fails if any restored `public` table has
RLS disabled. It then selects a restored `auth.users` identity with a household
membership, sets only transaction-local JWT claims, assumes the `authenticated`
database role, and verifies that the user can read its own membership. It rolls
back that smoke-test transaction, so it creates no data and persists no session
state. A failed restore or smoke test is evidence that recovery is not ready.
Keep the error record, repair the design, and repeat in a new empty scratch
project; never attempt a partial restore on production.
