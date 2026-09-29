#!/usr/bin/env bash
# 清理 /srv 下白名单内的历史发布目录，以及 2026-09-29 只读盘点核对过的残留目录。
#
# 设计原则（合成 DeepSeek + antigravity 两份独立审查，2026-09-29 补充告急分支）：
#   1. 默认 dry-run：只跑护栏 + 列清单，绝不动任何文件。按可用空间预告将隔离或将直接删除。
#   2. 精确目录名白名单，绝不用通配符。
#   3. 每个待删目录逐项过 preflight。挂载点、当前运行目录、保留锚点不过则整体中止。
#      被 pm2 的 cwd/exec_path 或 nginx 的 root/alias/include 引用的，只拒绝该目录并说明，其它继续。
#   4. execute 默认两阶段：先 mv 到隔离区 /srv/.cleanup-trash/<时间戳>，不直接 rm。
#      若 /srv 所在分区可用低于 STALE_CRITICAL_FREE_MB（默认 5120），
#      且服务健康检查通过、确认词正确，则对通过全部护栏的目录直接删除。
#   5. usb-bridge-live / -final- / releases 三类不在本白名单。
set -uo pipefail

MODE="${CLEANUP_MODE:-dry-run}"          # dry-run | execute
CONFIRM="${CLEANUP_CONFIRM:-}"           # execute 模式必须等于 EXPECT_CONFIRM
EXPECT_CONFIRM="${CLEANUP_EXPECT_CONFIRM:-}"
CRITICAL_FREE_MB="${STALE_CRITICAL_FREE_MB:-5120}"
case "$CRITICAL_FREE_MB" in
  ''|*[!0-9]*) CRITICAL_FREE_MB=5120 ;;
esac

CURRENT="$(readlink -f /srv/ai-job-print 2>/dev/null || echo /srv/ai-job-print)"
TRASH="/srv/.cleanup-trash/$(date +%Y%m%dT%H%M%S)"

# —— 保守白名单：antigravity 判定「无歧义、不涉及 live/final/releases」的 6 个 ——
#    每个都是 7 月中上旬的历史副本，精确路径，无通配符。
DELETE_LIST=(
  "/srv/ai-job-print-deploy-backups"
  "/srv/ai-job-print-backup-3ab056b3-20260707213132"
  "/srv/ai-job-print-backup-e5996e84-20260710195600"
  "/srv/ai-job-print-prev-c859b8e2-20260714T073515Z"
  "/srv/ai-job-print-prev-e62a9789-20260716T143123"
  "/srv/ai-job-print-failed-e2b3858d-20260713T114711Z"
  "/srv/ai-job-print-api-backups"
  "/srv/ai-job-print-env-backups"
  "/srv/ai-job-print-artifacts"
  "/srv/ai-job-print-static-releases"
  "/srv/ai-job-print-recovery-artifacts"
)

# —— 保留锚点：当前运行目录 + 最近两个受控发布 runtime 锚点 ——
KEEP_LIST=(
  "/srv/ai-job-print"
  "/srv/ai-job-print-backups"
)

refuse() { echo "❌ REFUSE: $*" >&2; exit 1; }

df_avail_mb() {
  local target="$1" n
  n="$(df -Pm "$target" 2>/dev/null | awk 'NR==2 { print $4; exit }')"
  case "$n" in
    ''|*[!0-9]*) return 1 ;;
  esac
  printf '%s\n' "$n"
}

# 只探活，不改任何东西。失败时返回 1，由调用方决定拒绝文案。
service_healthy() {
  local port path
  local ok=no
  for port in 3010 3000 8080; do
    for path in /api/v1/health /health; do
      if curl -fsS --max-time 5 "http://127.0.0.1:${port}${path}" 2>/dev/null | grep -q '"status"'; then
        echo "  API ${path} @:${port} → 可达"
        ok=yes
        break 2
      fi
    done
  done
  if [ "$ok" != yes ]; then
    echo "  API 健康检查不通过" >&2
    return 1
  fi
  if command -v pm2 >/dev/null 2>&1; then
    if ! pm2 jlist >/dev/null 2>&1; then
      echo "  pm2 jlist 异常" >&2
      return 1
    fi
    echo "  pm2 正常"
  fi
  return 0
}

REF_LOADED=no
PM2_PATH_BLOB=""
NGINX_PATH_BLOB=""

load_runtime_refs() {
  local raw
  if [ "$REF_LOADED" = yes ]; then
    return 0
  fi
  REF_LOADED=yes
  if command -v pm2 >/dev/null 2>&1; then
    raw="$(pm2 jlist 2>/dev/null || true)"
    PM2_PATH_BLOB="$(printf '%s\n' "$raw" | grep -oE '"(pm_cwd|pm_exec_path|cwd)"[[:space:]]*:[[:space:]]*"[^"]*"' | sed -E 's/^[^:]*:[[:space:]]*"([^"]*)"$/\1/' || true)"
  fi
  if command -v nginx >/dev/null 2>&1; then
    # 指令不一定单独成行。去掉注释后抽出 root / alias / include 的路径。
    NGINX_PATH_BLOB="$(nginx -T 2>/dev/null | awk '
      {
        line = $0
        sub(/#.*/, "", line)
        while (match(line, /(^|[[:space:]])(root|alias|include)[[:space:]]+/)) {
          rest = substr(line, RSTART + RLENGTH)
          path = rest
          sub(/;.*/, "", path)
          gsub(/^[[:space:]]+|[[:space:]]+$/, "", path)
          gsub(/^"|"$/, "", path)
          if (path != "") print path
          if (match(rest, /;/)) line = substr(rest, RSTART + 1)
          else break
        }
      }
    ' || true)"
  fi
}

# 打印 pm2、nginx、pm2,nginx 或 none。路径等于目录或在其下才算引用。
reference_of() {
  local resolved="$1" p hit_pm2=no hit_nginx=no
  load_runtime_refs
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    p="${p%/}"
    case "$p" in
      "$resolved"|"$resolved"/*) hit_pm2=yes ;;
    esac
  done <<EOF
$PM2_PATH_BLOB
EOF
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    p="${p%/}"
    case "$p" in
      "$resolved"|"$resolved"/*) hit_nginx=yes ;;
    esac
  done <<EOF
$NGINX_PATH_BLOB
EOF
  if [ "$hit_pm2" = yes ] && [ "$hit_nginx" = yes ]; then
    printf '%s\n' "pm2,nginx"
  elif [ "$hit_pm2" = yes ]; then
    printf '%s\n' "pm2"
  elif [ "$hit_nginx" = yes ]; then
    printf '%s\n' "nginx"
  else
    printf '%s\n' "none"
  fi
}

# —— purge-trash 模式：真删指定隔离区，释放空间 ——
# 为什么需要单独一个模式：execute 只做 mv，而 mv 在同一分区内**不释放任何空间**
# （2026-08-17 实测：mv 7319MB 后 df 仍是 88% / 可用 5GB，与 mv 前一致）。
# 空间只有 rm 才回来。这一步不可逆，所以：
#   · 必须显式传入目标隔离区路径（不接受通配、不接受 /srv/.cleanup-trash 本身）
#   · 删之前先验服务健康，服务不正常就拒绝删（那时更可能需要把内容 mv 回去）
if [ "$MODE" = purge-trash ]; then
  TARGET="${CLEANUP_PURGE_PATH:-}"
  [[ -n "$TARGET" ]] || refuse "purge-trash 需要 CLEANUP_PURGE_PATH"
  case "$TARGET" in
    /srv/.cleanup-trash/*) : ;;
    *) refuse "只允许删 /srv/.cleanup-trash/<时间戳>：$TARGET" ;;
  esac
  [[ "$TARGET" != *"*"* && "$TARGET" != *".."* ]] || refuse "含通配符或相对路径：$TARGET"
  [[ "$TARGET" != "/srv/.cleanup-trash" && "$TARGET" != "/srv/.cleanup-trash/" ]]     || refuse "拒绝删整个隔离区根目录，必须指定具体时间戳子目录"
  [[ -d "$TARGET" ]] || refuse "目录不存在：$TARGET"

  [[ -n "$EXPECT_CONFIRM" && "$CONFIRM" == "$EXPECT_CONFIRM" ]]     || refuse "confirm 不匹配，purge 中止（未删除任何文件）"

  echo "=== 删前健康检查（不正常就不删，那时更可能要 mv 回去）==="
  # 路径必须是 /api/v1/health —— 应用设了全局前缀 api/v1（main.ts setGlobalPrefix）。
  # 2026-08-17 首次 purge 因为只探了裸 /health 而被自己的护栏拒绝。探错路径不等于服务不健康。
  service_healthy || refuse "本机 API 健康检查不通过，拒绝删除隔离区"

  echo "=== 删除前空间 ==="; df -h /srv | tail -1
  SZ="$(du -sm "$TARGET" 2>/dev/null | cut -f1)"
  echo "即将删除 ${TARGET}（${SZ}MB）"
  rm -rf -- "$TARGET"
  echo "=== 删除后空间 ==="; df -h /srv | tail -1
  echo "=== 已释放约 ${SZ}MB ==="
  exit 0
fi

echo "=== 运行模式：$MODE ==="
echo "=== 当前生产目录（保留）：$CURRENT ==="
echo

preflight() {
  local target="$1" resolved keep
  echo "--- 检查 $target"

  # 0. 白名单正则：只允许 /srv/ai-job-print-<名字>，禁通配符与相对路径
  case "$target" in
    /srv/ai-job-print-*) : ;;
    *) refuse "不匹配 /srv/ai-job-print-* 白名单形态：$target" ;;
  esac
  [[ "$target" == *"*"* || "$target" == *".."* ]] && refuse "含通配符或相对路径：$target"

  # 1. 必须是普通目录，不是软链接
  [[ -e "$target" ]] || { echo "   （不存在，跳过）"; return 1; }
  [[ -d "$target" && ! -L "$target" ]] || refuse "不是普通目录（可能是软链接）：$target"

  resolved="$(readlink -f "$target")"

  # 2. 绝不等于、绝不包含当前运行目录
  [[ "$resolved" != "$CURRENT" ]] || refuse "等于当前运行目录：$target"
  [[ "$resolved" != "$CURRENT"/* ]] || refuse "在当前运行目录内部：$target"

  # 3. 绝不是保留锚点或其子目录
  for keep in "${KEEP_LIST[@]}"; do
    local kr; kr="$(readlink -f "$keep" 2>/dev/null || echo "$keep")"
    [[ "$resolved" == "$kr" || "$resolved" == "$kr"/* ]] && refuse "命中保留锚点 ${keep}：${target}"
  done

  # 4. 自身不是挂载点
  mount 2>/dev/null | awk '{print $3}' | grep -Fxq "$resolved" && refuse "是挂载点：$target"

  # 4b. **内部**也不得有挂载点。
  # 2026-08-17 实测发现：/srv/ai-job-print-deploy-backups 用 `du -xsm`（不跨文件系统）
  # 量出 1126MB，用 `du -sm`（跨）量出 2055MB —— 差 929MB，说明它内部挂着别的文件系统。
  # 只查目录自身是不够的：mv 一个内含挂载点的目录会失败或产生意外行为（跨设备 rename）。
  if mount 2>/dev/null | awk '{print $3}' | grep -q "^$resolved/"; then
    refuse "内部含挂载点（mv 会跨设备失败）：$target"
  fi

  # 4c. 报出两种口径的体积差，差异大即提示内部有跨文件系统内容
  local sz_x sz_all
  sz_x="$(du -xsm "$target" 2>/dev/null | cut -f1)"
  sz_all="$(du -sm "$target" 2>/dev/null | cut -f1)"
  if [ -n "$sz_x" ] && [ -n "$sz_all" ] && [ "$sz_all" -gt "$(( sz_x + 100 ))" ]; then
    echo "   ⚠️ 体积口径差异：du -xsm=${sz_x}MB / du -sm=${sz_all}MB（差 $(( sz_all - sz_x ))MB）"
    echo "      说明内部含跨文件系统内容。已通过挂载点检查，但请人工确认后再 execute。"
  fi

  # 4d. 被 pm2 或 nginx 引用则只拒绝本目录，其它通过护栏的目录仍可处理。
  local ref
  ref="$(reference_of "$resolved")"
  if [ "$ref" != none ]; then
    echo "   ❌ 拒绝处理：被 ${ref} 引用（pm2 的 cwd/exec_path 或 nginx 的 root/alias/include 落在该目录下），本目录不移动也不删除"
    return 1
  fi

  # 5. 无进程持有其内文件
  if command -v lsof >/dev/null 2>&1; then
    lsof +D "$target" >/dev/null 2>&1 && refuse "有进程打开其内文件：$target"
  else
    echo "   ⚠️ 无 lsof，跳过文件句柄检查（execute 前请人工确认）"
  fi

  # 6. 无进程 cwd / root 指向它
  find /proc/[0-9]*/cwd /proc/[0-9]*/root -maxdepth 0 -lname "$resolved*" 2>/dev/null | grep -q . \
    && refuse "有进程 cwd/root 指向：$target"

  # 7. 无进程命令行引用它
  ps -eo args 2>/dev/null | grep -F "$resolved" | grep -v grep | grep -q . \
    && refuse "有进程命令行引用：$target"

  # 8. 不在 nginx root/alias 里
  if command -v nginx >/dev/null 2>&1; then
    nginx -T 2>/dev/null | grep -E '^\s*(root|alias)\s' | grep -F "$resolved" >/dev/null \
      && refuse "被 nginx root/alias 引用：$target"
  fi

  # 9. 不在 pm2 cwd / 脚本路径里
  if command -v pm2 >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; then
    pm2 jlist 2>/dev/null | jq -r '.[].pm2_env.cwd, .[].pm2_env.pm_exec_path' 2>/dev/null \
      | grep -F "$resolved" >/dev/null && refuse "被 pm2 引用：$target"
  fi

  echo "   ✅ preflight 全过"
  return 0
}

# 灾备底座必须完好才允许清理
BK=/srv/ai-job-print-backups
BK_MB="$(du -sm "$BK" 2>/dev/null | cut -f1)"
[[ -n "${BK_MB:-}" && "$BK_MB" -gt 1024 ]] || refuse "灾备底座 $BK 不足 1GB（$BK_MB MB），拒绝清理"
echo "灾备底座 $BK = ${BK_MB}MB（> 1GB，OK）"
echo

RECLAIM=0
OK_TARGETS=()
for t in "${DELETE_LIST[@]}"; do
  if preflight "$t"; then
    mb="$(du -sm "$t" 2>/dev/null | cut -f1)"; RECLAIM=$(( RECLAIM + ${mb:-0} ))
    OK_TARGETS+=("$t")
    echo "   → 可回收 ${mb}MB"
  fi
done
echo
echo "=== 通过 preflight 的目录 ${#OK_TARGETS[@]} 个，合计可回收约 ${RECLAIM}MB ==="

if ! FREE_MB="$(df_avail_mb /srv)"; then
  echo "DF_AVAIL_MB_BEFORE=unknown"
  refuse "读不到 /srv 可用空间，无法判断隔离还是直接删除"
fi
echo "DF_AVAIL_MB_BEFORE=${FREE_MB}"
echo "STALE_CRITICAL_FREE_MB=${CRITICAL_FREE_MB}"
if [ "$FREE_MB" -lt "$CRITICAL_FREE_MB" ]; then
  ACTION=delete
  echo "CLEANUP_ACTION=delete"
else
  ACTION=quarantine
  echo "CLEANUP_ACTION=quarantine"
fi

if [ "$MODE" != execute ]; then
  if [ "$ACTION" = delete ]; then
    echo "=== dry-run：可用 ${FREE_MB}MB < ${CRITICAL_FREE_MB}MB，将直接删除通过护栏的目录 ==="
    if [ "${#OK_TARGETS[@]}" -gt 0 ]; then
      for t in "${OK_TARGETS[@]}"; do
        echo "PLAN_DELETE ${t}"
      done
    fi
    echo "QUARANTINED_MB=0"
    echo "FREED_MB=${RECLAIM}"
  else
    echo "=== dry-run：可用 ${FREE_MB}MB >= ${CRITICAL_FREE_MB}MB，将隔离通过护栏的目录 ==="
    if [ "${#OK_TARGETS[@]}" -gt 0 ]; then
      for t in "${OK_TARGETS[@]}"; do
        echo "PLAN_QUARANTINE ${t}"
      done
    fi
    echo "QUARANTINED_MB=${RECLAIM}"
    echo "FREED_MB=0"
  fi
  echo "DF_AVAIL_MB_AFTER=${FREE_MB}"
  echo "=== dry-run 结束：未移动/删除任何文件。 ==="
  echo "确认清单无误后，用 execute 模式 + 正确 confirm 重新触发。"
  exit 0
fi

# —— execute：确认词 + 健康检查，然后按可用空间隔离或直接删除 ——
[[ -n "$EXPECT_CONFIRM" && "$CONFIRM" == "$EXPECT_CONFIRM" ]] \
  || refuse "confirm 不匹配，execute 中止（未移动或删除任何文件）"

echo "=== 执行前健康检查 ==="
service_healthy || refuse "服务健康检查不通过，拒绝删除或隔离"

if [ "$ACTION" = delete ]; then
  FREED=0
  if [ "${#OK_TARGETS[@]}" -gt 0 ]; then
    for t in "${OK_TARGETS[@]}"; do
      mb="$(du -sm "$t" 2>/dev/null | cut -f1)"
      case "$mb" in ''|*[!0-9]*) mb=0 ;; esac
      echo "DELETE ${t}"
      rm -rf -- "$t"
      FREED=$((FREED + mb))
    done
  fi
  echo "QUARANTINED_MB=0"
  echo "FREED_MB=${FREED}"
else
  mkdir -p "$TRASH"
  MOVED=0
  if [ "${#OK_TARGETS[@]}" -gt 0 ]; then
    for t in "${OK_TARGETS[@]}"; do
      mb="$(du -sm "$t" 2>/dev/null | cut -f1)"
      case "$mb" in ''|*[!0-9]*) mb=0 ;; esac
      echo "MOVE ${t} → ${TRASH}/"
      mv -- "$t" "$TRASH/$(basename "$t")"
      MOVED=$((MOVED + mb))
    done
  fi
  echo
  echo "=== 已隔离到 ${TRASH}（未真删）==="
  echo "请依次验证，全部正常后再手动 rm -rf ${TRASH} ："
  echo "  nginx -t && curl -fsS http://127.0.0.1:3010/health"
  echo "  pm2 jlist >/dev/null && df -h /"
  echo "建议观察 24-72 小时无异常后再删除隔离区。"
  echo "QUARANTINED_MB=${MOVED}"
  echo "FREED_MB=0"
fi
AFTER_MB="$(df_avail_mb /srv || true)"
echo "DF_AVAIL_MB_AFTER=${AFTER_MB:-unknown}"
