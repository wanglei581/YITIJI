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

# 备份保留策略：按发布分组保留最近 N 组，其余删除。
#
# 背景（2026-08-09 真实事故）：根分区 40GB 被备份撑到 100%，可用仅剩 1GiB，
# 无法发布 —— 本脚本步骤 2/3 先做 PG 全库备份、再整目录备份（约 1.1GB），
# 空间不足会在备份阶段写满盘，波及正在运行的 API 与 PostgreSQL。
# 当天手工清理：29 组保留最新 3 组、删 26 组（最旧的 37 天没清），
# 备份目录 8656MB → 4320MB。但每次发布仍新增约 1.1GB，不自动清理必然重演。
#
# 安全设计：
# · 只在健康检查通过后调用（见步骤 9）。发布失败时保留全部备份 —— 那正是回滚锚点。
# · 本次刚生成的一组、以及最新的一组，永不删除。
# · 每次发布产生 <prefix>.dump 与 <prefix>.runtime，按 prefix 归组，不拆开算。
# · 只操作 BACKUP_ROOT（DEPLOY_BACKUP_ROOT，默认 /srv/ai-job-print-backups），
#   路径不接受外部传入；目录不存在时跳过而非报错。
# · 仓库为 public、Actions 日志公开 —— 只输出组数与目录总大小，不打印路径与文件名。
prune_old_backups() {
  local keep current_stem stems idx keep_list del_list del_count stem

  keep="${DEPLOY_BACKUP_KEEP:-3}"
  # 保留数必须是正整数；异常取值回退为 3，下限为 1（永不清空备份目录）
  case "$keep" in
    '' | *[!0-9]*) keep=3 ;;
  esac
  if [ "$keep" -lt 1 ]; then
    keep=1
  fi

  if [ ! -d "$BACKUP_ROOT" ]; then
    echo "备份目录不存在，跳过清理"
    return 0
  fi

  current_stem="$(basename "$BACKUP_PREFIX")"

  # 按 mtime 新→旧列出，去掉 .dump/.runtime 后缀后按 prefix 归组去重。
  # 去重保留首次出现，即取每组最新的 mtime（.dump 由 pg_dump 新写入，时间可靠；
  # .runtime 由 cp -a 保留源目录时间，可能偏旧，因此不能单独作为排序依据）。
  stems="$(find "$BACKUP_ROOT" -maxdepth 1 -mindepth 1 -printf '%T@\t%f\n' 2>/dev/null \
    | sort -rn \
    | cut -f2- \
    | sed -E 's/\.(dump|runtime)$//' \
    | awk 'NF && !seen[$0]++')"

  idx=0
  keep_list=""
  del_list=""
  while IFS= read -r stem; do
    [ -n "$stem" ] || continue
    idx=$((idx + 1))
    # 最新的 keep 组保留；本次刚生成的一组无论排在第几都保留
    if [ "$idx" -le "$keep" ] || [ "$stem" = "$current_stem" ]; then
      keep_list="$keep_list $stem"
    else
      del_list="$del_list $stem"
    fi
  done <<<"$stems"

  del_count="$(printf '%s' "$del_list" | wc -w | tr -d ' ')"
  echo "备份共 $idx 组（DEPLOY_BACKUP_KEEP=$keep）：将保留 $((idx - del_count)) 组，将删除 $del_count 组"
  if [ "$del_count" -eq 0 ]; then
    echo "未超过保留数，无需清理"
    return 0
  fi

  for stem in $del_list; do
    # 双重保险：保留名单内的任何 stem 一律跳过
    case " $keep_list " in
      *" $stem "*) continue ;;
    esac
    if [ "$stem" = "$current_stem" ]; then
      continue
    fi
    rm -rf -- "$BACKUP_ROOT/$stem.dump" "$BACKUP_ROOT/$stem.runtime" 2>/dev/null || true
  done

  echo "清理完成，备份目录当前占用 $(du -sm "$BACKUP_ROOT" 2>/dev/null | cut -f1)MB"
}

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
    echo "=== 9. 发布成功，清理历史备份 ==="
    # 清理失败不影响本次发布结果（发布已经成功），只记 warning。
    # 放在 || 右侧同时确保函数体内的错误不会被 set -e 带崩整个脚本。
    prune_old_backups || echo "::warning::备份清理失败，已跳过（不影响本次发布）"
    exit 0
  fi
  sleep 2
done
echo "::error::API health check failed after restart: $HEALTH_URL" >&2
exit 1
