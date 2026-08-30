#!/usr/bin/env bash
# Read-only readiness check for the required backup configuration.
# It never connects to Postgres or writes to Google Drive.
set -euo pipefail

require() {
  local name="$1"
  [[ -n "${!name:-}" ]] || { echo "backup-preflight: $name is required" >&2; exit 1; }
}

require DATABASE_URL
require BACKUP_DRIVE_REMOTE
require RCLONE_CONFIG
require BACKUP_ALERT_WEBHOOK_URL

[[ "$BACKUP_DRIVE_REMOTE" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]] || {
  echo "backup-preflight: BACKUP_DRIVE_REMOTE must be an rclone remote name" >&2
  exit 1
}
[[ -r "$RCLONE_CONFIG" ]] || {
  echo "backup-preflight: RCLONE_CONFIG is not readable" >&2
  exit 1
}

for bin in pg_dump pg_restore rclone curl jq; do
  command -v "$bin" >/dev/null 2>&1 || {
    echo "backup-preflight: $bin is required" >&2
    exit 1
  }
done

rclone --config "$RCLONE_CONFIG" lsd "${BACKUP_DRIVE_REMOTE}:" >/dev/null

echo "backup preflight passed: required tools and Google Drive root are reachable"
