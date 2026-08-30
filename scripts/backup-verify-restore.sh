#!/usr/bin/env bash
# Restore Pantry application data into an explicitly identified, isolated
# Supabase project. Supabase creates managed schemas and event triggers in every
# project; a project-local postgres role cannot safely replace those managed
# objects. This verifier therefore restores the source auth identities required
# by Pantry's foreign keys, then restores the complete public schema in ordered
# pre-data, data, and post-data passes. The target must be a fresh scratch
# project: this script never drops, cleans, or overwrites it.
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

# Pantry public tables reference auth.users. Restore the source instance/user
# rows first; a new Supabase project supplies the managed auth schema itself.
# Unqualified selectors are intentional: pg_restore's archive matching does not
# accept schema-qualified table names here, and this archive has no public table
# named instances or users.
pg_restore \
  --dbname="$TARGET_URL" \
  --data-only \
  --table=instances \
  --table=users \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  "$FILE"

for section in pre-data data post-data; do
  pg_restore \
    --dbname="$TARGET_URL" \
    --schema=public \
    --section="$section" \
    --no-owner \
    --no-privileges \
    --exit-on-error \
    "$FILE"
done

psql "$TARGET_URL" -v ON_ERROR_STOP=1 -Atqc "
  select 'public.households=' || count(*) from public.households
  union all
  select 'public.recipes=' || count(*) from public.recipes;
"

echo "backup restore verification passed for isolated project ${TARGET_REF}"
