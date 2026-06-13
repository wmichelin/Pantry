#!/usr/bin/env bash
# Logical backup of Postgres (Supabase direct URI) -> local custom-format dump -> optional cloud upload.
# Run from repo root or any host that can reach the DB (DATABASE_URL must include sslmode=require for Supabase).
#
# Env:
#   DATABASE_URL           - postgres URI (required); Supabase: Dashboard -> Database -> URI (direct/pooler), not anon key
#   BACKUP_OUTPUT_DIR      - default /var/backups/pantry-pg
#   BACKUP_RETENTION_DAYS  - delete local pantry-supabase-*.dump older than N days (optional)
#   BACKUP_LOG_FILE        - append run logs here (default $BACKUP_OUTPUT_DIR/backup.log)
# Upload (optional): set BACKUP_S3_BUCKET (or AWS_S3_BUCKET / SPACES_BUCKET) + creds - see backup-upload-spaces.sh
#
# Exit non-zero on any failure so cron/monitoring notices a broken backup.
set -euo pipefail

OUT="${BACKUP_OUTPUT_DIR:-/var/backups/pantry-pg}"
mkdir -p "$OUT"
LOG="${BACKUP_LOG_FILE:-$OUT/backup.log}"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG" >&2; }

# Make any failure loud: log the failing line before exiting.
trap 'log "ERROR: backup FAILED at line $LINENO (exit $?)"' ERR

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="${OUT}/pantry-supabase-${STAMP}.dump"

log "starting pg_dump -> $FILE"
pg_dump "${DATABASE_URL:?DATABASE_URL is required}" -Fc --no-owner --no-acl -f "$FILE"

# A custom-format dump is never legitimately empty; treat a tiny/missing file as a failure.
if [[ ! -s "$FILE" ]]; then
  log "ERROR: dump file missing or empty: $FILE"
  exit 1
fi
SIZE="$(wc -c < "$FILE" | tr -d ' ')"
log "pg_dump OK (${SIZE} bytes)"

if [[ -n "${BACKUP_RETENTION_DAYS:-}" ]]; then
  find "$OUT" -name 'pantry-supabase-*.dump' -mtime "+${BACKUP_RETENTION_DAYS}" -print -delete 2>/dev/null \
    | while read -r old; do log "pruned old backup: $old"; done || true
fi

_UP="$(dirname "$0")/backup-upload-spaces.sh"
if [[ -f "$_UP" ]] && { [[ -n "${BACKUP_S3_BUCKET:-}" ]] || [[ -n "${AWS_S3_BUCKET:-}" ]] || [[ -n "${SPACES_BUCKET:-}" ]]; }; then
  log "uploading offsite via $(basename "$_UP")"
  if BACKUP_FILE="$FILE" "$_UP"; then
    log "offsite upload OK"
  else
    log "ERROR: offsite upload FAILED for $FILE"
    exit 1
  fi
else
  log "offsite upload skipped (no bucket configured)"
fi
unset _UP

log "backup complete: $FILE"
echo "$FILE"
