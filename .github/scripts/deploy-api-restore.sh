#!/usr/bin/env bash

set -euo pipefail

: "${RUNTIME_BACKUP:?RUNTIME_BACKUP is required}"
: "${OLD_SHA:?OLD_SHA is required}"

RUNTIME_ROOT="${RUNTIME_ROOT:-/srv/ai-job-print}"
BACKUP_ROOT="${BACKUP_ROOT:-/srv/ai-job-print-backups}"
PM2_NAME="${DEPLOY_PM2_NAME:-ai-job-print-api}"
NODE_BIN="${DEPLOY_RESTORE_NODE_BIN:-/usr/local/bin/node}"
HEALTH_URL="${DEPLOY_HEALTH_URL:-http://127.0.0.1:3010/api/v1/health}"
READY_URL="${DEPLOY_READY_URL:-${HEALTH_URL%/}/ready}"
RESTORE_MARKER_FILE="${DEPLOY_RESTORE_MARKER_FILE:-}"

if [ "${DEPLOY_RESTORE_TEST_MODE:-false}" != true ] && [ -z "$RESTORE_MARKER_FILE" ]; then
  echo "::error::production API restore requires an attempt-scoped marker" >&2
  exit 1
fi

if ! printf '%s\n' "$OLD_SHA" | grep -Eq '^[0-9a-f]{40}$'; then
  echo "::error::OLD_SHA must be a full lowercase commit SHA" >&2
  exit 1
fi
if [ -n "$RESTORE_MARKER_FILE" ]; then
  : "${TARGET_SHA:?TARGET_SHA is required with DEPLOY_RESTORE_MARKER_FILE}"
  : "${CI_RUN:?CI_RUN is required with DEPLOY_RESTORE_MARKER_FILE}"
  : "${RELEASE_ATTEMPT:?RELEASE_ATTEMPT is required with DEPLOY_RESTORE_MARKER_FILE}"
  if ! printf '%s\n' "$TARGET_SHA" | grep -Eq '^[0-9a-f]{40}$' ||
    ! printf '%s\n' "$CI_RUN" | grep -Eq '^[0-9]+$' ||
    ! printf '%s\n' "$RELEASE_ATTEMPT" | grep -Eq '^[0-9]+-[1-9][0-9]*$' ||
    [ "$RESTORE_MARKER_FILE" != "$RUNTIME_ROOT/API_DEPLOY_SOURCE.txt" ]; then
    echo "::error::invalid API restore marker identity" >&2
    exit 1
  fi
fi

if [ "${DEPLOY_RESTORE_TEST_MODE:-false}" = true ]; then
  case "$RUNTIME_ROOT:$BACKUP_ROOT:$RUNTIME_BACKUP" in
    "${TMPDIR:-/tmp}"/*:"${TMPDIR:-/tmp}"/*:"${TMPDIR:-/tmp}"/*) ;;
    *) echo "::error::restore test paths must stay under TMPDIR" >&2; exit 1 ;;
  esac
else
  if [ "$RUNTIME_ROOT" != /srv/ai-job-print ] || [ "$BACKUP_ROOT" != /srv/ai-job-print-backups ]; then
    echo "::error::API restore paths are not approved" >&2
    exit 1
  fi
  case "$RUNTIME_BACKUP" in
    "$BACKUP_ROOT"/pre-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z.runtime) ;;
    *) echo "::error::RUNTIME_BACKUP is not a standard production backup path" >&2; exit 1 ;;
  esac
fi

for path in "$RUNTIME_ROOT" "$BACKUP_ROOT" "$RUNTIME_BACKUP"; do
  if [ ! -d "$path" ] || [ -L "$path" ]; then
    echo "::error::restore path is missing or unsafe" >&2
    exit 1
  fi
done
if [ "$(cd "$(dirname "$RUNTIME_BACKUP")" && pwd -P)" != "$(cd "$BACKUP_ROOT" && pwd -P)" ]; then
  echo "::error::runtime backup is outside the approved backup root" >&2
  exit 1
fi
if [ ! -f "$RUNTIME_BACKUP/services/api/dist/main.js" ]; then
  echo "::error::runtime backup does not contain a built API" >&2
  exit 1
fi
if [ ! -x "$NODE_BIN" ] || ! "$NODE_BIN" --version | grep -Eq '^v22\.'; then
  echo "::error::approved Node 22 runtime is unavailable" >&2
  exit 1
fi

pm2 delete "$PM2_NAME" >/dev/null 2>&1 || true
rsync -a --delete \
  --exclude '.STATIC_RELEASE_STATUS-*' \
  --exclude 'apps/*/.dist.*' \
  --exclude 'API_DEPLOY_SOURCE.txt' \
  --exclude '.API_DEPLOY_SOURCE.*' \
  --exclude 'services/api/storage' \
  "$RUNTIME_BACKUP/" "$RUNTIME_ROOT/"

env -i \
  HOME="$HOME" \
  PATH="$(dirname "$NODE_BIN"):/usr/local/bin:/usr/bin:/bin" \
  PM2_HOME="${PM2_HOME:-$HOME/.pm2}" \
  COMMIT="$OLD_SHA" \
  NODE_ENV=production \
  PRINT_REQUIRE_PII_SCAN=true \
  pm2 start "$RUNTIME_ROOT/services/api/dist/main.js" \
    --name "$PM2_NAME" \
    --cwd "$RUNTIME_ROOT/services/api" \
    --interpreter "$NODE_BIN" >/dev/null

pm2 jlist | "$NODE_BIN" -e '
  let input = "";
  process.stdin.on("data", chunk => { input += chunk });
  process.stdin.on("end", () => {
    const [name, sha] = process.argv.slice(1);
    const processInfo = JSON.parse(input).find(item => item.name === name);
    if (!processInfo) throw new Error("PM2 process not found after restore");
    const env = processInfo.pm2_env || {};
    if (env.status !== "online") throw new Error("restored PM2 process is not online");
    if (env.NODE_ENV !== "production") throw new Error("restored PM2 NODE_ENV is not production");
    if (String(env.PRINT_REQUIRE_PII_SCAN) !== "true") throw new Error("restored PM2 PII gate is not true");
    if (env.COMMIT !== sha) throw new Error("restored PM2 commit does not match the old SHA");
    const forbidden = Object.keys(env).filter(key => /^(KIOSK_TERMINAL_AGENT_BRIDGE_TOKEN|DEPLOY_.+|TARGET_SHA|CI_RUN|API_RELEASE_ENABLED)$/.test(key));
    if (forbidden.length > 0) throw new Error("restored PM2 contains forbidden deployment environment keys");
  });
' "$PM2_NAME" "$OLD_SHA"

restored=false
for _ in $(seq 1 30); do
  if curl -fsS "$HEALTH_URL" 2>/dev/null | grep -q '"status":"ok"' &&
    curl -fsS "$READY_URL" 2>/dev/null | grep -q '"status":"ready"'; then
    restored=true
    break
  fi
  sleep 2
done
if [ "$restored" != true ]; then
  echo "::error::previous API runtime was restored on disk but did not become ready" >&2
  exit 1
fi

pm2 save >/dev/null
chmod 0600 "${PM2_HOME:-$HOME/.pm2}/dump.pm2"
if [ -n "$RESTORE_MARKER_FILE" ]; then
  marker_tmp="$(mktemp "$RUNTIME_ROOT/.API_DEPLOY_SOURCE.restored.XXXXXX")"
  cat > "$marker_tmp" <<EOF
source=origin/main@$TARGET_SHA
scope=api
status=api-rolled-back
ci_run=$CI_RUN
release_attempt=$RELEASE_ATTEMPT
restored_source=origin/main@$OLD_SHA
runtime_backup=$RUNTIME_BACKUP
EOF
  chmod 0644 "$marker_tmp"
  mv -f -- "$marker_tmp" "$RESTORE_MARKER_FILE"
fi
echo "API_RESTORE_STATUS=ready"
