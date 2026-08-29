#!/usr/bin/env bash
# Read-only readiness check for the required backup configuration.
# It never connects to Postgres or writes to object storage.
set -euo pipefail

require() {
  local name="$1"
  [[ -n "${!name:-}" ]] || { echo "backup-preflight: $name is required" >&2; exit 1; }
}

require DATABASE_URL
require BACKUP_S3_BUCKET
require BACKUP_S3_ENDPOINT
require AWS_ACCESS_KEY_ID
require AWS_SECRET_ACCESS_KEY
require BACKUP_ALERT_WEBHOOK_URL

for bin in pg_dump pg_restore aws curl; do
  command -v "$bin" >/dev/null 2>&1 || {
    echo "backup-preflight: $bin is required" >&2
    exit 1
  }
done

export AWS_REGION="${AWS_REGION:-auto}"
export AWS_DEFAULT_REGION="$AWS_REGION"
aws s3api head-bucket \
  --bucket "$BACKUP_S3_BUCKET" \
  --endpoint-url "$BACKUP_S3_ENDPOINT"

echo "backup preflight passed: required tools and offsite bucket are reachable"
