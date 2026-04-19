#!/usr/bin/env bash
# Logical backup of Postgres (Supabase direct URI) → local custom-format dump → optional cloud upload.
# Run from repo root or any host that can reach the DB (DATABASE_URL must include sslmode=require for Supabase).
#
# Env:
#   DATABASE_URL           — postgres URI (required); Supabase: Dashboard → Database → URI (direct), not anon key
#   BACKUP_OUTPUT_DIR      — default /var/backups/pantry-pg
#   BACKUP_RETENTION_DAYS  — delete local pantry-supabase-*.dump older than N days (optional)
# Upload (optional): set AWS_S3_BUCKET + AWS_REGION for native S3, or SPACES_* for DO Spaces — see backup-upload-spaces.sh
#
set -euo pipefail

OUT="${BACKUP_OUTPUT_DIR:-/var/backups/pantry-pg}"
mkdir -p "$OUT"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="${OUT}/pantry-supabase-${STAMP}.dump"

pg_dump "${DATABASE_URL:?}" -Fc --no-owner --no-acl -f "$FILE"

if [[ -n "${BACKUP_RETENTION_DAYS:-}" ]]; then
  find "$OUT" -name 'pantry-supabase-*.dump' -mtime "+${BACKUP_RETENTION_DAYS}" -delete 2>/dev/null || true
fi

_UP="$(dirname "$0")/backup-upload-spaces.sh"
if [[ -f "$_UP" ]] && { [[ -n "${AWS_S3_BUCKET:-}" ]] || [[ -n "${SPACES_BUCKET:-}" ]]; }; then
  BACKUP_FILE="$FILE" "$_UP" || true
fi
unset _UP

echo "$FILE"
