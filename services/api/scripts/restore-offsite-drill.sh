#!/usr/bin/env bash
# 在另一台机器上，从异地副本拉最新一份 dump，校验后恢复到新建的临时库。
# 目标库名必须含 drill。不含就立刻退出，不拉取、不建库、不恢复。
set -euo pipefail
umask 077

reject() { echo "RESTORE_OFFSITE_ERROR: $1" >&2; exit 2; }
die() { echo "RESTORE_OFFSITE_ERROR: $1" >&2; exit 1; }

target_url="${1:-${DRILL_DATABASE_URL:-}}"
if [[ -z "$target_url" ]]; then
  reject "usage: restore-offsite-drill.sh DRILL_DATABASE_URL"
fi
target_db="${target_url##*/}"
target_db="${target_db%%\?*}"
# 硬校验放在任何拉取和数据库操作之前。
if [[ ! "$target_db" =~ drill ]]; then
  reject "target database name must contain drill"
fi
if [[ ! "$target_db" =~ ^[A-Za-z][A-Za-z0-9_]*$ ]]; then
  reject "target database name must match [A-Za-z][A-Za-z0-9_]* and contain drill"
fi
if [[ "${#target_db}" -gt 63 ]]; then
  reject "target database name is longer than 63 characters"
fi

script_dir="$(cd "$(dirname "$0")" && pwd)"
migrations_dir="${DRILL_MIGRATIONS_DIR:-$script_dir/../prisma/postgres/migrations}"
if [[ -n "${DRILL_ADMIN_URL:-}" ]]; then
  admin_url="$DRILL_ADMIN_URL"
else
  admin_base="${target_url%%\?*}"
  admin_url="${admin_base%/*}/postgres"
  if [[ "$target_url" == *\?* ]]; then
    admin_url="${admin_url}?${target_url#*\?}"
  fi
fi
admin_db="${admin_url##*/}"
admin_db="${admin_db%%\?*}"
if [[ "$admin_db" == "$target_db" ]]; then
  reject "DRILL_ADMIN_URL must not be the drill database"
fi

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

source_mode="${DRILL_SOURCE:-}"
if [[ -z "$source_mode" ]]; then
  if [[ "${BACKUP_UPLOAD_BACKEND:-}" == "local" ]]; then
    source_mode="local"
  elif [[ -n "${BACKUP_OBJECT_URI:-}" ]]; then
    source_mode="rclone"
  elif [[ -n "${BACKUP_MIRROR_DIR:-}" ]]; then
    source_mode="local"
  else
    reject "set BACKUP_OBJECT_URI or BACKUP_MIRROR_DIR"
  fi
fi
case "$source_mode" in
  local|rclone) ;;
  *) reject "DRILL_SOURCE must be local or rclone" ;;
esac

work="${DRILL_WORK_DIR:-}"
if [[ -z "$work" ]]; then
  work="$(mktemp -d "${TMPDIR:-/tmp}/offsite-drill.XXXXXX")"
fi
mkdir -p "$work"
record_path="${DRILL_RECORD_PATH:-$work/drill-record.txt}"
pulled_name=""
pulled_bytes=""
check_result="未做"
verify_result="未做"
dropped="否"
wrote=0
started="$(date '+%Y-%m-%d %H:%M:%S %z')"
start_s="$(date +%s)"
write_record() {
  local status=$?
  if [[ "$wrote" == "1" ]]; then
    return 0
  fi
  wrote=1
  local result_line="失败" elapsed
  if [[ "$status" -eq 0 ]]; then
    result_line="通过"
  fi
  elapsed="$(( $(date +%s) - start_s ))"
  mkdir -p "$(dirname "$record_path")"
  cat > "$record_path" <<EOF
异地恢复演练记录
时间: ${started}
文件名: ${pulled_name:-未知}
大小: ${pulled_bytes:-未知}
校验结果: ${check_result}
耗时: ${elapsed} 秒
核对结果: ${verify_result}
临时库: ${target_db}
删除临时库: ${dropped}
结论: ${result_line}
EOF
  cat "$record_path"
}
trap write_record EXIT

dump_name_ok() {
  [[ "$1" =~ ^postgres_[0-9]{4}-[0-9]{2}-[0-9]{2}\.dump$ ]]
}

if [[ "$source_mode" == "local" ]]; then
  [[ -d "${BACKUP_MIRROR_DIR:-}" ]] || die "BACKUP_MIRROR_DIR is not a directory"
  latest="$(find "$BACKUP_MIRROR_DIR" -maxdepth 1 -type f -name 'postgres_*.dump' | LC_ALL=C sort | tail -n 1)"
  [[ -n "$latest" ]] || die "no postgres_*.dump in BACKUP_MIRROR_DIR"
  pulled_name="$(basename "$latest")"
  dump_name_ok "$pulled_name" || die "mirror name is not a daily dump: ${pulled_name}"
  cp "$latest" "$work/$pulled_name"
else
  [[ -n "${BACKUP_OBJECT_URI:-}" ]] || die "BACKUP_OBJECT_URI is required"
  command -v rclone >/dev/null 2>&1 || die "rclone is required"
  listing="$(rclone_cmd lsf "$BACKUP_OBJECT_URI" --files-only --include 'postgres_*.dump' | LC_ALL=C sort)"
  pulled_name="$(printf '%s\n' "$listing" | sed '/^$/d' | tail -n 1 | tr -d '\r')"
  [[ -n "$pulled_name" ]] || die "no postgres_*.dump at BACKUP_OBJECT_URI"
  dump_name_ok "$pulled_name" || die "remote name is not a daily dump: ${pulled_name}"
  rclone_cmd copy "${BACKUP_OBJECT_URI%/}/$pulled_name" "$work/"
fi

dump_path="$work/$pulled_name"
[[ -f "$dump_path" ]] || die "pulled dump is missing: ${dump_path}"
pulled_bytes="$(wc -c < "$dump_path" | tr -d '[:space:]')"
sum="$(file_sha256 "$dump_path")"
if ! pg_restore -l "$dump_path" >/dev/null; then
  check_result="pg_restore -l 失败；sha256=${sum}"
  die "pg_restore -l failed"
fi
check_result="pg_restore -l 通过；sha256=${sum}"

exists="$(psql "$admin_url" -v ON_ERROR_STOP=1 -tA -c "SELECT 1 FROM pg_database WHERE datname = '${target_db}'")"
if [[ "$exists" == "1" ]]; then
  reject "database ${target_db} already exists; refusing to overwrite"
fi
psql "$admin_url" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"${target_db}\""
if ! pg_restore --exit-on-error --clean --if-exists --no-owner --no-acl --dbname="$target_url" "$dump_path"; then
  die "pg_restore failed"
fi

table_count="$(psql "$target_url" -v ON_ERROR_STOP=1 -tA -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")"
verify_ok=1
verify_result="表数=${table_count}"
if [[ ! "$table_count" =~ ^[1-9][0-9]*$ ]]; then
  verify_ok=0
fi
for table in _prisma_migrations User Organization Terminal; do
  if count="$(psql "$target_url" -v ON_ERROR_STOP=1 -tA -c "SELECT count(*) FROM \"${table}\"")"; then
    :
  else
    count="缺失"
    verify_ok=0
  fi
  verify_result="${verify_result}；${table}=${count}"
  if [[ ! "$count" =~ ^[0-9]+$ ]]; then
    verify_ok=0
  fi
  if [[ "$table" == "_prisma_migrations" && "$count" == "0" ]]; then
    verify_ok=0
  fi
done
db_latest="$(psql "$target_url" -v ON_ERROR_STOP=1 -tA -c "SELECT migration_name FROM \"_prisma_migrations\" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY finished_at DESC, migration_name DESC LIMIT 1")"
repo_latest="$(LC_ALL=C find "$migrations_dir" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; | LC_ALL=C sort | tail -n 1)"
if [[ -n "$db_latest" && "$db_latest" == "$repo_latest" ]]; then
  match="是"
else
  match="否"
  verify_ok=0
fi
verify_result="${verify_result}；库迁移=${db_latest:-无}；仓库迁移=${repo_latest:-无}；迁移一致=${match}"

if [[ "${DRILL_DROP_DATABASE:-0}" == "1" ]]; then
  if [[ ! "$target_db" =~ drill ]]; then
    die "refusing to drop a database whose name does not contain drill"
  fi
  psql "$admin_url" -v ON_ERROR_STOP=1 -c "DROP DATABASE \"${target_db}\""
  dropped="是"
fi

if [[ "$verify_ok" != "1" ]]; then
  die "read-only checks failed"
fi
echo "DRILL_NOTE: 工作目录里有数据库副本，核对留档后删除 ${work}" >&2
exit 0
