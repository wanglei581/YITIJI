#!/usr/bin/env bash
set -euo pipefail
backup="${1:-}"; target_url="${2:-${POSTGRES_URL:-${DATABASE_URL:-}}}"
if [[ -z "$backup" || -z "$target_url" ]]; then echo 'RESTORE_ERROR: usage restore-postgres-drill.sh BACKUP_FILE TARGET_DATABASE_URL' >&2; exit 2; fi
target_db="${target_url##*/}"; target_db="${target_db%%\?*}"
if [[ ! "$target_db" =~ (drill|verify) ]]; then echo 'RESTORE_ERROR: target database name must contain drill or verify' >&2; exit 2; fi
if [[ ! -f "$backup" ]]; then echo 'RESTORE_ERROR: backup file does not exist' >&2; exit 2; fi
if ! pg_restore --exit-on-error --clean --if-exists --dbname="$target_url" "$backup"; then echo 'RESTORE_ERROR: pg_restore failed' >&2; exit 1; fi
if ! (cd "$(dirname "$0")/.." && if command -v prisma >/dev/null 2>&1; then POSTGRES_URL="$target_url" DATABASE_URL="$target_url" prisma migrate status --config prisma.postgres.config.ts; else POSTGRES_URL="$target_url" DATABASE_URL="$target_url" pnpm exec prisma migrate status --config prisma.postgres.config.ts; fi); then echo 'RESTORE_ERROR: migration status check failed' >&2; exit 1; fi
echo "RESTORE_OK: restored ${backup} to ${target_db}; migration status checked"
