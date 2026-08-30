#!/usr/bin/env bash
# Upload one Pantry custom-format archive to its dedicated Google Drive root.
#
# This script intentionally uses only rclone's non-destructive commands:
# copyto, lsjson, and check. It never syncs, moves, prunes, or deletes remote data.
# The configured remote must set root_folder_id to the pre-created backup folder.
set -euo pipefail

FILE="${BACKUP_FILE:?BACKUP_FILE is required}"
REMOTE="${BACKUP_DRIVE_REMOTE:?BACKUP_DRIVE_REMOTE is required}"
CONFIG="${RCLONE_CONFIG:?RCLONE_CONFIG is required}"
RCLONE_BIN="${RCLONE_BIN:-rclone}"

[[ -s "$FILE" ]] || { echo "backup-upload-drive: file missing or empty" >&2; exit 1; }
[[ "$REMOTE" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]] || {
  echo "backup-upload-drive: BACKUP_DRIVE_REMOTE must be an rclone remote name" >&2
  exit 1
}
[[ -r "$CONFIG" ]] || { echo "backup-upload-drive: rclone config is not readable" >&2; exit 1; }
command -v "$RCLONE_BIN" >/dev/null 2>&1 || {
  echo "backup-upload-drive: rclone is required" >&2
  exit 1
}
command -v jq >/dev/null 2>&1 || {
  echo "backup-upload-drive: jq is required for exact metadata verification" >&2
  exit 1
}
"$RCLONE_BIN" copyto --help | grep -Fq -- '--immutable' || {
  echo "backup-upload-drive: rclone with copyto --immutable support is required" >&2
  exit 1
}

NAME="$(basename -- "$FILE")"
[[ "$NAME" =~ ^pantry-supabase-[0-9]{8}T[0-9]{6}Z\.dump$ ]] || {
  echo "backup-upload-drive: backup filename is not canonical" >&2
  exit 1
}

LOCAL_SIZE="$(wc -c < "$FILE" | tr -d ' ')"
REMOTE_FILE="${REMOTE}:${NAME}"

# --immutable turns a timestamp collision or unexpected remote object into a failure
# instead of overwriting it. copyto handles exactly this file and no remote pruning.
"$RCLONE_BIN" --config "$CONFIG" copyto --immutable "$FILE" "$REMOTE_FILE"

# lsjson --stat is a read-only metadata lookup. Keep its response out of logs so a
# configuration mistake cannot leak remote metadata into an alert or journal.
METADATA="$("$RCLONE_BIN" --config "$CONFIG" lsjson --stat --files-only "$REMOTE_FILE")"
if ! jq -e --arg name "$NAME" --argjson size "$LOCAL_SIZE" '
  length == 1 and
  .[0].IsDir == false and
  .[0].Name == $name and
  .[0].Size == $size
' >/dev/null <<<"$METADATA"; then
  echo "backup-upload-drive: remote metadata did not match the exact archive name and byte size" >&2
  exit 1
fi

# check compares the source archive to the exact remote object without altering either.
"$RCLONE_BIN" --config "$CONFIG" check --one-way "$FILE" "$REMOTE_FILE"

echo "uploaded and verified ${NAME} (${LOCAL_SIZE} bytes)"
