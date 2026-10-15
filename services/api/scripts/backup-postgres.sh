#!/usr/bin/env bash
set -euo pipefail
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
database_url="${POSTGRES_URL:-${DATABASE_URL:-}}"
[[ -n "$database_url" ]] || database_url="$(read_env_value DATABASE_URL "$API_ENV_FILE")"
alert_webhook="${ALERT_WEBHOOK_URL:-}"
[[ -n "$alert_webhook" ]] || alert_webhook="$(read_env_value ALERT_WEBHOOK_URL "$API_ENV_FILE")"
send_failure_alert() {
  [[ -n "$alert_webhook" ]] || return 0
  local message="【职易达告警】数据库每日备份失败（${stamp}，$(hostname)）"
  curl --silent --show-error --max-time 10 -X POST -H 'Content-Type: application/json' --data-raw "$(printf '{\"msgtype\":\"text\",\"text\":{\"content\":\"%s\"}}' "$message")" "$alert_webhook" >/dev/null || echo "BACKUP_ALERT_ERROR: webhook notification failed" >&2
}
fail() { local reason="$1"; send_failure_alert; echo "BACKUP_ERROR: ${reason}" >&2; exit 1; }
if [[ -z "$database_url" ]]; then send_failure_alert; echo 'BACKUP_ERROR: DATABASE_URL is required' >&2; exit 2; fi
mkdir -p "$BACKUP_DIR"
target="$BACKUP_DIR/postgres_${stamp}.dump"
partial="${target}.partial"
rm -f "$partial"
if ! pg_dump --format=custom --file="$partial" "$database_url"; then rm -f "$partial"; fail "pg_dump failed for ${stamp}"; fi
if ! pg_restore -l "$partial" >/dev/null; then rm -f "$partial"; fail "backup validation failed for ${stamp}"; fi
mv -f "$partial" "$target"
if [[ "${BACKUP_UPLOAD_ENABLED:-0}" == "1" ]]; then
  if [[ -z "${BACKUP_OBJECT_URI:-}" ]] || ! command -v rclone >/dev/null 2>&1 || ! rclone copy "$target" "$BACKUP_OBJECT_URI"; then fail "object upload failed for ${stamp}"; fi
fi
find "$BACKUP_DIR" -type f -name 'postgres_*.dump' -mtime "+$((RETENTION_DAYS - 1))" -delete
printf '%s %s\n' "$stamp" "$(basename "$target")" > "$BACKUP_DIR/LAST_SUCCESS"
echo "BACKUP_OK: $target"
