#!/usr/bin/env bash
set -euo pipefail

# The first contract commit has no schema baseline. Every later commit and PR
# is checked against the merge base so field-number reuse and other breaking
# wire changes fail in CI before generated code is accepted.
base_ref=""
if [ -n "${GITHUB_BASE_REF:-}" ]; then
  base_ref="origin/${GITHUB_BASE_REF}"
elif git rev-parse HEAD^ >/dev/null 2>&1; then
  base_ref="HEAD^"
fi

if [ -z "$base_ref" ] || ! git cat-file -e "${base_ref}:proto" 2>/dev/null; then
  echo 'No prior Protobuf contract exists; skipping the bootstrap breaking check.'
  exit 0
fi

npx buf breaking --against ".git#ref=${base_ref},subdir=proto"
