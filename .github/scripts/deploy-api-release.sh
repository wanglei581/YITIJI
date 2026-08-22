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
: "${RELEASE_ATTEMPT:?RELEASE_ATTEMPT is required}"
: "${DEPLOY_PATH:?DEPLOY_PATH is required}"

if ! printf '%s\n' "$TARGET_SHA" | grep -Eq '^[0-9a-f]{40}$'; then
  echo "::error::TARGET_SHA must be a full lowercase commit SHA" >&2
  exit 1
fi
if ! printf '%s\n' "$CI_RUN" | grep -Eq '^[0-9]+$'; then
  echo "::error::CI_RUN must be a numeric upstream workflow run id" >&2
  exit 1
fi
if ! printf '%s\n' "$RELEASE_ATTEMPT" | grep -Eq '^[0-9]+-[1-9][0-9]*$'; then
  echo "::error::RELEASE_ATTEMPT must be a GitHub run id and run attempt" >&2
  exit 1
fi

if [ "${PRINT_REQUIRE_PII_SCAN:-}" != "true" ]; then
  echo "::error::PRINT_REQUIRE_PII_SCAN must be explicitly true before production release" >&2
  exit 1
fi

RUNTIME_ROOT="/srv/ai-job-print"
PM2_NAME="${DEPLOY_PM2_NAME:-ai-job-print-api}"
NODE_BIN="/usr/local/bin/node"
BACKUP_ROOT="/srv/ai-job-print-backups"
HEALTH_URL="${DEPLOY_HEALTH_URL:-http://127.0.0.1:3010/api/v1/health}"
READY_URL="${DEPLOY_READY_URL:-${HEALTH_URL%/}/ready}"

API_DIR="$RUNTIME_ROOT/services/api"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_PREFIX="$BACKUP_ROOT/pre-$TARGET_SHA-$TS"
ACTIVE_SOURCE="$RUNTIME_ROOT/DEPLOY_SOURCE.txt"
ENV_TMP=""
PROVENANCE_TMP=""
rollback_armed=false

OLD_SHA="$(sed -n 's/^source=origin\/main@\([0-9a-f]\{40\}\)$/\1/p' "$ACTIVE_SOURCE" | head -n1)"
if ! printf '%s\n' "$OLD_SHA" | grep -Eq '^[0-9a-f]{40}$'; then
  echo "::error::current DEPLOY_SOURCE.txt does not contain a valid active SHA" >&2
  exit 1
fi

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
if [ -n "${DEPLOY_BACKUP_ROOT:-}" ] && [ "$DEPLOY_BACKUP_ROOT" != "$BACKUP_ROOT" ]; then
  echo "::error::DEPLOY_BACKUP_ROOT override is forbidden in production releases" >&2
  exit 1
fi
if [ -n "${DEPLOY_API_DIR:-}" ] && [ "$DEPLOY_API_DIR" != "$RUNTIME_ROOT" ]; then
  echo "::error::DEPLOY_API_DIR override is forbidden in production releases" >&2
  exit 1
fi
if [ ! -x "$NODE_BIN" ] || ! "$NODE_BIN" --version | grep -Eq '^v22\.'; then
  echo "::error::approved Node 22 runtime is unavailable" >&2
  exit 1
fi

echo "=== 0. 校验源码位于目标提交 ==="
test "$(git -C "$DEPLOY_PATH" rev-parse HEAD)" = "$TARGET_SHA"

echo "=== 0b. 磁盘空间闸门（必须在任何写操作之前）==="
# 为什么放在这里：步骤 2 的 pg_dump 是本脚本第一次写盘。
# 2026-08-09 真实事故是备份把 40GB 根分区撑到 100%，此时正在运行的 API 与
# PostgreSQL 一并受影响。空间不足必须在**动任何东西之前**中止 ——
# 把「发布到一半盘满」变成「发布没启动」，后者无害。
#
# 2026-08-17 实测：ROOT_TOTAL_GB=40 / ROOT_USED_PCT=88 / 备份盘可用 5GB，
# 备份目录 4372MB（13 组，最老 46 天）——清理只在健康检查通过后跑，
# 而连续三天没有发布成功过，所以它一直没执行。
if [ ! -d "$BACKUP_ROOT" ] || [ -L "$BACKUP_ROOT" ]; then
  echo "::error::approved backup directory is missing or unsafe" >&2
  exit 1
fi
AVAIL_MB="$(df -Pm "$BACKUP_ROOT" 2>/dev/null | awk 'NR==2{print $4}')"
RUNTIME_ROOT_MB="$(du -sm "$RUNTIME_ROOT" 2>/dev/null | cut -f1)"
: "${AVAIL_MB:=0}" ; : "${RUNTIME_ROOT_MB:=1500}"
# 需要的空间 = 整个运行目录备份 + PG dump 冗余 + 安全边界。
NEED_MB=$(( RUNTIME_ROOT_MB + 1024 ))
MARGIN_MB="${DEPLOY_MIN_FREE_MARGIN_MB:-1024}"
case "$MARGIN_MB" in
  '' | *[!0-9]*) echo "::error::DEPLOY_MIN_FREE_MARGIN_MB must be a positive integer" >&2; exit 1 ;;
esac
if [ "$MARGIN_MB" -lt 1024 ]; then
  echo "::error::DEPLOY_MIN_FREE_MARGIN_MB must be at least 1024" >&2
  exit 1
fi
REQUIRED_MB=$(( NEED_MB + MARGIN_MB ))
echo "DISK_AVAIL_MB=$AVAIL_MB REQUIRED_MB=$REQUIRED_MB (runtime_root=${RUNTIME_ROOT_MB}MB + 1024 备份冗余 + ${MARGIN_MB} 安全边界)"
if [ "$AVAIL_MB" -lt "$REQUIRED_MB" ]; then
  echo "::error::磁盘空间不足，发布已中止 —— 未做任何修改（未备份、未迁移、未重启）。"
  echo "可用 ${AVAIL_MB}MB < 需要 ${REQUIRED_MB}MB。"
  echo "回收空间的常用手段（按收益排序，均可安全执行）："
  echo "  1) pnpm store prune            # 清未被引用的包缓存，2026-08-17 实测约占 2663MB"
  echo "  2) 手工清理 $BACKUP_ROOT 下较旧的备份组（保留最近 2-3 组即可）"
  echo "  3) journalctl --vacuum-size=100M"
  exit 1
fi
echo "磁盘空间充足，继续。"

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

rollback_api_release() {
  set +e
  echo "::warning::API release failed; restoring the previous runtime and PM2 process" >&2
  RUNTIME_BACKUP="$BACKUP_PREFIX.runtime" \
    OLD_SHA="$OLD_SHA" \
    TARGET_SHA="$TARGET_SHA" \
    CI_RUN="$CI_RUN" \
    RELEASE_ATTEMPT="$RELEASE_ATTEMPT" \
    DEPLOY_RESTORE_MARKER_FILE="$RUNTIME_ROOT/API_DEPLOY_SOURCE.txt" \
    DEPLOY_PM2_NAME="$PM2_NAME" \
    DEPLOY_HEALTH_URL="$HEALTH_URL" \
    DEPLOY_READY_URL="$READY_URL" \
    bash "$DEPLOY_PATH/.github/scripts/deploy-api-restore.sh" \
    || return 1
  echo "::warning::previous API runtime restored and ready; database migrations were not reversed" >&2
  return 0
}

cleanup_release_temps() {
  if [ -n "$ENV_TMP" ]; then
    rm -f -- "$ENV_TMP"
  fi
  if [ -n "$PROVENANCE_TMP" ]; then
    rm -f -- "$PROVENANCE_TMP"
  fi
}

finish_release() {
  status=$?
  trap - EXIT
  cleanup_release_temps
  if [ "$status" -ne 0 ] && [ "$rollback_armed" = true ]; then
    if ! rollback_api_release; then
      exit 1
    fi
  fi
  exit "$status"
}

handle_release_signal() {
  signal_code="$1"
  trap - HUP INT TERM
  exit "$signal_code"
}

trap finish_release EXIT
trap 'handle_release_signal 129' HUP
trap 'handle_release_signal 130' INT
trap 'handle_release_signal 143' TERM

rollback_armed=true

echo "=== 3b. 原子固化生产环境与 PII 扫描门禁（不打印 .env）==="
ENV_FILE="$API_DIR/.env"
ENV_TMP="$(mktemp "$API_DIR/.env.runtime.XXXXXX")"
awk '
  BEGIN { node_written = 0; pii_written = 0 }
  /^[[:space:]]*(export[[:space:]]+)?NODE_ENV[[:space:]]*=/ {
    if (!node_written) {
      print "NODE_ENV=production"
      node_written = 1
    }
    next
  }
  /^[[:space:]]*(export[[:space:]]+)?PRINT_REQUIRE_PII_SCAN[[:space:]]*=/ {
    if (!pii_written) {
      print "PRINT_REQUIRE_PII_SCAN=true"
      pii_written = 1
    }
    next
  }
  { print }
  END {
    if (!node_written) print "NODE_ENV=production"
    if (!pii_written) print "PRINT_REQUIRE_PII_SCAN=true"
  }
' "$ENV_FILE" > "$ENV_TMP"
chmod --reference="$ENV_FILE" "$ENV_TMP"
chown --reference="$ENV_FILE" "$ENV_TMP" 2>/dev/null || true
mv -f -- "$ENV_TMP" "$ENV_FILE"
ENV_TMP=""

echo "=== 4. 在目标提交内构建 API ==="
cd "$DEPLOY_PATH"
pnpm --filter @ai-job-print/api db:pg:generate
pnpm --filter @ai-job-print/api build

echo "=== 4a. 用真实生产 .env 执行启动门禁预检 ==="
cd "$DEPLOY_PATH/services/api"
DOTENV_CONFIG_PATH="$ENV_FILE" DOTENV_CONFIG_OVERRIDE=true \
  node -r dotenv/config -e \
  "require('./dist/config/production-runtime-gates').assertProductionRuntimeGates(process.env)"

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
  --exclude '/DEPLOY_SOURCE.txt' \
  --exclude '/API_DEPLOY_SOURCE.txt' \
  --exclude '/.DEPLOY_SOURCE.*' \
  --exclude '/.API_DEPLOY_SOURCE.*' \
  --exclude '/.STATIC_RELEASE_STATUS-*' \
  --exclude '/apps/*/.dist.*' \
  --exclude 'services/api/.env' \
  --exclude 'services/api/storage' \
  --exclude 'apps/kiosk/dist' \
  --exclude 'apps/admin/dist' \
  --exclude 'apps/partner/dist' \
  "$DEPLOY_PATH/" "$RUNTIME_ROOT/"

echo "=== 6. 收敛运行目录依赖并执行 additive 迁移 ==="
cd "$RUNTIME_ROOT"
pnpm install --frozen-lockfile
cd "$RUNTIME_ROOT/services/api"
pnpm db:pg:deploy

echo "=== 7. 准备待提交的 DEPLOY_SOURCE（静态三端完成前不覆盖当前生产事实）==="
PROVENANCE_PENDING="$RUNTIME_ROOT/.DEPLOY_SOURCE.pending-$TARGET_SHA-$RELEASE_ATTEMPT"
API_PROVENANCE_PENDING="$RUNTIME_ROOT/.API_DEPLOY_SOURCE.pending-$TARGET_SHA-$RELEASE_ATTEMPT"
PROVENANCE_TMP="$(mktemp "$RUNTIME_ROOT/.DEPLOY_SOURCE.building.XXXXXX")"
cat > "$PROVENANCE_TMP" <<EOF
source=origin/main@$TARGET_SHA
scope=api+kiosk+admin+partner
status=static-pending
deployed_at=$(date -Is)
ci_run=$CI_RUN
release_attempt=$RELEASE_ATTEMPT
backup=$BACKUP_PREFIX.dump
runtime_backup=$BACKUP_PREFIX.runtime
rollback=restore $BACKUP_PREFIX.runtime then if migration rollback required restore $BACKUP_PREFIX.dump
api_database=postgresql
EOF
chmod 0644 "$PROVENANCE_TMP"
mv -f -- "$PROVENANCE_TMP" "$PROVENANCE_PENDING"
PROVENANCE_TMP=""

cp -- "$PROVENANCE_PENDING" "$API_PROVENANCE_PENDING"
sed -i.bak 's/^scope=.*/scope=api/; s/^status=.*/status=api-pending/' "$API_PROVENANCE_PENDING"
rm -f -- "$API_PROVENANCE_PENDING.bak"

echo "=== 8. 显式生产环境重启 PM2 并校验实际环境 ==="
pm2 delete "$PM2_NAME"
env -i \
  HOME="$HOME" \
  PATH="$(dirname "$NODE_BIN"):/usr/local/bin:/usr/bin:/bin" \
  PM2_HOME="${PM2_HOME:-$HOME/.pm2}" \
  COMMIT="$TARGET_SHA" \
  NODE_ENV=production \
  PRINT_REQUIRE_PII_SCAN=true \
  pm2 start "$RUNTIME_ROOT/services/api/dist/main.js" \
    --name "$PM2_NAME" \
    --cwd "$RUNTIME_ROOT/services/api" \
    --interpreter "$NODE_BIN"
pm2 jlist | "$NODE_BIN" -e '
  let input = "";
  process.stdin.on("data", chunk => { input += chunk });
  process.stdin.on("end", () => {
    const [name, sha] = process.argv.slice(1);
    const processInfo = JSON.parse(input).find(item => item.name === name);
    if (!processInfo) throw new Error("PM2 process not found");
    const env = processInfo.pm2_env || {};
    if (env.status !== "online") throw new Error("PM2 process is not online");
    if (env.NODE_ENV !== "production") throw new Error("PM2 NODE_ENV is not production");
    if (String(env.PRINT_REQUIRE_PII_SCAN) !== "true") throw new Error("PM2 PII gate is not true");
    if (env.COMMIT !== sha) throw new Error("PM2 commit does not match target SHA");
    const forbidden = Object.keys(env).filter(key => /^(KIOSK_TERMINAL_AGENT_BRIDGE_TOKEN|DEPLOY_.+|TARGET_SHA|CI_RUN|API_RELEASE_ENABLED)$/.test(key));
    if (forbidden.length > 0) throw new Error("PM2 contains forbidden deployment environment keys");
    console.log("PM2_RUNTIME_ENV=verified");
  });
' "$PM2_NAME" "$TARGET_SHA"

for _ in $(seq 1 30); do
  if curl -fsS "$HEALTH_URL" 2>/dev/null | grep -q '"status":"ok"' &&
    curl -fsS "$READY_URL" 2>/dev/null | grep -q '"status":"ready"'; then
    echo "API health and readiness OK"
    sed -i.bak 's/^status=.*/status=api-ready-static-pending/' "$API_PROVENANCE_PENDING"
    rm -f -- "$API_PROVENANCE_PENDING.bak"
    mv -f -- "$API_PROVENANCE_PENDING" "$RUNTIME_ROOT/API_DEPLOY_SOURCE.txt"
    pm2 save
    chmod 0600 "${PM2_HOME:-$HOME/.pm2}/dump.pm2"
    rollback_armed=false
    echo "API release ready; full provenance remains pending until all static sites pass"
    exit 0
  fi
  sleep 2
done
echo "::error::API health/readiness check failed after restart" >&2
exit 1
