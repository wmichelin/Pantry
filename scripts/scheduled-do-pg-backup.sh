#!/usr/bin/env bash
# Logical backup of Postgres (Supabase connection URI) -> local custom-format dump -> verified offsite upload.
# Run from repo root or any host that can reach the DB (DATABASE_URL must include sslmode=require for Supabase).
#
# Env:
#   DATABASE_URL           - postgres URI (required); Supabase: Dashboard -> Database -> URI (direct/pooler), not anon key
#   BACKUP_OUTPUT_DIR      - default /var/backups/pantry-pg
#   BACKUP_RETENTION_DAYS  - delete local pantry-supabase-*.dump older than N days (optional)
#   BACKUP_LOG_FILE        - append run logs here (default $BACKUP_OUTPUT_DIR/backup.log)
# Upload: BACKUP_DRIVE_REMOTE and RCLONE_CONFIG are required - see backup-upload-drive.sh
# Alert: BACKUP_ALERT_WEBHOOK_URL is required and receives a small JSON status payload - see backup-notify.sh
#
# Exit non-zero on any failure so cron/monitoring notices a broken backup.
set -euo pipefail

OUT="${BACKUP_OUTPUT_DIR:-/var/backups/pantry-pg}"
mkdir -p "$OUT"
LOG="${BACKUP_LOG_FILE:-$OUT/backup.log}"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG" >&2; }

NOTIFIER="$(dirname "$0")/backup-notify.sh"
notify() {
  "$NOTIFIER" "$1" "$2"
}

# Make any failure loud: log the failing line before exiting.
trap 'rc=$?; log "ERROR: backup FAILED at line $LINENO (exit $rc)"; notify failure "backup failed on $(hostname) at line $LINENO (exit $rc)" || true; exit "$rc"' ERR

[[ -x "$NOTIFIER" ]] || { log "ERROR: backup notifier is missing or not executable: $NOTIFIER"; exit 1; }
[[ -n "${BACKUP_DRIVE_REMOTE:-}" ]] || {
  log "ERROR: Google Drive remote is required; refusing a local-only backup"
  exit 1
}
[[ -n "${RCLONE_CONFIG:-}" ]] || {
  log "ERROR: RCLONE_CONFIG is required"
  exit 1
}
[[ -n "${BACKUP_ALERT_WEBHOOK_URL:-}" ]] || {
  log "ERROR: BACKUP_ALERT_WEBHOOK_URL is required"
  exit 1
}

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

# Read the archive catalog before retaining or uploading it. This is not a restore,
# but catches a truncated or malformed custom-format dump immediately.
command -v pg_restore >/dev/null 2>&1 || { log "ERROR: pg_restore is required to validate the dump"; exit 1; }
pg_restore --list "$FILE" >/dev/null
log "dump archive validation OK"

_UP="$(dirname "$0")/backup-upload-drive.sh"
[[ -x "$_UP" ]] || { log "ERROR: offsite upload helper is missing or not executable: $_UP"; exit 1; }
log "uploading offsite via $(basename "$_UP")"
BACKUP_FILE="$FILE" "$_UP"
log "offsite upload and size verification OK"
unset _UP

if [[ -n "${BACKUP_RETENTION_DAYS:-}" ]]; then
  [[ "$BACKUP_RETENTION_DAYS" =~ ^[1-9][0-9]*$ ]] || {
    log "ERROR: BACKUP_RETENTION_DAYS must be a positive integer"
    exit 1
  }
  find "$OUT" -name 'pantry-supabase-*.dump' -mtime "+${BACKUP_RETENTION_DAYS}" -print -delete \
    | while read -r old; do log "pruned old backup: $old"; done
fi

log "backup complete: $FILE"
notify success "backup completed on $(hostname): $(basename "$FILE") (${SIZE} bytes)"
echo "$FILE"
