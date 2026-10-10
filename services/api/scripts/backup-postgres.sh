#!/usr/bin/env bash
# 每日 PostgreSQL 逻辑备份。
# 异地副本默认关闭。开启后：上传、校验完整、再按异地自己的保留天数清理。
# 本机保留天数是 RETENTION_DAYS，异地是 BACKUP_REMOTE_RETENTION_DAYS，两者互不跟随。
set -euo pipefail
umask 077
BACKUP_DIR="${BACKUP_DIR:-/var/backups/ai-job-print/postgres}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
API_ENV_FILE="${API_ENV_FILE:-/srv/ai-job-print/services/api/.env}"
stamp="$(date -u +%Y-%m-%d)"
read_env_value() {
  local key="$1" file="$2" value
  [[ -r "$file" ]] || return 0
  value="$(sed -n "s/^${key}=\"\([^\"]*\)\"/\1/p" "$file" | head -n1)"
  [[ -n "$value" ]] || value="$(sed -n "s/^${key}=\([^[:space:]]*\).*/\1/p" "$file" | head -n1)"
  printf '%s' "$value"
}
load_env_if_unset() {
  local key="$1" value
  [[ -n "${!key:-}" ]] && return 0
  value="$(read_env_value "$key" "$API_ENV_FILE")"
  [[ -n "$value" ]] || return 0
  printf -v "$key" '%s' "$value"
}
database_url="${POSTGRES_URL:-${DATABASE_URL:-}}"
[[ -n "$database_url" ]] || database_url="$(read_env_value DATABASE_URL "$API_ENV_FILE")"
alert_webhook="${ALERT_WEBHOOK_URL:-}"
[[ -n "$alert_webhook" ]] || alert_webhook="$(read_env_value ALERT_WEBHOOK_URL "$API_ENV_FILE")"
load_env_if_unset BACKUP_UPLOAD_ENABLED
load_env_if_unset BACKUP_OBJECT_URI
load_env_if_unset BACKUP_REMOTE_RETENTION_DAYS
load_env_if_unset BACKUP_MIRROR_DIR
load_env_if_unset BACKUP_UPLOAD_BACKEND
load_env_if_unset RCLONE_CONFIG
send_failure_alert() {
  [[ -n "$alert_webhook" ]] || return 0
  local message="${1:-【职易达告警】数据库每日备份失败}（${stamp}，$(hostname)）"
  curl --silent --show-error --max-time 10 -X POST -H 'Content-Type: application/json' --data-raw "$(printf '{\"msgtype\":\"text\",\"text\":{\"content\":\"%s\"}}' "$message")" "$alert_webhook" >/dev/null || echo "BACKUP_ALERT_ERROR: webhook notification failed" >&2
}
fail() { local reason="$1"; send_failure_alert; echo "BACKUP_ERROR: ${reason}" >&2; exit 1; }
positive_days() {
  local name="$1" value="$2"
  [[ "$value" =~ ^[1-9][0-9]{0,3}$ ]] || fail "${name} must be a positive integer"
}
rclone_cmd() {
  if [[ -n "${RCLONE_CONFIG:-}" ]]; then
    rclone --config "$RCLONE_CONFIG" "$@"
  else
    rclone "$@"
  fi
}
file_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk 'NR==1 { print $1 }'
  else
    shasum -a 256 "$1" | awk 'NR==1 { print $1 }'
  fi
}
offsite_notice_once() {
  local marker="$BACKUP_DIR/.offsite-upload-disabled-notice"
  [[ -f "$marker" ]] && return 0
  echo "BACKUP_NOTICE: 未开启异地备份（BACKUP_UPLOAD_ENABLED 不是 1）。本次只保留在本机。要保留异地副本，请把 BACKUP_UPLOAD_ENABLED 设为 1，并设置 BACKUP_OBJECT_URI（rclone）或 BACKUP_UPLOAD_BACKEND=local 与 BACKUP_MIRROR_DIR（本地目录）。本提示只打印一次。" >&2
  touch "$marker"
}
upload_with_rclone() {
  local remote_days="$1" remote_name check_dir
  [[ -n "${BACKUP_OBJECT_URI:-}" ]] || fail "BACKUP_OBJECT_URI is required when uploading with rclone"
  command -v rclone >/dev/null 2>&1 || fail "rclone is required for offsite upload"
  remote_name="$(basename "$target")"
  if ! rclone_cmd copy "$target" "$BACKUP_OBJECT_URI"; then fail "object upload failed for ${stamp}"; fi
  # 只把今天这一个文件放进临时目录再 check，避免本机旧 dump 被当成缺件。
  check_dir="$(mktemp -d "${TMPDIR:-/tmp}/backup-check.XXXXXX")"
  cp "$target" "$check_dir/"
  if ! rclone_cmd check "$check_dir" "$BACKUP_OBJECT_URI" --one-way; then
    rm -f "$check_dir/$remote_name"
    rmdir "$check_dir" || true
    fail "object integrity check failed for ${stamp}"
  fi
  rm -f "$check_dir/$remote_name"
  rmdir "$check_dir" || true
  echo "BACKUP_OFFSITE_OK: checked ${BACKUP_OBJECT_URI}/${remote_name}"
  if ! rclone_cmd delete "$BACKUP_OBJECT_URI" --min-age "${remote_days}d" --include 'postgres_*.dump'; then
    send_failure_alert "【职易达告警】异地备份过期清理失败"
    echo "BACKUP_WARN: remote retention cleanup failed for ${stamp}" >&2
  fi
}
upload_to_local_mirror() {
  local remote_days="$1" remote_name mirror_file src_size dst_size src_sum dst_sum
  [[ -n "${BACKUP_MIRROR_DIR:-}" ]] || fail "BACKUP_MIRROR_DIR is required when BACKUP_UPLOAD_BACKEND=local"
  remote_name="$(basename "$target")"
  mkdir -p "$BACKUP_MIRROR_DIR"
  mirror_file="$BACKUP_MIRROR_DIR/$remote_name"
  cp "$target" "$mirror_file"
  src_size="$(wc -c < "$target" | tr -d '[:space:]')"
  dst_size="$(wc -c < "$mirror_file" | tr -d '[:space:]')"
  src_sum="$(file_sha256 "$target")"
  dst_sum="$(file_sha256 "$mirror_file")"
  if [[ "$src_size" != "$dst_size" || "$src_sum" != "$dst_sum" ]]; then
    rm -f "$mirror_file"
    fail "object integrity check failed for ${stamp}"
  fi
  echo "BACKUP_OFFSITE_OK: checked local ${mirror_file} sha256=${dst_sum} bytes=${dst_size}"
  if ! find "$BACKUP_MIRROR_DIR" -type f -name 'postgres_*.dump' -mtime "+$((remote_days - 1))" -delete; then
    send_failure_alert "【职易达告警】异地备份过期清理失败"
    echo "BACKUP_WARN: remote retention cleanup failed for ${stamp}" >&2
  fi
}
if [[ ! "$RETENTION_DAYS" =~ ^[1-9][0-9]{0,3}$ ]]; then fail "RETENTION_DAYS must be a positive integer"; fi
if [[ -z "$database_url" ]]; then send_failure_alert; echo 'BACKUP_ERROR: DATABASE_URL is required' >&2; exit 2; fi
mkdir -p "$BACKUP_DIR"
target="$BACKUP_DIR/postgres_${stamp}.dump"
partial="${target}.partial"
rm -f "$partial"
if ! pg_dump --format=custom --file="$partial" "$database_url"; then rm -f "$partial"; fail "pg_dump failed for ${stamp}"; fi
if ! pg_restore -l "$partial" >/dev/null; then rm -f "$partial"; fail "backup validation failed for ${stamp}"; fi
mv -f "$partial" "$target"
if [[ "${BACKUP_UPLOAD_ENABLED:-0}" == "1" ]]; then
  remote_retention="${BACKUP_REMOTE_RETENTION_DAYS:-30}"
  positive_days BACKUP_REMOTE_RETENTION_DAYS "$remote_retention"
  backend="${BACKUP_UPLOAD_BACKEND:-}"
  if [[ -z "$backend" ]]; then
    if [[ -n "${BACKUP_OBJECT_URI:-}" ]]; then
      backend="rclone"
    elif [[ -n "${BACKUP_MIRROR_DIR:-}" ]]; then
      backend="local"
    else
      fail "object upload destination is required"
    fi
  fi
  case "$backend" in
    local) upload_to_local_mirror "$remote_retention" ;;
    rclone) upload_with_rclone "$remote_retention" ;;
    *) fail "BACKUP_UPLOAD_BACKEND must be rclone or local" ;;
  esac
else
  offsite_notice_once
fi
find "$BACKUP_DIR" -type f -name 'postgres_*.dump' -mtime "+$((RETENTION_DAYS - 1))" -delete
printf '%s %s\n' "$stamp" "$(basename "$target")" > "$BACKUP_DIR/LAST_SUCCESS"
echo "BACKUP_OK: $target"
