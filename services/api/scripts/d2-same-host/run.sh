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

required_commands=(date dirname env git grep id loginctl mkdir nginx node pm2 pnpm realpath rm sha256sum sleep stat systemctl systemd-run timeout tr)
for required_command in "${required_commands[@]}"; do
  command -v "$required_command" >/dev/null 2>&1 || no_go "D2_PRIME_NO_GO_ENVIRONMENT"
done
node --version >/dev/null 2>&1 || no_go "D2_PRIME_NO_GO_ENVIRONMENT"
pnpm --version >/dev/null 2>&1 || no_go "D2_PRIME_NO_GO_ENVIRONMENT"
nginx -v >/dev/null 2>&1 || no_go "D2_PRIME_NO_GO_ENVIRONMENT"
NODE_BIN="$(command -v node)"
PM2_BIN="$(command -v pm2)"
NGINX_BIN="$(command -v nginx)"
ENV_BIN="$(command -v env)"
SLEEP_BIN="$(command -v sleep)"
SYSTEMCTL_BIN="$(command -v systemctl)"
SYSTEMD_RUN_BIN="$(command -v systemd-run)"
[[ "$ENV_BIN" == /* && "$SLEEP_BIN" == /* && "$SYSTEMCTL_BIN" == /* && "$SYSTEMD_RUN_BIN" == /* ]] \
  || no_go "D2_PRIME_NO_GO_ENVIRONMENT"

XDG_RUNTIME_DIR_PATH="/run/user/$(id -u)"
[[ -d "$XDG_RUNTIME_DIR_PATH" && -O "$XDG_RUNTIME_DIR_PATH" && ! -L "$XDG_RUNTIME_DIR_PATH" ]] \
  || no_go "D2_PRIME_NO_GO_ENVIRONMENT"
[[ "$(stat -c '%a' "$XDG_RUNTIME_DIR_PATH")" == "700" ]] \
  || no_go "D2_PRIME_NO_GO_ENVIRONMENT"
[[ -S "$XDG_RUNTIME_DIR_PATH/bus" && -O "$XDG_RUNTIME_DIR_PATH/bus" && ! -L "$XDG_RUNTIME_DIR_PATH/bus" ]] \
  || no_go "D2_PRIME_NO_GO_ENVIRONMENT"
export XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR_PATH"

user_systemctl() {
  "$ENV_BIN" -i \
    PATH="$APPROVED_PATH" \
    XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR_PATH" \
    "$SYSTEMCTL_BIN" --user "$@"
}

user_systemd_run() {
  "$ENV_BIN" -i \
    PATH="$APPROVED_PATH" \
    XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR_PATH" \
    "$SYSTEMD_RUN_BIN" --user "$@"
}

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

user_systemctl show-environment >/dev/null 2>&1 \
  || no_go "D2_PRIME_NO_GO_ENVIRONMENT"
[[ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null)" == "yes" ]] \
  || no_go "D2_PRIME_NO_GO_ENVIRONMENT"

PREFLIGHT_UNIT="f1-d2-preflight-$(tr -d '-' < /proc/sys/kernel/random/uuid)"
PREFLIGHT_OK=1
user_systemd_run \
  --expand-environment=no \
  --collect \
  --unit "$PREFLIGHT_UNIT" \
  --property MemoryMax=256M \
  --property CPUQuota=25% \
  --property TasksMax=64 \
  --property LimitNOFILE=256 \
  "$ENV_BIN" -i \
  PATH="$APPROVED_PATH" \
  "$SLEEP_BIN" 30 >/dev/null 2>&1 || PREFLIGHT_OK=0
PREFLIGHT_CONTROL_GROUP=""
if (( PREFLIGHT_OK == 1 )); then
  for _ in {1..50}; do
    PREFLIGHT_CONTROL_GROUP="$(user_systemctl show "$PREFLIGHT_UNIT" -p ControlGroup --value 2>/dev/null || true)"
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
  PREFLIGHT_NOFILE="$(user_systemctl show "$PREFLIGHT_UNIT" -p LimitNOFILE --value 2>/dev/null || true)"
  [[ "${PREFLIGHT_NOFILE%%:*}" == "256" ]] || PREFLIGHT_OK=0
fi
user_systemctl stop "$PREFLIGHT_UNIT" >/dev/null 2>&1 || PREFLIGHT_OK=0
PREFLIGHT_STOPPED=0
for _ in {1..50}; do
  PREFLIGHT_STATE="$(user_systemctl show "$PREFLIGHT_UNIT" -p ActiveState --value 2>/dev/null || true)"
  if [[ -z "$PREFLIGHT_STATE" || "$PREFLIGHT_STATE" == "inactive" || "$PREFLIGHT_STATE" == "failed" ]]; then
    PREFLIGHT_STOPPED=1
    break
  fi
  sleep 0.1
done
(( PREFLIGHT_STOPPED == 1 )) || PREFLIGHT_OK=0
user_systemctl reset-failed "$PREFLIGHT_UNIT" >/dev/null 2>&1 || true
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

bootstrap_cleanup() {
  local original_status=$?
  set +e
  [[ "$RUN_DIR" == "$WORK_DIR/"* && "$RUN_DIR" != "$WORK_DIR" ]] && rm -rf -- "$RUN_DIR"
  if [[ -n "${PM2_CONTROL_ROOT:-}" && "$PM2_CONTROL_ROOT" == "${PM2_RUNTIME_ROOT:-}/d2p-"* ]]; then
    rm -rf -- "$PM2_CONTROL_ROOT"
  fi
  return "$original_status"
}
trap bootstrap_cleanup EXIT

PM2_RUNTIME_ROOT="/run/user/$(id -u)"
[[ -d "$PM2_RUNTIME_ROOT" && -O "$PM2_RUNTIME_ROOT" && ! -L "$PM2_RUNTIME_ROOT" ]] \
  || no_go "D2_PRIME_NO_GO_ENVIRONMENT"
[[ "$(stat -c '%a' "$PM2_RUNTIME_ROOT")" == "700" && "$(realpath "$PM2_RUNTIME_ROOT")" == "$PM2_RUNTIME_ROOT" ]] \
  || no_go "D2_PRIME_NO_GO_ENVIRONMENT"
PM2_CONTROL_ROOT="$PM2_RUNTIME_ROOT/d2p-$NONCE"
[[ ! -e "$PM2_CONTROL_ROOT" && ! -L "$PM2_CONTROL_ROOT" ]] || no_go "D2_PRIME_NO_GO_WORKSPACE"
mkdir -m 700 "$PM2_CONTROL_ROOT" || no_go "D2_PRIME_NO_GO_WORKSPACE"

LEGACY_HOME="$RUN_DIR/legacy-home"
MANAGED_HOME="$RUN_DIR/managed-home"
PREFLIGHT_HOME="$RUN_DIR/preflight-home"
PREFLIGHT_PM2_HOME="$PM2_CONTROL_ROOT/p"
LEGACY_PM2_HOME="$PM2_CONTROL_ROOT/l"
MANAGED_PM2_HOME="$PM2_CONTROL_ROOT/m"
mkdir -m 700 \
  "$LEGACY_HOME" "$MANAGED_HOME" "$PREFLIGHT_HOME" \
  "$PREFLIGHT_PM2_HOME" "$LEGACY_PM2_HOME" "$MANAGED_PM2_HOME" \
  || no_go "D2_PRIME_NO_GO_WORKSPACE"
for isolated_dir in \
  "$PM2_CONTROL_ROOT" "$PREFLIGHT_PM2_HOME" "$LEGACY_PM2_HOME" "$MANAGED_PM2_HOME"; do
  [[ -O "$isolated_dir" && ! -L "$isolated_dir" && "$(stat -c '%a' "$isolated_dir")" == "700" ]] \
    && [[ "$(realpath "$isolated_dir")" == "$isolated_dir" ]] \
    || no_go "D2_PRIME_NO_GO_PATH"
done

pm2_home_has_state() {
  local pm2_home="$1"
  [[ -e "$pm2_home/pm2.pid" || -e "$pm2_home/pub.sock" || -e "$pm2_home/rpc.sock" ]]
}

read_pm2_daemon_pid() {
  local pm2_home="$1"
  local pid_file="$pm2_home/pm2.pid"
  [[ ! -e "$pid_file" && ! -L "$pid_file" ]] && return 1
  [[ -f "$pid_file" && -O "$pid_file" && ! -L "$pid_file" ]] || return 2
  [[ "$(stat -c '%s' "$pid_file")" =~ ^[0-9]+$ ]] || return 2
  (( $(stat -c '%s' "$pid_file") <= 32 )) || return 2
  local daemon_pid
  daemon_pid="$(<"$pid_file")"
  [[ "$daemon_pid" =~ ^[1-9][0-9]{0,9}$ ]] || return 2
  printf '%s' "$daemon_pid"
}

bounded_pm2_kill() {
  local home="$1"
  local pm2_home="$2"
  local daemon_pid=""
  local pid_status=0
  [[ ! -e "$home" && ! -e "$pm2_home" ]] && return 0
  [[ -d "$home" && -O "$home" && ! -L "$home" ]] || return 1
  [[ -d "$pm2_home" && -O "$pm2_home" && ! -L "$pm2_home" ]] || return 1
  if daemon_pid="$(read_pm2_daemon_pid "$pm2_home")"; then
    :
  else
    pid_status=$?
    (( pid_status == 1 )) || return 1
    daemon_pid=""
  fi
  timeout --signal=TERM --kill-after=3s 8s \
    env -i PATH="$APPROVED_PATH" HOME="$home" PM2_HOME="$pm2_home" \
    "$PM2_BIN" kill >/dev/null 2>&1 || true
  for _ in {1..20}; do
    pm2_home_has_state "$pm2_home" || return 0
    if [[ -z "$daemon_pid" ]]; then
      if daemon_pid="$(read_pm2_daemon_pid "$pm2_home")"; then
        break
      else
        pid_status=$?
        (( pid_status == 1 )) || return 1
        daemon_pid=""
      fi
    fi
    sleep 0.1
  done
  [[ -n "$daemon_pid" ]] || return 1
  if kill -0 "$daemon_pid" 2>/dev/null; then
    env -i PATH="$APPROVED_PATH" HOME="$home" \
      "$NODE_BIN" "$SCRIPT_DIR/control-plane.mjs" --terminate-daemon "$pm2_home" "$daemon_pid" \
      || return 1
  fi
  kill -0 "$daemon_pid" 2>/dev/null && return 1
  return 0
}

early_cleanup() {
  local original_status=$?
  local cleanup_failed=0
  set +e
  bounded_pm2_kill "$PREFLIGHT_HOME" "$PREFLIGHT_PM2_HOME" || cleanup_failed=1
  bounded_pm2_kill "$LEGACY_HOME" "$LEGACY_PM2_HOME" || cleanup_failed=1
  bounded_pm2_kill "$MANAGED_HOME" "$MANAGED_PM2_HOME" || cleanup_failed=1
  if [[ -n "${RUN_DIR:-}" && "$RUN_DIR" == "$WORK_DIR/"* && "$RUN_DIR" != "$WORK_DIR" ]]; then
    (( cleanup_failed == 0 )) && rm -rf -- "$RUN_DIR"
  fi
  if [[ -n "${PM2_CONTROL_ROOT:-}" && "$PM2_CONTROL_ROOT" == "$PM2_RUNTIME_ROOT/d2p-"* ]]; then
    (( cleanup_failed == 0 )) && rm -rf -- "$PM2_CONTROL_ROOT"
  fi
  (( cleanup_failed == 0 )) || return 2
  return "$original_status"
}
trap early_cleanup EXIT

env -i PATH="$APPROVED_PATH" HOME="$SCRIPT_DIR" \
  "$NODE_BIN" "$SCRIPT_DIR/control-plane.mjs" --assert-layout \
  "$PM2_RUNTIME_ROOT" "$NONCE" "$PM2_CONTROL_ROOT" \
  "$PREFLIGHT_PM2_HOME" "$LEGACY_PM2_HOME" "$MANAGED_PM2_HOME" \
  || no_go "D2_PRIME_NO_GO_PATH"

MANAGED_PM2_HOME_HASH="$(printf '%s' "$MANAGED_PM2_HOME" | sha256sum)"
MANAGED_PM2_HOME_ID="${MANAGED_PM2_HOME_HASH%% *}"
UNIT_NAME="f1-d2-managed-${NONCE:0:20}"
READY_MARKER="$RUN_DIR/managed-ready.json"
STOP_MARKER="$RUN_DIR/managed-stop"
EVIDENCE_OUT="${D2_EVIDENCE_OUT:-$EVIDENCE_DIR/d2-prime-evidence-$(date -u +%Y%m%dT%H%M%SZ).json}"
[[ "$EVIDENCE_OUT" == /* && "$(realpath -m "$(dirname "$EVIDENCE_OUT")")" == "$EVIDENCE_DIR" ]] \
  || no_go "D2_PRIME_NO_GO_EVIDENCE_PATH"
[[ ! -e "$EVIDENCE_OUT" && ! -L "$EVIDENCE_OUT" ]] || no_go "D2_PRIME_NO_GO_EVIDENCE_EXISTS"

KEEPER_STARTED=0

timeout --signal=TERM --kill-after=2s 5s \
  env -i PATH="$APPROVED_PATH" HOME="$PREFLIGHT_HOME" PM2_HOME="$PREFLIGHT_PM2_HOME" \
  "$PM2_BIN" -v >/dev/null 2>&1 || no_go "D2_PRIME_NO_GO_ENVIRONMENT"
timeout --signal=TERM --kill-after=3s 8s \
  env -i PATH="$APPROVED_PATH" HOME="$PREFLIGHT_HOME" PM2_HOME="$PREFLIGHT_PM2_HOME" \
  "$PM2_BIN" kill >/dev/null 2>&1 || no_go "D2_PRIME_NO_GO_ENVIRONMENT"
pm2_home_has_state "$PREFLIGHT_PM2_HOME" && no_go "D2_PRIME_NO_GO_ENVIRONMENT"

cleanup() {
  local original_status=$?
  local cleanup_failed=0
  set +e
  if [[ -n "${STOP_MARKER:-}" && -d "${RUN_DIR:-}" && ! -e "$STOP_MARKER" ]]; then
    (umask 077; set -o noclobber; : > "$STOP_MARKER") 2>/dev/null
  fi
  if (( KEEPER_STARTED == 1 )); then
    for _ in {1..150}; do
      user_systemctl is-active --quiet "$UNIT_NAME" || break
      sleep 0.1
    done
    user_systemctl stop "$UNIT_NAME" >/dev/null 2>&1 || true
    user_systemctl reset-failed "$UNIT_NAME" >/dev/null 2>&1 || true
  fi
  bounded_pm2_kill "$PREFLIGHT_HOME" "$PREFLIGHT_PM2_HOME" || cleanup_failed=1
  bounded_pm2_kill "$LEGACY_HOME" "$LEGACY_PM2_HOME" || cleanup_failed=1
  bounded_pm2_kill "$MANAGED_HOME" "$MANAGED_PM2_HOME" || cleanup_failed=1
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
  if [[ -n "${PM2_CONTROL_ROOT:-}" && "$PM2_CONTROL_ROOT" == "$PM2_RUNTIME_ROOT/d2p-"* ]]; then
    (( cleanup_failed == 0 )) && rm -rf -- "$PM2_CONTROL_ROOT"
  fi
  (( cleanup_failed == 0 )) || return 2
  return "$original_status"
}
trap cleanup EXIT
trap 'exit 2' INT TERM

user_systemd_run \
  --expand-environment=no \
  --unit "$UNIT_NAME" \
  --working-directory "$API_DIR" \
  --property MemoryMax=268435456 \
  --property CPUQuota=25% \
  --property TasksMax=64 \
  --property LimitNOFILE=256 \
  --collect \
  "$ENV_BIN" -i \
  PATH="$APPROVED_PATH" \
  HOME="$MANAGED_HOME" \
  PM2_HOME="$MANAGED_PM2_HOME" \
  D2_RUN_DIR="$RUN_DIR" \
  D2_CONTROL_ROOT="$PM2_CONTROL_ROOT" \
  D2_NONCE="$NONCE" \
  D2_PM2_HOME_ID="$MANAGED_PM2_HOME_ID" \
  D2_PM2_BIN="$PM2_BIN" \
  "$NODE_BIN" "$SCRIPT_DIR/managed-scope.mjs" >/dev/null \
  || no_go "D2_PRIME_NO_GO_MANAGED_SCOPE"
KEEPER_STARTED=1

set +e
env -i \
  PATH="$APPROVED_PATH" \
  XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR_PATH" \
  HOME="$MANAGED_HOME" \
  PM2_HOME="$MANAGED_PM2_HOME" \
  D2_API_DIR="$API_DIR" \
  D2_ROOT="$ROOT" \
  D2_RUN_DIR="$RUN_DIR" \
  D2_CONTROL_ROOT="$PM2_CONTROL_ROOT" \
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
