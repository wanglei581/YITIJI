#!/usr/bin/env bash
# 清理 /srv 下白名单内的历史发布目录，以及 2026-09-29 只读盘点核对过的残留目录。
#
# 设计原则（合成 DeepSeek + antigravity 两份独立审查，2026-09-29 补充告急分支）：
#   1. 默认 dry-run：只跑护栏 + 列清单，绝不动任何文件。按可用空间预告将隔离或将直接删除。
#   2. 精确目录名白名单，绝不用通配符。
#   3. 每个待删目录逐项过 preflight。挂载点、当前运行目录、保留锚点一旦确认命中则整体中止。
#      被 pm2 的 cwd/exec_path 或 nginx 的 root/alias/include 引用的，只拒绝该目录并说明，其它继续。
#   4. execute 默认两阶段：先 mv 到隔离区 /srv/.cleanup-trash/<时间戳>，不直接 rm。
#      若 /srv 所在分区可用低于 STALE_CRITICAL_FREE_MB（默认 5120），
#      且服务健康检查通过、确认词正确，则对通过全部护栏的目录直接删除。
#   5. usb-bridge-live / -final- / releases 三类不在本白名单。
#   6. mount、find、ps、readlink、正在运行的 nginx、rpc.sock 存在时的 pm2，任一不可用或解析失败，
#      对应目录拒绝，不当作「没引用」。脚本不使用 set -e，每个探针单独看返回码。
#   7. 工作流输入只经环境变量进入，本脚本不拼接未加引号的外部字符串。
set -uo pipefail

MODE_INPUT="${CLEANUP_MODE:-}"
if [ -n "${CLEANUP_PURGE_PATH:-}" ]; then
  MODE=purge-trash
elif [ -n "$MODE_INPUT" ]; then
  MODE="$MODE_INPUT"
elif [ "${CLEANUP_EXECUTE:-}" = "true" ]; then
  MODE=execute
else
  MODE=dry-run
fi
CONFIRM="${CLEANUP_CONFIRM:-}"
EXPECT_CONFIRM="${CLEANUP_EXPECT_CONFIRM:-}"
CRITICAL_FREE_MB="${STALE_CRITICAL_FREE_MB:-5120}"
case "$CRITICAL_FREE_MB" in
  ''|*[!0-9]*) CRITICAL_FREE_MB=5120 ;;
esac

SRV_ROOT="/srv"
TRASH_ROOT="${SRV_ROOT}/.cleanup-trash"
TRASH="${TRASH_ROOT}/$(date +%Y%m%dT%H%M%S)"
STAMP_RE='^[0-9]{8}T[0-9]{6}$'

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

canon_path() {
  local p="$1" out
  if out="$(readlink -m -- "$p" 2>/dev/null)" && [ -n "$out" ]; then
    case "$out" in
      *..*) ;;
      *) printf '%s\n' "$out"; return 0 ;;
    esac
  fi
  if out="$(realpath -m -- "$p" 2>/dev/null)" && [ -n "$out" ]; then
    case "$out" in
      *..*) return 1 ;;
      *) printf '%s\n' "$out"; return 0 ;;
    esac
  fi
  return 1
}

if ! CURRENT="$(canon_path "${SRV_ROOT}/ai-job-print")"; then
  CURRENT="${SRV_ROOT}/ai-job-print"
fi

dev_of() {
  local p="$1" id
  id="$(stat -c %d -- "$p" 2>/dev/null || true)"
  case "$id" in
    ''|*[!0-9]*) id="$(stat -f %d -- "$p" 2>/dev/null || true)" ;;
  esac
  case "$id" in
    ''|*[!0-9]*) return 1 ;;
  esac
  printf '%s\n' "$id"
}

df_avail_mb() {
  local target="$1" n
  n="$(df -Pm "$target" 2>/dev/null | awk 'NR==2 { print $4; exit }')"
  case "$n" in
    ''|*[!0-9]*) return 1 ;;
  esac
  printf '%s\n' "$n"
}

pm2_sock_up() {
  local base sock
  base="${PM2_HOME:-}"
  if [ -z "$base" ]; then
    base="${HOME:-}/.pm2"
  fi
  sock="${base}/rpc.sock"
  [ -S "$sock" ]
}

# 健康检查形状以 services/api/src/common/health.controller.ts 为准：
# GET /api/v1/health 返回 { success:true, data:{ status:"ok"|"degraded", ... } }。
# 只有 data.status 正好是 ok 才算健康。degraded、error、解析失败都不健康。
health_body_ok() {
  local body="$1"
  if ! command -v node >/dev/null 2>&1; then
    return 1
  fi
  printf '%s' "$body" | node -e '
    const fs = require("fs");
    let j;
    try { j = JSON.parse(fs.readFileSync(0, "utf8")); }
    catch (e) { process.exit(1); }
    if (!j || j.success !== true || !j.data || j.data.status !== "ok") process.exit(1);
  '
}

service_healthy() {
  local port body rc
  local ok=no
  for port in 3010 3000 8080; do
    body="$(curl -fsS --max-time 5 "http://127.0.0.1:${port}/api/v1/health" 2>/dev/null)"
    rc=$?
    if [ "$rc" -ne 0 ] || [ -z "$body" ]; then
      continue
    fi
    if health_body_ok "$body"; then
      echo "  API /api/v1/health @:${port} → 可达且 status=ok"
      ok=yes
      break
    fi
    echo "  API /api/v1/health @:${port} 返回的不是 data.status=ok" >&2
    return 1
  done
  if [ "$ok" != yes ]; then
    echo "  API 健康检查不通过" >&2
    return 1
  fi
  return 0
}

MOUNT_OK=no
MOUNT_POINTS=""
load_mounts() {
  local out rc
  out="$(mount 2>/dev/null)"
  rc=$?
  if [ "$rc" -ne 0 ] || [ -z "$out" ]; then
    MOUNT_OK=no
    MOUNT_POINTS=""
    return 1
  fi
  MOUNT_POINTS="$(printf '%s\n' "$out" | awk '{ print $3 }')"
  rc=$?
  if [ "$rc" -ne 0 ] || [ -z "$MOUNT_POINTS" ]; then
    MOUNT_OK=no
    MOUNT_POINTS=""
    return 1
  fi
  MOUNT_OK=yes
  return 0
}

# 0 = 是挂载点，1 = 不是，2 = 探针不可用。
is_mount_point() {
  local p="$1" mp
  if [ "$MOUNT_OK" != yes ]; then
    return 2
  fi
  while IFS= read -r mp; do
    [ "$mp" = "$p" ] && return 0
  done <<EOF
$MOUNT_POINTS
EOF
  return 1
}

has_inner_mount() {
  local p="$1" mp
  if [ "$MOUNT_OK" != yes ]; then
    return 2
  fi
  while IFS= read -r mp; do
    case "$mp" in
      "$p"/*) return 0 ;;
    esac
  done <<EOF
$MOUNT_POINTS
EOF
  return 1
}

guard_trash_root() {
  local c mrc
  if [ -L "$TRASH_ROOT" ]; then
    refuse "隔离区根目录是软链，拒绝隔离和 purge：${TRASH_ROOT}"
  fi
  if [ "$MOUNT_OK" != yes ]; then
    refuse "mount 不可用，无法确认隔离区不是挂载点，拒绝隔离和 purge"
  fi
  if [ -e "$TRASH_ROOT" ]; then
    if ! c="$(canon_path "$TRASH_ROOT")"; then
      refuse "隔离区根目录无法规范化，拒绝隔离和 purge"
    fi
    if [ "$c" != "$TRASH_ROOT" ]; then
      refuse "隔离区根目录规范化后不是 ${TRASH_ROOT}，拒绝隔离和 purge"
    fi
    is_mount_point "$c"
    mrc=$?
    if [ "$mrc" -ne 1 ]; then
      refuse "隔离区根目录是挂载点或无法判断，拒绝隔离和 purge：${TRASH_ROOT}"
    fi
  fi
}

REF_LOADED=no
REF_HIT=""
PM2_INDETERMINATE=no
NGINX_INDETERMINATE=no
PM2_PATHS=()
NGINX_PATHS=()

PM2_JS='
const fs = require("fs");
const raw = fs.readFileSync(0, "utf8");
const s = raw.indexOf("[");
const e = raw.lastIndexOf("]");
if (s < 0 || e <= s) process.exit(1);
let data;
try { data = JSON.parse(raw.slice(s, e + 1)); }
catch (err) { process.exit(1); }
if (!Array.isArray(data)) process.exit(1);
const keys = ["pm_cwd", "pm_exec_path", "cwd"];
for (const item of data) {
  if (!item || typeof item !== "object") continue;
  const bags = [item, item.pm2_env];
  for (const bag of bags) {
    if (!bag || typeof bag !== "object") continue;
    for (const k of keys) {
      if (typeof bag[k] === "string" && bag[k]) process.stdout.write(bag[k] + "\n");
    }
  }
}
'

nginx_service_up() {
  if [ -f /run/nginx.pid ] || [ -f /var/run/nginx.pid ]; then
    return 0
  fi
  local comm rc
  comm="$(ps -eo comm= 2>/dev/null)"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    if command -v nginx >/dev/null 2>&1; then
      return 0
    fi
    return 1
  fi
  if printf '%s\n' "$comm" | grep -Eq '(^|/)nginx$'; then
    return 0
  fi
  return 1
}

remember_path() {
  local kind="$1" path="$2" canon
  if [[ "$path" == *'$'* ]] || [ -z "$path" ]; then
    if [ "$kind" = root ] || [ "$kind" = alias ] || [ "$kind" = include ]; then
      NGINX_INDETERMINATE=yes
    fi
    return 0
  fi
  if [ "$kind" = include ] && [[ "$path" == *[*?[]* ]]; then
    local m any=no
    while IFS= read -r m; do
      [ -n "$m" ] || continue
      any=yes
      if ! canon="$(canon_path "$m")"; then
        NGINX_INDETERMINATE=yes
        continue
      fi
      NGINX_PATHS+=("$canon")
    done < <(compgen -G "$path" || true)
    return 0
  fi
  if ! canon="$(canon_path "$path")"; then
    NGINX_INDETERMINATE=yes
    return 0
  fi
  NGINX_PATHS+=("$canon")
}

load_runtime_refs() {
  local raw rc paths p canon line kind path parsed
  if [ "$REF_LOADED" = yes ]; then
    return 0
  fi
  REF_LOADED=yes
  PM2_INDETERMINATE=no
  NGINX_INDETERMINATE=no
  PM2_PATHS=()
  NGINX_PATHS=()
  if pm2_sock_up; then
    if ! command -v pm2 >/dev/null 2>&1 || ! command -v node >/dev/null 2>&1; then
      PM2_INDETERMINATE=yes
    else
      raw="$(pm2 jlist 2>/dev/null)"
      rc=$?
      if [ "$rc" -ne 0 ] || [ -z "$raw" ]; then
        PM2_INDETERMINATE=yes
      else
        paths="$(printf '%s' "$raw" | node -e "$PM2_JS" 2>/dev/null)"
        rc=$?
        if [ "$rc" -ne 0 ]; then
          PM2_INDETERMINATE=yes
        else
          while IFS= read -r p; do
            [ -n "$p" ] || continue
            if ! canon="$(canon_path "$p")"; then
              PM2_INDETERMINATE=yes
              continue
            fi
            PM2_PATHS+=("$canon")
          done <<EOF
$paths
EOF
        fi
      fi
    fi
  else
    PM2_INDETERMINATE=yes
  fi
  if nginx_service_up; then
    if ! command -v nginx >/dev/null 2>&1; then
      NGINX_INDETERMINATE=yes
    else
      raw="$(nginx -T 2>/dev/null)"
      rc=$?
      if [ "$rc" -ne 0 ] || [ -z "$raw" ]; then
        NGINX_INDETERMINATE=yes
      else
        parsed="$(printf '%s\n' "$raw" | awk '
          function emit(kind, stmt,    path, n, i) {
            sub(/^[[:space:]]*(root|alias|include)[[:space:]]+/, "", stmt)
            gsub(/[[:space:]]+/, " ", stmt)
            gsub(/^[[:space:]]+|[[:space:]]+$/, "", stmt)
            gsub(/^["'\'']|["'\'']$/, "", stmt)
            if (stmt == "" || index(stmt, "$") > 0) { print "INDETERMINATE", kind; return }
            n = split(stmt, a, /[[:space:]]+/)
            path = a[1]
            gsub(/^["'\'']|["'\'']$/, "", path)
            if (path == "" || index(path, "$") > 0) { print "INDETERMINATE", kind; return }
            print kind, path
          }
          {
            line = $0
            sub(/\r$/, "", line)
            out = ""
            q = ""
            for (i = 1; i <= length(line); i++) {
              c = substr(line, i, 1)
              if (q == "") {
                if (c == "#") break
                if (c == "\"" || c == "'\''") q = c
                out = out c
              } else {
                out = out c
                if (c == q) q = ""
              }
            }
            buf = buf " " out
          }
          END {
            n = split(buf, parts, ";")
            for (i = 1; i <= n; i++) {
              s = parts[i]
              gsub(/^[[:space:]]+|[[:space:]]+$/, "", s)
              # 块指令没有分号，root/alias/include 常常在 "server {" 后面，不在片段开头。
              rest = s
              while (match(rest, /(^|[^A-Za-z0-9_])(root|alias|include)([[:space:]]|$)/)) {
                kw = RSTART
                pre = substr(rest, RSTART, 1)
                if (pre !~ /^[A-Za-z]/) kw = RSTART + 1
                stmt = substr(rest, kw)
                kind = stmt
                sub(/[[:space:]].*/, "", kind)
                sub(/[^A-Za-z].*/, "", kind)
                emit(kind, stmt)
                break
              }
            }
          }
        ')"
        rc=$?
        if [ "$rc" -ne 0 ]; then
          NGINX_INDETERMINATE=yes
        else
          while IFS= read -r line; do
            [ -n "$line" ] || continue
            kind="${line%% *}"
            path="${line#* }"
            if [ "$kind" = INDETERMINATE ]; then
              NGINX_INDETERMINATE=yes
              continue
            fi
            remember_path "$kind" "$path"
          done <<EOF
$parsed
EOF
        fi
      fi
    fi
  fi
  return 0
}

path_related() {
  local a="$1" b="$2"
  [ -n "$a" ] && [ -n "$b" ] || return 1
  [ "$a" = "$b" ] && return 0
  [[ "$a" == "$b"/* ]] && return 0
  [[ "$b" == "$a"/* ]] && return 0
  return 1
}

# 把引用结果写进 REF_HIT（pm2、nginx、pm2,nginx、none 或 indeterminate）。
# 不能放进 $(...)：那样 load_runtime_refs 在子 shell 里，REF_LOADED 留不下，删除前的重新加载会失效。
reference_of() {
  local resolved="$1" p hit_pm2=no hit_nginx=no
  load_runtime_refs
  if [ "$PM2_INDETERMINATE" = yes ] || [ "$NGINX_INDETERMINATE" = yes ]; then
    REF_HIT="indeterminate"
    return 0
  fi
  if [ "${#PM2_PATHS[@]}" -gt 0 ]; then
    for p in "${PM2_PATHS[@]}"; do
      if path_related "$p" "$resolved"; then
        hit_pm2=yes
      fi
    done
  fi
  if [ "${#NGINX_PATHS[@]}" -gt 0 ]; then
    for p in "${NGINX_PATHS[@]}"; do
      if path_related "$p" "$resolved"; then
        hit_nginx=yes
      fi
    done
  fi
  if [ "$hit_pm2" = yes ] && [ "$hit_nginx" = yes ]; then
    REF_HIT="pm2,nginx"
  elif [ "$hit_pm2" = yes ]; then
    REF_HIT="pm2"
  elif [ "$hit_nginx" = yes ]; then
    REF_HIT="nginx"
  else
    REF_HIT="none"
  fi
}

# 删除前再查一次软链、挂载点和引用。返回 0 才允许 rm。
recheck_target() {
  local target="$1" resolved ref mrc
  if [ -L "$target" ] || [ ! -d "$target" ]; then
    echo "   ❌ 拒绝处理：删除前已不是普通目录：${target}"
    return 1
  fi
  if ! resolved="$(canon_path "$target")"; then
    echo "   ❌ 拒绝处理：删除前无法规范化：${target}"
    return 1
  fi
  is_mount_point "$resolved"
  mrc=$?
  if [ "$mrc" -eq 2 ]; then
    echo "   ❌ 拒绝处理：删除前 mount 不可用：${target}"
    return 1
  fi
  if [ "$mrc" -eq 0 ]; then
    echo "   ❌ 拒绝处理：删除前发现是挂载点：${target}"
    return 1
  fi
  has_inner_mount "$resolved"
  mrc=$?
  if [ "$mrc" -ne 1 ]; then
    echo "   ❌ 拒绝处理：删除前内部挂载点不可判定或存在：${target}"
    return 1
  fi
  reference_of "$resolved"
  ref="$REF_HIT"
  if [ "$ref" != none ]; then
    echo "   ❌ 拒绝处理：删除前引用复查未过（${ref}）：${target}"
    return 1
  fi
  return 0
}

# —— purge-trash：真删指定的一层时间戳隔离目录 ——
if [ "$MODE" = purge-trash ]; then
  TARGET="${CLEANUP_PURGE_PATH:-}"
  [ -n "$TARGET" ] || refuse "purge-trash 需要 CLEANUP_PURGE_PATH"
  load_mounts || true
  guard_trash_root
  probe="$TARGET"
  while [ "$probe" != "${probe%/}" ]; do
    probe="${probe%/}"
  done
  if [ -L "$TARGET" ] || [ -L "$probe" ]; then
    refuse "不许是软链：${TARGET}"
  fi
  if ! canon="$(canon_path "$TARGET")"; then
    refuse "无法规范化：${TARGET}"
  fi
  base="${canon#"${TRASH_ROOT}/"}"
  if [ "$base" = "$canon" ] || [[ "$base" == */* ]] || [[ ! "$base" =~ $STAMP_RE ]]; then
    refuse "只允许删 ${TRASH_ROOT}/<YYYYMMDDTHHMMSS>：${TARGET}"
  fi
  if [ "$canon" != "${TRASH_ROOT}/${base}" ]; then
    refuse "路径规范化后不是单层时间戳目录：${TARGET}"
  fi
  if [ -L "${TRASH_ROOT}/${base}" ]; then
    refuse "不许是软链：${TARGET}"
  fi
  [ -d "$canon" ] || refuse "目录不存在：${TARGET}"
  is_mount_point "$canon"
  mrc=$?
  if [ "$mrc" -ne 1 ]; then
    refuse "目标是挂载点或无法判断挂载点，拒绝 purge：${TARGET}"
  fi
  [ -n "$EXPECT_CONFIRM" ] && [ "$CONFIRM" = "$EXPECT_CONFIRM" ] || refuse "confirm 不匹配，purge 中止（未删除任何文件）"
  echo "=== 删前健康检查（不正常就不删，那时更可能要 mv 回去）==="
  service_healthy || refuse "本机 API 健康检查不通过，拒绝删除隔离区"
  echo "=== 删除前空间 ==="; df -h "$SRV_ROOT" | tail -1
  SZ="$(du -sm "$canon" 2>/dev/null | cut -f1)"
  echo "即将删除 ${canon}（${SZ}MB）"
  if ! rm -rf -- "$canon"; then
    echo "WARNING: 删除失败 ${canon}" >&2
    exit 1
  fi
  if [ -e "$canon" ] || [ -L "$canon" ]; then
    echo "WARNING: 删除后路径仍在 ${canon}" >&2
    exit 1
  fi
  echo "=== 删除后空间 ==="; df -h "$SRV_ROOT" | tail -1
  echo "=== 已释放约 ${SZ}MB ==="
  exit 0
fi

echo "=== 运行模式：${MODE} ==="
echo "=== 当前生产目录（保留）：${CURRENT} ==="
echo

load_mounts || true

preflight() {
  local target="$1" resolved keep ref mrc sz_x sz_all
  echo "--- 检查 ${target}"

  case "$target" in
    /srv/ai-job-print-*) : ;;
    *) refuse "不匹配 /srv/ai-job-print-* 白名单形态：${target}" ;;
  esac
  [[ "$target" == *"*"* || "$target" == *".."* ]] && refuse "含通配符或相对路径：${target}"

  [ -e "$target" ] || { echo "   （不存在，跳过）"; return 1; }
  [ -d "$target" ] && [ ! -L "$target" ] || refuse "不是普通目录（可能是软链接）：${target}"

  if ! resolved="$(canon_path "$target")"; then
    echo "   ❌ 拒绝处理：readlink 不可用或无法规范化：${target}"
    return 1
  fi

  [ "$resolved" != "$CURRENT" ] || refuse "等于当前运行目录：${target}"
  [[ "$resolved" != "$CURRENT"/* ]] || refuse "在当前运行目录内部：${target}"

  for keep in "${KEEP_LIST[@]}"; do
    local kr
    if ! kr="$(canon_path "$keep")"; then
      kr="$keep"
    fi
    [ "$resolved" = "$kr" ] || [[ "$resolved" == "$kr"/* ]] && refuse "命中保留锚点 ${keep}：${target}"
  done

  is_mount_point "$resolved"
  mrc=$?
  if [ "$mrc" -eq 2 ]; then
    echo "   ❌ 拒绝处理：mount 不可用或输出无法解析，拒绝该目录：${target}"
    return 1
  fi
  if [ "$mrc" -eq 0 ]; then
    refuse "是挂载点：${target}"
  fi
  has_inner_mount "$resolved"
  mrc=$?
  if [ "$mrc" -eq 2 ]; then
    echo "   ❌ 拒绝处理：mount 不可用，无法判断内部挂载点：${target}"
    return 1
  fi
  if [ "$mrc" -eq 0 ]; then
    refuse "内部含挂载点（mv 会跨设备失败）：${target}"
  fi

  sz_x="$(du -xsm "$target" 2>/dev/null | cut -f1)"
  sz_all="$(du -sm "$target" 2>/dev/null | cut -f1)"
  case "$sz_x" in ''|*[!0-9]*) sz_x="" ;; esac
  case "$sz_all" in ''|*[!0-9]*) sz_all="" ;; esac
  if [ -z "$sz_x" ] || [ -z "$sz_all" ]; then
    echo "   ❌ 拒绝处理：du 失败，无法比较体积：${target}"
    return 1
  fi
  if [ "$sz_all" -gt "$((sz_x + 1))" ] || [ "$sz_x" -gt "$((sz_all + 1))" ]; then
    echo "   ⚠️ 体积口径差异：du -xsm=${sz_x}MB / du -sm=${sz_all}MB（差 $((sz_all - sz_x))MB）"
    if [ "$MODE" = execute ]; then
      echo "   ❌ 拒绝处理：体积差超过 1MB，execute 不处理该目录：${target}"
      return 1
    fi
    echo "      dry-run 只报告该差异。"
  fi

  reference_of "$resolved"
  ref="$REF_HIT"
  if [ "$ref" = indeterminate ] || [ -z "$ref" ]; then
    echo "   ❌ 拒绝处理：pm2 或 nginx 引用不可判定，本目录不移动也不删除：${target}"
    return 1
  fi
  if [ "$ref" != none ]; then
    echo "   ❌ 拒绝处理：被 ${ref} 引用（pm2 的 cwd/exec_path 或 nginx 的 root/alias/include 落在该目录下），本目录不移动也不删除"
    return 1
  fi

  if command -v lsof >/dev/null 2>&1; then
    if lsof +D "$target" >/dev/null 2>&1; then
      refuse "有进程打开其内文件：${target}"
    fi
  else
    echo "   ⚠️ 无 lsof，跳过文件句柄检查（execute 前请人工确认）"
  fi

  local find_out find_rc ps_out ps_rc
  find_out="$(find /proc/[0-9]*/cwd /proc/[0-9]*/root -maxdepth 0 -lname "${resolved}*" 2>/dev/null)"
  find_rc=$?
  if [ "$find_rc" -ne 0 ]; then
    echo "   ❌ 拒绝处理：find 不可用，无法判断进程 cwd：${target}"
    return 1
  fi
  if [ -n "$find_out" ]; then
    refuse "有进程 cwd/root 指向：${target}"
  fi

  ps_out="$(ps -eo args 2>/dev/null)"
  ps_rc=$?
  if [ "$ps_rc" -ne 0 ]; then
    echo "   ❌ 拒绝处理：ps 不可用，无法判断进程命令行：${target}"
    return 1
  fi
  if printf '%s\n' "$ps_out" | grep -F "$resolved" | grep -v grep | grep -q .; then
    refuse "有进程命令行引用：${target}"
  fi

  echo "   ✅ preflight 全过"
  return 0
}

BK="${SRV_ROOT}/ai-job-print-backups"
BK_MB="$(du -sm "$BK" 2>/dev/null | cut -f1)"
[ -n "${BK_MB:-}" ] && [ "$BK_MB" -gt 1024 ] || refuse "灾备底座 ${BK} 不足 1GB（${BK_MB} MB），拒绝清理"
echo "灾备底座 ${BK} = ${BK_MB}MB（> 1GB，OK）"
echo

RECLAIM=0
OK_TARGETS=()
for t in "${DELETE_LIST[@]}"; do
  if preflight "$t"; then
    mb="$(du -sm "$t" 2>/dev/null | cut -f1)"
    RECLAIM=$((RECLAIM + ${mb:-0}))
    OK_TARGETS+=("$t")
    echo "   → 可回收 ${mb}MB"
  fi
done
echo
echo "=== 通过 preflight 的目录 ${#OK_TARGETS[@]} 个，合计可回收约 ${RECLAIM}MB ==="

if ! FREE_MB="$(df_avail_mb "$SRV_ROOT")"; then
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

[ -n "$EXPECT_CONFIRM" ] && [ "$CONFIRM" = "$EXPECT_CONFIRM" ] \
  || refuse "confirm 不匹配，execute 中止（未移动或删除任何文件）"

echo "=== 执行前健康检查 ==="
service_healthy || refuse "服务健康检查不通过，拒绝删除或隔离"

FAIL_OP=0
if [ "$ACTION" = delete ]; then
  FREED=0
  if [ "${#OK_TARGETS[@]}" -gt 0 ]; then
    for t in "${OK_TARGETS[@]}"; do
      REF_LOADED=no
      if ! recheck_target "$t"; then
        echo "WARNING: 删除前复查未过，跳过 ${t}" >&2
        FAIL_OP=1
        continue
      fi
      mb="$(du -sm "$t" 2>/dev/null | cut -f1)"
      case "$mb" in ''|*[!0-9]*) mb=0 ;; esac
      echo "DELETE ${t}"
      if ! rm -rf -- "$t"; then
        echo "WARNING: 删除失败 ${t}" >&2
        FAIL_OP=1
        continue
      fi
      if [ -e "$t" ] || [ -L "$t" ]; then
        echo "WARNING: 删除后路径仍在 ${t}" >&2
        FAIL_OP=1
        continue
      fi
      FREED=$((FREED + mb))
    done
  fi
  echo "QUARANTINED_MB=0"
  echo "FREED_MB=${FREED}"
else
  guard_trash_root
  MOVED=0
  made=no
  if [ "${#OK_TARGETS[@]}" -gt 0 ]; then
    for t in "${OK_TARGETS[@]}"; do
      src_dev="$(dev_of "$t" 2>/dev/null || true)"
      if [ -z "$src_dev" ]; then
        echo "   ❌ 拒绝处理：读不到源目录文件系统：${t}"
        FAIL_OP=1
        continue
      fi
      if [ -e "$TRASH_ROOT" ]; then
        dst_dev="$(dev_of "$TRASH_ROOT" 2>/dev/null || true)"
      else
        dst_dev="$(dev_of "$SRV_ROOT" 2>/dev/null || true)"
      fi
      if [ -z "$dst_dev" ] || [ "$src_dev" != "$dst_dev" ]; then
        echo "   ❌ 拒绝处理：与隔离区不在同一文件系统，不做跨盘 mv：${t}"
        FAIL_OP=1
        continue
      fi
      if [ "$made" != yes ]; then
        mkdir -p "$TRASH"
        made=yes
      fi
      mb="$(du -sm "$t" 2>/dev/null | cut -f1)"
      case "$mb" in ''|*[!0-9]*) mb=0 ;; esac
      echo "MOVE ${t} → ${TRASH}/"
      if ! mv -- "$t" "${TRASH}/$(basename "$t")"; then
        echo "WARNING: 隔离失败 ${t}" >&2
        FAIL_OP=1
        continue
      fi
      if [ -e "$t" ]; then
        echo "WARNING: 隔离后源路径仍在 ${t}" >&2
        FAIL_OP=1
        continue
      fi
      MOVED=$((MOVED + mb))
    done
  fi
  echo
  echo "=== 已隔离到 ${TRASH}（未真删）==="
  echo "请依次验证，全部正常后再手动 rm -rf ${TRASH} ："
  echo "  nginx -t && curl -fsS http://127.0.0.1:3010/api/v1/health"
  echo "  pm2 jlist >/dev/null && df -h /"
  echo "建议观察 24-72 小时无异常后再删除隔离区。"
  echo "QUARANTINED_MB=${MOVED}"
  echo "FREED_MB=0"
fi
AFTER_MB="$(df_avail_mb "$SRV_ROOT" || true)"
echo "DF_AVAIL_MB_AFTER=${AFTER_MB:-unknown}"
if [ "$FAIL_OP" -ne 0 ]; then
  exit 1
fi
