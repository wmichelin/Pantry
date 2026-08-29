#!/usr/bin/env bash
# Restore a logical backup into an explicitly identified, isolated Supabase project.
# This script refuses to run unless the caller provides a separate target project
# reference and an exact confirmation string. It never drops, cleans, or overwrites
# a database; the target must be a fresh scratch database.
set -euo pipefail

FILE="${BACKUP_FILE:?BACKUP_FILE is required}"
TARGET_URL="${BACKUP_RESTORE_DATABASE_URL:?BACKUP_RESTORE_DATABASE_URL is required}"
SOURCE_REF="${BACKUP_SOURCE_PROJECT_REF:?BACKUP_SOURCE_PROJECT_REF is required}"
TARGET_REF="${BACKUP_RESTORE_PROJECT_REF:?BACKUP_RESTORE_PROJECT_REF is required}"
CONFIRM="${BACKUP_RESTORE_CONFIRM:?BACKUP_RESTORE_CONFIRM is required}"

[[ -s "$FILE" ]] || { echo "backup-restore-verify: backup file is missing or empty" >&2; exit 1; }
[[ "$SOURCE_REF" != "$TARGET_REF" ]] || {
  echo "backup-restore-verify: target project ref must differ from the production source ref" >&2
  exit 1
}
[[ "$CONFIRM" == "RESTORE_TO_ISOLATED_SCRATCH_ONLY" ]] || {
  echo "backup-restore-verify: set BACKUP_RESTORE_CONFIRM=RESTORE_TO_ISOLATED_SCRATCH_ONLY" >&2
  exit 1
}
if [[ -n "${DATABASE_URL:-}" && "$TARGET_URL" == "$DATABASE_URL" ]]; then
  echo "backup-restore-verify: target URL must not equal DATABASE_URL" >&2
  exit 1
fi

for bin in pg_restore psql; do
  command -v "$bin" >/dev/null 2>&1 || {
    echo "backup-restore-verify: $bin is required" >&2
    exit 1
  }
done

pg_restore --list "$FILE" >/dev/null
pg_restore \
  --dbname="$TARGET_URL" \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  --single-transaction \
  "$FILE"

psql "$TARGET_URL" -v ON_ERROR_STOP=1 -Atqc "
  select 'public.households=' || count(*) from public.households
  union all
  select 'public.recipes=' || count(*) from public.recipes;
"

echo "backup restore verification passed for isolated project ${TARGET_REF}"
