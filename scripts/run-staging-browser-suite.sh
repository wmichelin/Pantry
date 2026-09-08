#!/usr/bin/env bash

set -euo pipefail

readonly DEFAULT_CHROMIUM_PATH="/home/wmichelin/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome"
readonly CHROMIUM_BIN="${CHROMIUM_PATH:-$DEFAULT_CHROMIUM_PATH}"

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
  local debug_port=""
  local ready=false

  if [[ ! -f "$script" ]]; then
    echo "Browser verification script does not exist: $script" >&2
    exit 1
  fi

  profile_dir="$(mktemp -d /tmp/pantry-staging-browser.XXXXXX)"
  setsid "$CHROMIUM_BIN" \
    --headless \
    --no-sandbox \
    --disable-gpu \
    --remote-debugging-address=127.0.0.1 \
    --remote-debugging-port=0 \
    --user-data-dir="$profile_dir" \
    --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 \
    about:blank >"$profile_dir/chromium.log" 2>&1 &
  chromium_pid=$!

  cleanup() {
    kill -TERM -- "-$chromium_pid" 2>/dev/null || true
    wait "$chromium_pid" 2>/dev/null || true
    case "$profile_dir" in
      /tmp/pantry-staging-browser.*)
        for _ in {1..20}; do
          rm -rf -- "$profile_dir" 2>/dev/null || true
          [[ ! -e "$profile_dir" ]] && break
          sleep 0.1
        done
        [[ ! -e "$profile_dir" ]] || echo "Could not remove browser profile: $profile_dir" >&2
        ;;
      *) echo "Refusing to remove unexpected browser profile: $profile_dir" >&2 ;;
    esac
  }
  trap cleanup EXIT

  for _ in {1..100}; do
    if [[ -s "$profile_dir/DevToolsActivePort" ]]; then
      debug_port="$(head -n 1 "$profile_dir/DevToolsActivePort")"
    fi
    if [[ "$debug_port" =~ ^[0-9]+$ ]] && curl -fsS "http://127.0.0.1:${debug_port}/json/version" >/dev/null 2>&1; then
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
  PANTRY_BROWSER_DEBUG_PORT="$debug_port" node "$script"
)

for script in "$@"; do
  run_suite "$script"
done
