#!/usr/bin/env bash
# Send a minimal backup status event to a configured HTTPS webhook.
# The payload intentionally contains no credentials, database URL, or customer data.
set -euo pipefail

STATUS="${1:?status is required}"
MESSAGE="${2:?message is required}"
URL="${BACKUP_ALERT_WEBHOOK_URL:?BACKUP_ALERT_WEBHOOK_URL is required}"

command -v curl >/dev/null 2>&1 || { echo "backup-notify: curl is required" >&2; exit 1; }

json_escape() {
  printf '%s' "$1" | tr '\r\n' '  ' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

HOST="$(hostname)"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
PAYLOAD=$(printf '{"service":"pantry-backup","status":"%s","host":"%s","time":"%s","message":"%s"}' \
  "$(json_escape "$STATUS")" \
  "$(json_escape "$HOST")" \
  "$(json_escape "$NOW")" \
  "$(json_escape "$MESSAGE")")

curl --fail --silent --show-error --max-time 15 \
  -H 'Content-Type: application/json' \
  --data "$PAYLOAD" \
  "$URL" >/dev/null
