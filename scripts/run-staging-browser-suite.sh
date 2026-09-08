#!/usr/bin/env bash

set -euo pipefail

readonly DEFAULT_CHROMIUM_PATH="/home/wmichelin/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome"
readonly CHROMIUM_BIN="${CHROMIUM_PATH:-$DEFAULT_CHROMIUM_PATH}"
readonly DEBUG_PORT="${PANTRY_BROWSER_DEBUG_PORT:-9222}"

if [[ ! -x "$CHROMIUM_BIN" ]]; then
  echo "Chromium is not executable at $CHROMIUM_BIN" >&2
  exit 1
fi

if (($# == 0)); then
  set -- scripts/verify-staging-*-browser.mjs
fi

run_suite() (
  local script="$1"
  local profile_dir
  local chromium_pid
  local ready=false

  if [[ ! -f "$script" ]]; then
    echo "Browser verification script does not exist: $script" >&2
    exit 1
  fi

  profile_dir="$(mktemp -d /tmp/pantry-staging-browser.XXXXXX)"
  "$CHROMIUM_BIN" \
    --headless \
    --no-sandbox \
    --disable-gpu \
    --remote-debugging-address=127.0.0.1 \
    --remote-debugging-port="$DEBUG_PORT" \
    --user-data-dir="$profile_dir" \
    --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 \
    about:blank >"$profile_dir/chromium.log" 2>&1 &
  chromium_pid=$!

  cleanup() {
    if kill -0 "$chromium_pid" 2>/dev/null; then
      kill "$chromium_pid" 2>/dev/null || true
      wait "$chromium_pid" 2>/dev/null || true
    fi
  }
  trap cleanup EXIT

  for _ in {1..100}; do
    if curl -fsS "http://127.0.0.1:${DEBUG_PORT}/json/version" >/dev/null 2>&1; then
      ready=true
      break
    fi
    sleep 0.1
  done

  if [[ "$ready" != true ]]; then
    echo "Chromium debug endpoint did not become ready for $script" >&2
    tail -100 "$profile_dir/chromium.log" >&2
    exit 1
  fi

  echo "Running $script"
  node "$script"
)

for script in "$@"; do
  run_suite "$script"
done
