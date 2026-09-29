#!/usr/bin/env bash
# 发布前置只读核对。由 deploy-precheck.yml 通过 ssh-action script_path 送到远端执行。
# Runner 读取本文件，远端不写临时脚本。禁止任何写操作。
# 允许输出：yes/no、数量、日期、版本号、证书目录名、白名单内终端编号、
# 点名的残留目录名、内存数字、/srv 下两级目录名、/root 合计 MB。
# 禁止输出：文件名、订单号、用户、来源地址、请求内容、密钥、环境变量、启动参数、进程命令行、
# nginx -T、pm2 jlist、访问日志原文、/root 下的文件名、任何订单行内容。
set -uo pipefail

# PM2 在守护进程没起来时，任何子命令都会自己拉起守护进程并写 ~/.pm2。先看套接字。
pm2_daemon_up() {
  local base sock
  base="${PM2_HOME:-}"
  if [ -z "$base" ]; then
    base="${HOME:-}/.pm2"
  fi
  sock="${base}/rpc.sock"
  [ -S "$sock" ]
}

echo "=== 1. 部署脚本默认的 API 目录是否存在 ==="
if [ -d "$EXPECT_DIR" ]; then
  echo "API_DIR_DEFAULT_OK=yes"
else
  echo "API_DIR_DEFAULT_OK=no  （需配置 secret DEPLOY_API_DIR）"
fi

echo "=== 2. 该目录下是否有 DEPLOY_SOURCE.txt（发布脚本依赖它做版本一致性校验）==="
if [ -f "$EXPECT_DIR/DEPLOY_SOURCE.txt" ]; then
  echo "DEPLOY_SOURCE_PRESENT=yes"
else
  echo "DEPLOY_SOURCE_PRESENT=no  （首次受控发布会创建）"
fi

echo "=== 3. 默认 PM2 进程名是否存在 ==="
if ! command -v pm2 >/dev/null 2>&1; then
  echo "PM2_INSTALLED=no  （API 可能不是用 PM2 托管，需确认托管方式）"
  echo "PM2_NAME_DEFAULT_OK=unknown"
  echo "PM2_PROCESS_COUNT=unknown"
elif ! pm2_daemon_up; then
  echo "PM2_INSTALLED=yes"
  echo "PM2_DAEMON=down"
  echo "PM2_NAME_DEFAULT_OK=unknown"
  echo "PM2_PROCESS_COUNT=unknown"
else
  echo "PM2_INSTALLED=yes"
  echo "PM2_DAEMON=up"
  if pm2 jlist 2>/dev/null | grep -q "\"name\":\"${EXPECT_PM2}\""; then
    echo "PM2_NAME_DEFAULT_OK=yes"
  else
    echo "PM2_NAME_DEFAULT_OK=no  （需配置 secret DEPLOY_PM2_NAME）"
    echo "PM2_PROCESS_COUNT=$(pm2 jlist 2>/dev/null | grep -o '"name":' | wc -l | tr -d ' ')"
  fi
fi

echo "=== 4. 备份盘可用空间（仅输出 GiB 数量级）==="
BK_PARENT="$(dirname "$EXPECT_BACKUP")"
AVAIL_GB="$(df -BG --output=avail "$BK_PARENT" 2>/dev/null | tail -n1 | tr -dc '0-9')"
if [ -n "$AVAIL_GB" ]; then
  echo "BACKUP_DISK_AVAIL_GB=$AVAIL_GB"
else
  echo "BACKUP_DISK_AVAIL_GB=unknown"
fi

echo "=== 5. API 健康检查端点当前是否可达（本机回环）==="
if curl -fsS -m 5 http://127.0.0.1:3010/api/v1/health >/dev/null 2>&1; then
  echo "API_HEALTH_LOCAL=ok"
else
  echo "API_HEALTH_LOCAL=unreachable  （端口或路径可能与默认不同）"
fi

echo "=== 6. 磁盘占用盘点（只输出数量级，用于判断清理目标）==="
# 首轮探测发现备份盘仅剩 1 GiB。发布脚本第一步就是 PG 全库备份、
# 第二步备份整个运行目录，空间不足会在备份阶段写满盘，
# 波及正在运行的 API 与 PostgreSQL。故先盘点占用分布再决定清理。
echo "ROOT_TOTAL_GB=$(df -BG --output=size / 2>/dev/null | tail -n1 | tr -dc '0-9')"
echo "ROOT_USED_PCT=$(df --output=pcent / 2>/dev/null | tail -n1 | tr -dc '0-9')"

if [ -d "$EXPECT_BACKUP" ]; then
  echo "BACKUP_ROOT_SIZE_MB=$(du -sm "$EXPECT_BACKUP" 2>/dev/null | cut -f1)"
  echo "BACKUP_FILE_COUNT=$(find "$EXPECT_BACKUP" -maxdepth 1 -type f 2>/dev/null | wc -l | tr -d ' ')"
  echo "BACKUP_DIR_COUNT=$(find "$EXPECT_BACKUP" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')"
  echo "BACKUP_OLDEST_DAYS=$(find "$EXPECT_BACKUP" -maxdepth 1 -mindepth 1 -printf '%T@\n' 2>/dev/null | sort -n | head -1 | awk '{print int((systime()-$1)/86400)}')"
else
  echo "BACKUP_ROOT_EXISTS=no"
fi

echo "API_DIR_SIZE_MB=$(du -sm "$EXPECT_DIR" 2>/dev/null | cut -f1)"
echo "API_NODE_MODULES_MB=$(du -sm "$EXPECT_DIR/node_modules" 2>/dev/null | cut -f1)"
echo "PNPM_STORE_MB=$(du -sm ~/.local/share/pnpm/store 2>/dev/null | cut -f1)"
echo "PM2_LOGS_MB=$(du -sm ~/.pm2/logs 2>/dev/null | cut -f1)"
echo "NGINX_LOGS_MB=$(du -sm /var/log/nginx 2>/dev/null | cut -f1)"
echo "JOURNAL_MB=$(journalctl --disk-usage 2>/dev/null | grep -o '[0-9.]*[MG]' | head -1)"

echo "=== 6b. 磁盘去向分解（只读，定位占用在哪些一级目录）==="
# 已测项之外的占用也要能对上号，所以这里按一级目录拆开。
# 只输出目录名与 MB，不输出文件名（本仓库为 public，Actions 日志公开可读）。
# 注意：不要跑 `find /` 全盘扫描 —— 2026-08-17 试过一次，根分区上直接把
# drone-ssh 的 command_timeout 跑爆，整个探测无输出。du 一级目录已足够定位。
echo "--- / 下一级目录（MB，降序前 12）---"
du -xsm /* 2>/dev/null | sort -rn | head -12 | awk '{printf "  %-24s %s MB\n", $2, $1}'
echo "--- /var 下（MB，降序前 6）---"
du -xsm /var/* 2>/dev/null | sort -rn | head -6 | awk '{printf "  %-24s %s MB\n", $2, $1}'
echo "--- /srv 下两级目录（MB，降序前 15）---"
shopt -s nullglob
srv_dirs=(/srv/*/ /srv/*/*/)
if [ "${#srv_dirs[@]}" -gt 0 ]; then
  du -xsm "${srv_dirs[@]}" 2>/dev/null | sort -rn | awk '!seen[$2]++' | head -15 | awk '{printf "  %-40s %s MB\n", $2, $1}'
fi
shopt -u nullglob
echo "--- /root 合计（MB，不列文件名）---"
root_home="${PRECHECK_ROOT_HOME:-/root}"
if [ -d "$root_home" ]; then
  root_mb="$(du -xsm "$root_home" 2>/dev/null | awk 'NR==1 { print $1; exit }')"
  case "$root_mb" in
    ''|*[!0-9]*) echo "ROOT_HOME_MB=unknown" ;;
    *) echo "ROOT_HOME_MB=${root_mb}" ;;
  esac
else
  echo "ROOT_HOME_MB=unknown"
fi

echo "=== 7. 本次发布需要的空间量级 ==="
# 注意：这条 SQL 含括号，务必用单引号包住并先赋值再 echo。
# 之前写成 `$(... -tAc \"SELECT pg_database_size(current_database())...\")` 嵌在双引号里，
# bash 在**解析期**就看到裸的 `(` 而报 `syntax error near unexpected token '('` ——
# 语法错误发生在解析阶段，整个脚本一行都不会执行，九个检查项全部无输出。
# 这就是本工作流此前从未产出过任何结果的原因。
PG_DB_SIZE_MB="$(sudo -n -u postgres psql -tAc 'SELECT pg_database_size(current_database())/1024/1024;' 2>/dev/null | tr -d ' ')"
echo "PG_DB_SIZE_MB=${PG_DB_SIZE_MB:-unknown（无免密 sudo，可忽略）}"

echo "=== 7b. Redis 可达性（发布前置条件，缺它会在健康检查阶段炸）==="
# 为什么必须查：deploy-api-release.sh 第 8 步健康检查是 grep '"status":"ok"'，
# 而当前代码在 Redis 降级时返回 "degraded"。若重启那一刻 Redis 不可达，
# 健康检查会连续失败然后 deploy 报错 —— 但此时迁移已执行、rsync 已完成、
# PM2 已重启新代码。结果是「一份部署失败的日志」配「一个已经换成新版本的生产环境」。
if command -v redis-cli >/dev/null 2>&1; then
  if [ "$(redis-cli ping 2>/dev/null)" = "PONG" ]; then
    echo "REDIS_REACHABLE=yes"
  else
    echo "REDIS_REACHABLE=no  （发布会在健康检查阶段失败，且此时迁移已执行）"
  fi
else
  echo "REDIS_REACHABLE=unknown  （本机无 redis-cli，需另行确认）"
fi

echo "=== 8. 发布后验证：资金门禁不得退回可关闭的部署开关 ==="
# 原先这里 grep 启动日志里的 PRINT_REQUIRE_PAID_BEFORE_CLAIM 告警。该开关
# 及其告警已删除：claim 无条件只领已付款订单，写死在 claimableWhere 与事务
# 内 CAS 两层。继续 grep 会恒打 "no" 并被误读成「日志轮转了」。
# 现在改为反向检查：运行目录的 .env 里不该再出现这个已废弃的变量。
if [ -f "$EXPECT_DIR/.env" ] && grep -q "^[[:space:]]*PRINT_REQUIRE_PAID_BEFORE_CLAIM=" "$EXPECT_DIR/.env"; then
  echo "PAID_GATE_DEAD_ENV_PRESENT=yes  （该变量已废弃且不再生效，建议从 .env 移除以免误导运维）"
else
  echo "PAID_GATE_DEAD_ENV_PRESENT=no  （符合预期：门控已写死在代码里）"
fi

echo "=== 9. 发布后验证：#553 隐私门控审计动作是否已注册 ==="
# 只查审计表里是否出现过该 action，不打印任何 payload
CNT="$(sudo -n -u postgres psql -tAc \
  "SELECT count(*) FROM \"AuditLog\" WHERE action='print_job.pii_scan_bypassed';" 2>/dev/null || echo unknown)"
echo "PII_BYPASS_AUDIT_ROWS=$CNT  （0 属正常：本次发布后尚无人建单）"

echo "=== 9b. 已付款、未打印完、超过 100 面的订单（只读计数）==="
# 只输出一行 OVERSIZE_PAID_UNFINISHED_ORDERS。失败、psql 不可用、结果不是纯数字都写 unknown。
# 不打印订单号、用户、文件名、终端编号或任何行内容。
# 上限变量与 PRINT_MAX_SIDES_PER_ORDER 同一口径：每单最多这么多面，超过才计数。
# 终态取 services/api/src/terminals/terminals-agent.service.ts 的 TERMINAL_STATES
# （completed / failed / cancelled）。面数按 printOrderSideCount：有订单行则各行
# billablePages × copies 相加；没有行则用订单 billablePages × 参数里的 copies。
# copies 不解析 JSON。整段必须是一层对象（键是字符串，值是字符串、数字、true、false 或 null），
# 再在其中用 substring ... from 取 "copies" 后 1 到 4 位正整数；取不到或整段对不上，都按 1。
# 字符串、小数、0、负数、超过 4 位、坏 JSON 因此都是 1。这条正则从 PostgreSQL 9.x 起就能跑。
# billablePages 为空或小于 1 按 0 面。
OVERSIZE_MAX_SIDES=100
oversize_sql=""
# bash 3.2 在 $() 里读不到这份带括号的 heredoc。read -d '' 读到文件尾，退出码 1 是正常的。
IFS= read -r -d '' oversize_sql <<SQL || true
BEGIN READ ONLY;
-- oversize-paid-unfinished-count
SELECT count(*)::text
FROM "Order" o
LEFT JOIN LATERAL (
  SELECT count(*) AS item_count,
         COALESCE(SUM(i."billablePages"::numeric * i."copies"::numeric), 0) AS item_sides
  FROM "OrderItem" i
  WHERE i."orderId" = o.id
) items ON true
WHERE o."payStatus" = 'paid'
  AND o."taskStatus" NOT IN ('completed', 'failed', 'cancelled')
  AND (
    CASE
      WHEN items.item_count > 0 THEN items.item_sides
      WHEN o."billablePages" IS NULL OR o."billablePages" < 1 THEN 0
      ELSE o."billablePages"::numeric * (
        CASE
          WHEN o."printParamsJson" ~ \$obj\$^[[:space:]]*\\{[[:space:]]*("([^"\\\\]|\\\\.)*"[[:space:]]*:[[:space:]]*("([^"\\\\]|\\\\.)*"|-?(0|[1-9][0-9]*)(\\.[0-9]+)?([eE][+-]?[0-9]+)?|true|false|null)[[:space:]]*(,[[:space:]]*"([^"\\\\]|\\\\.)*"[[:space:]]*:[[:space:]]*("([^"\\\\]|\\\\.)*"|-?(0|[1-9][0-9]*)(\\.[0-9]+)?([eE][+-]?[0-9]+)?|true|false|null)[[:space:]]*)*)?\\}[[:space:]]*\$\$obj\$
          THEN COALESCE(substring(o."printParamsJson" from \$cpy\$"copies"\\s*:\\s*([1-9][0-9]{0,3})\\s*[,}]\$cpy\$)::numeric, 1)
          ELSE 1
        END
      )
    END
  ) > ${OVERSIZE_MAX_SIDES};
ROLLBACK;
SQL
oversize_rc=0
# -q 去掉 BEGIN/ROLLBACK 的命令标签，否则成功时输出不是纯数字，会被收成 unknown。
oversize_raw="$(printf '%s\n' "$oversize_sql" | sudo -n -u postgres psql -X -q -tA -v ON_ERROR_STOP=1 2>/dev/null)" || oversize_rc=$?
oversize_raw="$(printf '%s' "$oversize_raw" | tr -d '[:space:]')"
if [ "$oversize_rc" -ne 0 ]; then
  echo "OVERSIZE_PAID_UNFINISHED_ORDERS=unknown"
elif printf '%s' "$oversize_raw" | grep -Eq '^[0-9]+$'; then
  echo "OVERSIZE_PAID_UNFINISHED_ORDERS=${oversize_raw}"
else
  echo "OVERSIZE_PAID_UNFINISHED_ORDERS=unknown"
fi

echo "=== 10. 运行版本与 main 是否一致 ==="
if [ -f "$EXPECT_DIR/DEPLOY_SOURCE.txt" ]; then
  echo "DEPLOY_SOURCE_SHA8=$(sed -n 's/^source=origin\/main@\([0-9a-f]\{8\}\).*/\1/p' "$EXPECT_DIR/DEPLOY_SOURCE.txt" | head -1)"
fi

echo "=== 11. 静态发布备份与残留 bundle（只读）==="
# 路径与 deploy.yml 的 STATIC_BACKUP_ROOT 默认值相同。只输出数量和日期，不打印文件名。
STATIC_BACKUP_ROOT="/srv/ai-job-print-static-backups"
if [ -d "$STATIC_BACKUP_ROOT" ]; then
  echo "STATIC_BACKUP_SIZE_MB=$(du -sm "$STATIC_BACKUP_ROOT" 2>/dev/null | cut -f1)"
  echo "STATIC_BACKUP_GROUP_COUNT=$(find "$STATIC_BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')"
  OLDEST="$(find "$STATIC_BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %TY-%Tm-%Td\n' 2>/dev/null | sort -n | head -1 | awk '{print $2}')"
  echo "STATIC_BACKUP_OLDEST_DATE=${OLDEST:-none}"
else
  echo "STATIC_BACKUP_EXISTS=no"
  echo "STATIC_BACKUP_SIZE_MB=0"
  echo "STATIC_BACKUP_GROUP_COUNT=0"
  echo "STATIC_BACKUP_OLDEST_DATE=none"
fi
if [ -f /tmp/release.bundle ]; then
  echo "RELEASE_BUNDLE_PRESENT=yes"
  echo "RELEASE_BUNDLE_SIZE_MB=$(du -sm /tmp/release.bundle 2>/dev/null | cut -f1)"
else
  echo "RELEASE_BUNDLE_PRESENT=no"
  echo "RELEASE_BUNDLE_SIZE_MB=0"
fi

echo "=== 12. 运行时版本（只读）==="
# 只打版本号、数量、日期、域名目录名、终端编号、内存数字，以及下面点名的残留目录名。
# 不打文件名、来源地址、请求内容、密钥、环境变量、启动参数、进程命令行，
# 也不回显 nginx -T、pm2 jlist 或访问日志原文。
shopt -s nullglob

MODE_AWK=$(cat <<'PRECHECK_MODE_AWK'
function braces(s,    i, c, n) {
  n = 0
  for (i = 1; i <= length(s); i++) {
    c = substr(s, i, 1)
    if (c == "{") n++
    else if (c == "}") n--
  }
  return n
}
function listen_port(line,    t) {
  if (match(line, /[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+:[0-9]+/)) {
    t = substr(line, RSTART, RLENGTH)
    sub(/.*:/, "", t)
    return t + 0
  }
  if (match(line, /\]:[0-9]+/)) {
    t = substr(line, RSTART, RLENGTH)
    sub(/\]:/, "", t)
    return t + 0
  }
  if (match(line, /listen[ \t]+[0-9]+/)) {
    t = substr(line, RSTART, RLENGTH)
    sub(/listen[ \t]+/, "", t)
    return t + 0
  }
  return 0
}
function acc_path(line,    p) {
  if (line ~ /access_log[ \t]+off[ \t]*;/) return "off"
  if (match(line, /access_log[ \t]+[^ \t;]+/)) {
    p = substr(line, RSTART, RLENGTH)
    sub(/access_log[ \t]+/, "", p)
    gsub(sprintf("%c", 34), "", p)
    return p
  }
  return ""
}
function acc_fmt(line,    rest, n, i) {
  if (line ~ /access_log[ \t]+off[ \t]*;/) return ""
  if (!match(line, /access_log[ \t]+[^ \t;]+[ \t]*/)) return ""
  rest = substr(line, RSTART + RLENGTH)
  sub(/;.*/, "", rest)
  n = split(rest, a, /[ \t]+/)
  for (i = 1; i <= n; i++) {
    if (a[i] == "") continue
    if (a[i] ~ /=/) continue
    return a[i]
  }
  return "combined"
}
function add_sq(src,    s, body, piece, q) {
  q = sprintf("%c", 39)
  body = ""
  s = src
  while (match(s, q "[^" q "]*" q)) {
    piece = substr(s, RSTART + 1, RLENGTH - 2)
    body = body piece
    s = substr(s, RSTART + RLENGTH)
  }
  gsub(/[[:space:]]+/, " ", body)
  sub(/^ /, "", body)
  sub(/ $/, "", body)
  return body
}
function note_listen(text) {
  if (text ~ /listen[ \t]/) {
    p = listen_port(text)
    if (p == 80 || p == 443) server_ports = server_ports " " p
  }
}
function note_access(text) {
  if (text ~ /access_log[ \t]/) {
    server_log = acc_path(text)
    server_fmt = acc_fmt(text)
  }
}
function flush_server(    i, n, p, fmt, lg) {
  if (!in_server) return
  n = split(server_ports, ps, / /)
  lg = server_log
  fmt = server_fmt
  if (lg == "") { lg = http_log; fmt = http_fmt }
  if (lg != "" && lg != "off") {
    if (fmt == "") fmt = "combined"
    for (i = 1; i <= n; i++) {
      p = ps[i] + 0
      if (p != 80 && p != 443) continue
      key = p SUBSEP lg
      if (seen_port[key]) continue
      seen_port[key] = 1
      port_n++
      port_p[port_n] = p
      port_log[port_n] = lg
      port_fmt[port_n] = fmt
    }
  }
  server_ports = ""
  server_log = ""
  server_fmt = ""
}
BEGIN {
  depth = 0
  in_server = 0
  server_base = 0
  pending = 0
  cap = 0
  http_log = ""
  http_fmt = "combined"
}
{
  line = $0
  sub(/\r$/, "", line)
  if (cap) {
    fmtbuf = fmtbuf " " line
    if (index(line, ";") > 0) {
      cap = 0
      fmt_body[fmtname] = add_sq(fmtbuf)
    }
    next
  }
  if (line ~ /^[[:space:]]*#/) next
  if (match(line, /^[[:space:]]*log_format[ \t]+[A-Za-z0-9_]+/)) {
    fmtname = substr(line, RSTART, RLENGTH)
    sub(/^[[:space:]]*log_format[ \t]+/, "", fmtname)
    if (index(line, ";") > 0) fmt_body[fmtname] = add_sq(line)
    else { cap = 1; fmtbuf = line }
    next
  }
  pure = line
  sub(/#.*/, "", pure)
  depth_before = depth
  depth += braces(pure)
  if (!in_server && (pure ~ /^[[:space:]]*server[[:space:]]*\{/ || pure ~ /^[[:space:]]*server[[:space:]]*$/)) {
    if (pure ~ /\{/) {
      in_server = 1
      server_base = depth_before + 1
      server_ports = ""
      server_log = ""
      server_fmt = ""
      pending = 0
    } else pending = 1
  } else if (pending && pure ~ /\{/) {
    in_server = 1
    server_base = depth_before + 1
    server_ports = ""
    server_log = ""
    server_fmt = ""
    pending = 0
  }
  if (in_server) {
    note_listen(pure)
    note_access(pure)
    if (depth < server_base) {
      flush_server()
      in_server = 0
    }
  } else if (pure ~ /access_log[ \t]/) {
    http_log = acc_path(pure)
    http_fmt = acc_fmt(pure)
  }
}

function split_fields(line, arr,    i, n, len, c, buf, state) {
  n = 0
  buf = ""
  state = ""
  len = length(line)
  for (i = 1; i <= len; i++) {
    c = substr(line, i, 1)
    if (state == "") {
      if (c == " " || c == "\t") {
        if (buf != "") { n++; arr[n] = buf; buf = "" }
        continue
      }
      buf = buf c
      if (c == "\"") state = "q"
      else if (c == "[") state = "b"
    } else if (state == "q") {
      buf = buf c
      if (c == "\"") state = ""
    } else if (state == "b") {
      buf = buf c
      if (c == "]") state = ""
    }
  }
  if (buf != "") { n++; arr[n] = buf }
  return n
}
function field_index(body, token,    n, i) {
  n = split_fields(body, fa)
  for (i = 1; i <= n; i++) if (fa[i] == token) return i
  return 0
}
function has_log(port, lg,    i) {
  for (i = 1; i <= port_n; i++) if (port_p[i] == port && port_log[i] == lg) return 1
  return 0
}
END {
  if (in_server) flush_server()
  n80 = 0
  n443 = 0
  shared = 0
  for (i = 1; i <= port_n; i++) {
    if (port_p[i] == 80) n80++
    if (port_p[i] == 443) n443++
  }
  for (i = 1; i <= port_n; i++) {
    if (port_p[i] != 80) continue
    if (has_log(443, port_log[i])) shared = 1
  }
  if (n80 > 0 && n443 > 0 && !shared) {
    print "MODE files"
    for (i = 1; i <= port_n; i++) print "LOG", port_p[i], port_log[i]
    exit
  }
  idx = 0
  kind = ""
  for (i = 1; i <= port_n; i++) {
    body = fmt_body[port_fmt[i]]
    if (body == "") continue
    got = field_index(body, "$server_port")
    if (got > 0) { idx = got; kind = "port"; break }
  }
  if (idx == 0) {
    for (i = 1; i <= port_n; i++) {
      body = fmt_body[port_fmt[i]]
      if (body == "") continue
      got = field_index(body, "$scheme")
      if (got > 0) { idx = got; kind = "scheme"; break }
    }
  }
  if (idx > 0) {
    print "MODE field"
    print "KIND", kind
    print "INDEX", idx
    seen_log[""] = 0
    for (i = 1; i <= port_n; i++) {
      if (seen_log[port_log[i]]) continue
      seen_log[port_log[i]] = 1
      print "LOG", port_log[i]
    }
    exit
  }
  print "MODE indeterminate"
}


PRECHECK_MODE_AWK
)
COUNT_AWK=$(cat <<'PRECHECK_COUNT_AWK'
function mon(m) {
  if (m=="Jan") return 1
  if (m=="Feb") return 2
  if (m=="Mar") return 3
  if (m=="Apr") return 4
  if (m=="May") return 5
  if (m=="Jun") return 6
  if (m=="Jul") return 7
  if (m=="Aug") return 8
  if (m=="Sep") return 9
  if (m=="Oct") return 10
  if (m=="Nov") return 11
  if (m=="Dec") return 12
  return 0
}
function civil_epoch(y, m, d, H, Mi, S,    era, yoe, doy, doe, days) {
  y += 0; m += 0; d += 0; H += 0; Mi += 0; S += 0
  if (m <= 2) { y--; m += 12 }
  era = int((y >= 0 ? y : y - 399) / 400)
  yoe = y - era * 400
  doy = int((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1
  doe = yoe * 365 + int(yoe / 4) - int(yoe / 100) + doy
  days = era * 146097 + doe - 719468
  return days * 86400 + H * 3600 + Mi * 60 + S
}
function off_sec(o,    sign, hh, mm) {
  sign = 1
  if (substr(o, 1, 1) == "-") sign = -1
  hh = substr(o, 2, 2) + 0
  mm = substr(o, 4, 2) + 0
  return sign * (hh * 3600 + mm * 60)
}
function line_epoch(line,    stamp, n, mo, loc) {
  if (!match(line, /\[[0-9][0-9]\/[A-Za-z][A-Za-z][A-Za-z]\/[0-9][0-9][0-9][0-9]:[0-9][0-9]:[0-9][0-9]:[0-9][0-9] [+-][0-9][0-9][0-9][0-9]\]/)) return -1
  stamp = substr(line, RSTART + 1, RLENGTH - 2)
  n = split(stamp, a, /[\/: ]/)
  if (n < 7) return -1
  mo = mon(a[2])
  if (mo == 0) return -1
  loc = civil_epoch(a[3], mo, a[1], a[4], a[5], a[6])
  return loc - off_sec(a[7])
}
function split_fields(line, arr,    i, n, len, c, buf, state) {
  n = 0
  buf = ""
  state = ""
  len = length(line)
  for (i = 1; i <= len; i++) {
    c = substr(line, i, 1)
    if (state == "") {
      if (c == " " || c == "\t") {
        if (buf != "") { n++; arr[n] = buf; buf = "" }
        continue
      }
      buf = buf c
      if (c == "\"") state = "q"
      else if (c == "[") state = "b"
    } else if (state == "q") {
      buf = buf c
      if (c == "\"") state = ""
    } else if (state == "b") {
      buf = buf c
      if (c == "]") state = ""
    }
  }
  if (buf != "") { n++; arr[n] = buf }
  return n
}
function terminal(line,    id, after, c) {
  if (!match(line, sprintf("/api/v1/terminals/[^/%c%c%c%c]+", 32, 63, 34, 9))) return ""
  id = substr(line, RSTART, RLENGTH)
  sub(/.*\//, "", id)
  after = substr(line, RSTART + RLENGTH)
  kind = "other"
  if (index(after, "/heartbeat") == 1) {
    c = substr(after, 11, 1)
    if (c == "" || c == "?" || c == " " || c == "\"" || c == "/") kind = "heartbeat"
  }
  return id SUBSEP kind
}
function port_of(line,    n, raw, v) {
  if (mode == "file") return fixed + 0
  n = split_fields(line, f)
  if (idx < 1 || idx > n) return 0
  raw = f[idx]
  gsub(sprintf("%c", 34), "", raw)
  if (kindf == "scheme") {
    if (raw == "https") return 443
    if (raw == "http") return 80
    return 0
  }
  v = raw + 0
  if (raw ~ /^[0-9]+$/ && (v == 80 || v == 443)) return v
  return 0
}
function id_ok(id) {
  return id ~ /^[A-Za-z0-9_-]+$/ && length(id) >= 1 && length(id) <= 32
}
BEGIN { SUBSEP = "\t"; seen = 0; trunc = 0; cap = cap + 0; if (cap < 1) cap = 2000000 }
{
  seen++
  if (seen > cap) { trunc = 1; exit }
  ep = line_epoch($0)
  if (ep < 0 || ep < cutoff) next
  info = terminal($0)
  if (info == "") next
  split(info, tk, "\t")
  port = port_of($0)
  if (port != 80 && port != 443) next
  id = tk[1]
  if (!id_ok(id)) id = "invalid_format"
  key = port SUBSEP id SUBSEP tk[2]
  n[key]++
  if (port == 443 && tk[2] == "heartbeat") hb++
}
END {
  for (k in n) {
    split(k, a, SUBSEP)
    printf "COUNT %s %s %s %d\n", a[1], a[2], a[3], n[k]
  }
  if (trunc) print "TRUNCATED yes"
}

PRECHECK_COUNT_AWK
)

du_mb() {
  local p="$1" n
  if [ ! -e "$p" ]; then
    printf '0\n'
    return 0
  fi
  n="$(du -sm "$p" 2>/dev/null | cut -f1)"
  case "$n" in
    ''|*[!0-9]*) printf 'unknown\n' ;;
    *) printf '%s\n' "$n" ;;
  esac
}

epoch_of() {
  local n
  n="$(stat -c %Y "$1" 2>/dev/null || true)"
  if [ -z "$n" ]; then
    n="$(stat -f %m "$1" 2>/dev/null || true)"
  fi
  printf '%s\n' "$n"
}

ymd_of() {
  local e="$1"
  case "$e" in
    ''|*[!0-9]*) printf '\n'; return 0 ;;
  esac
  date -u -d "@${e}" +%Y-%m-%d 2>/dev/null || date -u -r "$e" +%Y-%m-%d 2>/dev/null || true
}

# 0 = 达到 22.13；1 = 低于；2 = 解析不了。
node_ok_for() {
  local s="$1" rest maj min
  s="${s#v}"
  s="${s#V}"
  maj="${s%%.*}"
  case "$maj" in
    ''|*[!0-9]*) return 2 ;;
  esac
  rest="${s#*.}"
  if [ "$rest" = "$s" ]; then
    return 2
  fi
  min="${rest%%.*}"
  case "$min" in
    ''|*[!0-9]*) return 2 ;;
  esac
  if [ "$maj" -gt 22 ]; then
    return 0
  fi
  if [ "$maj" -eq 22 ] && [ "$min" -ge 13 ]; then
    return 0
  fi
  return 1
}

node_ver="$(node -v 2>/dev/null || true)"
pnpm_ver="$(pnpm -v 2>/dev/null || true)"
echo "NODE_VERSION=${node_ver:-unknown}"
echo "PNPM_VERSION=${pnpm_ver:-unknown}"

pm2_node="unknown"
if command -v pm2 >/dev/null 2>&1 && pm2_daemon_up; then
  raw="$(pm2 jlist 2>/dev/null || true)"
  ver="$(printf '%s\n' "$raw" | grep -oE '"node_version"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*"([^"]*)"$/\1/' || true)"
  if [ -z "$ver" ]; then
    ver="$(printf '%s\n' "$raw" | grep -oE '"node_version"[[:space:]]*:[[:space:]]*[0-9][^,}[:space:]]*' | head -1 | sed -E 's/.*:[[:space:]]*//' || true)"
  fi
  if [ -z "$ver" ]; then
    interp="$(printf '%s\n' "$raw" | grep -oE '"exec_interpreter"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*"([^"]*)"$/\1/' || true)"
    case "$interp" in
      *node*)
        if [ -n "$interp" ] && [ -x "$interp" ]; then
          ver="$("$interp" -v 2>/dev/null || true)"
        fi
        ;;
    esac
  fi
  if [ -n "$ver" ]; then
    pm2_node="$ver"
  fi
fi
echo "PM2_NODE_VERSION=${pm2_node}"

basis="$pm2_node"
ok_rc=0
node_ok_for "$basis" || ok_rc=$?
if [ "$ok_rc" -eq 2 ]; then
  ok_rc=0
  node_ok_for "${node_ver:-}" || ok_rc=$?
fi
if [ "$ok_rc" -eq 0 ]; then
  echo "NODE_OK_FOR_PDFJS=yes"
elif [ "$ok_rc" -eq 1 ]; then
  echo "NODE_OK_FOR_PDFJS=no"
else
  echo "NODE_OK_FOR_PDFJS=unknown"
fi

echo "=== 13. 证书与续期定时器（只读）==="
if command -v certbot >/dev/null 2>&1; then
  echo "CERTBOT_INSTALLED=yes"
else
  echo "CERTBOT_INSTALLED=no"
fi
timer_present=no
timer_next=""
if command -v systemctl >/dev/null 2>&1; then
  timer_line="$(systemctl list-timers --all 2>/dev/null | grep -i certbot | head -1 || true)"
  if [ -n "$timer_line" ]; then
    timer_present=yes
    timer_next="$(printf '%s\n' "$timer_line" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1 || true)"
  fi
fi
echo "CERTBOT_TIMER_PRESENT=${timer_present}"
if [ "$timer_present" = yes ]; then
  echo "CERTBOT_TIMER_NEXT=${timer_next:-unknown}"
else
  echo "CERTBOT_TIMER_NEXT=none"
fi

cert_ymd() {
  awk '
    function mm(m) {
      if (m=="Jan") return "01"
      if (m=="Feb") return "02"
      if (m=="Mar") return "03"
      if (m=="Apr") return "04"
      if (m=="May") return "05"
      if (m=="Jun") return "06"
      if (m=="Jul") return "07"
      if (m=="Aug") return "08"
      if (m=="Sep") return "09"
      if (m=="Oct") return "10"
      if (m=="Nov") return "11"
      if (m=="Dec") return "12"
      return ""
    }
    {
      sub(/^notAfter=/, "", $0)
      m = mm($1)
      d = $2
      y = $4
      if (m == "" || y !~ /^[0-9][0-9][0-9][0-9]$/) exit 1
      if (length(d) == 1) d = "0" d
      if (d !~ /^[0-9][0-9]$/) exit 1
      printf "%s-%s-%s\n", y, m, d
    }
  '
}

live="${PRECHECK_LE_LIVE:-/etc/letsencrypt/live}"
cert_found=no
if [ -d "$live" ]; then
  for cert in "$live"/*/cert.pem; do
    [ -f "$cert" ] || continue
    domain="$(basename "$(dirname "$cert")")"
    if [ "$domain" = "README" ]; then
      continue
    fi
    endraw="$(openssl x509 -enddate -noout -in "$cert" 2>/dev/null || true)"
    end="$(printf '%s\n' "$endraw" | cert_ymd 2>/dev/null || true)"
    if [ -n "$end" ]; then
      echo "CERT_EXPIRES domain=${domain} end=${end}"
    else
      echo "CERT_EXPIRES domain=${domain} end=unknown"
    fi
    cert_found=yes
  done
fi
if [ "$cert_found" != yes ]; then
  echo "CERT_EXPIRES=unknown"
fi

echo "=== 14. 终端 API 近 7 天按端口（只读）==="
now="$(date +%s 2>/dev/null || true)"
case "$now" in
  ''|*[!0-9]*) now=0 ;;
esac
CUTOFF="$((now - 7 * 86400))"
if [ "$CUTOFF" -lt 0 ]; then
  CUTOFF=0
fi

REF_LOADED=no
PM2_PATH_BLOB=""
NGINX_PATH_BLOB=""

load_runtime_refs() {
  local raw
  if [ "$REF_LOADED" = yes ]; then
    return 0
  fi
  REF_LOADED=yes
  PM2_REF_READY=no
  if command -v pm2 >/dev/null 2>&1 && pm2_daemon_up; then
    PM2_REF_READY=yes
    raw="$(pm2 jlist 2>/dev/null || true)"
    PM2_PATH_BLOB="$(printf '%s\n' "$raw" | grep -oE '"(pm_cwd|pm_exec_path|cwd)"[[:space:]]*:[[:space:]]*"[^"]*"' | sed -E 's/^[^:]*:[[:space:]]*"([^"]*)"$/\1/' || true)"
  fi
  if command -v nginx >/dev/null 2>&1; then
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
  elif [ "${PM2_REF_READY:-no}" != yes ]; then
    printf '%s\n' "unknown"
  else
    printf '%s\n' "none"
  fi
}

say_indeterminate() {
  echo "PLAINTEXT_API_COUNT=indeterminate（日志格式不含端口）"
}

LOG_LINE_CAP="${PRECHECK_LOG_LINE_CAP:-2000000}"
case "$LOG_LINE_CAP" in
  ''|*[!0-9]*) LOG_LINE_CAP=2000000 ;;
esac
SEEN_LOGS="|"
LOG_SUMMARIES=()
scan_file() {
  local file="$1" mode="$2" port="$3" chunk
  if [ ! -f "$file" ]; then
    return 0
  fi
  case "$SEEN_LOGS" in
    *"|${file}|"*) return 0 ;;
  esac
  SEEN_LOGS="${SEEN_LOGS}${file}|"
  chunk=""
  case "$file" in
    *.gz)
      chunk="$(gzip -dc -- "$file" 2>/dev/null | awk -v cutoff="$CUTOFF" -v mode="$mode" -v fixed="$port" -v idx="${idx:-0}" -v kindf="${kindf:-}" -v cap="$LOG_LINE_CAP" "$COUNT_AWK" || true)"
      ;;
    *)
      chunk="$(awk -v cutoff="$CUTOFF" -v mode="$mode" -v fixed="$port" -v idx="${idx:-0}" -v kindf="${kindf:-}" -v cap="$LOG_LINE_CAP" "$COUNT_AWK" "$file" 2>/dev/null || true)"
      ;;
  esac
  if [ -n "$chunk" ]; then
    LOG_SUMMARIES+=("$chunk")
  fi
}

scan_family() {
  local base="$1" mode="$2" port="$3" f epoch
  case "$base" in
    /*) ;;
    *) return 0 ;;
  esac
  if [ -f "$base" ]; then
    scan_file "$base" "$mode" "$port"
  fi
  for f in "$base".1 "$base".[0-9] "$base".[0-9][0-9] "$base".gz "$base".*.gz "$base".[0-9].gz "$base".[0-9][0-9].gz; do
    [ -f "$f" ] || continue
    [ "$f" = "$base" ] && continue
    epoch="$(epoch_of "$f")"
    case "$epoch" in
      ''|*[!0-9]*) continue ;;
    esac
    if [ "$epoch" -ge "$CUTOFF" ]; then
      scan_file "$f" "$mode" "$port"
    fi
  done
}

emit_counts() {
  local agg hb joined=""
  if [ "${#LOG_SUMMARIES[@]}" -gt 0 ]; then
    joined="$(printf '%s\n' "${LOG_SUMMARIES[@]}")"
  fi
  agg="$(printf '%s\n' "$joined" | awk '
    $1 == "COUNT" && ($2 == 80 || $2 == 443) {
      if ($4 != "heartbeat" && $4 != "other") next
      if ($3 == "") next
      key = $2 SUBSEP $3 SUBSEP $4
      n[key] += $5
      if ($2 == 443 && $4 == "heartbeat") hb += $5
    }
    $1 == "TRUNCATED" { trunc = 1 }
    END {
      for (k in n) {
        split(k, a, SUBSEP)
        printf "TERMINAL_API port=%s terminal=%s kind=%s count=%s\n", a[1], a[2], a[3], n[k]
      }
      printf "HTTPS_HEARTBEAT_COUNT_7D=%d\n", hb + 0
      if (trunc) print "truncated=yes"
    }
  ')"
  printf '%s\n' "$agg"
  hb="$(printf '%s\n' "$agg" | awk -F= '$1=="HTTPS_HEARTBEAT_COUNT_7D"{print $2; exit}')"
  case "$hb" in
    ''|*[!0-9]*) hb=0 ;;
  esac
  if [ "$hb" -eq 0 ]; then
    echo "::warning::HTTPS 心跳近 7 天次数为 0，统计可能没测到"
  fi
}

conf=""
if command -v nginx >/dev/null 2>&1; then
  conf="$(nginx -T 2>/dev/null || true)"
fi
if [ -z "$conf" ]; then
  say_indeterminate
else
  mode_out="$(printf '%s\n' "$conf" | awk "$MODE_AWK")"
  mode_kind="$(printf '%s\n' "$mode_out" | awk '$1=="MODE"{print $2; exit}')"
  if [ "$mode_kind" = files ]; then
    while IFS= read -r line; do
      case "$line" in
        LOG\ *)
          rest="${line#LOG }"
          port="${rest%% *}"
          path="${rest#* }"
          case "$port" in
            80|443) scan_family "$path" file "$port" ;;
          esac
          ;;
      esac
    done <<EOF
$mode_out
EOF
    emit_counts
  elif [ "$mode_kind" = field ]; then
    kindf="$(printf '%s\n' "$mode_out" | awk '$1=="KIND"{print $2; exit}')"
    idx="$(printf '%s\n' "$mode_out" | awk '$1=="INDEX"{print $2; exit}')"
    case "$idx" in
      ''|*[!0-9]*) idx=0 ;;
    esac
    if [ "$idx" -lt 1 ]; then
      say_indeterminate
    else
      while IFS= read -r line; do
        case "$line" in
          LOG\ *)
            path="${line#LOG }"
            scan_family "$path" field 0
            ;;
        esac
      done <<EOF
$mode_out
EOF
      emit_counts
    fi
  else
    say_indeterminate
  fi
fi

echo "=== 15. /srv 根下残留目录（只读）==="
srv="${PRECHECK_SRV:-/srv}"
for name in node_modules services ai-job-print-api-backups ai-job-print-env-backups ai-job-print-artifacts ai-job-print-static-releases ai-job-print-recovery-artifacts; do
  dir="${srv}/${name}"
  if [ -L "$dir" ]; then
    size=unknown
    mtime=unknown
  elif [ -d "$dir" ]; then
    size="$(du_mb "$dir")"
    epoch="$(epoch_of "$dir")"
    mtime="$(ymd_of "$epoch")"
    if [ -z "$mtime" ]; then
      mtime=unknown
    fi
  else
    size=absent
    mtime=none
  fi
  ref="$(reference_of "$dir")"
  if [ ! -L "$dir" ]; then
    canon="$(readlink -f "$dir" 2>/dev/null || true)"
    if [ "$ref" = none ] && [ -n "$canon" ] && [ "$canon" != "$dir" ]; then
      ref="$(reference_of "$canon")"
    fi
  fi
  echo "SRV_LEFTOVER name=${name} size_mb=${size} mtime=${mtime} referenced_by=${ref}"
done

echo "=== 16. 其它增长项（只读）==="
home="${PRECHECK_HOME:-$HOME}"
tmp="${PRECHECK_TMP:-/tmp}"

cache_mb() {
  local total=0 n base low d needle matched
  if [ ! -d "$home/.cache" ]; then
    printf '0\n'
    return 0
  fi
  for d in "$home/.cache"/* "$home/.cache"/.[!.]* "$home/.cache"/..?*; do
    [ -e "$d" ] || continue
    base="$(basename "$d")"
    low="$(printf '%s' "$base" | tr '[:upper:]' '[:lower:]')"
    matched=no
    for needle in "$@"; do
      case "$low" in
        $needle) matched=yes ;;
      esac
    done
    if [ "$matched" != yes ]; then
      continue
    fi
    n="$(du -sm "$d" 2>/dev/null | cut -f1)"
    case "$n" in
      ''|*[!0-9]*) printf 'unknown\n'; return 0 ;;
    esac
    total=$((total + n))
  done
  printf '%s\n' "$total"
}

echo "CACHE_LIBREOFFICE_MB=$(cache_mb '*libreoffice*')"
echo "CACHE_CHROMIUM_MB=$(cache_mb '*chromium*' '*chrome*')"
echo "CACHE_PUPPETEER_MB=$(cache_mb '*puppeteer*')"

tmp_mb=0
tmp_unknown=no
for d in "$tmp"/lu* "$tmp"/soffice* "$tmp"/.org.chromium*; do
  [ -e "$d" ] || continue
  n="$(du -sm "$d" 2>/dev/null | cut -f1)"
  case "$n" in
    ''|*[!0-9]*) tmp_unknown=yes ;;
    *) tmp_mb=$((tmp_mb + n)) ;;
  esac
done
if [ "$tmp_unknown" = yes ]; then
  echo "TMP_LO_CHROME_MB=unknown"
else
  echo "TMP_LO_CHROME_MB=${tmp_mb}"
fi

if command -v redis-cli >/dev/null 2>&1; then
  redis_dir="$(redis-cli CONFIG GET dir 2>/dev/null | awk 'NR==2 { print; exit }')"
else
  redis_dir=""
fi
if [ -z "$redis_dir" ]; then
  echo "REDIS_DUMP_MB=unknown"
  echo "REDIS_APPENDONLY_MB=unknown"
else
  if [ -f "$redis_dir/dump.rdb" ]; then
    echo "REDIS_DUMP_MB=$(du_mb "$redis_dir/dump.rdb")"
  else
    echo "REDIS_DUMP_MB=0"
  fi
  if [ -d "$redis_dir/appendonlydir" ]; then
    echo "REDIS_APPENDONLY_MB=$(du_mb "$redis_dir/appendonlydir")"
  elif [ -f "$redis_dir/appendonly.aof" ]; then
    echo "REDIS_APPENDONLY_MB=$(du_mb "$redis_dir/appendonly.aof")"
  else
    echo "REDIS_APPENDONLY_MB=0"
  fi
fi

logdir="${PRECHECK_SYSLOG_DIR:-/var/log}"
sys_mb=0
sys_unknown=no
sys_any=no
for f in "$logdir"/syslog* "$logdir"/auth.log*; do
  [ -e "$f" ] || continue
  sys_any=yes
  n="$(du -sm "$f" 2>/dev/null | cut -f1)"
  case "$n" in
    ''|*[!0-9]*) sys_unknown=yes ;;
    *) sys_mb=$((sys_mb + n)) ;;
  esac
done
if [ "$sys_unknown" = yes ]; then
  echo "SYSLOG_AUTH_MB=unknown"
elif [ "$sys_any" = yes ]; then
  echo "SYSLOG_AUTH_MB=${sys_mb}"
else
  echo "SYSLOG_AUTH_MB=0"
fi

echo "POSTGRESQL_LOG_MB=$(du_mb "${PRECHECK_PG_LOG:-/var/log/postgresql}")"
echo "NPM_CACHE_MB=$(du_mb "$home/.npm")"
echo "COREPACK_CACHE_MB=$(du_mb "$home/.cache/node/corepack")"

git_mb=""
if [ -n "${EXPECT_DIR:-}" ] && [ -d "${EXPECT_DIR}/.git" ]; then
  git_mb="$(du_mb "${EXPECT_DIR}/.git")"
else
  best=0
  found=no
  for g in "$home"/.git "$home"/*/.git "$home"/*/*/.git "$home"/*/*/*/.git; do
    [ -d "$g" ] || continue
    n="$(du_mb "$g")"
    case "$n" in
      ''|*[!0-9]*) continue ;;
    esac
    if [ "$found" = no ] || [ "$n" -gt "$best" ]; then
      best="$n"
      found=yes
    fi
  done
  if [ "$found" = yes ]; then
    git_mb="$best"
  else
    git_mb=0
  fi
fi
echo "GIT_DIR_MB=${git_mb}"
echo "APT_CACHE_MB=$(du_mb "${PRECHECK_APT:-/var/cache/apt}")"

jmb="$(journalctl --disk-usage 2>/dev/null | awk '
  {
    if (match($0, /[0-9]+([.][0-9]+)?[KMGT]/)) {
      tok = substr($0, RSTART, RLENGTH)
      unit = substr(tok, length(tok), 1)
      num = substr(tok, 1, length(tok) - 1) + 0
      if (unit == "K") printf "%d\n", (num >= 512 ? 1 : 0)
      else if (unit == "M") printf "%d\n", int(num + 0.5)
      else if (unit == "G") printf "%d\n", int(num * 1024 + 0.5)
      else if (unit == "T") printf "%d\n", int(num * 1024 * 1024 + 0.5)
      exit
    }
  }
' || true)"
echo "JOURNAL_SIZE_MB=${jmb:-unknown}"

boots="$(journalctl --list-boots 2>/dev/null || true)"
oldest="$(printf '%s\n' "$boots" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | sort | head -1 || true)"
if [ -z "$oldest" ]; then
  oldest="$(journalctl --output=short-iso 2>/dev/null | head -1 | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1 || true)"
fi
echo "JOURNAL_OLDEST_DATE=${oldest:-unknown}"

echo "=== 17. 内存占用（只读，只打数字）==="
api_name="${EXPECT_PM2:-ai-job-print-api}"
emit_api_unknown() {
  echo "PM2_API_RSS_MB=unknown"
  echo "PM2_API_HEAP_MB=unknown"
  echo "PM2_API_RESTARTS=unknown"
  echo "PM2_API_UPTIME_HOURS=unknown"
}
api_raw=""
if command -v pm2 >/dev/null 2>&1 && pm2_daemon_up; then
  api_raw="$(pm2 jlist 2>/dev/null || true)"
fi
api_parsed=""
if [ -n "$api_raw" ] && command -v node >/dev/null 2>&1; then
  api_js="$(cat <<'JS'
const fs = require("fs");
function num(v) {
  if (typeof v === "boolean" || v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function emit(key, value) {
  process.stdout.write(key + "=" + value + "\n");
}
const name = process.env.PRECHECK_PM2_NAME || "ai-job-print-api";
const raw = fs.readFileSync(0, "utf8");
const start = raw.indexOf("[");
const end = raw.lastIndexOf("]");
let data = null;
if (start >= 0 && end > start) {
  try { data = JSON.parse(raw.slice(start, end + 1)); } catch (e) { data = null; }
}
let proc = null;
if (Array.isArray(data)) {
  for (const item of data) {
    if (item && typeof item === "object" && item.name === name) { proc = item; break; }
  }
}
if (!proc || typeof proc !== "object") {
  emit("PM2_API_RSS_MB", "unknown");
  emit("PM2_API_HEAP_MB", "unknown");
  emit("PM2_API_RESTARTS", "unknown");
  emit("PM2_API_UPTIME_HOURS", "unknown");
  process.exit(0);
}
const monit = proc.monit && typeof proc.monit === "object" ? proc.monit : {};
const penv = proc.pm2_env && typeof proc.pm2_env === "object" ? proc.pm2_env : {};
const mem = num(monit.memory);
emit("PM2_API_RSS_MB", mem == null ? "unknown" : String(Math.floor(mem / 1048576)));
const axm = penv.axm_monitor && typeof penv.axm_monitor === "object" ? penv.axm_monitor : {};
const heap = axm["Heap Used"];
let hv = null;
let unit = "";
if (heap && typeof heap === "object") {
  hv = num(heap.value);
  if (typeof heap.unit === "string") unit = heap.unit;
} else {
  hv = num(heap);
  unit = "MiB";
}
if (hv == null) emit("PM2_API_HEAP_MB", "unknown");
else {
  const u = unit.trim().toLowerCase();
  let mb = null;
  if (u === "" || u === "mib" || u === "mb" || u === "m") mb = hv;
  else if (u === "kib" || u === "kb" || u === "k") mb = hv / 1024;
  else if (u === "b" || u === "byte" || u === "bytes") mb = hv / 1048576;
  else if (u === "gib" || u === "gb" || u === "g") mb = hv * 1024;
  emit("PM2_API_HEAP_MB", mb == null ? "unknown" : String(Math.floor(mb + 0.5)));
}
const rt = penv.restart_time;
if (typeof rt === "boolean" || typeof rt !== "number") emit("PM2_API_RESTARTS", "unknown");
else emit("PM2_API_RESTARTS", String(Math.trunc(rt)));
const up = num(penv.pm_uptime);
const nowMs = Date.now();
if (up == null || up < 1000000000) emit("PM2_API_UPTIME_HOURS", "unknown");
else {
  const stamp = up >= 100000000000 ? up : up * 1000;
  const delta = nowMs - stamp;
  emit("PM2_API_UPTIME_HOURS", delta < 0 ? "unknown" : String(Math.floor(delta / 3600000)));
}
JS
)"
  api_parsed="$(printf '%s' "$api_raw" | PRECHECK_PM2_NAME="$api_name" node -e "$api_js" 2>/dev/null || true)"
fi
if printf '%s\n' "$api_parsed" | grep -q '^PM2_API_RSS_MB='; then
  printf '%s\n' "$api_parsed"
else
  emit_api_unknown
fi

if command -v free >/dev/null 2>&1; then
  free_out="$(LC_ALL=C free -m 2>/dev/null || true)"
  printf '%s\n' "$free_out" | awk '
    NR == 1 && $0 ~ /available/ { has = 1 }
    $1 == "Mem:" && $2 ~ /^[0-9]+$/ {
      total = $2
      if (has && NF >= 7 && $7 ~ /^[0-9]+$/) avail = $7
    }
    $1 == "Swap:" && $3 ~ /^[0-9]+$/ { swap = $3 }
    END {
      if (total == "") print "MEM_TOTAL_MB=unknown"
      else print "MEM_TOTAL_MB=" total
      if (avail == "") print "MEM_AVAILABLE_MB=unknown"
      else print "MEM_AVAILABLE_MB=" avail
      if (swap == "") print "SWAP_USED_MB=unknown"
      else print "SWAP_USED_MB=" swap
    }
  '
else
  echo "MEM_TOTAL_MB=unknown"
  echo "MEM_AVAILABLE_MB=unknown"
  echo "SWAP_USED_MB=unknown"
fi

if command -v redis-cli >/dev/null 2>&1; then
  redis_info="$(redis-cli INFO memory 2>/dev/null || true)"
  redis_human="$(printf '%s\n' "$redis_info" | awk -F: '$1 == "used_memory_human" { gsub(/^[ \t]+|[ \t\r]+$/, "", $2); print $2; exit }')"
  case "$redis_human" in
    ''|*[!0-9.KMGTPEBkmgtpeb]*) echo "REDIS_USED_MEMORY_HUMAN=unknown" ;;
    *) echo "REDIS_USED_MEMORY_HUMAN=${redis_human}" ;;
  esac
else
  echo "REDIS_USED_MEMORY_HUMAN=unknown"
fi

if command -v ps >/dev/null 2>&1; then
  if pg_rows="$(LC_ALL=C ps -eo rss=,comm= 2>/dev/null)"; then
    pg_mb="$(printf '%s\n' "$pg_rows" | awk '
      $1 ~ /^[0-9]+$/ && ($2 == "postgres" || index($2, "postgres:") == 1) { s += $1 }
      END { printf "%d\n", int(s / 1024 + 0.5) }
    ')"
    echo "POSTGRES_RSS_MB=${pg_mb:-0}"
  else
    echo "POSTGRES_RSS_MB=unknown"
  fi
else
  echo "POSTGRES_RSS_MB=unknown"
fi
echo "=== 完成：以上均为只读探测，未做任何修改 ==="
