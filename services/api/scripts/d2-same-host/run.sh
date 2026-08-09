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

[[ "$(uname -s)" == "Linux" ]] || no_go "D2_PRIME_NO_GO_KERNEL"
[[ -r /sys/fs/cgroup/cgroup.controllers ]] || no_go "D2_PRIME_NO_GO_KERNEL"

required_commands=(date dirname git grep id loginctl mkdir nginx node pm2 pnpm realpath rm sha256sum sleep stat systemctl timeout tr)
for required_command in "${required_commands[@]}"; do
  command -v "$required_command" >/dev/null 2>&1 || no_go "D2_PRIME_NO_GO_APPROVED_PATH_COMMAND"
done
node --version >/dev/null 2>&1 || no_go "D2_PRIME_NO_GO_TOOLCHAIN"
pnpm --version >/dev/null 2>&1 || no_go "D2_PRIME_NO_GO_TOOLCHAIN"
nginx -v >/dev/null 2>&1 || no_go "D2_PRIME_NO_GO_TOOLCHAIN"
NODE_BIN="$(command -v node)"
PM2_BIN="$(command -v pm2)"
NGINX_BIN="$(command -v nginx)"
SYSTEMCTL_BIN="$(command -v systemctl)"

# D2_GOVERNANCE_INVOKE_START
[[ -n "${D2_GOVERNANCE_ROOT:-}" && -n "${D2_GOVERNANCE_RESERVATION_ID:-}" ]] \
  || no_go "D2_PRIME_NO_GO_GOVERNANCE_STATE"

GOVERNANCE_CONTEXT_SENTINEL="D2_GOVERNANCE_CONTEXT_END"
GOVERNANCE_CONTEXT_RAW=""
if ! GOVERNANCE_CONTEXT_RAW="$(
  env -i PATH="$APPROVED_PATH" HOME="$SCRIPT_DIR" \
    "$NODE_BIN" "$SCRIPT_DIR/governance.mjs" invoke \
    --state-root "$D2_GOVERNANCE_ROOT" \
    --reservation-id "$D2_GOVERNANCE_RESERVATION_ID" \
    --context-fd 3 \
    3>&1 >/dev/null
  GOVERNANCE_STATUS=$?
  (( GOVERNANCE_STATUS == 0 )) || exit "$GOVERNANCE_STATUS"
  printf '%s' "$GOVERNANCE_CONTEXT_SENTINEL"
)"; then
  unset GOVERNANCE_CONTEXT_RAW GOVERNANCE_CONTEXT_SENTINEL
  exit 2
fi
[[ "$GOVERNANCE_CONTEXT_RAW" == *"$GOVERNANCE_CONTEXT_SENTINEL" ]] \
  || no_go "D2_PRIME_NO_GO_MANIFEST"
GOVERNANCE_CONTEXT_PAYLOAD="${GOVERNANCE_CONTEXT_RAW%$GOVERNANCE_CONTEXT_SENTINEL}"
[[ "$GOVERNANCE_CONTEXT_PAYLOAD" == *$'\n' ]] || no_go "D2_PRIME_NO_GO_MANIFEST"
GOVERNANCE_CONTEXT_PAYLOAD="${GOVERNANCE_CONTEXT_PAYLOAD%$'\n'}"
[[ "$GOVERNANCE_CONTEXT_PAYLOAD" == *$'\n'* ]] || no_go "D2_PRIME_NO_GO_MANIFEST"
EVIDENCE_DIR="${GOVERNANCE_CONTEXT_PAYLOAD%%$'\n'*}"
EVIDENCE_OUT="${GOVERNANCE_CONTEXT_PAYLOAD#*$'\n'}"
[[ -n "$EVIDENCE_DIR" && -n "$EVIDENCE_OUT" && "$EVIDENCE_DIR" == /* \
  && "$EVIDENCE_OUT" == /* && "$EVIDENCE_OUT" != *$'\n'* ]] \
  || no_go "D2_PRIME_NO_GO_MANIFEST"
unset GOVERNANCE_CONTEXT_RAW GOVERNANCE_CONTEXT_SENTINEL GOVERNANCE_CONTEXT_PAYLOAD GOVERNANCE_STATUS
# D2_GOVERNANCE_INVOKE_END

INVOCATION_CLONE_ROOT="$(realpath "$ROOT" 2>/dev/null)" \
  || no_go "D2_PRIME_NO_GO_GIT_IDENTITY"
INVOCATION_GIT_ROOT="$(git -C "$ROOT" rev-parse --show-toplevel 2>/dev/null)" \
  || no_go "D2_PRIME_NO_GO_GIT_IDENTITY"
INVOCATION_GIT_ROOT="$(realpath "$INVOCATION_GIT_ROOT" 2>/dev/null)" \
  || no_go "D2_PRIME_NO_GO_GIT_IDENTITY"
[[ "$INVOCATION_CLONE_ROOT" == "$INVOCATION_GIT_ROOT" ]] \
  || no_go "D2_PRIME_NO_GO_GIT_IDENTITY"
INVOCATION_BASELINE_OID="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null)" \
  || no_go "D2_PRIME_NO_GO_GIT_IDENTITY"
INVOCATION_TREE_OID="$(git -C "$ROOT" rev-parse 'HEAD^{tree}' 2>/dev/null)" \
  || no_go "D2_PRIME_NO_GO_GIT_IDENTITY"
INVOCATION_BRANCH="$(git -C "$ROOT" symbolic-ref --quiet --short HEAD 2>/dev/null)" \
  || no_go "D2_PRIME_NO_GO_GIT_IDENTITY"
git -C "$ROOT" diff --quiet --ignore-submodules -- >/dev/null 2>&1 \
  || no_go "D2_PRIME_NO_GO_GIT_IDENTITY"
git -C "$ROOT" diff --cached --quiet --ignore-submodules -- >/dev/null 2>&1 \
  || no_go "D2_PRIME_NO_GO_GIT_IDENTITY"

assert_invocation_clone_identity() {
  local current_root=""
  local current_git_root=""
  local current_baseline_oid=""
  local current_tree_oid=""
  local current_branch=""
  current_root="$(realpath "$ROOT" 2>/dev/null)" \
    || no_go "D2_PRIME_NO_GO_GIT_IDENTITY"
  current_git_root="$(git -C "$ROOT" rev-parse --show-toplevel 2>/dev/null)" \
    || no_go "D2_PRIME_NO_GO_GIT_IDENTITY"
  current_git_root="$(realpath "$current_git_root" 2>/dev/null)" \
    || no_go "D2_PRIME_NO_GO_GIT_IDENTITY"
  [[ "$current_root" == "$INVOCATION_CLONE_ROOT" && "$current_git_root" == "$INVOCATION_GIT_ROOT" ]] \
    || no_go "D2_PRIME_NO_GO_GIT_IDENTITY"
  current_baseline_oid="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null)" \
    || no_go "D2_PRIME_NO_GO_GIT_IDENTITY"
  [[ "$current_baseline_oid" == "$INVOCATION_BASELINE_OID" ]] \
    || no_go "D2_PRIME_NO_GO_GIT_IDENTITY"
  current_tree_oid="$(git -C "$ROOT" rev-parse 'HEAD^{tree}' 2>/dev/null)" \
    || no_go "D2_PRIME_NO_GO_GIT_IDENTITY"
  [[ "$current_tree_oid" == "$INVOCATION_TREE_OID" ]] \
    || no_go "D2_PRIME_NO_GO_GIT_IDENTITY"
  current_branch="$(git -C "$ROOT" symbolic-ref --quiet --short HEAD 2>/dev/null)" \
    || no_go "D2_PRIME_NO_GO_GIT_IDENTITY"
  [[ "$current_branch" == "$INVOCATION_BRANCH" ]] \
    || no_go "D2_PRIME_NO_GO_GIT_IDENTITY"
  git -C "$ROOT" diff --quiet --ignore-submodules -- >/dev/null 2>&1 \
    || no_go "D2_PRIME_NO_GO_GIT_IDENTITY"
  git -C "$ROOT" diff --cached --quiet --ignore-submodules -- >/dev/null 2>&1 \
    || no_go "D2_PRIME_NO_GO_GIT_IDENTITY"
}

assert_invocation_clone_identity
command -v systemd-run >/dev/null 2>&1 || no_go "D2_PRIME_NO_GO_APPROVED_PATH_COMMAND"

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
  AI_LLM_API_KEY AI_IMAGE_API_KEY CONTRACT_REVIEW_API_KEY
  BAIDU_OCR_API_KEY BAIDU_OCR_SECRET_KEY BAIDU_ASR_API_KEY BAIDU_ASR_SECRET_KEY
  JWT_SECRET TERMINAL_ADMIN_SECRET TERMINAL_ACTION_TOKEN_SECRET
  FILE_SIGNING_SECRET SECRET_ENCRYPTION_KEY
  PAYMENT_SESSION_SECRET SANDBOX_PAYMENT_SECRET
  WECHAT_PAY_MCHID WECHAT_PAY_APPID WECHAT_PAY_MCH_SERIAL_NO
  WECHAT_PAY_PRIVATE_KEY_PEM WECHAT_PAY_PRIVATE_KEY_PATH WECHAT_PAY_APIV3_KEY
  WECHAT_PAY_PUBLIC_KEY_PEM WECHAT_PAY_PUBLIC_KEY_PATH WECHAT_PAY_PUBLIC_KEY_ID
  WECHAT_PAY_CODEPAY_STORE_OUT_ID
  WECHAT_MINIAPP_APPID WECHAT_MINIAPP_APPSECRET
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

# A `--collect` unit may disappear before or while cleanup polls it. Ignore the stop exit status
# only long enough to obtain one keyed state snapshot; success still requires one of the two
# explicit inactive tuples below. Malformed, contradictory, or unknown snapshots fail closed.
stop_user_unit_and_prove_inactive() {
  local unit_name="$1"
  local unit_properties=""
  local load_state=""
  local active_state=""
  local property_name=""
  local property_value=""
  local load_state_seen=0
  local active_state_seen=0
  if timeout --signal=TERM --kill-after=2s 10s \
    systemctl --user stop "$unit_name" >/dev/null 2>&1; then
    :
  fi
  for _ in {1..50}; do
    if ! unit_properties="$(systemctl --user show "$unit_name" -p LoadState -p ActiveState 2>/dev/null)"; then
      return 1
    fi
    load_state=""
    active_state=""
    load_state_seen=0
    active_state_seen=0
    while IFS='=' read -r property_name property_value; do
      case "$property_name" in
        LoadState)
          (( load_state_seen == 0 )) || return 1
          load_state_seen=1
          load_state="$property_value"
          ;;
        ActiveState)
          (( active_state_seen == 0 )) || return 1
          active_state_seen=1
          active_state="$property_value"
          ;;
        *) return 1 ;;
      esac
    done <<< "$unit_properties"
    (( load_state_seen == 1 && active_state_seen == 1 )) || return 1
    [[ -n "$load_state" && -n "$active_state" ]] || return 1
    if [[ "$active_state" == "inactive" ]]; then
      [[ "$load_state" == "loaded" || "$load_state" == "not-found" ]] && return 0
      return 1
    fi
    [[ "$load_state" == "loaded" ]] || return 1
    case "$active_state" in
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

[[ -z "${D2_WORK_DIR+x}" ]] || no_go "D2_PRIME_NO_GO_GOVERNANCE_STATE"
WORK_DIR="$SCRIPT_DIR/.work"
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
    if ! pm2_home_has_state "$pm2_home"; then
      [[ -z "$daemon_pid" ]] && return 0
      break
    fi
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

process_start_time_ticks() {
  local pid="$1"
  local process_stat=""
  local -a process_fields=()
  [[ "$pid" =~ ^[1-9][0-9]{0,9}$ ]] || return 1
  [[ -r "/proc/$pid/stat" ]] || return 1
  process_stat="$(<"/proc/$pid/stat")" || return 1
  [[ "$process_stat" == *") "* ]] || return 1
  read -r -a process_fields <<< "${process_stat##*) }"
  (( ${#process_fields[@]} >= 20 )) || return 1
  [[ "${process_fields[19]}" =~ ^[1-9][0-9]*$ ]] || return 1
  printf '%s' "${process_fields[19]}"
}

nginx_process_matches_identity() {
  local nginx_pid="$1"
  local expected_start_time="$2"
  local expected_executable=""
  local actual_executable=""
  local actual_start_time=""
  [[ -d "/proc/$nginx_pid" && -O "/proc/$nginx_pid" && ! -L "/proc/$nginx_pid" ]] || return 1
  expected_executable="$(realpath "$NGINX_BIN" 2>/dev/null)" || return 1
  actual_executable="$(realpath "/proc/$nginx_pid/exe" 2>/dev/null)" || return 1
  [[ "$actual_executable" == "$expected_executable" ]] || return 1
  actual_start_time="$(process_start_time_ticks "$nginx_pid")" || return 1
  [[ "$actual_start_time" == "$expected_start_time" ]]
}

stop_nginx_and_prove_dead() {
  [[ -n "${RUN_DIR:-}" ]] || return 1
  [[ "$RUN_DIR" == "$WORK_DIR/"* && "$RUN_DIR" != "$WORK_DIR" ]] || return 1
  [[ -d "$RUN_DIR" && -O "$RUN_DIR" && ! -L "$RUN_DIR" ]] || return 1
  local nginx_attempt_file="$RUN_DIR/nginx/nginx-start-attempted"
  local nginx_identity_file="$RUN_DIR/nginx/nginx-master.identity"
  local nginx_identity=""
  local nginx_identity_pattern='^([1-9][0-9]{0,9}) ([1-9][0-9]*)$'
  local nginx_pid=""
  local nginx_start_time=""
  if [[ ! -e "$nginx_attempt_file" && ! -L "$nginx_attempt_file" ]]; then
    [[ ! -e "$nginx_identity_file" && ! -L "$nginx_identity_file" ]] || return 1
    return 0
  fi
  [[ -f "$nginx_attempt_file" && -O "$nginx_attempt_file" && ! -L "$nginx_attempt_file" ]] || return 1
  [[ "$(stat -c '%s' "$nginx_attempt_file")" == "0" ]] || return 1
  [[ -f "$nginx_identity_file" && -O "$nginx_identity_file" && ! -L "$nginx_identity_file" ]] || return 1
  [[ "$(stat -c '%s' "$nginx_identity_file")" =~ ^[1-9][0-9]*$ ]] || return 1
  (( $(stat -c '%s' "$nginx_identity_file") <= 64 )) || return 1
  nginx_identity="$(<"$nginx_identity_file")" || return 1
  [[ "$nginx_identity" =~ $nginx_identity_pattern ]] || return 1
  nginx_pid="${BASH_REMATCH[1]}"
  nginx_start_time="${BASH_REMATCH[2]}"
  (( nginx_pid > 1 )) || return 1
  kill -0 "$nginx_pid" 2>/dev/null || return 0
  nginx_process_matches_identity "$nginx_pid" "$nginx_start_time" || return 1
  if ! kill -TERM "$nginx_pid" 2>/dev/null; then
    kill -0 "$nginx_pid" 2>/dev/null && return 1
    return 0
  fi
  for _ in {1..50}; do
    kill -0 "$nginx_pid" 2>/dev/null || return 0
    if ! nginx_process_matches_identity "$nginx_pid" "$nginx_start_time"; then
      kill -0 "$nginx_pid" 2>/dev/null || return 0
      return 1
    fi
    sleep 0.1
  done
  return 1
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
  stop_nginx_and_prove_dead || cleanup_failed=1
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

KEEPER_STARTED=1

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
