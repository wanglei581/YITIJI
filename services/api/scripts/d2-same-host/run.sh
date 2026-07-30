#!/usr/bin/env bash
set -euo pipefail

no_go() {
  printf 'D2_PRIME_NO_GO %s\n' "$1" >&2
  exit 2
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ROOT="$(cd "$API_DIR/../.." && pwd)"

[[ "$(uname -s)" == "Linux" ]] || no_go "D2_PRIME_NO_GO_ENVIRONMENT"
[[ -r /sys/fs/cgroup/cgroup.controllers ]] || no_go "D2_PRIME_NO_GO_ENVIRONMENT"

APPROVED_PATH="${D2_APPROVED_PATH:-/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin}"
IFS=':' read -r -a approved_path_parts <<< "$APPROVED_PATH"
[[ ${#approved_path_parts[@]} -gt 0 ]] || no_go "D2_PRIME_NO_GO_PATH"
for path_part in "${approved_path_parts[@]}"; do
  [[ "$path_part" == /* && "$path_part" != *$'\n'* && "$path_part" != *"/../"* ]] \
    || no_go "D2_PRIME_NO_GO_PATH"
done
export PATH="$APPROVED_PATH"

required_commands=(date dirname git grep id loginctl mkdir nginx node pm2 pnpm realpath rm sha256sum sleep stat systemctl systemd-run tr)
for required_command in "${required_commands[@]}"; do
  command -v "$required_command" >/dev/null 2>&1 || no_go "D2_PRIME_NO_GO_ENVIRONMENT"
done
node --version >/dev/null 2>&1 || no_go "D2_PRIME_NO_GO_ENVIRONMENT"
pnpm --version >/dev/null 2>&1 || no_go "D2_PRIME_NO_GO_ENVIRONMENT"
nginx -v >/dev/null 2>&1 || no_go "D2_PRIME_NO_GO_ENVIRONMENT"

production_variables=(
  DATABASE_URL DIRECT_URL
  REDIS_URL REDIS_HOST REDIS_PASSWORD
  OSS_ACCESS_KEY_ID OSS_ACCESS_KEY_SECRET
  COS_SECRET_ID COS_SECRET_KEY
  TENCENTCLOUD_SECRET_ID TENCENTCLOUD_SECRET_KEY
  AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
  MINIO_ROOT_USER MINIO_ROOT_PASSWORD
)
for variable_name in "${production_variables[@]}"; do
  [[ -z "${!variable_name+x}" ]] || no_go "D2_PRIME_NO_GO_PRODUCTION_ENV"
done

[[ "$(realpath "$ROOT")" == "$(git -C "$ROOT" rev-parse --show-toplevel 2>/dev/null)" ]] \
  || no_go "D2_PRIME_NO_GO_BUILD_INPUT"
for build_input in \
  "$API_DIR/dist/release-provenance/release-genesis.js" \
  "$API_DIR/dist/release-provenance/release-activation.js" \
  "$API_DIR/dist/release-provenance/release-current-launcher.js"; do
  [[ -r "$build_input" ]] || no_go "D2_PRIME_NO_GO_BUILD_INPUT"
done

systemctl --user show-environment >/dev/null 2>&1 \
  || no_go "D2_PRIME_NO_GO_ENVIRONMENT"
[[ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null)" == "yes" ]] \
  || no_go "D2_PRIME_NO_GO_ENVIRONMENT"

PREFLIGHT_UNIT="f1-d2-preflight-$(tr -d '-' < /proc/sys/kernel/random/uuid)"
PREFLIGHT_OK=1
systemd-run --user --collect \
  --unit "$PREFLIGHT_UNIT" \
  --property MemoryMax=256M \
  --property CPUQuota=25% \
  --property TasksMax=64 \
  --property LimitNOFILE=256 \
  /usr/bin/sleep 30 >/dev/null 2>&1 || PREFLIGHT_OK=0
PREFLIGHT_CONTROL_GROUP=""
if (( PREFLIGHT_OK == 1 )); then
  for _ in {1..50}; do
    PREFLIGHT_CONTROL_GROUP="$(systemctl --user show "$PREFLIGHT_UNIT" -p ControlGroup --value 2>/dev/null || true)"
    [[ "$PREFLIGHT_CONTROL_GROUP" == /* ]] && break
    sleep 0.1
  done
  [[ "$PREFLIGHT_CONTROL_GROUP" == /* ]] || PREFLIGHT_OK=0
fi
if (( PREFLIGHT_OK == 1 )); then
  PREFLIGHT_CGROUP="/sys/fs/cgroup$PREFLIGHT_CONTROL_GROUP"
  [[ -r "$PREFLIGHT_CGROUP/cgroup.controllers" && -r "$PREFLIGHT_CGROUP/cpu.max" \
    && -r "$PREFLIGHT_CGROUP/memory.max" && -r "$PREFLIGHT_CGROUP/pids.max" ]] || PREFLIGHT_OK=0
fi
if (( PREFLIGHT_OK == 1 )); then
  [[ " $(<"$PREFLIGHT_CGROUP/cgroup.controllers") " == *" cpu "* ]] || PREFLIGHT_OK=0
  PREFLIGHT_CPU_QUOTA=""
  PREFLIGHT_CPU_PERIOD=""
  read -r PREFLIGHT_CPU_QUOTA PREFLIGHT_CPU_PERIOD < "$PREFLIGHT_CGROUP/cpu.max" || PREFLIGHT_OK=0
  if [[ "$PREFLIGHT_CPU_QUOTA" =~ ^[0-9]+$ && "$PREFLIGHT_CPU_PERIOD" =~ ^[1-9][0-9]*$ ]]; then
    (( PREFLIGHT_CPU_QUOTA * 1000000 / PREFLIGHT_CPU_PERIOD == 250000 )) || PREFLIGHT_OK=0
  else
    PREFLIGHT_OK=0
  fi
  [[ "$(<"$PREFLIGHT_CGROUP/memory.max")" == "268435456" ]] || PREFLIGHT_OK=0
  [[ "$(<"$PREFLIGHT_CGROUP/pids.max")" == "64" ]] || PREFLIGHT_OK=0
  PREFLIGHT_NOFILE="$(systemctl --user show "$PREFLIGHT_UNIT" -p LimitNOFILE --value 2>/dev/null || true)"
  [[ "${PREFLIGHT_NOFILE%%:*}" == "256" ]] || PREFLIGHT_OK=0
fi
systemctl --user stop "$PREFLIGHT_UNIT" >/dev/null 2>&1 || PREFLIGHT_OK=0
PREFLIGHT_STOPPED=0
for _ in {1..50}; do
  PREFLIGHT_STATE="$(systemctl --user show "$PREFLIGHT_UNIT" -p ActiveState --value 2>/dev/null || true)"
  if [[ -z "$PREFLIGHT_STATE" || "$PREFLIGHT_STATE" == "inactive" || "$PREFLIGHT_STATE" == "failed" ]]; then
    PREFLIGHT_STOPPED=1
    break
  fi
  sleep 0.1
done
(( PREFLIGHT_STOPPED == 1 )) || PREFLIGHT_OK=0
systemctl --user reset-failed "$PREFLIGHT_UNIT" >/dev/null 2>&1 || true
(( PREFLIGHT_OK == 1 )) || no_go "D2_PRIME_NO_GO_ENVIRONMENT"

NGINX_PORT="${D2_NGINX_PORT:-18080}"
[[ "$NGINX_PORT" =~ ^[0-9]+$ ]] \
  && (( NGINX_PORT >= 1024 && NGINX_PORT <= 65535 )) \
  && [[ "$NGINX_PORT" != "3010" && "$NGINX_PORT" != "3011" ]] \
  || no_go "D2_PRIME_NO_GO_PORT"

env -i PATH="$APPROVED_PATH" HOME="$SCRIPT_DIR" \
  node -e '
    const net = require("node:net");
    const ports = process.argv.slice(1).map(Number);
    (async () => {
      for (const port of ports) {
        await new Promise((resolve, reject) => {
          const server = net.createServer();
          server.once("error", reject);
          server.listen(port, "127.0.0.1", () => server.close(resolve));
        });
      }
    })().catch(() => process.exit(2));
  ' 3010 3011 "$NGINX_PORT" \
  || no_go "D2_PRIME_NO_GO_PORT"

EVIDENCE_DIR="${D2_EVIDENCE_DIR:-$SCRIPT_DIR/.evidence}"
WORK_DIR="${D2_WORK_DIR:-$SCRIPT_DIR/.work}"
[[ "$EVIDENCE_DIR" == /* && "$WORK_DIR" == /* ]] || no_go "D2_PRIME_NO_GO_PATH"
mkdir -p -m 700 "$EVIDENCE_DIR" "$WORK_DIR"
[[ -O "$EVIDENCE_DIR" && -O "$WORK_DIR" && ! -L "$EVIDENCE_DIR" && ! -L "$WORK_DIR" ]] \
  || no_go "D2_PRIME_NO_GO_PATH"
[[ "$(stat -c '%a' "$EVIDENCE_DIR")" == "700" && "$(stat -c '%a' "$WORK_DIR")" == "700" ]] \
  || no_go "D2_PRIME_NO_GO_PATH"
EVIDENCE_DIR="$(realpath "$EVIDENCE_DIR")"
WORK_DIR="$(realpath "$WORK_DIR")"

NONCE="$(tr -d '-' < /proc/sys/kernel/random/uuid)"
[[ "$NONCE" =~ ^[0-9a-f]{32}$ ]] || no_go "D2_PRIME_NO_GO_NONCE"
RUN_DIR="$WORK_DIR/$NONCE"
mkdir -m 700 "$RUN_DIR" || no_go "D2_PRIME_NO_GO_WORKSPACE"

early_cleanup() {
  local original_status=$?
  set +e
  if [[ -n "${RUN_DIR:-}" && "$RUN_DIR" == "$WORK_DIR/"* && "$RUN_DIR" != "$WORK_DIR" ]]; then
    rm -rf -- "$RUN_DIR"
  fi
  return "$original_status"
}
trap early_cleanup EXIT

LEGACY_HOME="$RUN_DIR/legacy-home"
LEGACY_PM2_HOME="$RUN_DIR/legacy-pm2"
MANAGED_HOME="$RUN_DIR/managed-home"
MANAGED_PM2_HOME="$RUN_DIR/managed-pm2"
mkdir -m 700 "$LEGACY_HOME" "$LEGACY_PM2_HOME" "$MANAGED_HOME" "$MANAGED_PM2_HOME"

MANAGED_PM2_HOME_HASH="$(printf '%s' "$MANAGED_PM2_HOME" | sha256sum)"
MANAGED_PM2_HOME_ID="${MANAGED_PM2_HOME_HASH%% *}"
UNIT_NAME="f1-d2-managed-${NONCE:0:20}"
READY_MARKER="$RUN_DIR/managed-ready.json"
STOP_MARKER="$RUN_DIR/managed-stop"
EVIDENCE_OUT="${D2_EVIDENCE_OUT:-$EVIDENCE_DIR/d2-prime-evidence-$(date -u +%Y%m%dT%H%M%SZ).json}"
[[ "$EVIDENCE_OUT" == /* && "$(realpath -m "$(dirname "$EVIDENCE_OUT")")" == "$EVIDENCE_DIR" ]] \
  || no_go "D2_PRIME_NO_GO_EVIDENCE_PATH"
[[ ! -e "$EVIDENCE_OUT" && ! -L "$EVIDENCE_OUT" ]] || no_go "D2_PRIME_NO_GO_EVIDENCE_EXISTS"

NODE_BIN="$(command -v node)"
PM2_BIN="$(command -v pm2)"
NGINX_BIN="$(command -v nginx)"
SYSTEMCTL_BIN="$(command -v systemctl)"
KEEPER_STARTED=0

PREFLIGHT_HOME="$RUN_DIR/preflight-home"
PREFLIGHT_PM2_HOME="$RUN_DIR/preflight-pm2"
mkdir -m 700 "$PREFLIGHT_HOME" "$PREFLIGHT_PM2_HOME"
env -i PATH="$APPROVED_PATH" HOME="$PREFLIGHT_HOME" PM2_HOME="$PREFLIGHT_PM2_HOME" \
  "$PM2_BIN" -v >/dev/null 2>&1 || no_go "D2_PRIME_NO_GO_ENVIRONMENT"
env -i PATH="$APPROVED_PATH" HOME="$PREFLIGHT_HOME" PM2_HOME="$PREFLIGHT_PM2_HOME" \
  "$PM2_BIN" kill >/dev/null 2>&1 || no_go "D2_PRIME_NO_GO_ENVIRONMENT"
rm -rf -- "$PREFLIGHT_HOME" "$PREFLIGHT_PM2_HOME"

cleanup() {
  local original_status=$?
  local cleanup_failed=0
  set +e
  if [[ -n "${STOP_MARKER:-}" && -d "${RUN_DIR:-}" && ! -e "$STOP_MARKER" ]]; then
    (umask 077; set -o noclobber; : > "$STOP_MARKER") 2>/dev/null
  fi
  if (( KEEPER_STARTED == 1 )); then
    for _ in {1..150}; do
      systemctl --user is-active --quiet "$UNIT_NAME" || break
      sleep 0.1
    done
    systemctl --user stop "$UNIT_NAME" >/dev/null 2>&1 || true
    systemctl --user reset-failed "$UNIT_NAME" >/dev/null 2>&1 || true
  fi
  local nginx_pid_file="${RUN_DIR:-}/nginx/nginx.pid"
  if [[ -f "$nginx_pid_file" && -O "$nginx_pid_file" && ! -L "$nginx_pid_file" ]]; then
    local nginx_pid
    nginx_pid="$(<"$nginx_pid_file")"
    if [[ "$nginx_pid" =~ ^[1-9][0-9]{0,9}$ ]] && kill -0 "$nginx_pid" 2>/dev/null; then
      "$NGINX_BIN" -s stop -p "$RUN_DIR/nginx/" -c "$RUN_DIR/nginx/nginx.conf" >/dev/null 2>&1 || true
      for _ in {1..50}; do
        kill -0 "$nginx_pid" 2>/dev/null || break
        sleep 0.1
      done
      kill -0 "$nginx_pid" 2>/dev/null && cleanup_failed=1
    fi
  fi
  if [[ -n "${RUN_DIR:-}" && "$RUN_DIR" == "$WORK_DIR/"* && "$RUN_DIR" != "$WORK_DIR" ]]; then
    (( cleanup_failed == 0 )) && rm -rf -- "$RUN_DIR"
  fi
  (( cleanup_failed == 0 )) || return 2
  return "$original_status"
}
trap cleanup EXIT
trap 'exit 2' INT TERM

systemd-run --user \
  --unit "$UNIT_NAME" \
  --working-directory "$API_DIR" \
  --setenv "HOME=$MANAGED_HOME" \
  --setenv "PM2_HOME=$MANAGED_PM2_HOME" \
  --setenv "PATH=$APPROVED_PATH" \
  --setenv "D2_RUN_DIR=$RUN_DIR" \
  --setenv "D2_NONCE=$NONCE" \
  --setenv "D2_PM2_HOME_ID=$MANAGED_PM2_HOME_ID" \
  --setenv "D2_PM2_BIN=$PM2_BIN" \
  --property MemoryMax=268435456 \
  --property CPUQuota=25% \
  --property TasksMax=64 \
  --property LimitNOFILE=256 \
  --collect \
  "$NODE_BIN" "$SCRIPT_DIR/managed-scope.mjs" >/dev/null \
  || no_go "D2_PRIME_NO_GO_MANAGED_SCOPE"
KEEPER_STARTED=1

set +e
env -i \
  PATH="$APPROVED_PATH" \
  HOME="$MANAGED_HOME" \
  PM2_HOME="$MANAGED_PM2_HOME" \
  D2_API_DIR="$API_DIR" \
  D2_ROOT="$ROOT" \
  D2_RUN_DIR="$RUN_DIR" \
  D2_NONCE="$NONCE" \
  D2_UNIT_NAME="$UNIT_NAME" \
  D2_READY_MARKER="$READY_MARKER" \
  D2_STOP_MARKER="$STOP_MARKER" \
  D2_LEGACY_HOME="$LEGACY_HOME" \
  D2_LEGACY_PM2_HOME="$LEGACY_PM2_HOME" \
  D2_MANAGED_PM2_HOME="$MANAGED_PM2_HOME" \
  D2_MANAGED_PM2_HOME_ID="$MANAGED_PM2_HOME_ID" \
  D2_PM2_BIN="$PM2_BIN" \
  D2_NGINX_BIN="$NGINX_BIN" \
  D2_SYSTEMCTL_BIN="$SYSTEMCTL_BIN" \
  D2_NGINX_PORT="$NGINX_PORT" \
  D2_EVIDENCE_OUT="$EVIDENCE_OUT" \
  "$NODE_BIN" "$SCRIPT_DIR/drill.mjs"
DRILL_STATUS=$?
set -e
(( DRILL_STATUS == 0 )) || no_go "D2_PRIME_RUNTIME_FAILURE"

env -i PATH="$APPROVED_PATH" HOME="$MANAGED_HOME" \
  "$NODE_BIN" "$SCRIPT_DIR/verify-contract.mjs" --evidence "$EVIDENCE_OUT" \
  || no_go "D2_PRIME_EVIDENCE_REJECTED"

printf 'D2_PRIME_PASS\nproductionF1=NO-GO\n'
