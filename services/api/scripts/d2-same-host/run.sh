#!/usr/bin/env bash
set -euo pipefail

no_go() {
  printf 'D2_PRIME_NO_GO %s\n' "$1" >&2
  exit 2
}

SCRIPT_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
API_DIR="$(cd -P "$SCRIPT_DIR/../.." && pwd -P)"
ROOT="$(cd -P "$API_DIR/../.." && pwd -P)"

APPROVED_PATH="${D2_APPROVED_PATH:-/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin}"
IFS=':' read -r -a approved_path_parts <<< "$APPROVED_PATH"
[[ ${#approved_path_parts[@]} -gt 0 ]] || no_go "D2_PRIME_NO_GO_APPROVED_PATH"
for path_part in "${approved_path_parts[@]}"; do
  [[ "$path_part" == /* && "$path_part" != *$'\n'* && "$path_part" != *"/../"* && "$path_part" != *"/.." ]] \
    || no_go "D2_PRIME_NO_GO_APPROVED_PATH"
  [[ "$path_part" != "$ROOT" && "$path_part" != "$ROOT/"* ]] \
    || no_go "D2_PRIME_NO_GO_APPROVED_PATH"
  path_part_physical="$(cd -P -- "$path_part" 2>/dev/null && pwd -P)" \
    || no_go "D2_PRIME_NO_GO_APPROVED_PATH"
  [[ "$path_part_physical" != "$ROOT" && "$path_part_physical" != "$ROOT/"* ]] \
    || no_go "D2_PRIME_NO_GO_APPROVED_PATH"
done
export PATH="$APPROVED_PATH"

GOVERNANCE_ENV_BIN="$(command -v env 2>/dev/null || true)"
GOVERNANCE_NODE_BIN="$(command -v node 2>/dev/null || true)"
[[ "$GOVERNANCE_ENV_BIN" == /* && -x "$GOVERNANCE_ENV_BIN" ]] \
  || no_go "D2_PRIME_NO_GO_INVOCATION_INPUT"
[[ "$GOVERNANCE_NODE_BIN" == /* && -x "$GOVERNANCE_NODE_BIN" ]] \
  || no_go "D2_PRIME_NO_GO_INVOCATION_INPUT"
required_invocation_variables=(
  D2_GOVERNANCE_ROOT D2_TASK_ID D2_BASELINE_SHA D2_BRANCH_NAME
  D2_CLONE_PATH D2_EVIDENCE_OUT D2_ARCHIVE_PATH
)
for variable_name in "${required_invocation_variables[@]}"; do
  [[ -n "${!variable_name:-}" ]] || no_go "D2_PRIME_NO_GO_INVOCATION_INPUT"
done
"$GOVERNANCE_ENV_BIN" -i PATH="$APPROVED_PATH" HOME="$SCRIPT_DIR" \
  D2_GOVERNANCE_ROOT="$D2_GOVERNANCE_ROOT" \
  D2_TASK_ID="$D2_TASK_ID" \
  D2_BASELINE_SHA="$D2_BASELINE_SHA" \
  D2_BRANCH_NAME="$D2_BRANCH_NAME" \
  D2_CLONE_PATH="$D2_CLONE_PATH" \
  D2_EVIDENCE_OUT="$D2_EVIDENCE_OUT" \
  D2_ARCHIVE_PATH="$D2_ARCHIVE_PATH" \
  "$GOVERNANCE_NODE_BIN" "$SCRIPT_DIR/invocation-governance.mjs" --consume \
  || exit 2

[[ "$(uname -s)" == "Linux" ]] || no_go "D2_PRIME_NO_GO_KERNEL"
[[ -r /sys/fs/cgroup/cgroup.controllers ]] || no_go "D2_PRIME_NO_GO_KERNEL"

required_commands=(date dirname git grep id loginctl mkdir nginx node pm2 pnpm realpath rm sha256sum sleep stat systemctl systemd-run timeout tr)
for required_command in "${required_commands[@]}"; do
  command -v "$required_command" >/dev/null 2>&1 || no_go "D2_PRIME_NO_GO_APPROVED_PATH_COMMAND"
done

assert_invocation_clone_identity() {
  local current_baseline=""
  local current_branch=""
  local current_root=""
  local invocation_clone_root=""
  current_baseline="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null)" \
    || no_go "D2_PRIME_NO_GO_INVOCATION_INPUT"
  [[ "$current_baseline" == "$D2_BASELINE_SHA" ]] \
    || no_go "D2_PRIME_NO_GO_INVOCATION_INPUT"
  current_branch="$(git -C "$ROOT" symbolic-ref --quiet --short HEAD 2>/dev/null)" \
    || no_go "D2_PRIME_NO_GO_INVOCATION_INPUT"
  [[ "$current_branch" == "$D2_BRANCH_NAME" ]] \
    || no_go "D2_PRIME_NO_GO_INVOCATION_INPUT"
  current_root="$(realpath "$ROOT" 2>/dev/null)" \
    || no_go "D2_PRIME_NO_GO_INVOCATION_INPUT"
  invocation_clone_root="$(realpath "$D2_CLONE_PATH" 2>/dev/null)" \
    || no_go "D2_PRIME_NO_GO_INVOCATION_INPUT"
  [[ "$current_root" == "$invocation_clone_root" ]] \
    || no_go "D2_PRIME_NO_GO_INVOCATION_INPUT"
  git -C "$ROOT" diff --quiet --ignore-submodules -- >/dev/null 2>&1 \
    || no_go "D2_PRIME_NO_GO_INVOCATION_INPUT"
  git -C "$ROOT" diff --cached --quiet --ignore-submodules -- >/dev/null 2>&1 \
    || no_go "D2_PRIME_NO_GO_INVOCATION_INPUT"
}

assert_invocation_clone_identity
node --version >/dev/null 2>&1 || no_go "D2_PRIME_NO_GO_TOOLCHAIN"
pnpm --version >/dev/null 2>&1 || no_go "D2_PRIME_NO_GO_TOOLCHAIN"
nginx -v >/dev/null 2>&1 || no_go "D2_PRIME_NO_GO_TOOLCHAIN"
NODE_BIN="$(command -v node)"
PM2_BIN="$(command -v pm2)"
NGINX_BIN="$(command -v nginx)"
SYSTEMCTL_BIN="$(command -v systemctl)"

[[ -n "${D2_EVIDENCE_DIR:-}" && -n "${D2_EVIDENCE_OUT:-}" ]] \
  || no_go "D2_PRIME_NO_GO_EVIDENCE_PATH"
EVIDENCE_DIR="$D2_EVIDENCE_DIR"
EVIDENCE_OUT="$D2_EVIDENCE_OUT"

production_variables=(
  DATABASE_URL DIRECT_URL POSTGRES_URL
  REDIS_URL REDIS_HOST REDIS_PASSWORD
  OSS_ACCESS_KEY_ID OSS_ACCESS_KEY_SECRET
  COS_SECRET_ID COS_SECRET_KEY TENCENT_COS_SECRET_ID TENCENT_COS_SECRET_KEY
  TENCENTCLOUD_SECRET_ID TENCENTCLOUD_SECRET_KEY
  TENCENT_SECRET_ID TENCENT_SECRET_KEY
  TENCENT_SMS_SECRET_ID TENCENT_SMS_SECRET_KEY TENCENT_SMS_SDK_APP_ID
  TENCENT_SMS_SIGN_NAME TENCENT_SMS_TEMPLATE_ID
  TENCENT_ASR_SECRET_ID TENCENT_ASR_SECRET_KEY
  TENCENT_TTS_SECRET_ID TENCENT_TTS_SECRET_KEY
  TENCENT_OCR_SECRET_ID TENCENT_OCR_SECRET_KEY
  TRTC_SDK_APP_ID TRTC_SDK_SECRET_KEY TRTC_LLM_API_KEY TRTC_TTS_APP_ID
  AI_LLM_API_KEY AI_IMAGE_API_KEY
  BAIDU_OCR_API_KEY BAIDU_OCR_SECRET_KEY BAIDU_ASR_API_KEY BAIDU_ASR_SECRET_KEY
  JWT_SECRET TERMINAL_ADMIN_SECRET TERMINAL_ACTION_TOKEN_SECRET
  FILE_SIGNING_SECRET SECRET_ENCRYPTION_KEY
  PAYMENT_SESSION_SECRET SANDBOX_PAYMENT_SECRET
  WECHAT_PAY_MCHID WECHAT_PAY_APPID WECHAT_PAY_MCH_SERIAL_NO
  WECHAT_PAY_PRIVATE_KEY_PEM WECHAT_PAY_PRIVATE_KEY_PATH WECHAT_PAY_APIV3_KEY
  WECHAT_PAY_PUBLIC_KEY_PEM WECHAT_PAY_PUBLIC_KEY_PATH WECHAT_PAY_PUBLIC_KEY_ID
  WECHAT_PAY_CODEPAY_STORE_OUT_ID
  ALIPAY_APP_ID ALIPAY_APP_PRIVATE_KEY_PEM ALIPAY_APP_PRIVATE_KEY_PATH
  ALIPAY_PUBLIC_KEY_PEM ALIPAY_PUBLIC_KEY_PATH
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

XDG_RUNTIME_DIR="/run/user/$(id -u)"
[[ -d "$XDG_RUNTIME_DIR" && -O "$XDG_RUNTIME_DIR" && ! -L "$XDG_RUNTIME_DIR" ]] \
  || no_go "D2_PRIME_NO_GO_RUNTIME_DIR"
[[ "$(stat -c '%a' "$XDG_RUNTIME_DIR")" == "700" && "$(realpath "$XDG_RUNTIME_DIR")" == "$XDG_RUNTIME_DIR" ]] \
  || no_go "D2_PRIME_NO_GO_RUNTIME_DIR"
export XDG_RUNTIME_DIR

stop_user_unit_and_prove_inactive() {
  local unit_name="$1"
  local unit_state=""
  systemctl --user stop "$unit_name" >/dev/null 2>&1 || return 1
  for _ in {1..50}; do
    if ! unit_state="$(systemctl --user show "$unit_name" -p ActiveState --value 2>/dev/null)"; then
      return 1
    fi
    [[ "$unit_state" == "inactive" ]] && return 0
    case "$unit_state" in
      active|activating|deactivating|reloading) sleep 0.1 ;;
      *) return 1 ;;
    esac
  done
  return 1
}

assert_invocation_clone_identity
systemctl --user show-environment >/dev/null 2>&1 \
  || no_go "D2_PRIME_NO_GO_USER_MANAGER"
[[ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null)" == "yes" ]] \
  || no_go "D2_PRIME_NO_GO_USER_MANAGER"

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
stop_user_unit_and_prove_inactive "$PREFLIGHT_UNIT" || PREFLIGHT_OK=0
(( PREFLIGHT_OK == 1 )) || no_go "D2_PRIME_NO_GO_CGROUP_DELEGATION"

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

PM2_RUNTIME_ROOT="$XDG_RUNTIME_DIR"
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
  local cleanup_failed=0
  set +e
  bounded_pm2_kill "$PREFLIGHT_HOME" "$PREFLIGHT_PM2_HOME" || cleanup_failed=1
  bounded_pm2_kill "$LEGACY_HOME" "$LEGACY_PM2_HOME" || cleanup_failed=1
  bounded_pm2_kill "$MANAGED_HOME" "$MANAGED_PM2_HOME" || cleanup_failed=1
  if [[ -n "${RUN_DIR:-}" && "$RUN_DIR" == "$WORK_DIR/"* && "$RUN_DIR" != "$WORK_DIR" ]]; then
    (( cleanup_failed != 0 )) || rm -rf -- "$RUN_DIR" || cleanup_failed=1
  fi
  if [[ -n "${PM2_CONTROL_ROOT:-}" && "$PM2_CONTROL_ROOT" == "$PM2_RUNTIME_ROOT/d2p-"* ]]; then
    (( cleanup_failed != 0 )) || rm -rf -- "$PM2_CONTROL_ROOT" || cleanup_failed=1
  fi
  (( cleanup_failed == 0 )) || return 2
  return 0
}

early_cleanup_on_exit() {
  local original_status=$?
  trap - EXIT
  if ! early_cleanup; then
    exit 2
  fi
  exit "$original_status"
}
trap early_cleanup_on_exit EXIT

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
[[ "$EVIDENCE_OUT" == /* && "$(realpath -m "$(dirname "$EVIDENCE_OUT")")" == "$EVIDENCE_DIR" ]] \
  || no_go "D2_PRIME_NO_GO_EVIDENCE_PATH"
[[ ! -e "$EVIDENCE_OUT" && ! -L "$EVIDENCE_OUT" ]] || no_go "D2_PRIME_NO_GO_EVIDENCE_EXISTS"

KEEPER_STARTED=0

timeout --signal=TERM --kill-after=2s 5s \
  env -i PATH="$APPROVED_PATH" HOME="$PREFLIGHT_HOME" PM2_HOME="$PREFLIGHT_PM2_HOME" \
  "$PM2_BIN" -v >/dev/null 2>&1 || no_go "D2_PRIME_NO_GO_PM2_PREFLIGHT"
timeout --signal=TERM --kill-after=3s 8s \
  env -i PATH="$APPROVED_PATH" HOME="$PREFLIGHT_HOME" PM2_HOME="$PREFLIGHT_PM2_HOME" \
  "$PM2_BIN" kill >/dev/null 2>&1 || no_go "D2_PRIME_NO_GO_PM2_PREFLIGHT"
pm2_home_has_state "$PREFLIGHT_PM2_HOME" && no_go "D2_PRIME_NO_GO_PM2_PREFLIGHT"

cleanup() {
  local cleanup_failed=0
  set +e
  if [[ -n "${STOP_MARKER:-}" && -d "${RUN_DIR:-}" && ! -e "$STOP_MARKER" ]]; then
    (umask 077; set -o noclobber; : > "$STOP_MARKER") 2>/dev/null || cleanup_failed=1
  fi
  if (( KEEPER_STARTED == 1 )); then
    for _ in {1..150}; do
      systemctl --user is-active --quiet "$UNIT_NAME" || break
      sleep 0.1
    done
    stop_user_unit_and_prove_inactive "$UNIT_NAME" || cleanup_failed=1
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
    (( cleanup_failed != 0 )) || rm -rf -- "$RUN_DIR" || cleanup_failed=1
  fi
  if [[ -n "${PM2_CONTROL_ROOT:-}" && "$PM2_CONTROL_ROOT" == "$PM2_RUNTIME_ROOT/d2p-"* ]]; then
    (( cleanup_failed != 0 )) || rm -rf -- "$PM2_CONTROL_ROOT" || cleanup_failed=1
  fi
  (( cleanup_failed == 0 )) || return 2
  return 0
}

cleanup_on_exit() {
  local original_status=$?
  trap - EXIT
  if ! cleanup; then
    exit 2
  fi
  exit "$original_status"
}
trap cleanup_on_exit EXIT
trap 'exit 2' INT TERM

systemd-run --user \
  --unit "$UNIT_NAME" \
  --working-directory "$API_DIR" \
  --setenv "HOME=$MANAGED_HOME" \
  --setenv "PM2_HOME=$MANAGED_PM2_HOME" \
  --setenv "PATH=$APPROVED_PATH" \
  --setenv "D2_RUN_DIR=$RUN_DIR" \
  --setenv "D2_CONTROL_ROOT=$PM2_CONTROL_ROOT" \
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

assert_invocation_clone_identity
set +e
env -i \
  PATH="$APPROVED_PATH" \
  HOME="$MANAGED_HOME" \
  XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \
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

trap - EXIT
cleanup || no_go "D2_PRIME_CLEANUP_FAILED"
printf 'D2_PRIME_PASS\nproductionF1=NO-GO\n'
