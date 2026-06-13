#!/usr/bin/env bash
# Upload a backup file to an S3-compatible object store.
# Default/recommended target: Cloudflare R2 free tier (10 GB, no egress fees, $0 at this scale).
# Also works unchanged with AWS S3, DigitalOcean Spaces, or Backblaze B2 (all S3-compatible).
#
# Required:
#   BACKUP_FILE            - path to the .dump to upload (set by scheduled-do-pg-backup.sh)
#   BACKUP_S3_BUCKET       - bucket name        (aliases: AWS_S3_BUCKET, SPACES_BUCKET)
#   AWS_ACCESS_KEY_ID      - access key
#   AWS_SECRET_ACCESS_KEY  - secret key
#
# For Cloudflare R2 / Spaces / B2 (anything that isn't native AWS), set the endpoint:
#   BACKUP_S3_ENDPOINT     - e.g. https://<accountid>.r2.cloudflarestorage.com   (alias: AWS_S3_ENDPOINT)
#   AWS_REGION             - "auto" for R2; the region for AWS/Spaces (default: auto)
# Optional:
#   BACKUP_S3_PREFIX       - key prefix/folder (default: pantry-pg)
#
# Requires the `aws` CLI (apt-get install -y awscli, or pip install awscli).
set -euo pipefail

FILE="${BACKUP_FILE:?BACKUP_FILE is required}"
[[ -s "$FILE" ]] || { echo "backup-upload: file missing/empty: $FILE" >&2; exit 1; }

BUCKET="${BACKUP_S3_BUCKET:-${AWS_S3_BUCKET:-${SPACES_BUCKET:-}}}"
[[ -n "$BUCKET" ]] || { echo "backup-upload: no bucket configured" >&2; exit 1; }

ENDPOINT="${BACKUP_S3_ENDPOINT:-${AWS_S3_ENDPOINT:-}}"
PREFIX="${BACKUP_S3_PREFIX:-pantry-pg}"
export AWS_REGION="${AWS_REGION:-auto}"
export AWS_DEFAULT_REGION="$AWS_REGION"

KEY="${PREFIX%/}/$(basename "$FILE")"
ARGS=(s3 cp "$FILE" "s3://${BUCKET}/${KEY}" --only-show-errors)
[[ -n "$ENDPOINT" ]] && ARGS+=(--endpoint-url "$ENDPOINT")

command -v aws >/dev/null 2>&1 || { echo "backup-upload: aws CLI not found" >&2; exit 1; }
aws "${ARGS[@]}"
echo "uploaded s3://${BUCKET}/${KEY}"
