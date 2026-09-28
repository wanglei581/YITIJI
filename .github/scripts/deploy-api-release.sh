#!/usr/bin/env bash
# 受控 API 发布脚本（服务器端执行，仅由 .github/workflows/deploy.yml 调用）。
#
# 硬约束：
# - 仅在 API_RELEASE_ENABLED=true 时执行（发布授权闸门）。
# - 不打印任何密钥/连接串；运行目录备份建好后任何一步失败，都把运行目录就地恢复到发布前备份
#   （已重启过新版本时再重启回旧版），保留全部备份；数据库迁移不回退（迁移只做 additive）。
# - 遵循仓库“同一目标提交整体切换、迁移前备份并校验、additive migrate deploy”规则。
set -Eeuo pipefail

if [ "${API_RELEASE_ENABLED:-}" != "true" ]; then
  echo "::error::API release skipped because API_RELEASE_ENABLED != true" >&2
  exit 1
fi

: "${TARGET_SHA:?TARGET_SHA is required}"
: "${CI_RUN:?CI_RUN is required}"
: "${DEPLOY_PATH:?DEPLOY_PATH is required}"
: "${DEPLOY_SCOPE:?DEPLOY_SCOPE is required}"
: "${CONTROL_PLANE_DEPLOY_HELPER_SHA256:?CONTROL_PLANE_DEPLOY_HELPER_SHA256 is required}"

case "$DEPLOY_SCOPE" in
  api-only | full) ;;
  *)
    echo "::error::invalid DEPLOY_SCOPE: $DEPLOY_SCOPE" >&2
    exit 1
    ;;
esac

if [ "${PRINT_REQUIRE_PII_SCAN:-}" != "true" ]; then
  echo "::error::PRINT_REQUIRE_PII_SCAN must be explicitly true before production release" >&2
  exit 1
fi

RUNTIME_ROOT="${DEPLOY_API_DIR:-/srv/ai-job-print}"
PM2_NAME="${DEPLOY_PM2_NAME:-ai-job-print-api}"
BACKUP_ROOT="${DEPLOY_BACKUP_ROOT:-/srv/ai-job-print-backups}"
HEALTH_URL="${DEPLOY_HEALTH_URL:-http://127.0.0.1:3010/api/v1/health/ready}"
HEALTH_ATTEMPTS="${DEPLOY_HEALTH_ATTEMPTS:-30}"
HEALTH_DELAY_SECONDS="${DEPLOY_HEALTH_DELAY_SECONDS:-2}"

API_DIR="$RUNTIME_ROOT/services/api"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_PREFIX="$BACKUP_ROOT/pre-$TARGET_SHA-$TS"

# 这里的键必须与目标提交 services/api/src/config/production-runtime-gates.ts 里
# NODE_ENV=production 时 fail-closed 要求显式为 true 的 env 一一对应。
# 0a 先确认目标至少认识控制面将持久化的每个键；3c 再用目标构建产物拦截目标额外要求、
# 但控制面尚未认识的键。两边都必须在备份、迁移和运行目录写入之前失败。
REQUIRED_PRODUCTION_GATES=(
  PRINT_REQUIRE_PII_SCAN
  PRINT_REQUIRE_PRINTER_ONLINE
)

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
# · 每次发布产生 <prefix>.dump、<prefix>.runtime 与 <prefix>.migrations.log，按 prefix 归组，
#   不拆开算（迁移日志若单算一组，会占掉保留名额，把上一次发布的备份挤出去删掉）。
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
    | sed -E 's/\.(dump|runtime|migrations\.log)$//' \
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
    rm -rf -- "$BACKUP_ROOT/$stem.dump" "$BACKUP_ROOT/$stem.runtime" "$BACKUP_ROOT/$stem.migrations.log" 2>/dev/null || true
  done

  echo "清理完成，备份目录当前占用 $(du -sm "$BACKUP_ROOT" 2>/dev/null | cut -f1)MB"
}

echo "=== 0. 校验源码位于目标提交 ==="
test "$(git -C "$DEPLOY_PATH" rev-parse HEAD)" = "$TARGET_SHA"

echo "=== 0a. 控制面生产闸门必须被目标提交认识 ==="
TARGET_GATES_SOURCE="$DEPLOY_PATH/services/api/src/config/production-runtime-gates.ts"
test -f "$TARGET_GATES_SOURCE"
MISSING_TARGET_GATES=""
for GATE_KEY in "${REQUIRED_PRODUCTION_GATES[@]}"; do
  if ! grep -Eq "(^|[^A-Z_])${GATE_KEY}([^A-Z_]|$)" "$TARGET_GATES_SOURCE"; then
    MISSING_TARGET_GATES="$MISSING_TARGET_GATES $GATE_KEY"
  fi
done
if [ -n "$MISSING_TARGET_GATES" ]; then
  echo "::error::目标提交不认识控制面要求的生产闸门键：$MISSING_TARGET_GATES" >&2
  exit 1
fi

echo "=== 0b. 磁盘空间闸门（必须在任何写操作之前）==="
# 为什么放在这里：步骤 2 的 pg_dump 是本脚本第一次写盘。
# 2026-08-09 真实事故是备份把 40GB 根分区撑到 100%，此时正在运行的 API 与
# PostgreSQL 一并受影响。空间不足必须在**动任何东西之前**中止 ——
# 把「发布到一半盘满」变成「发布没启动」，后者无害。
#
# 2026-08-17 实测：ROOT_TOTAL_GB=40 / ROOT_USED_PCT=88 / 备份盘可用 5GB，
# 备份目录 4372MB（13 组，最老 46 天）——清理只在健康检查通过后跑，
# 而连续三天没有发布成功过，所以它一直没执行。
mkdir -p "$BACKUP_ROOT"
AVAIL_MB="$(df -Pm "$BACKUP_ROOT" 2>/dev/null | awk 'NR==2{print $4}')"
API_DIR_MB="$(du -sm "$API_DIR" 2>/dev/null | cut -f1)"
: "${AVAIL_MB:=0}" ; : "${API_DIR_MB:=1500}"
# 需要的空间 = 整目录备份 + PG dump（压缩后远小于目录，按目录量级留冗余）+ 1GB 安全边界
NEED_MB=$(( API_DIR_MB + 1024 ))
MARGIN_MB="${DEPLOY_MIN_FREE_MARGIN_MB:-1024}"
REQUIRED_MB=$(( NEED_MB + MARGIN_MB ))
echo "DISK_AVAIL_MB=$AVAIL_MB REQUIRED_MB=$REQUIRED_MB (api_dir=${API_DIR_MB}MB + 1024 备份冗余 + ${MARGIN_MB} 安全边界)"
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

# 2026-09-06 实测：#790 加了 PRINT_REQUIRE_PRINTER_ONLINE 闸门，这里没跟着加，
# 结果 35af2263b 发布走完全部步骤后健康检查失败，pm2 崩溃循环 17 次，线上 API
# 中断到手工补 .env 为止。verify:deploy-gates-in-sync 门禁现在会在 CI 里对这张
# 清单和 production-runtime-gates.ts 做集合比对，两边不一致直接红。

echo "=== 1b. 在源码检出内构建 API（不写运行目录，供 3c 预检使用目标提交闸门）==="
# 只写 DEPLOY_PATH（git 检出），不碰 RUNTIME_ROOT。失败时线上未动。
cd "$DEPLOY_PATH"
pnpm install --frozen-lockfile
pnpm --filter @ai-job-print/api db:pg:generate
pnpm --filter @ai-job-print/api build

echo "=== 3c. 生产运行闸门预检（目标提交代码 × 服务器真实 .env）==="
# 用刚构建的 dist/config/production-runtime-gates.js 对运行目录真实 .env
# 做启动闸门预检，并叠加 3b 将写入的 KEY=true。失败必须在 pg_dump 之前中止。
if ! node services/api/scripts/preflight-production-gates.mjs \
  --env-file "$API_DIR/.env" \
  --force-true "$(IFS=,; echo "${REQUIRED_PRODUCTION_GATES[*]}")"; then
  echo "::error::生产闸门预检失败，发布在备份前中止（线上未动）"
  exit 1
fi

echo "=== 2. PostgreSQL 全库备份 + 可读校验 ==="
mkdir -p "$BACKUP_ROOT"
pg_dump "$DBURL" -Fc -f "$BACKUP_PREFIX.dump"
pg_restore -l "$BACKUP_PREFIX.dump" >/dev/null

echo "=== 3. 备份当前运行目录（回滚锚点）==="
cp -a "$RUNTIME_ROOT" "$BACKUP_PREFIX.runtime"

# ── 从这里起任何一步失败，都把运行目录恢复到上面的备份 ──────────────────────
# 3b 改 .env、5 同步代码、6 装依赖与迁移、7 重启：哪一步失败，运行目录都已不是发布前的样子。
# 恢复只动运行目录：不回退数据库（迁移只做 additive，旧代码忽略新增列），也不动
# services/api/storage（发布期间用户新传的文件要留着）。PM2 只在「已经重启过新版本」时
# 才需要再重启回旧版；在那之前线上进程本来就还是旧代码。
PM2_RESTARTED=false
MIGRATION_LOG="$BACKUP_PREFIX.migrations.log"

check_ready() {
  curl -fsS "$HEALTH_URL" 2>/dev/null \
    | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ready"'
}

restore_runtime_and_exit() {
  local reason="$1" rollback_version ok=false
  trap - ERR
  set +e
  echo "::error::${reason}；开始把运行目录恢复到发布前备份（数据库迁移不回退）。" >&2
  if [ ! -d "$BACKUP_PREFIX.runtime" ]; then
    echo "::error::找不到回退运行目录：$BACKUP_PREFIX.runtime，请人工处理" >&2
    exit 1
  fi
  # 就地 rsync，而不是先删再拷：恢复中途失败也不会出现「运行目录整个不见了」的窗口。
  if ! rsync -a --delete --exclude 'services/api/storage' "$BACKUP_PREFIX.runtime/" "$RUNTIME_ROOT/"; then
    echo "::error::运行目录恢复失败，备份仍在 $BACKUP_PREFIX.runtime，请人工恢复" >&2
    exit 1
  fi
  rollback_version="$(sed -n 's/^source=origin\/main@//p' "$RUNTIME_ROOT/DEPLOY_SOURCE.txt" 2>/dev/null | head -n1)"
  rollback_version="${rollback_version:-发布前备份}"
  if [ -f "$MIGRATION_LOG" ]; then
    echo "本次迁移记录保留在 $MIGRATION_LOG；数据库不回退，请人工判断迁移影响。" >&2
  fi
  if [ "$PM2_RESTARTED" = true ]; then
    export COMMIT="$rollback_version"
    pm2 restart "$PM2_NAME" --update-env
    for _ in $(seq 1 "$HEALTH_ATTEMPTS"); do
      if check_ready; then ok=true; break; fi
      sleep "$HEALTH_DELAY_SECONDS"
    done
    if [ "$ok" = true ]; then
      echo "已回退到 $rollback_version，回退后的就绪检查通过；本次发布仍记为失败。" >&2
    else
      echo "::error::已回退到 $rollback_version，但回退后的就绪检查仍失败，请人工处理。" >&2
    fi
  else
    echo "线上进程尚未重启，仍在运行发布前的版本；运行目录已恢复一致。" >&2
  fi
  exit 1
}
trap 'restore_runtime_and_exit "发布在第 $LINENO 行失败"' ERR

echo "=== 3b. 持久化全部生产运行闸门（不打印 .env）==="
# 键清单见上方 REQUIRED_PRODUCTION_GATES（3c 预检已按同一数组 --force-true）。
# 此处才写运行目录 .env：必须在步骤 3 回滚锚点之后、迁移之前。
ENV_FILE="$API_DIR/.env"
for GATE_KEY in "${REQUIRED_PRODUCTION_GATES[@]}"; do
  ENV_TMP="$(mktemp "$API_DIR/.env.runtime.XXXXXX")"
  cleanup_env_tmp() {
    rm -f -- "$ENV_TMP"
  }
  trap cleanup_env_tmp EXIT
  awk -v key="$GATE_KEY" '
    BEGIN { written = 0 }
    $0 ~ ("^[[:space:]]*(export[[:space:]]+)?" key "[[:space:]]*=") {
      if (!written) {
        print key "=true"
        written = 1
      }
      next
    }
    { print }
    END {
      if (!written) print key "=true"
    }
  ' "$ENV_FILE" > "$ENV_TMP"
  chmod --reference="$ENV_FILE" "$ENV_TMP"
  chown --reference="$ENV_FILE" "$ENV_TMP" 2>/dev/null || true
  mv -f -- "$ENV_TMP" "$ENV_FILE"
  trap - EXIT
  echo "  已持久化 $GATE_KEY=true"
done

echo "=== 4. 在目标提交内构建 API ==="
# 构建已在备份前（1b）完成，供 3c 加载目标提交 dist。此处确认产物仍在；
# 若缺失则补构建，不把「API 未构建」漏到 rsync。
cd "$DEPLOY_PATH"
if [ ! -f "$DEPLOY_PATH/services/api/dist/config/production-runtime-gates.js" ]; then
  pnpm --filter @ai-job-print/api db:pg:generate
  pnpm --filter @ai-job-print/api build
fi
test -f "$DEPLOY_PATH/services/api/dist/config/production-runtime-gates.js"

if [ "$DEPLOY_SCOPE" = "full" ]; then
  echo "=== 4b. 校验三端前端 dist 均已构建（防止 rsync --delete 误删运行目录）==="
  for app in kiosk admin partner; do
    if [ ! -f "$DEPLOY_PATH/apps/$app/dist/index.html" ]; then
      echo "::error::missing $DEPLOY_PATH/apps/$app/dist/index.html; build all frontends before release" >&2
      exit 1
    fi
  done
else
  echo "=== 4b. API-only：跳过三端前端 dist 校验 ==="
fi

echo "=== 5. 同步运行目录（保留 .env / storage）==="
RSYNC_EXCLUDES=(
  --exclude '.git'
  --exclude '.claude'
  --exclude '.ccg'
  --exclude 'node_modules'
  --exclude '.env.local'
  --exclude '.env.production'
  --exclude '.env.development'
  --exclude 'services/api/.env'
  --exclude 'services/api/storage'
)
if [ "$DEPLOY_SCOPE" = "api-only" ]; then
  # --delete 会删除 source 中不存在的 receiver 文件。API-only 不构建前端，
  # 因此必须保护运行目录已有 dist，避免 API 发布改变任何前端产物副本。
  RSYNC_EXCLUDES+=(
    --exclude 'apps/kiosk/dist'
    --exclude 'apps/admin/dist'
    --exclude 'apps/partner/dist'
  )
fi
rsync -a --delete \
  "${RSYNC_EXCLUDES[@]}" \
  "$DEPLOY_PATH/" "$RUNTIME_ROOT/"

echo "=== 6. 收敛运行目录依赖并执行 additive 迁移 ==="
cd "$RUNTIME_ROOT"
pnpm install --frozen-lockfile
cd "$RUNTIME_ROOT/services/api"
echo "本次执行的 PostgreSQL 迁移（数据库不回退，供人工判断）：" | tee "$MIGRATION_LOG"
pnpm db:pg:deploy 2>&1 | tee -a "$MIGRATION_LOG"

echo "=== 7. 重启 PM2 并就绪检查（$HEALTH_URL） ==="
# 先置位再重启：pm2 restart 本身失败时进程状态不确定，恢复后要按「已重启过」处理
PM2_RESTARTED=true
export COMMIT="$TARGET_SHA"
export PRINT_REQUIRE_PRINTER_ONLINE=true
export PRINT_REQUIRE_PII_SCAN=true
pm2 restart "$PM2_NAME" --update-env
for _ in $(seq 1 "$HEALTH_ATTEMPTS"); do
  if check_ready; then
    echo "API readiness OK: $HEALTH_URL"
    # 新版本已就绪：之后写发布指针或清理备份失败都只告警，不能把一个健康的版本回退掉。
    trap - ERR
    echo "=== 8. 写 DEPLOY_SOURCE（就绪检查通过后，不含秘密） ==="
    cat > "$RUNTIME_ROOT/DEPLOY_SOURCE.txt" <<EOF || echo "::warning::DEPLOY_SOURCE.txt 写入失败（本次发布已成功），请人工补写"
source=origin/main@$TARGET_SHA
deployed_at=$(date -Is)
ci_run=$CI_RUN
control_plane_helper_sha256=$CONTROL_PLANE_DEPLOY_HELPER_SHA256
backup=$BACKUP_PREFIX.dump
runtime_backup=$BACKUP_PREFIX.runtime
migrations=$MIGRATION_LOG
rollback=restore $BACKUP_PREFIX.runtime; database migrations are not rolled back
api_database=postgresql
EOF
    echo "=== 9. 发布成功，清理历史备份 ==="
    # 清理失败不影响本次发布结果（发布已经成功），只记 warning。
    prune_old_backups || echo "::warning::备份清理失败，已跳过（不影响本次发布）"
    exit 0
  fi
  sleep "$HEALTH_DELAY_SECONDS"
done
restore_runtime_and_exit "API 就绪检查在 $HEALTH_ATTEMPTS 次内没有通过"
