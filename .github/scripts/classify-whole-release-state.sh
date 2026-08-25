#!/usr/bin/env bash

set -euo pipefail

: "${RUNTIME_ROOT:?RUNTIME_ROOT is required}"
: "${EXPECTED_SHA:?EXPECTED_SHA is required}"
: "${RELEASE_ATTEMPT:?RELEASE_ATTEMPT is required}"
: "${STATIC_STATUS_FILE:?STATIC_STATUS_FILE is required}"

if ! printf '%s\n' "$EXPECTED_SHA" | grep -Eq '^[0-9a-f]{40}$' ||
  ! printf '%s\n' "$RELEASE_ATTEMPT" | grep -Eq '^[0-9]+-[1-9][0-9]*$'; then
  echo "::error::invalid whole-release identity" >&2
  exit 1
fi

FULL_SOURCE="$RUNTIME_ROOT/DEPLOY_SOURCE.txt"
API_SOURCE="$RUNTIME_ROOT/API_DEPLOY_SOURCE.txt"

matches_current_attempt() {
  local file="$1" expected_status="$2"
  [ -f "$file" ] && [ ! -L "$file" ] &&
    grep -Fxq "source=origin/main@$EXPECTED_SHA" "$file" &&
    grep -Fxq "status=$expected_status" "$file" &&
    grep -Fxq "release_attempt=$RELEASE_ATTEMPT" "$file"
}

if matches_current_attempt "$FULL_SOURCE" full-ready; then
  printf '%s\n' committed
  exit 0
fi

if [ -L "$API_SOURCE" ]; then
  printf '%s\n' manual
  exit 0
fi

if [ -f "$API_SOURCE" ] && [ ! -L "$API_SOURCE" ] &&
  grep -Fxq "source=origin/main@$EXPECTED_SHA" "$API_SOURCE" &&
  grep -Fxq "release_attempt=$RELEASE_ATTEMPT" "$API_SOURCE"; then
  if grep -Fxq 'status=api-rolled-back' "$API_SOURCE"; then
    printf '%s\n' restored
  elif grep -Fxq 'status=api-ready-static-pending' "$API_SOURCE" &&
    [ -f "$STATIC_STATUS_FILE" ] && [ ! -L "$STATIC_STATUS_FILE" ] &&
    grep -Eq '^(not-switched|rolled-back)$' "$STATIC_STATUS_FILE"; then
    printf '%s\n' restore
  else
    printf '%s\n' manual
  fi
  exit 0
fi

printf '%s\n' api-helper
