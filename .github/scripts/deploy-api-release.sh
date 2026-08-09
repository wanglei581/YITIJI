#!/usr/bin/env bash
# 受控 API 发布脚本（服务器端执行，仅由 .github/workflows/deploy.yml 调用）。
#
# 硬约束：
# - 仅在 API_RELEASE_ENABLED=true 时执行（发布授权闸门）。
# - 不打印任何密钥/连接串；失败即退出并保留备份与现场，不自动回滚迁移。
# - 遵循仓库“同一目标提交整体切换、迁移前备份并校验、additive migrate deploy”规则。
set -euo pipefail

if [ "${API_RELEASE_ENABLED:-}" != "true" ]; then
  echo "::error::API release skipped because API_RELEASE_ENABLED != true" >&2
  exit 1
fi

: "${TARGET_SHA:?TARGET_SHA is required}"
: "${CI_RUN:?CI_RUN is required}"
: "${DEPLOY_PATH:?DEPLOY_PATH is required}"

RUNTIME_ROOT="${DEPLOY_API_DIR:-/srv/ai-job-print}"
PM2_NAME="${DEPLOY_PM2_NAME:-ai-job-print-api}"
BACKUP_ROOT="${DEPLOY_BACKUP_ROOT:-/srv/ai-job-print-backups}"
HEALTH_URL="${DEPLOY_HEALTH_URL:-http://127.0.0.1:3010/api/v1/health}"

API_DIR="$RUNTIME_ROOT/services/api"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_PREFIX="$BACKUP_ROOT/pre-$TARGET_SHA-$TS"

echo "=== 0. 校验源码位于目标提交 ==="
test "$(git -C "$DEPLOY_PATH" rev-parse HEAD)" = "$TARGET_SHA"

echo "=== 1. 读取 DATABASE_URL（不打印）==="
DBURL="$(sed -n 's/^DATABASE_URL="\([^"]*\)"/\1/p' "$API_DIR/.env" | head -n1)"
if [ -z "$DBURL" ]; then
  DBURL="$(sed -n 's/^DATABASE_URL=\([^"]*\)/\1/p' "$API_DIR/.env" | head -n1)"
fi
if [ -z "$DBURL" ]; then
  echo "::error::DATABASE_URL not found in $API_DIR/.env" >&2
  exit 1
fi

echo "=== 2. PostgreSQL 全库备份 + 可读校验 ==="
mkdir -p "$BACKUP_ROOT"
pg_dump "$DBURL" -Fc -f "$BACKUP_PREFIX.dump"
pg_restore -l "$BACKUP_PREFIX.dump" >/dev/null

echo "=== 3. 备份当前运行目录（回滚锚点）==="
cp -a "$RUNTIME_ROOT" "$BACKUP_PREFIX.runtime"

echo "=== 4. 在目标提交内构建 API ==="
cd "$DEPLOY_PATH"
pnpm --filter @ai-job-print/api db:pg:generate
pnpm --filter @ai-job-print/api build

echo "=== 4b. 校验三端前端 dist 均已构建（防止 rsync --delete 误删运行目录）==="
for app in kiosk admin partner; do
  if [ ! -f "$DEPLOY_PATH/apps/$app/dist/index.html" ]; then
    echo "::error::missing $DEPLOY_PATH/apps/$app/dist/index.html; build all frontends before release" >&2
    exit 1
  fi
done

echo "=== 5. 同步运行目录（保留 .env / storage）==="
rsync -a --delete \
  --exclude '.git' \
  --exclude '.claude' \
  --exclude '.ccg' \
  --exclude 'node_modules' \
  --exclude '.env.local' \
  --exclude '.env.production' \
  --exclude '.env.development' \
  --exclude 'services/api/.env' \
  --exclude 'services/api/storage' \
  "$DEPLOY_PATH/" "$RUNTIME_ROOT/"

echo "=== 6. 收敛运行目录依赖并执行 additive 迁移 ==="
cd "$RUNTIME_ROOT"
pnpm install --frozen-lockfile
cd "$RUNTIME_ROOT/services/api"
pnpm db:pg:deploy

echo "=== 7. 写 DEPLOY_SOURCE（不含秘密）==="
cat > "$RUNTIME_ROOT/DEPLOY_SOURCE.txt" <<EOF
source=origin/main@$TARGET_SHA
deployed_at=$(date -Is)
ci_run=$CI_RUN
backup=$BACKUP_PREFIX.dump
runtime_backup=$BACKUP_PREFIX.runtime
rollback=restore $BACKUP_PREFIX.runtime then if migration rollback required restore $BACKUP_PREFIX.dump
api_database=postgresql
EOF

echo "=== 8. 重启 PM2 并健康检查 ==="
export COMMIT="$TARGET_SHA"
pm2 restart "$PM2_NAME" --update-env
for _ in $(seq 1 30); do
  if curl -fsS "$HEALTH_URL" 2>/dev/null | grep -q '"status":"ok"'; then
    echo "API health OK: $HEALTH_URL"
    exit 0
  fi
  sleep 2
done
echo "::error::API health check failed after restart: $HEALTH_URL" >&2
exit 1
