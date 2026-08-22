#!/usr/bin/env bash
# 清理 /srv 下 7 月手动部署时代遗留的历史发布目录。
#
# 设计原则（合成 DeepSeek + antigravity 两份独立审查）：
#   1. 默认 dry-run：只跑护栏 + 列清单，绝不动任何文件。
#   2. 精确目录名白名单，**绝不用通配符** —— 一个 rm -rf /srv/ai-job-print-* 就是灾难。
#   3. 每个待删目录逐项过 preflight：不是当前运行目录、不是软链接目标、无进程持有、
#      不在 nginx/pm2 引用里、不是挂载点。任一不过即整体中止。
#   4. execute 用两阶段：先 mv 到隔离区 /srv/.cleanup-trash/<时间戳>，
#      **不直接 rm** —— 误判也能立刻恢复。真删由人在观察窗口后手动执行。
#   5. usb-bridge-live / -final- / releases 三类**不在**本白名单，进第二批人工确认。
set -euo pipefail

MODE="${CLEANUP_MODE:-dry-run}"          # dry-run | execute
CONFIRM="${CLEANUP_CONFIRM:-}"           # execute 模式必须等于 EXPECT_CONFIRM
EXPECT_CONFIRM="${CLEANUP_EXPECT_CONFIRM:-}"

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
)

# —— 保留锚点：当前运行目录 + 最近两个受控发布 runtime 锚点 ——
KEEP_LIST=(
  "/srv/ai-job-print"
  "/srv/ai-job-print-backups"
)

refuse() { echo "❌ REFUSE: $*" >&2; exit 1; }

# —— purge-trash 模式：真删指定隔离区，释放空间 ——
# 为什么需要单独一个模式：execute 只做 mv，而 mv 在同一分区内**不释放任何空间**
# （2026-08-17 实测：mv 7319MB 后 df 仍是 88% / 可用 5GB，与 mv 前一致）。
# 空间只有 rm 才回来。这一步不可逆，所以：
#   · 必须显式传入目标隔离区路径（不接受通配、不接受 /srv/.cleanup-trash 本身）
#   · 删之前先验服务健康，服务不正常就拒绝删（那时更可能需要把内容 mv 回去）
if [ "$MODE" = purge-trash ]; then
  TARGET="${CLEANUP_PURGE_PATH:-}"
  [[ -n "$TARGET" ]] || refuse "purge-trash 需要 CLEANUP_PURGE_PATH"
  [[ "$TARGET" =~ ^/srv/\.cleanup-trash/[0-9]{8}T[0-9]{6}$ ]] \
    || refuse "只允许删 /srv/.cleanup-trash/YYYYMMDDTHHMMSS"
  [[ -d "$TARGET" ]] || refuse "目录不存在：$TARGET"

  [[ -n "$EXPECT_CONFIRM" && "$CONFIRM" == "$EXPECT_CONFIRM" ]]     || refuse "confirm 不匹配，purge 中止（未删除任何文件）"

  echo "=== 删前健康检查（不正常就不删，那时更可能要 mv 回去）==="
  HEALTH_OK=no
  # 路径必须是 /api/v1/health —— 应用设了全局前缀 api/v1（main.ts setGlobalPrefix）。
  # 2026-08-17 首次 purge 因为只探了裸 /health 而被自己的护栏拒绝，
  # 当时公网 https://zyidai.cn/api/v1/health 明明是 ok 的。探错路径 ≠ 服务不健康。
  for port in 3010 3000 8080; do
    for path in /api/v1/health /health; do
      if curl -fsS --max-time 5 "http://127.0.0.1:$port$path" 2>/dev/null | grep -q '"status"'; then
        echo "  API $path @:$port → 可达"; HEALTH_OK=yes; break 2
      fi
    done
  done
  [[ "$HEALTH_OK" == yes ]] || refuse "本机 API 健康检查不通过，拒绝删除隔离区"
  if command -v pm2 >/dev/null 2>&1; then
    pm2 jlist >/dev/null 2>&1 || refuse "pm2 jlist 异常，拒绝删除隔离区"
    echo "  pm2 正常"
  fi

  echo "=== 删除前空间 ==="; df -h /srv | tail -1
  SZ="$(du -sm "$TARGET" 2>/dev/null | cut -f1)"
  echo "即将删除 $TARGET（${SZ}MB）"
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
    [[ "$resolved" == "$kr" || "$resolved" == "$kr"/* ]] && refuse "命中保留锚点 $keep：$target"
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

if [[ "$MODE" != execute ]]; then
  echo "=== dry-run 结束：未移动/删除任何文件。 ==="
  echo "确认清单无误后，用 execute 模式 + 正确 confirm 重新触发。"
  exit 0
fi

# —— execute：confirm 门 + 两阶段 mv ——
[[ -n "$EXPECT_CONFIRM" && "$CONFIRM" == "$EXPECT_CONFIRM" ]] \
  || refuse "confirm 不匹配，execute 中止（未移动任何文件）"

mkdir -p "$TRASH"
for t in "${OK_TARGETS[@]}"; do
  echo "MOVE $t → $TRASH/"
  mv -- "$t" "$TRASH/$(basename "$t")"
done
echo
echo "=== 已隔离到 $TRASH（未真删）==="
echo "请依次验证，全部正常后再手动 rm -rf $TRASH ："
echo "  nginx -t && curl -fsS http://127.0.0.1:3010/api/v1/health"
echo "  pm2 jlist >/dev/null && df -h /"
echo "建议观察 24-72 小时无异常后再删除隔离区。"
