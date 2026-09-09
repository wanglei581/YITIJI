#!/usr/bin/env bash
# collect-production-evidence.sh
#
# 生产证据只读采集：给产品负责人在生产服务器上跑一次，
# 收齐上线清单里「需 SSH / 生产 .env / PM2 / nginx / COS / 密钥」的 B 类 59 条。
#
# =============================================================================
# 硬性只读声明
# =============================================================================
# 本脚本是严格只读的。除 /tmp 下自己的临时目录外，不写任何路径。
# 禁止（本文件也不包含）以下写操作：
#   - 向仓库 / 运行目录 / .env / nginx 配置 / 系统目录做 > >> tee cp mv ln
#   - pm2 restart / start / stop / delete / flush / install / set
#   - systemctl 任意子命令（含 status 也不调，避免被当成运维动作）
#   - nginx -s reload|stop|quit、apt/yum/dnf/pnpm/npm install、改 .env、删业务文件
# 允许写的只有 mktemp 在 /tmp 下创建的目录，EXIT/INT/TERM 时 rm -rf 清掉。
#
# 本脚本会执行的命令类别（逐类列出，全部只读）：
#   1. 文件元数据：test / stat / ls / find / wc / head（不 cat 密钥文件、不 cat 日志正文）
#   2. 读配置：/etc/os-release、DEPLOY_SOURCE.txt、nginx -T dump（只抽指令，不打印证书私钥）
#   3. 读 .env：仅 grep -c '^KEY=' 判断键是否存在；长度/样值/scheme 由 python 解析后
#      只打印「已配置/未配置/长度 N/scheme=…」。绝不打印密钥值。
#      NODE_ENV 与 PAYMENT_PROVIDER 是取值不是密钥，允许打印。
#      其它非密钥开关（FILE_STORAGE_DRIVER / SMS_PROVIDER 等）为了能判定门禁，允许打印。
#   4. 进程：command -v、pgrep、ps、read /proc/<pid>/environ（只取允许键）
#   5. 运行时版本：node -v、pnpm -v、dpkg-query -W
#   6. PM2 只读：pm2 jlist（python 抽 name/status/restarts/日志路径/允许键，不 dump 全量 env）
#      pm2 conf pm2-logrotate（只读模块配置，不 pm2 set）
#   7. nginx 只读：nginx -T（配置 dump；不 -s、不 reload）
#   8. 本机 HTTP GET：curl 127.0.0.1:3010 的 health / ready / capabilities / channels
#      （不带鉴权；不跟 POST/PUT/PATCH/DELETE）
#   9. PostgreSQL 只读：psql -c 'SELECT/SHOW'（不 INSERT/UPDATE/DELETE/COPY/migrate/DROP）
#      不把 DATABASE_URL 放到命令行，避免 ps 泄露密码。
#  10. Redis 只读：redis-cli -h 127.0.0.1 PING / INFO（不 CONFIG SET / FLUSH / AUTH <密码>）
#      连不上时报 UNKNOWN，不从 .env 取出 REDIS_URL 密码去重试。
#  11. 证书只读：openssl x509 -noout -dates -subject -checkend（读 crt，不读 key）
#  12. Git 只读：rev-parse / status --porcelain / ls-files
#  13. 套接字/资源：ss -lnt、df、free、nproc、/proc/loadavg、timedatectl、fc-list
#  14. 字体/包查询：fc-list、dpkg-query
#  15. 临时文件：仅 /tmp/collect-prod-evidence.* ，结束删除
#
# 输出格式（每项恰好一段）：
#   [Bxx 项目] 判定(OK/NG/UNKNOWN) 证据(实际读到的东西)
# 拿不到就 UNKNOWN 并写原因，不猜、不留空。
# 判定看命令退出码（以及 http 状态码、openssl -checkend 退出码、psql 退出码），
# 不用「输出里有没有某句英文」当成功判据。
#
# 用法（在生产服务器上）：
#   bash scripts/collect-production-evidence.sh
#   bash scripts/collect-production-evidence.sh --runtime-dir /srv/ai-job-print
# 可选环境变量：RUNTIME_DIR / SOURCE_DIR / ENV_FILE / PM2_APP / API_PORT / PG_DB / PG_HOST
# 把 stdout 整段贴进工单即可。不要在 script 外面再 cat .env 或 pm2 env。

set -u
# 不用 set -e：单项失败必须继续采完 59 条。
# 不用 set -x：会把 .env 解析过程打到终端。
# 不用 set -o pipefail 作为全局：grep -c 无匹配时退出 1，不应炸掉整段。

umask 077

RUNTIME_DIR="${RUNTIME_DIR:-/srv/ai-job-print}"
SOURCE_DIR="${SOURCE_DIR:-/root/YITIJI}"
ENV_FILE="${ENV_FILE:-}"
PM2_APP="${PM2_APP:-ai-job-print-api}"
API_PORT="${API_PORT:-3010}"
PG_DB="${PG_DB:-ai_job_print}"
PG_HOST="${PG_HOST:-127.0.0.1}"
NGINX_BIN=""
PYTHON=""
WORKDIR=""
N_OK=0
N_NG=0
N_UNK=0
N_TOTAL=0

usage() {
  cat <<'EOF'
用法: bash scripts/collect-production-evidence.sh [选项]
  --runtime-dir DIR   API 运行目录（默认 /srv/ai-job-print）
  --source-dir DIR    源码检出（默认 /root/YITIJI）
  --env-file FILE     生产 .env（默认 DIR/services/api/.env）
  --pm2-app NAME      PM2 应用名（默认 ai-job-print-api）
  --api-port N        本机 API 端口（默认 3010）
  --help              显示本说明
严格只读。密钥只报已配置/未配置/长度。输出贴工单即可。
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --runtime-dir) RUNTIME_DIR="$2"; shift 2 ;;
    --source-dir) SOURCE_DIR="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --pm2-app) PM2_APP="$2"; shift 2 ;;
    --api-port) API_PORT="$2"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *)
      printf '未知参数: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ -z "$ENV_FILE" ]; then
  ENV_FILE="${RUNTIME_DIR}/services/api/.env"
fi

cleanup() {
  if [ -n "${WORKDIR:-}" ] && [ -d "$WORKDIR" ]; then
    rm -rf "$WORKDIR"
  fi
}
trap cleanup EXIT INT TERM

WORKDIR="$(mktemp -d /tmp/collect-prod-evidence.XXXXXX)" || {
  printf '无法在 /tmp 创建临时目录，中止\n' >&2
  exit 1
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

run_rc() {
  # 运行命令，把 stdout/stderr 收到 WORKDIR，返回退出码。不把失败当脚本中止。
  local out="$1" err="$2"
  shift 2
  "$@" >"$out" 2>"$err"
}

one_line() {
  printf '%s' "$1" | tr '\n\r\t' '   ' | sed 's/  */ /g; s/^ //; s/ $//'
}

# grep -c 无匹配时退出 1 但仍打印 0；后面不能再 `|| echo 0`，否则会变成 "0\n0"。
count_nonempty_lines() {
  local f="$1"
  if [ ! -s "$f" ]; then
    printf '0'
    return 0
  fi
  grep -c . "$f" 2>/dev/null || true
}

emit() {
  local id="$1" title="$2" verdict="$3" evidence="$4"
  N_TOTAL=$((N_TOTAL + 1))
  case "$verdict" in
    OK) N_OK=$((N_OK + 1)) ;;
    NG) N_NG=$((N_NG + 1)) ;;
    UNKNOWN) N_UNK=$((N_UNK + 1)) ;;
    *)
      verdict="UNKNOWN"
      evidence="内部错误：判定值非法；原证据: $evidence"
      N_UNK=$((N_UNK + 1))
      ;;
  esac
  printf '[%s %s] 判定(%s) 证据(%s)\n' "$id" "$title" "$verdict" "$(one_line "$evidence")"
}

# 键是否存在：只看 grep 退出码。grep -c 有匹配=0、无匹配=1、出错=2。
# 打印到临时文件的是数字，不是密钥值。
env_key_count() {
  local key="$1"
  local out="$WORKDIR/grepcount" err="$WORKDIR/greperr" rc
  if [ ! -f "$ENV_FILE" ]; then
    echo "err"
    return 2
  fi
  grep -c -E "^(export[[:space:]]+)?${key}=" "$ENV_FILE" >"$out" 2>"$err"
  rc=$?
  if [ "$rc" -eq 0 ] || [ "$rc" -eq 1 ]; then
    cat "$out"
    return "$rc"
  fi
  echo "err"
  return 2
}

if has_cmd python3; then
  PYTHON=python3
elif has_cmd python; then
  PYTHON=python
else
  PYTHON=""
fi

if has_cmd nginx; then
  NGINX_BIN=nginx
elif [ -x /usr/sbin/nginx ]; then
  NGINX_BIN=/usr/sbin/nginx
fi

# ---------- 内嵌 python 助手（只在 /tmp 落地，结束删除）----------
if [ -n "$PYTHON" ]; then
  cat >"$WORKDIR/helper.py" <<'PY'
# -*- coding: utf-8 -*-
"""只读助手：解析 .env / pm2 jlist / health JSON。默认不打印密钥值。"""
from __future__ import print_function

import json
import os
import re
import sys
from datetime import datetime, timezone

ALLOW_VALUE = {
    "NODE_ENV",
    "PAYMENT_PROVIDER",
    "FILE_STORAGE_DRIVER",
    "SMS_PROVIDER",
    "OCR_PROVIDER",
    "AI_PROVIDER",
    "ASR_PROVIDER",
    "CONVERSION_ENGINE",
    "SOFFICE_PATH",
    "GOTENBERG_URL",
    "CONVERSION_MAX_CONCURRENCY",
    "CONVERSION_TIMEOUT",
    "PRINT_REQUIRE_PII_SCAN",
    "PRINT_REQUIRE_PRINTER_ONLINE",
    "PRINT_SCAN_CAPABILITY_MODE",
    "TRUST_PROXY_HOPS",
    "TERMINAL_LEGACY_REGISTER_ENABLED",
    "TERMINAL_PLANNED_PROVISIONING_ENABLED",
    "PAYMENT_NOTIFY_BASE_URL",
    "PAYMENT_CODEPAY_AUTO_CONVERGE_ENABLED",
    "PAYMENT_QR_EXPIRY_AUTO_RELEASE_ENABLED",
    "REFUND_AUTO_CONVERGE_ENABLED",
    "LOG_LEVEL",
    "PINO_LEVEL",
    "PORT",
    "CORS_ALLOWED_ORIGINS",
    "TENCENT_COS_REGION",
    "TENCENT_COS_SIGN_URL_EXPIRES_SECONDS",
    "RESUME_PDF_FONT_PATH",
    "RESUME_PDF_FONT_FAMILY",
    "JOB_MATERIAL_PDF_FONT_PATH",
    "JOB_MATERIAL_PDF_FONT_FAMILY",
    "TENCENT_SMS_SIGN_NAME",
    "TENCENT_SMS_TEMPLATE_ID",
    "TENCENT_SMS_SDK_APP_ID",
    "TENCENT_SMS_REGION",
    "TRTC_REGION",
    "TRTC_LLM_TYPE",
    "TRTC_LLM_MODEL",
    "AI_LLM_MODEL",
    "CONTRACT_REVIEW_PROVIDER",
    "AI_IMAGE_PROVIDER",
    "DATA_DELETION_ENABLED",
    "FILE_STORAGE_DIR",
}

SAMPLE_MARKERS = ("dev-only-", "dev-", "test-", "replace-with-", "change-me")
KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def unquote(raw):
    if not raw:
        return ""
    first = raw[0]
    if first in ("'", '"'):
        i = 1
        out = []
        while i < len(raw):
            ch = raw[i]
            if ch == "\\" and first == '"' and i + 1 < len(raw):
                nxt = raw[i + 1]
                out.append({"n": "\n", "r": "\r", "t": "\t"}.get(nxt, nxt))
                i += 2
                continue
            if ch == first:
                return "".join(out)
            out.append(ch)
            i += 1
        return "".join(out)
    comment = re.search(r"\s+#", raw)
    return (raw[: comment.start()] if comment else raw).strip()


def parse_env_file(path):
    env = {}
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        text = fh.read()
    if text[:1] == "\ufeff":
        text = text[1:]
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export ") or line.startswith("export\t"):
            line = line.split(None, 1)[1]
        m = re.search(r"\s*=\s*", line)
        if not m or m.start() <= 0:
            continue
        key = line[: m.start()].strip()
        if not KEY_RE.match(key):
            continue
        env[key] = unquote(line[m.end() :])
    return env


def sample_marker(value):
    lowered = value.lower()
    for marker in SAMPLE_MARKERS:
        if lowered.startswith(marker):
            return marker
    return ""


def scheme_host(key, value):
    if key not in ("DATABASE_URL", "REDIS_URL") or not value:
        return "-", "-"
    v = value.strip().strip('"').strip("'")
    if v.startswith("file:"):
        return "file", "-"
    try:
        from urllib.parse import urlparse

        u = urlparse(v)
        scheme = u.scheme or "other"
        host = u.hostname or "-"
        port = u.port
        hostport = "%s:%s" % (host, port) if port else host
        return scheme, hostport
    except Exception:
        if v.startswith("postgres"):
            return "postgresql", "-"
        if v.startswith("redis"):
            return "redis", "-"
        return "other", "-"


def cmd_env_meta(path, keys):
    if not os.path.isfile(path):
        print("ENV_FILE_MISSING")
        return 2
    env = parse_env_file(path)
    for key in keys:
        if key not in env:
            print("%s present=no length=0 sample=no scheme=- host=-" % key)
            continue
        value = env[key]
        trimmed = value.strip() if isinstance(value, str) else ""
        present = "yes" if trimmed else "empty"
        scheme, host = scheme_host(key, trimmed)
        marker = sample_marker(trimmed) if trimmed else ""
        print(
            "%s present=%s length=%d sample=%s scheme=%s host=%s"
            % (
                key,
                present,
                len(trimmed),
                marker if marker else "no",
                scheme,
                host,
            )
        )
    return 0


def cmd_env_value(path, key):
    if key not in ALLOW_VALUE:
        sys.stderr.write("REFUSED_VALUE_PRINT key=%s\n" % key)
        return 2
    if not os.path.isfile(path):
        return 2
    env = parse_env_file(path)
    if key not in env:
        print("")
        return 1
    value = env[key].strip()
    print(value.replace("\n", "\\n"))
    return 0 if value else 1


def cmd_env_keys(path):
    if not os.path.isfile(path):
        return 2
    env = parse_env_file(path)
    for key in sorted(env.keys()):
        print(key)
    return 0


def _pm2_env_get(pm2_env, key):
    if not isinstance(pm2_env, dict):
        return None
    val = pm2_env.get(key)
    if isinstance(val, str):
        return val
    nested = pm2_env.get("env")
    if isinstance(nested, dict):
        nval = nested.get(key)
        if isinstance(nval, str):
            return nval
    return None


def cmd_pm2_summary():
    raw = sys.stdin.read()
    if not raw.strip():
        print("pm2_jlist=empty")
        return 1
    try:
        data = json.loads(raw)
    except Exception as exc:
        print("pm2_jlist=unparseable err=%s" % type(exc).__name__)
        return 1
    if not isinstance(data, list):
        print("pm2_jlist=not_array")
        return 1
    print("pm2_count=%d" % len(data))
    for proc in data:
        env = proc.get("pm2_env") or {}
        name = proc.get("name") or env.get("name") or "?"
        status = env.get("status") or "?"
        restarts = env.get("restart_time")
        unstable = env.get("unstable_restarts")
        pid = proc.get("pid")
        cwd = env.get("pm_cwd") or env.get("exec_cwd") or ""
        script = env.get("pm_exec_path") or ""
        node_ver = env.get("node_version") or ""
        err_log = env.get("pm_err_log_path") or ""
        out_log = env.get("pm_out_log_path") or ""
        node_env = _pm2_env_get(env, "NODE_ENV") or ""
        pay = _pm2_env_get(env, "PAYMENT_PROVIDER") or ""
        print(
            "proc name=%s status=%s pid=%s restarts=%s unstable_restarts=%s node=%s cwd=%s script=%s err_log=%s out_log=%s NODE_ENV=%s PAYMENT_PROVIDER=%s"
            % (
                name,
                status,
                pid,
                restarts,
                unstable,
                node_ver,
                cwd,
                script,
                err_log,
                out_log,
                node_env,
                pay,
            )
        )
    return 0


def cmd_proc_env(pid, keys):
    path = "/proc/%s/environ" % pid
    try:
        blob = open(path, "rb").read()
    except OSError as exc:
        print("proc_environ=unreadable errno=%s" % getattr(exc, "errno", "?"))
        return 1
    env = {}
    for item in blob.split(b"\0"):
        if not item or b"=" not in item:
            continue
        k, v = item.split(b"=", 1)
        try:
            env[k.decode("utf-8", "replace")] = v.decode("utf-8", "replace")
        except Exception:
            continue
    for key in keys:
        if key not in env:
            print("%s=absent" % key)
            continue
        val = env[key]
        if key in ALLOW_VALUE:
            print("%s=%s" % (key, val.replace("\n", "\\n")))
        else:
            print("%s=present length=%d" % (key, len(val)))
    return 0


def _dig(obj, path):
    cur = obj
    for part in path.split("."):
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        else:
            return None
    return cur


def cmd_json_fields():
    raw = sys.stdin.read()
    try:
        obj = json.loads(raw)
    except Exception as exc:
        print("json=unparseable err=%s" % type(exc).__name__)
        return 1
    args = sys.argv[2:]
    bits = []
    for path in args:
        val = _dig(obj, path)
        if val is None:
            data = obj.get("data") if isinstance(obj, dict) else None
            if isinstance(data, dict):
                val = _dig(data, path)
        if isinstance(val, (dict, list)):
            bits.append("%s=%s" % (path, json.dumps(val, ensure_ascii=False, separators=(",", ":"))))
        else:
            bits.append("%s=%s" % (path, val))
    print(" ".join(bits))
    return 0


def cmd_node_semver(ver, lo_major, lo_minor, hi_major):
    m = re.match(r"v?(\d+)\.(\d+)", ver or "")
    if not m:
        print("parse=fail")
        return 1
    major, minor = int(m.group(1)), int(m.group(2))
    ok = (int(lo_major), int(lo_minor)) <= (major, minor) < (int(hi_major), 0)
    print("major=%d minor=%d in_range=%s" % (major, minor, "yes" if ok else "no"))
    return 0 if ok else 1


def cmd_nginx_extract():
    body = sys.stdin.read()
    want = (
        "client_max_body_size",
        "proxy_pass",
        "proxy_read_timeout",
        "proxy_send_timeout",
        "client_body_timeout",
        "proxy_http_version",
        "ssl_certificate ",
        "listen ",
        "server_name ",
        "root ",
        "location ",
        "upgrade",
        "connection",
    )
    n = 0
    for raw in body.splitlines():
        line = raw.strip()
        lower = line.lower()
        if "ssl_certificate_key" in lower:
            continue
        if any(tok in lower for tok in ("begin ", "private key", "api_key", "secret")):
            continue
        if any(w in lower for w in want):
            print(line)
            n += 1
            if n >= 200:
                print("truncated=yes")
                break
    return 0


def cmd_now_iso():
    print(datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
    return 0


def main():
    if len(sys.argv) < 2:
        sys.stderr.write("helper: missing command\n")
        return 2
    cmd = sys.argv[1]
    if cmd == "env-meta":
        return cmd_env_meta(sys.argv[2], sys.argv[3:])
    if cmd == "env-value":
        return cmd_env_value(sys.argv[2], sys.argv[3])
    if cmd == "env-keys":
        return cmd_env_keys(sys.argv[2])
    if cmd == "pm2-summary":
        return cmd_pm2_summary()
    if cmd == "proc-env":
        return cmd_proc_env(sys.argv[2], sys.argv[3:])
    if cmd == "json-fields":
        return cmd_json_fields()
    if cmd == "node-semver":
        return cmd_node_semver(*sys.argv[2:6])
    if cmd == "nginx-extract":
        return cmd_nginx_extract()
    if cmd == "now-iso":
        return cmd_now_iso()
    sys.stderr.write("helper: unknown command\n")
    return 2


if __name__ == "__main__":
    sys.exit(main())
PY
fi

helper() {
  if [ -z "$PYTHON" ]; then
    return 127
  fi
  "$PYTHON" "$WORKDIR/helper.py" "$@"
}

env_meta() {
  helper env-meta "$ENV_FILE" "$@"
}

env_value() {
  helper env-value "$ENV_FILE" "$1"
}

# ---------- 探测工具 / 路径（失败不中止）----------
NOW="$(date -Is 2>/dev/null || date)"
HOST="$(hostname 2>/dev/null || echo unknown)"
WHO="$(id -un 2>/dev/null || echo unknown)"

printf '=== collect-production-evidence 只读采集 ===\n'
printf 'host=%s user=%s now=%s\n' "$HOST" "$WHO" "$NOW"
printf 'runtime_dir=%s source_dir=%s env_file=%s pm2_app=%s api_port=%s\n' \
  "$RUNTIME_DIR" "$SOURCE_DIR" "$ENV_FILE" "$PM2_APP" "$API_PORT"
printf 'python=%s nginx=%s\n' "${PYTHON:-MISSING}" "${NGINX_BIN:-MISSING}"
printf '说明: 密钥只报已配置/未配置/长度; NODE_ENV 与 PAYMENT_PROVIDER 打印取值。\n'
printf '\n'

# ---------- B01 OS ----------
if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  PRETTY_NAME="" VERSION_ID=""
  PRETTY_NAME="$(. /etc/os-release; printf '%s' "${PRETTY_NAME:-}")"
  VERSION_ID="$(. /etc/os-release; printf '%s' "${VERSION_ID:-}")"
  KERN="$(uname -r 2>/dev/null || echo unknown)"
  UNAME_RC=0
  uname -r >/dev/null 2>&1 || UNAME_RC=$?
  if [ "$UNAME_RC" -eq 0 ] && [ -n "$PRETTY_NAME" ]; then
    emit B01 "操作系统" OK "PRETTY_NAME=${PRETTY_NAME} VERSION_ID=${VERSION_ID} kernel=${KERN}"
  else
    emit B01 "操作系统" UNKNOWN "os-release 读到 PRETTY_NAME='${PRETTY_NAME}' 但 uname rc=${UNAME_RC}"
  fi
else
  emit B01 "操作系统" UNKNOWN "/etc/os-release 不可读"
fi

# ---------- B02 Node.js ----------
if has_cmd node; then
  run_rc "$WORKDIR/nodev" "$WORKDIR/nodev.err" node -v
  NODE_RC=$?
  NODE_VER="$(tr -d '\n' <"$WORKDIR/nodev")"
  if [ "$NODE_RC" -ne 0 ]; then
    emit B02 "Node.js 版本" UNKNOWN "node -v rc=${NODE_RC} stderr=$(one_line "$(cat "$WORKDIR/nodev.err")")"
  elif [ -n "$PYTHON" ]; then
    helper node-semver "$NODE_VER" 22 13 23 >"$WORKDIR/semver" 2>"$WORKDIR/semver.err"
    SEM_RC=$?
    SEM_OUT="$(tr -d '\n' <"$WORKDIR/semver")"
    if [ "$SEM_RC" -eq 0 ]; then
      emit B02 "Node.js 版本" OK "node=${NODE_VER} engines='>=22.13 <23' ${SEM_OUT}"
    else
      emit B02 "Node.js 版本" NG "node=${NODE_VER} 不在 >=22.13 <23 内 ${SEM_OUT}"
    fi
  else
    emit B02 "Node.js 版本" UNKNOWN "node=${NODE_VER} 无 python，无法做区间比较；项目 engines 为 >=22.13 <23"
  fi
else
  emit B02 "Node.js 版本" UNKNOWN "PATH 中没有 node"
fi

# ---------- B03 pnpm ----------
if has_cmd pnpm; then
  run_rc "$WORKDIR/pnpmv" "$WORKDIR/pnpmv.err" pnpm -v
  PNPM_RC=$?
  PNPM_VER="$(tr -d '\n' <"$WORKDIR/pnpmv")"
  if [ "$PNPM_RC" -eq 0 ] && [ -n "$PNPM_VER" ]; then
    case "$PNPM_VER" in
      11.*) emit B03 "pnpm 版本" OK "pnpm=${PNPM_VER} packageManager=pnpm@11.2.2" ;;
      *) emit B03 "pnpm 版本" NG "pnpm=${PNPM_VER} 期望 11.x（锁文件 pnpm@11.2.2）" ;;
    esac
  else
    emit B03 "pnpm 版本" UNKNOWN "pnpm -v rc=${PNPM_RC}"
  fi
else
  emit B03 "pnpm 版本" UNKNOWN "PATH 中没有 pnpm"
fi

# ---------- PostgreSQL 探测（全程不传密码）----------
PSQL_BIN=""
PSQL_BASE=()
PG_PROBE_RC=127
PG_PROBE_MSG="psql 不可用"
if has_cmd psql; then
  PSQL_BIN=psql
  run_rc "$WORKDIR/pgprobe" "$WORKDIR/pgprobe.err" \
    psql -h "$PG_HOST" -d "$PG_DB" -Atc "SELECT 1"
  PG_PROBE_RC=$?
  if [ "$PG_PROBE_RC" -eq 0 ]; then
    PSQL_BASE=(psql -h "$PG_HOST" -d "$PG_DB" -At)
    PG_PROBE_MSG="tcp ${PG_HOST}/${PG_DB} SELECT 1 ok"
  else
    run_rc "$WORKDIR/pgprobe2" "$WORKDIR/pgprobe2.err" \
      psql -d "$PG_DB" -Atc "SELECT 1"
    PG_PROBE_RC=$?
    if [ "$PG_PROBE_RC" -eq 0 ]; then
      PSQL_BASE=(psql -d "$PG_DB" -At)
      PG_PROBE_MSG="local socket/${PG_DB} SELECT 1 ok"
    else
      PG_PROBE_MSG="psql SELECT 1 失败 rc=${PG_PROBE_RC}（未使用 DATABASE_URL，以免命令行泄露密码）"
    fi
  fi
fi

psql_ro() {
  if [ -z "$PSQL_BIN" ] || [ "$PG_PROBE_RC" -ne 0 ]; then
    return 127
  fi
  "${PSQL_BASE[@]}" -c "$1"
}

# ---------- B04 PostgreSQL ----------
if [ -z "$PSQL_BIN" ]; then
  emit B04 "PostgreSQL 连通与版本" UNKNOWN "PATH 中没有 psql"
elif [ "$PG_PROBE_RC" -ne 0 ]; then
  emit B04 "PostgreSQL 连通与版本" UNKNOWN "$PG_PROBE_MSG"
else
  PG_VER="$(psql_ro "SHOW server_version;" 2>"$WORKDIR/pgver.err")"
  PG_VER_RC=$?
  PG_VER="$(printf '%s' "$PG_VER" | tr -d '\n')"
  if [ "$PG_VER_RC" -eq 0 ] && [ -n "$PG_VER" ]; then
    case "$PG_VER" in
      16.*) emit B04 "PostgreSQL 连通与版本" OK "${PG_PROBE_MSG} server_version=${PG_VER}" ;;
      *) emit B04 "PostgreSQL 连通与版本" NG "${PG_PROBE_MSG} server_version=${PG_VER} 清单建议 16.x" ;;
    esac
  else
    emit B04 "PostgreSQL 连通与版本" UNKNOWN "SELECT 1 成功但 SHOW server_version rc=${PG_VER_RC}"
  fi
fi

# ---------- B05 Redis ----------
if has_cmd redis-cli; then
  run_rc "$WORKDIR/redis_ping" "$WORKDIR/redis_ping.err" redis-cli -h 127.0.0.1 ping
  REDIS_PING_RC=$?
  PING_OUT="$(tr -d '\n' <"$WORKDIR/redis_ping")"
  if [ "$REDIS_PING_RC" -ne 0 ]; then
    emit B05 "Redis 连通与版本" UNKNOWN "redis-cli ping rc=${REDIS_PING_RC}（未从 .env 取 REDIS_URL 重试，避免泄露密码） out=${PING_OUT}"
  else
    run_rc "$WORKDIR/redis_info" "$WORKDIR/redis_info.err" redis-cli -h 127.0.0.1 INFO server
    INFO_RC=$?
    if [ "$INFO_RC" -ne 0 ]; then
      emit B05 "Redis 连通与版本" UNKNOWN "PING 成功但 INFO server rc=${INFO_RC}"
    else
      REDIS_VER="$(awk -F: '/^redis_version:/ {print $2}' "$WORKDIR/redis_info" | tr -d '\r')"
      if [ -n "$REDIS_VER" ]; then
        case "$REDIS_VER" in
          7.*) emit B05 "Redis 连通与版本" OK "ping=${PING_OUT} redis_version=${REDIS_VER} rc_ping=0" ;;
          *) emit B05 "Redis 连通与版本" NG "ping=${PING_OUT} redis_version=${REDIS_VER} 清单建议 7.x" ;;
        esac
      else
        emit B05 "Redis 连通与版本" UNKNOWN "PING 成功但 INFO 里没有 redis_version 行"
      fi
    fi
  fi
else
  emit B05 "Redis 连通与版本" UNKNOWN "PATH 中没有 redis-cli"
fi

# ---------- B06 CJK fonts ----------
if has_cmd fc-list; then
  run_rc "$WORKDIR/fc" "$WORKDIR/fc.err" fc-list :lang=zh family
  FC_RC=$?
  if [ "$FC_RC" -ne 0 ]; then
    emit B06 "中文字体 fc-list" UNKNOWN "fc-list rc=${FC_RC}"
  else
    FC_LINES="$(count_nonempty_lines "$WORKDIR/fc")"
    FC_SAMPLE="$(head -5 "$WORKDIR/fc" | tr '\n' ';' )"
    if [ "${FC_LINES:-0}" -gt 0 ]; then
      emit B06 "中文字体 fc-list" OK "zh_family_lines=${FC_LINES} sample=${FC_SAMPLE}"
    else
      emit B06 "中文字体 fc-list" NG "fc-list rc=0 但 :lang=zh 0 行"
    fi
  fi
else
  emit B06 "中文字体 fc-list" UNKNOWN "PATH 中没有 fc-list"
fi

# ---------- B07 timezone ----------
if has_cmd timedatectl; then
  run_rc "$WORKDIR/tz" "$WORKDIR/tz.err" timedatectl
  TZ_RC=$?
  if [ "$TZ_RC" -ne 0 ]; then
    emit B07 "时区" UNKNOWN "timedatectl rc=${TZ_RC}"
  else
    TZ_LINE="$(awk -F': ' '/Time zone/ {print $2}' "$WORKDIR/tz" | head -1)"
    NTP_LINE="$(awk -F': ' '/NTP|System clock synchronized/ {print $1"="$2}' "$WORKDIR/tz" | tr '\n' ' ')"
    case "$TZ_LINE" in
      *Asia/Shanghai*) emit B07 "时区" OK "Time zone=${TZ_LINE} ${NTP_LINE}" ;;
      "") emit B07 "时区" UNKNOWN "timedatectl rc=0 但无 Time zone 行" ;;
      *) emit B07 "时区" NG "Time zone=${TZ_LINE} 期望 Asia/Shanghai" ;;
    esac
  fi
else
  emit B07 "时区" UNKNOWN "PATH 中没有 timedatectl"
fi

# ---------- B08 disk ----------
run_rc "$WORKDIR/df" "$WORKDIR/df.err" df -Pk /
DF_RC=$?
if [ "$DF_RC" -ne 0 ]; then
  emit B08 "磁盘余量" UNKNOWN "df -Pk / rc=${DF_RC}"
else
  DF_LINE="$(awk 'NR==2 {printf "blocks=%s used=%s avail_kb=%s cap=%s mount=%s",$2,$3,$4,$5,$6}' "$WORKDIR/df")"
  AVAIL_KB="$(awk 'NR==2 {print $4}' "$WORKDIR/df")"
  case "$AVAIL_KB" in
    ''|*[!0-9]*) emit B08 "磁盘余量" UNKNOWN "df 成功但无法解析 avail ${DF_LINE}" ;;
    0) emit B08 "磁盘余量" NG "${DF_LINE}" ;;
    *) emit B08 "磁盘余量" OK "${DF_LINE} （清单未给阈值，本项按采集成功+avail>0 记 OK，是否够用由产品负责人看数字）" ;;
  esac
fi

# ---------- B09 memory/cpu ----------
run_rc "$WORKDIR/free" "$WORKDIR/free.err" free -m
FREE_RC=$?
NPROC_N="$(nproc 2>/dev/null || echo "?")"
LOAD="$(cat /proc/loadavg 2>/dev/null || echo "?")"
if [ "$FREE_RC" -ne 0 ]; then
  emit B09 "内存与 CPU" UNKNOWN "free -m rc=${FREE_RC} nproc=${NPROC_N} loadavg=${LOAD}"
else
  MEM="$(awk '/^Mem:/ {printf "mem_total_mb=%s used_mb=%s avail_mb=%s",$2,$3,$7}' "$WORKDIR/free")"
  emit B09 "内存与 CPU" OK "${MEM} nproc=${NPROC_N} loadavg=${LOAD}"
fi

# ---------- B10 listen ports ----------
if has_cmd ss; then
  run_rc "$WORKDIR/ss" "$WORKDIR/ss.err" ss -lnt
  SS_RC=$?
  if [ "$SS_RC" -ne 0 ]; then
    emit B10 "监听端口" UNKNOWN "ss -lnt rc=${SS_RC}"
  else
    PUB80="$(awk '$4 ~ /:80$/ {c++} END {print c+0}' "$WORKDIR/ss")"
    PUB443="$(awk '$4 ~ /:443$/ {c++} END {print c+0}' "$WORKDIR/ss")"
    PUB22="$(awk '$4 ~ /:22$/ {c++} END {print c+0}' "$WORKDIR/ss")"
    PG_BIND="$(awk '$4 ~ /:5432$/ {print $4}' "$WORKDIR/ss" | tr '\n' ',')"
    RD_BIND="$(awk '$4 ~ /:6379$/ {print $4}' "$WORKDIR/ss" | tr '\n' ',')"
    API_BIND="$(awk '$4 ~ /:3010$/ {print $4}' "$WORKDIR/ss" | tr '\n' ',')"
    PG_BAD="$(awk '$4 ~ /(0\.0\.0\.0|\*|\[::\]):5432$/ {c++} END {print c+0}' "$WORKDIR/ss")"
    RD_BAD="$(awk '$4 ~ /(0\.0\.0\.0|\*|\[::\]):6379$/ {c++} END {print c+0}' "$WORKDIR/ss")"
    if [ "$PG_BAD" -eq 0 ] && [ "$RD_BAD" -eq 0 ]; then
      emit B10 "监听端口" OK "ss_rc=0 listen80=${PUB80} listen443=${PUB443} listen22=${PUB22} pg=${PG_BIND:-none} redis=${RD_BIND:-none} api=${API_BIND:-none} pg_public=no redis_public=no"
    else
      emit B10 "监听端口" NG "ss_rc=0 pg=${PG_BIND} redis=${RD_BIND} pg_public=${PG_BAD} redis_public=${RD_BAD} （5432/6379 不得对公网）"
    fi
  fi
else
  emit B10 "监听端口" UNKNOWN "PATH 中没有 ss"
fi

# ---------- B11 source git SHA ----------
if [ -d "$SOURCE_DIR/.git" ] && has_cmd git; then
  run_rc "$WORKDIR/sha" "$WORKDIR/sha.err" git -C "$SOURCE_DIR" rev-parse HEAD
  SHA_RC=$?
  SHA="$(tr -d '\n' <"$WORKDIR/sha")"
  run_rc "$WORKDIR/dirty" "$WORKDIR/dirty.err" git -C "$SOURCE_DIR" status --porcelain
  DIRTY_RC=$?
  DIRTY_N=0
  if [ "$DIRTY_RC" -eq 0 ]; then
    DIRTY_N="$(count_nonempty_lines "$WORKDIR/dirty")"
  fi
  if [ "$SHA_RC" -eq 0 ] && [ -n "$SHA" ]; then
    emit B11 "源码检出 git SHA" OK "dir=${SOURCE_DIR} HEAD=${SHA} dirty_lines=${DIRTY_N} status_rc=${DIRTY_RC}"
  else
    emit B11 "源码检出 git SHA" UNKNOWN "git rev-parse rc=${SHA_RC} dir=${SOURCE_DIR}"
  fi
elif [ ! -d "$SOURCE_DIR" ]; then
  emit B11 "源码检出 git SHA" UNKNOWN "源码目录不存在: ${SOURCE_DIR}"
else
  emit B11 "源码检出 git SHA" UNKNOWN "${SOURCE_DIR} 不是 git 仓库或没有 git 命令"
fi

# ---------- B12 DEPLOY_SOURCE ----------
DS="${RUNTIME_DIR}/DEPLOY_SOURCE.txt"
if [ -f "$DS" ]; then
  run_rc "$WORKDIR/ds" "$WORKDIR/ds.err" cat "$DS"
  DS_RC=$?
  if [ "$DS_RC" -eq 0 ]; then
    emit B12 "DEPLOY_SOURCE.txt" OK "$(one_line "$(cat "$WORKDIR/ds")")"
  else
    emit B12 "DEPLOY_SOURCE.txt" UNKNOWN "文件存在但 cat rc=${DS_RC}"
  fi
else
  emit B12 "DEPLOY_SOURCE.txt" NG "不存在: ${DS}"
fi

# ---------- B13 / B15 / B16 PM2 jlist（一次采集，多项判定）----------
PM2_SUMMARY=""
PM2_JLIST_RC=127
ERR_LOG=""
OUT_LOG=""
PM2_PID=""
PM2_STATUS=""
PM2_RESTARTS=""
PM2_UNSTABLE=""
PM2_CWD=""
PM2_SCRIPT=""
PM2_NODE=""
PM2_NODE_ENV=""
PM2_PAY=""
if has_cmd pm2; then
  if [ -z "$PYTHON" ]; then
    # 即使 jlist 成功也绝不能把全量 JSON 落到终端或磁盘：里面是完整环境变量。
    emit B13 "PM2 运行路径" UNKNOWN "有 pm2 但无 python，拒绝 pm2 jlist（全量 env 含密钥）"
    PM2_JLIST_RC=127
  else
    # 管道直送 python，不把 jlist JSON 落到磁盘。
    pm2 jlist 2>"$WORKDIR/jlist.err" | helper pm2-summary >"$WORKDIR/pm2sum"
    PM2_JLIST_RC=${PIPESTATUS[0]}
    SUM_RC=${PIPESTATUS[1]}
    PM2_SUMMARY="$(one_line "$(cat "$WORKDIR/pm2sum")")"
    if [ "$PM2_JLIST_RC" -ne 0 ]; then
      emit B13 "PM2 运行路径" UNKNOWN "pm2 jlist rc=${PM2_JLIST_RC}"
    elif [ "$SUM_RC" -ne 0 ]; then
      emit B13 "PM2 运行路径" UNKNOWN "jlist 解析 rc=${SUM_RC} ${PM2_SUMMARY}"
    else
      API_LINE="$(awk -v n="$PM2_APP" '$0 ~ ("name=" n " ") || $0 ~ /script=.*dist\/main\.js/ {print; exit}' "$WORKDIR/pm2sum")"
      if [ -z "$API_LINE" ]; then
        API_LINE="$(awk '/^proc / {print; exit}' "$WORKDIR/pm2sum")"
      fi
      PM2_STATUS="$(printf '%s\n' "$API_LINE" | sed -n 's/.* status=\([^ ]*\).*/\1/p')"
      PM2_PID="$(printf '%s\n' "$API_LINE" | sed -n 's/.* pid=\([^ ]*\).*/\1/p')"
      PM2_RESTARTS="$(printf '%s\n' "$API_LINE" | sed -n 's/.* restarts=\([^ ]*\).*/\1/p')"
      PM2_UNSTABLE="$(printf '%s\n' "$API_LINE" | sed -n 's/.* unstable_restarts=\([^ ]*\).*/\1/p')"
      PM2_CWD="$(printf '%s\n' "$API_LINE" | sed -n 's/.* cwd=\([^ ]*\).*/\1/p')"
      PM2_SCRIPT="$(printf '%s\n' "$API_LINE" | sed -n 's/.* script=\([^ ]*\).*/\1/p')"
      PM2_NODE="$(printf '%s\n' "$API_LINE" | sed -n 's/.* node=\([^ ]*\).*/\1/p')"
      ERR_LOG="$(printf '%s\n' "$API_LINE" | sed -n 's/.* err_log=\([^ ]*\).*/\1/p')"
      OUT_LOG="$(printf '%s\n' "$API_LINE" | sed -n 's/.* out_log=\([^ ]*\).*/\1/p')"
      PM2_NODE_ENV="$(printf '%s\n' "$API_LINE" | sed -n 's/.* NODE_ENV=\([^ ]*\).*/\1/p')"
      PM2_PAY="$(printf '%s\n' "$API_LINE" | sed -n 's/.* PAYMENT_PROVIDER=\([^ ]*\).*/\1/p')"
      if [ -n "$PM2_SCRIPT" ] || [ -n "$PM2_CWD" ]; then
        emit B13 "PM2 运行路径" OK "app=${PM2_APP} cwd=${PM2_CWD} script=${PM2_SCRIPT} node=${PM2_NODE} pid=${PM2_PID}"
      else
        emit B13 "PM2 运行路径" UNKNOWN "jlist 解析成功但未找到 cwd/script 行 ${PM2_SUMMARY}"
      fi
    fi
  fi
else
  emit B13 "PM2 运行路径" UNKNOWN "PATH 中没有 pm2"
fi

# ---------- B14 .env 权限 + 未进 git ----------
if [ -f "$ENV_FILE" ]; then
  MODE="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || stat -f '%OLp' "$ENV_FILE" 2>/dev/null || echo "?")"
  OWNER="$(stat -c '%U:%G' "$ENV_FILE" 2>/dev/null || echo "?")"
  GIT_TRACKED="not_checked"
  if has_cmd git && [ -d "$SOURCE_DIR/.git" ]; then
    git -C "$SOURCE_DIR" ls-files --error-unmatch -- "services/api/.env" >/dev/null 2>&1
    GT_RC=$?
    if [ "$GT_RC" -eq 0 ]; then
      GIT_TRACKED=tracked_in_source_repo
    else
      GIT_TRACKED=not_in_source_index
    fi
  fi
  KEY_N="?"
  if [ -n "$PYTHON" ]; then
    helper env-keys "$ENV_FILE" >"$WORKDIR/envkeys" 2>"$WORKDIR/envkeys.err"
    KEY_N="$(count_nonempty_lines "$WORKDIR/envkeys")"
  fi
  if [ "$MODE" = "600" ] || [ "$MODE" = "400" ]; then
    if [ "$GIT_TRACKED" = "tracked_in_source_repo" ]; then
      emit B14 ".env 权限与未入库" NG "path=${ENV_FILE} mode=${MODE} owner=${OWNER} keys=${KEY_N} git=${GIT_TRACKED}"
    else
      emit B14 ".env 权限与未入库" OK "path=${ENV_FILE} mode=${MODE} owner=${OWNER} keys=${KEY_N} git=${GIT_TRACKED} （只统计键名数量，未打印键值）"
    fi
  elif [ "$MODE" = "?" ]; then
    emit B14 ".env 权限与未入库" UNKNOWN "path=${ENV_FILE} 存在但 stat 权限失败 git=${GIT_TRACKED}"
  else
    emit B14 ".env 权限与未入库" NG "path=${ENV_FILE} mode=${MODE} 期望 600 owner=${OWNER} git=${GIT_TRACKED}"
  fi
else
  emit B14 ".env 权限与未入库" NG "不存在: ${ENV_FILE}"
fi

# ---------- B15 PM2 status ----------
if [ "$PM2_JLIST_RC" -ne 0 ]; then
  emit B15 "PM2 进程状态" UNKNOWN "pm2 jlist rc=${PM2_JLIST_RC} 未采集到状态"
elif [ -z "$PYTHON" ]; then
  emit B15 "PM2 进程状态" UNKNOWN "有 jlist 但无 python，拒绝解析全量 env"
elif [ -z "$PM2_STATUS" ]; then
  emit B15 "PM2 进程状态" UNKNOWN "未找到应用 ${PM2_APP} 的 status"
elif [ "$PM2_STATUS" = "online" ]; then
  emit B15 "PM2 进程状态" OK "name=${PM2_APP} status=${PM2_STATUS} pid=${PM2_PID}"
else
  emit B15 "PM2 进程状态" NG "name=${PM2_APP} status=${PM2_STATUS} pid=${PM2_PID}"
fi

# ---------- B16 restarts ----------
if [ -n "$PM2_RESTARTS" ] && [ "$PM2_RESTARTS" != "None" ]; then
  emit B16 "PM2 重启次数" OK "restart_time=${PM2_RESTARTS} unstable_restarts=${PM2_UNSTABLE} （restart_time 是累计重启次数，不是时间）"
else
  emit B16 "PM2 重启次数" UNKNOWN "jlist 未提供 restart_time"
fi

# ---------- B17 error log 行数 + 最近时间（不读正文）----------
pick_log() {
  local p="$1"
  if [ -n "$p" ] && [ -f "$p" ]; then
    printf '%s' "$p"
    return 0
  fi
  return 1
}
if pick_log "$ERR_LOG" >/dev/null 2>&1; then
  :
elif [ -f "${HOME}/.pm2/logs/${PM2_APP}-error.log" ]; then
  ERR_LOG="${HOME}/.pm2/logs/${PM2_APP}-error.log"
fi
if pick_log "$OUT_LOG" >/dev/null 2>&1; then
  :
elif [ -f "${HOME}/.pm2/logs/${PM2_APP}-out.log" ]; then
  OUT_LOG="${HOME}/.pm2/logs/${PM2_APP}-out.log"
fi

if [ -n "$ERR_LOG" ] && [ -f "$ERR_LOG" ]; then
  run_rc "$WORKDIR/errwc" "$WORKDIR/errwc.err" wc -l "$ERR_LOG"
  WC_RC=$?
  ERR_LINES="$(awk '{print $1}' "$WORKDIR/errwc")"
  ERR_STAT="$(stat -c '%y %s' "$ERR_LOG" 2>/dev/null || stat -f '%Sm %z' "$ERR_LOG" 2>/dev/null || echo "?")"
  if [ "$WC_RC" -eq 0 ]; then
    emit B17 "PM2 错误日志行数" OK "path=${ERR_LOG} lines=${ERR_LINES} mtime_size=${ERR_STAT} （只报行数与 mtime，未打印日志正文）"
  else
    emit B17 "PM2 错误日志行数" UNKNOWN "wc rc=${WC_RC} path=${ERR_LOG}"
  fi
else
  emit B17 "PM2 错误日志行数" UNKNOWN "未找到 error log 路径（pm2 字段=${ERR_LOG:-empty}）"
fi

# ---------- B18 pm2-logrotate ----------
if has_cmd pm2; then
  run_rc "$WORKDIR/logrot" "$WORKDIR/logrot.err" pm2 conf pm2-logrotate
  LR_RC=$?
  if [ "$LR_RC" -ne 0 ]; then
    emit B18 "pm2-logrotate" UNKNOWN "pm2 conf pm2-logrotate rc=${LR_RC} stderr=$(one_line "$(head -c 200 "$WORKDIR/logrot.err")")"
  else
    LR_EV="$(awk 'BEGIN{IGNORECASE=1} /max_size|retain|rotateInterval|compress/ {gsub(/^[ \t]+/,""); printf "%s; ",$0}' "$WORKDIR/logrot")"
    if [ -n "$LR_EV" ]; then
      emit B18 "pm2-logrotate" OK "rc=0 ${LR_EV}"
    else
      emit B18 "pm2-logrotate" UNKNOWN "rc=0 但输出里没有 max_size/retain 字段"
    fi
  fi
else
  emit B18 "pm2-logrotate" UNKNOWN "没有 pm2"
fi

# ---------- nginx dump once（只留抽取出的指令，不把完整 dump 留在磁盘）----------
NGINX_RC=127
: >"$WORKDIR/ngx"
if [ -n "$NGINX_BIN" ]; then
  if [ -n "$PYTHON" ]; then
    "$NGINX_BIN" -T 2>"$WORKDIR/nginx.err" | helper nginx-extract >"$WORKDIR/ngx"
    NGINX_RC=${PIPESTATUS[0]}
  else
    "$NGINX_BIN" -T 2>"$WORKDIR/nginx.err" | awk 'BEGIN{IGNORECASE=1}
      /ssl_certificate_key/ {next}
      /client_max_body_size|proxy_pass|proxy_read_timeout|proxy_send_timeout|client_body_timeout|proxy_http_version|server_name |root |listen |Upgrade|proxy_set_header Connection|location / {print}' \
      >"$WORKDIR/ngx"
    NGINX_RC=${PIPESTATUS[0]}
  fi
fi

# ---------- B19 client_max_body_size ----------
if [ -z "$NGINX_BIN" ]; then
  emit B19 "nginx client_max_body_size" UNKNOWN "没有 nginx 可执行文件"
elif [ "$NGINX_RC" -ne 0 ]; then
  emit B19 "nginx client_max_body_size" UNKNOWN "nginx -T rc=${NGINX_RC} stderr=$(one_line "$(head -c 180 "$WORKDIR/nginx.err")")"
else
  BODY_SIZES="$(awk 'BEGIN{IGNORECASE=1} /client_max_body_size/ {gsub(/^[ \t]+/,""); printf "%s; ",$0}' "$WORKDIR/ngx" 2>/dev/null)"
  if [ -z "$BODY_SIZES" ]; then
    emit B19 "nginx client_max_body_size" NG "nginx -T rc=0 但无 client_max_body_size 指令（走默认 1m）"
  else
    emit B19 "nginx client_max_body_size" OK "nginx -T rc=0 ${BODY_SIZES}"
  fi
fi

# ---------- B20 proxy_pass ----------
if [ "$NGINX_RC" -ne 0 ]; then
  emit B20 "nginx 反代目标" UNKNOWN "nginx -T rc=${NGINX_RC} 无配置可抽"
else
  PASSES="$(awk 'BEGIN{IGNORECASE=1} /proxy_pass/ {gsub(/^[ \t]+/,""); printf "%s; ",$0}' "$WORKDIR/ngx" 2>/dev/null)"
  case "$PASSES" in
    *"127.0.0.1:${API_PORT}"*) emit B20 "nginx 反代目标" OK "nginx -T rc=0 ${PASSES}" ;;
    "") emit B20 "nginx 反代目标" NG "nginx -T rc=0 但无 proxy_pass" ;;
    *) emit B20 "nginx 反代目标" NG "有 proxy_pass 但未看到 127.0.0.1:${API_PORT} ；${PASSES}" ;;
  esac
fi

# ---------- B21 timeouts ----------
if [ "$NGINX_RC" -ne 0 ]; then
  emit B21 "nginx 上传超时" UNKNOWN "nginx -T rc=${NGINX_RC}"
else
  TO="$(awk 'BEGIN{IGNORECASE=1} /proxy_read_timeout|proxy_send_timeout|client_body_timeout/ {gsub(/^[ \t]+/,""); printf "%s; ",$0}' "$WORKDIR/ngx" 2>/dev/null)"
  if [ -n "$TO" ]; then
    emit B21 "nginx 上传超时" OK "nginx -T rc=0 ${TO}"
  else
    emit B21 "nginx 上传超时" NG "nginx -T rc=0 且无 proxy_read_timeout/proxy_send_timeout/client_body_timeout（走默认 60s）"
  fi
fi

# ---------- B22 Upgrade ----------
if [ "$NGINX_RC" -ne 0 ]; then
  emit B22 "nginx WebSocket Upgrade 头" UNKNOWN "nginx -T rc=${NGINX_RC}"
else
  UP="$(awk 'BEGIN{IGNORECASE=1} /Upgrade|proxy_set_header Connection|proxy_http_version/ {gsub(/^[ \t]+/,""); printf "%s; ",$0}' "$WORKDIR/ngx" 2>/dev/null)"
  if [ -n "$UP" ]; then
    emit B22 "nginx WebSocket Upgrade 头" OK "nginx -T rc=0 ${UP}"
  else
    emit B22 "nginx WebSocket Upgrade 头" NG "nginx -T rc=0 且无 Upgrade / Connection / proxy_http_version 相关指令"
  fi
fi

# ---------- B23 roots / opc ----------
if [ "$NGINX_RC" -ne 0 ]; then
  emit B23 "nginx root/server_name/opc" UNKNOWN "nginx -T rc=${NGINX_RC}"
else
  ROOTS="$(awk 'BEGIN{IGNORECASE=1} /^root |^server_name |^listen / {gsub(/^[ \t]+/,""); printf "%s; ",$0}' "$WORKDIR/ngx" 2>/dev/null)"
  OPC_N="$(awk 'BEGIN{IGNORECASE=1} /location[[:space:]]+\/opc/ {c++} END {print c+0}' "$WORKDIR/ngx" 2>/dev/null)"
  emit B23 "nginx root/server_name/opc" OK "nginx -T rc=0 opc_location_count=${OPC_N} ${ROOTS}"
fi

# ---------- B24 TLS cert ----------
if [ "$NGINX_RC" -ne 0 ]; then
  emit B24 "TLS 证书有效期" UNKNOWN "无 nginx dump，找不到 ssl_certificate 路径"
elif ! has_cmd openssl; then
  emit B24 "TLS 证书有效期" UNKNOWN "PATH 中没有 openssl"
else
  CRT="$(awk 'BEGIN{IGNORECASE=1} $1=="ssl_certificate" {gsub(/;$/,"",$2); print $2; exit}' "$WORKDIR/ngx")"
  if [ -z "$CRT" ] || [ ! -r "$CRT" ]; then
    emit B24 "TLS 证书有效期" UNKNOWN "ssl_certificate 路径不可读: ${CRT:-empty}"
  else
    run_rc "$WORKDIR/x509d" "$WORKDIR/x509d.err" openssl x509 -in "$CRT" -noout -dates -subject
    X509_RC=$?
    openssl x509 -in "$CRT" -noout -checkend 0 >/dev/null 2>&1
    EXP_RC=$?
    SUBJ="$(one_line "$(cat "$WORKDIR/x509d")")"
    if [ "$X509_RC" -ne 0 ]; then
      emit B24 "TLS 证书有效期" UNKNOWN "openssl x509 rc=${X509_RC} crt=${CRT}"
    elif [ "$EXP_RC" -eq 0 ]; then
      emit B24 "TLS 证书有效期" OK "checkend0_rc=0 crt=${CRT} ${SUBJ}"
    else
      emit B24 "TLS 证书有效期" NG "checkend0_rc=${EXP_RC} 已过期 crt=${CRT} ${SUBJ}"
    fi
  fi
fi

# ---------- env helpers for remaining items ----------
meta_line() {
  local key="$1"
  if [ -z "$PYTHON" ]; then
    echo "${key} present=? length=? sample=? scheme=? host=?"
    return 127
  fi
  env_meta "$key" 2>/dev/null | tail -1
}

val_of() {
  local key="$1"
  if [ -z "$PYTHON" ] || [ ! -f "$ENV_FILE" ]; then
    echo ""
    return 127
  fi
  env_value "$key" 2>/dev/null
}

# ---------- B25 NODE_ENV ----------
NODE_ENV_FILE=""
NODE_ENV_PROC=""
if [ -f "$ENV_FILE" ] && [ -n "$PYTHON" ]; then
  NODE_ENV_FILE="$(val_of NODE_ENV || true)"
fi
if [ -n "$PM2_NODE_ENV" ]; then
  :
fi
if [ -n "$PM2_PID" ] && [ "$PM2_PID" != "0" ] && [ -n "$PYTHON" ] && [ -r "/proc/${PM2_PID}/environ" ]; then
  helper proc-env "$PM2_PID" NODE_ENV >"$WORKDIR/procenv" 2>"$WORKDIR/procenv.err"
  NODE_ENV_PROC="$(sed -n 's/^NODE_ENV=//p' "$WORKDIR/procenv" | head -1)"
fi
NE_BITS="env_file=${NODE_ENV_FILE:-unread} pm2=${PM2_NODE_ENV:-unread} proc=${NODE_ENV_PROC:-unread}"
NE_VAL="${NODE_ENV_PROC:-${PM2_NODE_ENV:-$NODE_ENV_FILE}}"
if [ -z "$NE_VAL" ]; then
  emit B25 "NODE_ENV 实际取值" UNKNOWN "三处都没读到。${NE_BITS}"
elif [ "$NE_VAL" = "production" ]; then
  CONFLICT=no
  for v in "$NODE_ENV_FILE" "$PM2_NODE_ENV" "$NODE_ENV_PROC"; do
    if [ -n "$v" ] && [ "$v" != "production" ]; then
      CONFLICT=yes
    fi
  done
  if [ "$CONFLICT" = "yes" ]; then
    emit B25 "NODE_ENV 实际取值" NG "读到非 production 的来源。${NE_BITS}"
  else
    emit B25 "NODE_ENV 实际取值" OK "${NE_BITS}"
  fi
else
  emit B25 "NODE_ENV 实际取值" NG "有效取值=${NE_VAL} 期望 production。${NE_BITS}"
fi

# ---------- B26 PAYMENT_PROVIDER ----------
PAY_FILE=""
if [ -f "$ENV_FILE" ] && [ -n "$PYTHON" ]; then
  PAY_FILE="$(val_of PAYMENT_PROVIDER || true)"
fi
PAY_VAL="${PM2_PAY:-$PAY_FILE}"
if [ -z "$PAY_VAL" ] && [ -z "$PAY_FILE" ] && [ -z "$PM2_PAY" ]; then
  if [ ! -f "$ENV_FILE" ]; then
    emit B26 "PAYMENT_PROVIDER 实际取值" UNKNOWN ".env 不存在且 PM2 未读到"
  elif [ -z "$PYTHON" ]; then
    emit B26 "PAYMENT_PROVIDER 实际取值" UNKNOWN "无 python，拒绝用 grep 打印该行（可能与其它键一起被误贴）"
  else
    emit B26 "PAYMENT_PROVIDER 实际取值" OK "env 未配置（等价 disabled，生产允许关闭线上支付） pm2=${PM2_PAY:-unread}"
  fi
else
  PAY_LC="$(printf '%s' "$PAY_VAL" | tr '[:upper:]' '[:lower:]')"
  case ",${PAY_LC}," in
    *",sandbox,"*) emit B26 "PAYMENT_PROVIDER 实际取值" NG "value=${PAY_VAL} 含 sandbox，生产禁止" ;;
    *) emit B26 "PAYMENT_PROVIDER 实际取值" OK "env=${PAY_FILE:-empty} pm2=${PM2_PAY:-unread}" ;;
  esac
fi

# ---------- B27 FILE_STORAGE_DRIVER ----------
if [ ! -f "$ENV_FILE" ]; then
  emit B27 "FILE_STORAGE_DRIVER" UNKNOWN ".env 不存在"
elif [ -z "$PYTHON" ]; then
  CNT="$(env_key_count FILE_STORAGE_DRIVER || true)"
  emit B27 "FILE_STORAGE_DRIVER" UNKNOWN "键计数=${CNT} 无 python 不打印取值；门禁要求 cos"
else
  DRV="$(val_of FILE_STORAGE_DRIVER || true)"
  if [ "$DRV" = "cos" ]; then
    emit B27 "FILE_STORAGE_DRIVER" OK "value=cos"
  elif [ -z "$DRV" ]; then
    emit B27 "FILE_STORAGE_DRIVER" NG "未配置或空，生产必须 cos"
  else
    emit B27 "FILE_STORAGE_DRIVER" NG "value=${DRV} 生产必须 cos"
  fi
fi

# ---------- B28 SMS/OCR/AI providers ----------
if [ ! -f "$ENV_FILE" ]; then
  emit B28 "SMS/OCR/AI provider 取值" UNKNOWN ".env 不存在"
elif [ -z "$PYTHON" ]; then
  emit B28 "SMS/OCR/AI provider 取值" UNKNOWN "无 python，只确认键存在会不够判定取值"
else
  SMSV="$(val_of SMS_PROVIDER || true)"
  OCRV="$(val_of OCR_PROVIDER || true)"
  AIV="$(val_of AI_PROVIDER || true)"
  ASRV="$(val_of ASR_PROVIDER || true)"
  SMS_OK=no OCR_OK=no AI_OK=no
  [ "$(printf '%s' "$SMSV" | tr '[:upper:]' '[:lower:]')" = "tencent" ] && SMS_OK=yes
  [ "$(printf '%s' "$OCRV" | tr '[:upper:]' '[:lower:]')" = "baidu" ] && OCR_OK=yes
  [ "$(printf '%s' "$AIV" | tr '[:upper:]' '[:lower:]')" = "llm" ] && AI_OK=yes
  if [ "$SMS_OK" = yes ] && [ "$OCR_OK" = yes ] && [ "$AI_OK" = yes ]; then
    emit B28 "SMS/OCR/AI provider 取值" OK "SMS_PROVIDER=${SMSV} OCR_PROVIDER=${OCRV} AI_PROVIDER=${AIV} ASR_PROVIDER=${ASRV:-unset}"
  else
    emit B28 "SMS/OCR/AI provider 取值" NG "SMS_PROVIDER=${SMSV:-unset}(须tencent) OCR_PROVIDER=${OCRV:-unset}(须baidu) AI_PROVIDER=${AIV:-unset}(须llm) ASR_PROVIDER=${ASRV:-unset}"
  fi
fi

# ---------- B29 PRINT_* ----------
if [ ! -f "$ENV_FILE" ] || [ -z "$PYTHON" ]; then
  emit B29 "打印门禁开关" UNKNOWN "无法安全读取 PRINT_* 取值"
else
  PII="$(val_of PRINT_REQUIRE_PII_SCAN || true)"
  PON="$(val_of PRINT_REQUIRE_PRINTER_ONLINE || true)"
  CAP="$(val_of PRINT_SCAN_CAPABILITY_MODE || true)"
  CAP_LC="$(printf '%s' "$CAP" | tr '[:upper:]' '[:lower:]')"
  if [ "$PII" = "true" ] && [ "$PON" = "true" ] && { [ "$CAP_LC" = "managed" ] || [ "$CAP_LC" = "strict" ]; }; then
    emit B29 "打印门禁开关" OK "PRINT_REQUIRE_PII_SCAN=${PII} PRINT_REQUIRE_PRINTER_ONLINE=${PON} PRINT_SCAN_CAPABILITY_MODE=${CAP}"
  else
    emit B29 "打印门禁开关" NG "PRINT_REQUIRE_PII_SCAN=${PII:-unset}(须true) PRINT_REQUIRE_PRINTER_ONLINE=${PON:-unset}(须true) PRINT_SCAN_CAPABILITY_MODE=${CAP:-unset}(须managed|strict)"
  fi
fi

# ---------- B30 terminal flags ----------
if [ ! -f "$ENV_FILE" ] || [ -z "$PYTHON" ]; then
  emit B30 "终端注册开关" UNKNOWN "无法安全读取 TERMINAL_* 取值"
else
  LEG="$(val_of TERMINAL_LEGACY_REGISTER_ENABLED || true)"
  PLN="$(val_of TERMINAL_PLANNED_PROVISIONING_ENABLED || true)"
  LEG_LC="$(printf '%s' "$LEG" | tr '[:upper:]' '[:lower:]')"
  PLN_LC="$(printf '%s' "$PLN" | tr '[:upper:]' '[:lower:]')"
  if [ "$LEG_LC" = "false" ] && { [ "$PLN_LC" = "true" ] || [ "$PLN_LC" = "false" ]; }; then
    emit B30 "终端注册开关" OK "TERMINAL_LEGACY_REGISTER_ENABLED=${LEG} TERMINAL_PLANNED_PROVISIONING_ENABLED=${PLN}"
  else
    emit B30 "终端注册开关" NG "LEGACY=${LEG:-unset}(须false) PLANNED=${PLN:-unset}(须true|false)"
  fi
fi

# ---------- B31 TRUST_PROXY_HOPS ----------
if [ ! -f "$ENV_FILE" ] || [ -z "$PYTHON" ]; then
  emit B31 "TRUST_PROXY_HOPS" UNKNOWN "无法安全读取取值"
else
  HOPS="$(val_of TRUST_PROXY_HOPS || true)"
  case "$HOPS" in
    [1-9]) emit B31 "TRUST_PROXY_HOPS" OK "value=${HOPS}" ;;
    "") emit B31 "TRUST_PROXY_HOPS" NG "未配置，生产必须 1..9" ;;
    true|false|TRUE|FALSE) emit B31 "TRUST_PROXY_HOPS" NG "value=${HOPS} 禁止布尔，必须 1..9" ;;
    *) emit B31 "TRUST_PROXY_HOPS" NG "value=${HOPS} 必须是 1..9" ;;
  esac
fi

# ---------- B32 conversion ----------
if [ ! -f "$ENV_FILE" ] || [ -z "$PYTHON" ]; then
  emit B32 "Word 转换引擎配置" UNKNOWN "无法安全读取 CONVERSION_* / SOFFICE_PATH"
else
  CENG="$(val_of CONVERSION_ENGINE || true)"
  SPATH="$(val_of SOFFICE_PATH || true)"
  CCMAX="$(val_of CONVERSION_MAX_CONCURRENCY || true)"
  GURL="$(val_of GOTENBERG_URL || true)"
  CENG_LC="$(printf '%s' "$CENG" | tr '[:upper:]' '[:lower:]')"
  SO_EV=""
  if [ -n "$SPATH" ]; then
    if [ -x "$SPATH" ]; then
      SO_EV="path_executable=yes"
    elif [ -e "$SPATH" ]; then
      SO_EV="path_exists_not_exec=yes"
    else
      SO_EV="path_missing=yes"
    fi
  fi
  if [ "$CENG_LC" = "soffice" ]; then
    if [ -n "$SPATH" ] && [ "${SPATH#/}" != "$SPATH" ] && [ -x "$SPATH" ]; then
      if [ "$SPATH" = "/usr/bin/soffice" ]; then
        emit B32 "Word 转换引擎配置" NG "CONVERSION_ENGINE=${CENG} SOFFICE_PATH=${SPATH} 清单要求走隔离包装而不是裸 /usr/bin/soffice CONVERSION_MAX_CONCURRENCY=${CCMAX:-unset}"
      else
        emit B32 "Word 转换引擎配置" OK "CONVERSION_ENGINE=${CENG} SOFFICE_PATH=${SPATH} ${SO_EV} CONVERSION_MAX_CONCURRENCY=${CCMAX:-unset}"
      fi
    else
      emit B32 "Word 转换引擎配置" NG "CONVERSION_ENGINE=soffice 但 SOFFICE_PATH 不是可执行绝对路径 SPATH=${SPATH:-unset} ${SO_EV}"
    fi
  elif [ "$CENG_LC" = "gotenberg" ]; then
    emit B32 "Word 转换引擎配置" OK "CONVERSION_ENGINE=${CENG} GOTENBERG_URL=${GURL:-unset} （URL 本身不是密钥；未探活该 URL）"
  elif [ "$CENG_LC" = "disabled" ] || [ -z "$CENG_LC" ]; then
    emit B32 "Word 转换引擎配置" NG "CONVERSION_ENGINE=${CENG:-unset} 生产已开通 soffice 路线时应为 soffice"
  else
    emit B32 "Word 转换引擎配置" NG "CONVERSION_ENGINE=${CENG} 非法"
  fi
fi

# ---------- B33 gate secrets lengths ----------
SECRET_KEYS="JWT_SECRET FILE_SIGNING_SECRET SECRET_ENCRYPTION_KEY PAYMENT_SESSION_SECRET TERMINAL_ADMIN_SECRET TERMINAL_ACTION_TOKEN_SECRET"
if [ ! -f "$ENV_FILE" ]; then
  emit B33 "运行闸门密钥长度" UNKNOWN ".env 不存在"
elif [ -z "$PYTHON" ]; then
  BITS=""
  for k in $SECRET_KEYS; do
    c="$(env_key_count "$k" || true)"
    BITS="${BITS}${k}_grep_c=${c}; "
  done
  emit B33 "运行闸门密钥长度" UNKNOWN "无 python 不能量长度，只做了 grep -c：${BITS}"
else
  env_meta $SECRET_KEYS >"$WORKDIR/secmeta" 2>"$WORKDIR/secmeta.err"
  SEC_RC=$?
  env_meta DATABASE_URL REDIS_URL >"$WORKDIR/urlmeta" 2>/dev/null || true
  URL_EV="$(awk '{
      k=$1; pres="-"; sch="-"; host="-";
      for(i=1;i<=NF;i++){
        if($i ~ /^present=/){split($i,a,"="); pres=a[2]}
        if($i ~ /^scheme=/){split($i,a,"="); sch=a[2]}
        if($i ~ /^host=/){split($i,a,"="); host=a[2]}
      }
      printf "%s present=%s scheme=%s host=%s; ", k, pres, sch, host
    }' "$WORKDIR/urlmeta")"
  SEC_EV="$(tr '\n' '; ' <"$WORKDIR/secmeta") ${URL_EV}"
  BAD=0
  if [ "$SEC_RC" -ne 0 ]; then
    emit B33 "运行闸门密钥长度" UNKNOWN "env-meta rc=${SEC_RC}"
  else
    # JWT >=16, 其余 >=32, 均不得样值、不得空
    while read -r line; do
      [ -z "$line" ] && continue
      k="$(printf '%s' "$line" | awk '{print $1}')"
      pres="$(printf '%s' "$line" | sed -n 's/.*present=\([^ ]*\).*/\1/p')"
      len="$(printf '%s' "$line" | sed -n 's/.*length=\([^ ]*\).*/\1/p')"
      sam="$(printf '%s' "$line" | sed -n 's/.*sample=\([^ ]*\).*/\1/p')"
      min=32
      [ "$k" = "JWT_SECRET" ] && min=16
      if [ "$pres" != "yes" ] || [ "${len:-0}" -lt "$min" ] || [ "$sam" != "no" ]; then
        BAD=1
      fi
    done <"$WORKDIR/secmeta"
    DB_PRES="$(awk '$1=="DATABASE_URL"{for(i=1;i<=NF;i++) if($i ~ /^present=/){split($i,a,"="); print a[2]}}' "$WORKDIR/urlmeta")"
    DB_SCH="$(awk '$1=="DATABASE_URL"{for(i=1;i<=NF;i++) if($i ~ /^scheme=/){split($i,a,"="); print a[2]}}' "$WORKDIR/urlmeta")"
    RD_PRES="$(awk '$1=="REDIS_URL"{for(i=1;i<=NF;i++) if($i ~ /^present=/){split($i,a,"="); print a[2]}}' "$WORKDIR/urlmeta")"
    [ "$DB_PRES" = "yes" ] && [ "$DB_SCH" = "postgresql" ] || BAD=1
    [ "$RD_PRES" = "yes" ] || BAD=1
    [ "$DB_SCH" = "file" ] && BAD=1
    if [ "$BAD" -eq 0 ]; then
      emit B33 "运行闸门密钥长度" OK "${SEC_EV} （未打印值；JWT>=16 其余>=32 且非样值；DATABASE_URL scheme 须 postgresql）"
    else
      emit B33 "运行闸门密钥长度" NG "${SEC_EV} （未打印值；存在缺失/过短/样值前缀，或 DATABASE_URL 不是 postgresql / REDIS_URL 缺失）"
    fi
  fi
fi

# ---------- B34 COS keys ----------
COS_KEYS="TENCENT_COS_SECRET_ID TENCENT_COS_SECRET_KEY TENCENT_COS_BUCKET TENCENT_COS_REGION TENCENT_COS_SIGN_URL_EXPIRES_SECONDS COS_BUCKET COS_REGION COS_SECRET_ID FILE_SIGNING_TTL COS_SIGNED_URL_TTL"
if [ ! -f "$ENV_FILE" ]; then
  emit B34 "COS 配置键" UNKNOWN ".env 不存在"
elif [ -z "$PYTHON" ]; then
  BITS=""
  for k in TENCENT_COS_SECRET_ID TENCENT_COS_SECRET_KEY TENCENT_COS_BUCKET TENCENT_COS_REGION; do
    c="$(env_key_count "$k" || true)"
    BITS="${BITS}${k}_c=${c}; "
  done
  emit B34 "COS 配置键" UNKNOWN "无 python：${BITS}"
else
  env_meta TENCENT_COS_SECRET_ID TENCENT_COS_SECRET_KEY TENCENT_COS_BUCKET TENCENT_COS_REGION TENCENT_COS_SIGN_URL_EXPIRES_SECONDS >"$WORKDIR/cosmeta" 2>/dev/null
  REGION="$(val_of TENCENT_COS_REGION || true)"
  TTL="$(val_of TENCENT_COS_SIGN_URL_EXPIRES_SECONDS || true)"
  COS_EV="$(tr '\n' '; ' <"$WORKDIR/cosmeta") region_value=${REGION:-unread} ttl_value=${TTL:-unread}"
  ID_P="$(sed -n 's/^TENCENT_COS_SECRET_ID present=\([^ ]*\).*/\1/p' "$WORKDIR/cosmeta")"
  KEY_P="$(sed -n 's/^TENCENT_COS_SECRET_KEY present=\([^ ]*\).*/\1/p' "$WORKDIR/cosmeta")"
  BKT_P="$(sed -n 's/^TENCENT_COS_BUCKET present=\([^ ]*\).*/\1/p' "$WORKDIR/cosmeta")"
  REG_P="$(sed -n 's/^TENCENT_COS_REGION present=\([^ ]*\).*/\1/p' "$WORKDIR/cosmeta")"
  if [ "$ID_P" = "yes" ] && [ "$KEY_P" = "yes" ] && [ "$BKT_P" = "yes" ] && [ "$REG_P" = "yes" ]; then
    emit B34 "COS 配置键" OK "${COS_EV} （SECRET/BUCKET 只报 present+length，region/ttl 非密钥可打印）"
  else
    emit B34 "COS 配置键" NG "${COS_EV} 四件套未齐"
  fi
fi

# ---------- B35 SMS/OCR/LLM/TRTC/ASR key presence ----------
if [ ! -f "$ENV_FILE" ] || [ -z "$PYTHON" ]; then
  emit B35 "短信/OCR/LLM/TRTC/ASR 密钥是否存在" UNKNOWN "无法做长度级盘点"
else
  env_meta \
    TENCENT_SMS_SECRET_ID TENCENT_SMS_SECRET_KEY TENCENT_SMS_SDK_APP_ID TENCENT_SMS_SIGN_NAME TENCENT_SMS_TEMPLATE_ID \
    BAIDU_OCR_API_KEY BAIDU_OCR_SECRET_KEY \
    AI_LLM_API_KEY TRTC_LLM_API_KEY \
    TRTC_SDK_APP_ID TRTC_SDK_SECRET_KEY TENCENT_SECRET_ID TENCENT_SECRET_KEY TRTC_TTS_APP_ID \
    BAIDU_ASR_API_KEY BAIDU_ASR_SECRET_KEY \
    >"$WORKDIR/svcmeta" 2>/dev/null
  SVC_EV="$(awk '{
      k=$1; pres="-"; len="-";
      for(i=1;i<=NF;i++){
        if($i ~ /^present=/){split($i,a,"="); pres=a[2]}
        if($i ~ /^length=/){split($i,a,"="); len=a[2]}
      }
      printf "%s=%s/%s; ", k, pres, len
    }' "$WORKDIR/svcmeta")"
  sms_ok=1
  for k in TENCENT_SMS_SECRET_ID TENCENT_SMS_SECRET_KEY TENCENT_SMS_SDK_APP_ID TENCENT_SMS_SIGN_NAME TENCENT_SMS_TEMPLATE_ID; do
    pres="$(awk -v k="$k" '$1==k {for(i=1;i<=NF;i++) if($i ~ /^present=/){split($i,a,"="); print a[2]}}' "$WORKDIR/svcmeta")"
    [ "$pres" = "yes" ] || sms_ok=0
  done
  ocr_ok=1
  for k in BAIDU_OCR_API_KEY BAIDU_OCR_SECRET_KEY; do
    pres="$(awk -v k="$k" '$1==k {for(i=1;i<=NF;i++) if($i ~ /^present=/){split($i,a,"="); print a[2]}}' "$WORKDIR/svcmeta")"
    [ "$pres" = "yes" ] || ocr_ok=0
  done
  llm_ok=0
  for k in AI_LLM_API_KEY TRTC_LLM_API_KEY; do
    pres="$(awk -v k="$k" '$1==k {for(i=1;i<=NF;i++) if($i ~ /^present=/){split($i,a,"="); print a[2]}}' "$WORKDIR/svcmeta")"
    [ "$pres" = "yes" ] && llm_ok=1
  done
  SMS_YES=no
  OCR_YES=no
  LLM_YES=no
  [ "$sms_ok" -eq 1 ] && SMS_YES=yes
  [ "$ocr_ok" -eq 1 ] && OCR_YES=yes
  [ "$llm_ok" -eq 1 ] && LLM_YES=yes
  if [ "$sms_ok" -eq 1 ] && [ "$ocr_ok" -eq 1 ] && [ "$llm_ok" -eq 1 ]; then
    emit B35 "短信/OCR/LLM/TRTC/ASR 密钥是否存在" OK "sms_ok=yes ocr_ok=yes llm_at_least_one=yes ${SVC_EV}"
  else
    emit B35 "短信/OCR/LLM/TRTC/ASR 密钥是否存在" NG "sms_ok=${SMS_YES} ocr_ok=${OCR_YES} llm_at_least_one=${LLM_YES} ${SVC_EV}"
  fi
fi

# ---------- B36 payment keys + forbidden leftover ----------
if [ ! -f "$ENV_FILE" ] || [ -z "$PYTHON" ]; then
  emit B36 "支付渠道键与禁止项" UNKNOWN "无法盘点支付键"
else
  env_meta \
    WECHAT_PAY_MCHID WECHAT_PAY_APPID WECHAT_PAY_MCH_SERIAL_NO WECHAT_PAY_PRIVATE_KEY_PEM WECHAT_PAY_PRIVATE_KEY_PATH \
    WECHAT_PAY_APIV3_KEY WECHAT_PAY_PUBLIC_KEY_PEM WECHAT_PAY_PUBLIC_KEY_PATH WECHAT_PAY_PUBLIC_KEY_ID \
    ALIPAY_APP_ID ALIPAY_APP_PRIVATE_KEY_PEM ALIPAY_APP_PRIVATE_KEY_PATH ALIPAY_PUBLIC_KEY_PEM ALIPAY_PUBLIC_KEY_PATH \
    SANDBOX_PAYMENT_SECRET PRINT_REQUIRE_PAID_BEFORE_CLAIM PAYMENT_NOTIFY_BASE_URL PAYMENT_CODEPAY_AUTO_CONVERGE_ENABLED \
    DEMO_SEED_CONFIRM \
    >"$WORKDIR/paymeta" 2>/dev/null
  PAY_EV="$(awk '{
      k=$1; pres="-"; len="-";
      for(i=1;i<=NF;i++){
        if($i ~ /^present=/){split($i,a,"="); pres=a[2]}
        if($i ~ /^length=/){split($i,a,"="); len=a[2]}
      }
      printf "%s=%s/%s; ", k, pres, len
    }' "$WORKDIR/paymeta")"
  NOTIFY="$(val_of PAYMENT_NOTIFY_BASE_URL || true)"
  CODEPAY="$(val_of PAYMENT_CODEPAY_AUTO_CONVERGE_ENABLED || true)"
  SB_P="$(awk '$1=="SANDBOX_PAYMENT_SECRET" {for(i=1;i<=NF;i++) if($i ~ /^present=/){split($i,a,"="); print a[2]}}' "$WORKDIR/paymeta")"
  OLD_P="$(awk '$1=="PRINT_REQUIRE_PAID_BEFORE_CLAIM" {for(i=1;i<=NF;i++) if($i ~ /^present=/){split($i,a,"="); print a[2]}}' "$WORKDIR/paymeta")"
  SEED_P="$(awk '$1=="DEMO_SEED_CONFIRM" {for(i=1;i<=NF;i++) if($i ~ /^present=/){split($i,a,"="); print a[2]}}' "$WORKDIR/paymeta")"
  FORB=""
  [ "$SB_P" = "yes" ] && FORB="${FORB} SANDBOX_PAYMENT_SECRET 应缺;"
  [ "$OLD_P" = "yes" ] && FORB="${FORB} PRINT_REQUIRE_PAID_BEFORE_CLAIM 已删除应缺;"
  [ "$SEED_P" = "yes" ] && FORB="${FORB} DEMO_SEED_CONFIRM 生产应空/缺;"
  # PATH 可读性（不 cat）
  WPATH="$(awk '$1=="WECHAT_PAY_PRIVATE_KEY_PATH" {for(i=1;i<=NF;i++) if($i ~ /^present=/){split($i,a,"="); print a[2]}}' "$WORKDIR/paymeta")"
  PATH_EV=""
  if [ -n "$PYTHON" ]; then
    # 不能 value-of PATH（不在 allowlist）。只报 present。
    PATH_EV="wechat_priv_path_present=${WPATH:-no}"
  fi
  if [ -n "$FORB" ]; then
    emit B36 "支付渠道键与禁止项" NG "禁止项仍在:${FORB} notify=${NOTIFY:-unset} codepay=${CODEPAY:-unset} ${PATH_EV} ${PAY_EV}"
  else
    emit B36 "支付渠道键与禁止项" OK "禁止项未配置 notify=${NOTIFY:-unset} codepay=${CODEPAY:-unset} ${PATH_EV} ${PAY_EV}"
  fi
fi

# ---------- B37 prisma migrations ----------
if [ "$PG_PROBE_RC" -ne 0 ]; then
  emit B37 "Prisma migration 最新一条" UNKNOWN "Postgres 未连通: ${PG_PROBE_MSG}"
else
  MIG="$(psql_ro "SELECT migration_name || ' finished=' || COALESCE(finished_at::text,'null') FROM _prisma_migrations WHERE rolled_back_at IS NULL ORDER BY finished_at DESC NULLS LAST LIMIT 1;" 2>"$WORKDIR/mig.err")"
  MIG_RC=$?
  MIG_N="$(psql_ro "SELECT count(*) FROM _prisma_migrations WHERE rolled_back_at IS NULL;" 2>/dev/null | tr -d '\n')"
  if [ "$MIG_RC" -eq 0 ] && [ -n "$MIG" ]; then
    emit B37 "Prisma migration 最新一条" OK "applied_count=${MIG_N} latest=$(one_line "$MIG")"
  else
    emit B37 "Prisma migration 最新一条" UNKNOWN "查询 rc=${MIG_RC} stderr=$(one_line "$(head -c 160 "$WORKDIR/mig.err")")"
  fi
fi

# ---------- B38 User count ----------
if [ "$PG_PROBE_RC" -ne 0 ]; then
  emit B38 "User 行数" UNKNOWN "Postgres 未连通"
else
  UC="$(psql_ro "SELECT count(*) FROM \"User\";" 2>"$WORKDIR/uc.err")"
  UC_RC=$?
  UC="$(printf '%s' "$UC" | tr -d '\n')"
  if [ "$UC_RC" -eq 0 ]; then
    emit B38 "User 行数" OK "count=${UC} （>0 则不是全新空库，bootstrap 项按 N/A 口径）"
  else
    emit B38 "User 行数" UNKNOWN "rc=${UC_RC} $(one_line "$(head -c 160 "$WORKDIR/uc.err")")"
  fi
fi

# ---------- B39 admin passwordProofState ----------
if [ "$PG_PROBE_RC" -ne 0 ]; then
  emit B39 "管理员口令状态" UNKNOWN "Postgres 未连通"
else
  ADM="$(psql_ro "SELECT role || ',' || \"tokenVersion\"::text || ',' || \"passwordProofState\" || ',' || enabled::text FROM \"User\" WHERE role IN ('admin','owner') AND \"deletedAt\" IS NULL ORDER BY role LIMIT 10;" 2>"$WORKDIR/adm.err")"
  ADM_RC=$?
  if [ "$ADM_RC" -ne 0 ]; then
    emit B39 "管理员口令状态" UNKNOWN "查询 rc=${ADM_RC} （列名按 schema: role,tokenVersion,passwordProofState；未选 passwordHash） $(one_line "$(head -c 160 "$WORKDIR/adm.err")")"
  elif [ -z "$ADM" ]; then
    emit B39 "管理员口令状态" UNKNOWN "查询成功但 0 行 admin/owner"
  else
    LEGACY_N="$(printf '%s\n' "$ADM" | grep -c ',legacy,' || true)"
    emit B39 "管理员口令状态" OK "rows=$(one_line "$ADM") legacy_count=${LEGACY_N} （格式 role,tokenVersion,passwordProofState,enabled）"
  fi
fi

# ---------- B40 bootstrap audit ----------
if [ "$PG_PROBE_RC" -ne 0 ]; then
  emit B40 "bootstrap 审计" UNKNOWN "Postgres 未连通"
else
  BS="$(psql_ro "SELECT action || ' @ ' || \"createdAt\"::text FROM \"AuditLog\" WHERE action ILIKE '%bootstrap%' ORDER BY \"createdAt\" DESC LIMIT 5;" 2>"$WORKDIR/bs.err")"
  BS_RC=$?
  BS_N="$(psql_ro "SELECT count(*) FROM \"AuditLog\" WHERE action ILIKE '%bootstrap%';" 2>/dev/null | tr -d '\n')"
  if [ "$BS_RC" -eq 0 ]; then
    emit B40 "bootstrap 审计" OK "count=${BS_N:-0} latest=$(one_line "${BS:-none}") （未读 payloadJson）"
  else
    emit B40 "bootstrap 审计" UNKNOWN "rc=${BS_RC} $(one_line "$(head -c 160 "$WORKDIR/bs.err")")"
  fi
fi

# ---------- B41 constraints ----------
if [ "$PG_PROBE_RC" -ne 0 ]; then
  emit B41 "核心表约束" UNKNOWN "Postgres 未连通"
else
  CON_N="$(psql_ro "SELECT count(*) FROM pg_constraint WHERE contype IN ('f','u','p');" 2>"$WORKDIR/con.err")"
  CON_RC=$?
  CON_N="$(printf '%s' "$CON_N" | tr -d '\n')"
  SAMPLE="$(psql_ro "SELECT conrelid::regclass::text || ':' || conname || ':' || contype FROM pg_constraint WHERE contype IN ('f','u','p') ORDER BY 1 LIMIT 8;" 2>/dev/null)"
  if [ "$CON_RC" -eq 0 ] && [ "${CON_N:-0}" -gt 0 ]; then
    emit B41 "核心表约束" OK "fk_u_p_count=${CON_N} sample=$(one_line "$SAMPLE")"
  elif [ "$CON_RC" -eq 0 ]; then
    emit B41 "核心表约束" NG "fk_u_p_count=0"
  else
    emit B41 "核心表约束" UNKNOWN "rc=${CON_RC}"
  fi
fi

# ---------- B42 ScanTask dupes ----------
if [ "$PG_PROBE_RC" -ne 0 ]; then
  emit B42 "ScanTask 活跃重复" UNKNOWN "Postgres 未连通"
else
  DUP="$(psql_ro "SELECT \"terminalId\" || '=' || count(*)::text FROM \"ScanTask\" WHERE status IN ('waiting','matched') GROUP BY \"terminalId\" HAVING count(*) > 1;" 2>"$WORKDIR/dup.err")"
  DUP_RC=$?
  if [ "$DUP_RC" -eq 0 ]; then
    if [ -z "$DUP" ]; then
      emit B42 "ScanTask 活跃重复" OK "HAVING count>1 返回 0 行"
    else
      emit B42 "ScanTask 活跃重复" NG "重复终端: $(one_line "$DUP")"
    fi
  else
    emit B42 "ScanTask 活跃重复" UNKNOWN "rc=${DUP_RC} $(one_line "$(head -c 160 "$WORKDIR/dup.err")")"
  fi
fi

# ---------- B43 TerminalCapability scan ----------
if [ "$PG_PROBE_RC" -ne 0 ]; then
  emit B43 "终端 scan 能力" UNKNOWN "Postgres 未连通"
else
  CAPS="$(psql_ro "SELECT \"terminalId\" || ',' || \"capabilityKey\" || ',' || status FROM \"TerminalCapability\" WHERE \"capabilityKey\"='scan';" 2>"$WORKDIR/caps.err")"
  CAPS_RC=$?
  if [ "$CAPS_RC" -eq 0 ]; then
    emit B43 "终端 scan 能力" OK "rows=$(one_line "${CAPS:-none}") （schema 字段是 capabilityKey 不是 key）"
  else
    emit B43 "终端 scan 能力" UNKNOWN "rc=${CAPS_RC} $(one_line "$(head -c 160 "$WORKDIR/caps.err")")"
  fi
fi

# ---------- B44 sqlite leftovers ----------
run_rc "$WORKDIR/sqlite_find" "$WORKDIR/sqlite_find.err" \
  find /srv /var/backups -maxdepth 4 \( -name '*.sqlite*' -o -name '*.db' \) -not -path '*/node_modules/*' 2>/dev/null
# find 即使无匹配也常 rc=0；有权限警告可能 rc=1。以文件列表为准。
SQ_N="$(count_nonempty_lines "$WORKDIR/sqlite_find")"
if [ "${SQ_N:-0}" -eq 0 ]; then
  emit B44 "SQLite 残留文件" OK "find /srv /var/backups maxdepth4 排除 node_modules 命中=0"
else
  SQ_SAMPLE="$(head -8 "$WORKDIR/sqlite_find" | tr '\n' ';')"
  emit B44 "SQLite 残留文件" NG "hits=${SQ_N} sample=${SQ_SAMPLE}"
fi

# ---------- B45 seed traces ----------
SEED_HITS=0
SEED_EV=""
if [ -r /root/.bash_history ]; then
  grep -c -E 'db:seed|DEMO_SEED_CONFIRM' /root/.bash_history >"$WORKDIR/seed_hist" 2>/dev/null || true
  SEED_HITS="$(cat "$WORKDIR/seed_hist" 2>/dev/null || echo 0)"
  SEED_EV="bash_history_hits=${SEED_HITS}"
else
  SEED_EV="bash_history=unreadable"
fi
# 不 grep 日志正文内容到终端；只计数
if [ -n "$OUT_LOG" ] && [ -f "$OUT_LOG" ]; then
  grep -c -E 'db:seed|DEMO_SEED_CONFIRM' "$OUT_LOG" >"$WORKDIR/seed_out" 2>/dev/null || true
  SEED_EV="${SEED_EV} out_log_hits=$(cat "$WORKDIR/seed_out" 2>/dev/null || echo 0)"
fi
emit B45 "db:seed 痕迹" OK "${SEED_EV} （只计数，未打印命中行；有命中不等于生产跑过 seed）"

# ---------- local HTTP helpers ----------
curl_get() {
  local path="$1" body="$2" codef="$3"
  if ! has_cmd curl; then
    return 127
  fi
  curl -sS --max-time 8 -o "$body" -w '%{http_code}' "http://127.0.0.1:${API_PORT}${path}" >"$codef" 2>"${body}.err"
}

# ---------- B46 health ----------
if ! has_cmd curl; then
  emit B46 "本机 /health" UNKNOWN "没有 curl"
else
  curl_get "/api/v1/health" "$WORKDIR/health.json" "$WORKDIR/health.code"
  H_RC=$?
  H_CODE="$(tr -d '\n' <"$WORKDIR/health.code" 2>/dev/null || echo "")"
  if [ "$H_RC" -eq 127 ]; then
    emit B46 "本机 /health" UNKNOWN "没有 curl"
  elif [ "$H_RC" -ne 0 ] && [ -z "$H_CODE" ]; then
    emit B46 "本机 /health" UNKNOWN "curl rc=${H_RC} $(one_line "$(head -c 120 "$WORKDIR/health.json.err")")"
  elif [ -n "$PYTHON" ] && [ -s "$WORKDIR/health.json" ]; then
    helper json-fields status db time <"$WORKDIR/health.json" >"$WORKDIR/health.f" 2>/dev/null
    HF="$(cat "$WORKDIR/health.f")"
    if [ "$H_CODE" != "200" ]; then
      emit B46 "本机 /health" NG "http=${H_CODE} curl_rc=${H_RC} ${HF}"
    else
      case "$HF" in
        *'db=postgres'*) emit B46 "本机 /health" OK "http=200 curl_rc=${H_RC} ${HF}" ;;
        *'db=sqlite'*) emit B46 "本机 /health" NG "http=200 但 db=sqlite，生产必须 postgres ${HF}" ;;
        *) emit B46 "本机 /health" UNKNOWN "http=200 但 JSON 里没有 db=postgres/sqlite ${HF}" ;;
      esac
    fi
  else
    if [ "$H_CODE" = "200" ]; then
      emit B46 "本机 /health" UNKNOWN "http=200 curl_rc=${H_RC} （无 python，未解析 db 字段）"
    else
      emit B46 "本机 /health" NG "http=${H_CODE} curl_rc=${H_RC}"
    fi
  fi
fi

# ---------- B47 ready ----------
if ! has_cmd curl; then
  emit B47 "本机 /health/ready" UNKNOWN "没有 curl"
else
  curl_get "/api/v1/health/ready" "$WORKDIR/ready.json" "$WORKDIR/ready.code"
  R_RC=$?
  R_CODE="$(tr -d '\n' <"$WORKDIR/ready.code" 2>/dev/null || echo "")"
  if [ "$R_RC" -ne 0 ] && [ -z "$R_CODE" ]; then
    emit B47 "本机 /health/ready" UNKNOWN "curl rc=${R_RC} $(one_line "$(head -c 120 "$WORKDIR/ready.json.err")")"
  elif [ -n "$PYTHON" ] && [ -s "$WORKDIR/ready.json" ]; then
    helper json-fields status db <"$WORKDIR/ready.json" >"$WORKDIR/ready.f" 2>/dev/null
    RF="$(cat "$WORKDIR/ready.f")"
    if [ "$R_CODE" != "200" ]; then
      emit B47 "本机 /health/ready" NG "http=${R_CODE} curl_rc=${R_RC} ${RF} （503=有子系统降级，属 ready 语义）"
    else
      case "$RF" in
        *'db=postgres'*) emit B47 "本机 /health/ready" OK "http=200 curl_rc=${R_RC} ${RF}" ;;
        *'db=sqlite'*) emit B47 "本机 /health/ready" NG "http=200 但 db=sqlite，生产必须 postgres ${RF}" ;;
        *) emit B47 "本机 /health/ready" UNKNOWN "http=200 但 JSON 里没有 db 字段 ${RF}" ;;
      esac
    fi
  else
    if [ "$R_CODE" = "200" ]; then
      emit B47 "本机 /health/ready" UNKNOWN "http=200 curl_rc=${R_RC} （无 python，未解析 db 字段）"
    else
      emit B47 "本机 /health/ready" NG "http=${R_CODE} curl_rc=${R_RC}"
    fi
  fi
fi

# ---------- B48 conversion capabilities ----------
if ! has_cmd curl; then
  emit B48 "document-conversion capabilities" UNKNOWN "没有 curl"
else
  curl_get "/api/v1/document-conversion/capabilities" "$WORKDIR/cap.json" "$WORKDIR/cap.code"
  C_RC=$?
  C_CODE="$(tr -d '\n' <"$WORKDIR/cap.code" 2>/dev/null || echo "")"
  if [ "$C_CODE" = "200" ] && [ -n "$PYTHON" ]; then
    helper json-fields wordToPdf engine cjkFonts <"$WORKDIR/cap.json" >"$WORKDIR/cap.f" 2>/dev/null
    emit B48 "document-conversion capabilities" OK "http=200 $(cat "$WORKDIR/cap.f") CONVERSION_ENGINE=${CENG:-unread}"
  elif [ "$C_CODE" = "200" ]; then
    emit B48 "document-conversion capabilities" OK "http=200 （无 python 未拆字段）"
  elif [ -z "$C_CODE" ]; then
    emit B48 "document-conversion capabilities" UNKNOWN "curl rc=${C_RC}"
  else
    emit B48 "document-conversion capabilities" NG "http=${C_CODE} curl_rc=${C_RC}"
  fi
fi

# ---------- B49 log secret-pattern counts ----------
count_pat() {
  local file="$1"
  if [ ! -f "$file" ]; then
    echo "missing"
    return 1
  fi
  grep -cEi 'sk-|api[_-]?key|Bearer eyJ|BEGIN PRIVATE|access_token' "$file" 2>/dev/null
  local rc=$?
  if [ "$rc" -eq 1 ]; then
    echo 0
  fi
  return 0
}
if [ -z "$ERR_LOG" ] && [ -z "$OUT_LOG" ]; then
  emit B49 "日志疑似密钥行数" UNKNOWN "没有日志路径，未扫描正文"
else
  ERR_HITS="na"
  OUT_HITS="na"
  if [ -n "$ERR_LOG" ] && [ -f "$ERR_LOG" ]; then
    ERR_HITS="$(grep -cEi 'sk-|api[_-]?key|Bearer eyJ|BEGIN PRIVATE|access_token' "$ERR_LOG" 2>/dev/null || true)"
    [ -z "$ERR_HITS" ] && ERR_HITS=0
  fi
  if [ -n "$OUT_LOG" ] && [ -f "$OUT_LOG" ]; then
    OUT_HITS="$(grep -cEi 'sk-|api[_-]?key|Bearer eyJ|BEGIN PRIVATE|access_token' "$OUT_LOG" 2>/dev/null || true)"
    [ -z "$OUT_HITS" ] && OUT_HITS=0
  fi
  # grep -c 无匹配退出 1 且可能空输出，上面 || true 已兜住
  if [ "${ERR_HITS:-0}" = "0" ] && [ "${OUT_HITS:-0}" = "0" ]; then
    emit B49 "日志疑似密钥行数" OK "error_hits=${ERR_HITS} out_hits=${OUT_HITS} （grep -c 只计数，未打印命中行）"
  elif [ "$ERR_HITS" = "na" ] && [ "$OUT_HITS" = "na" ]; then
    emit B49 "日志疑似密钥行数" UNKNOWN "路径有值但文件不存在 err=${ERR_LOG:-none} out=${OUT_LOG:-none}"
  else
    emit B49 "日志疑似密钥行数" NG "error_hits=${ERR_HITS} out_hits=${OUT_HITS} （只报行数，未打印命中行，请在服务器上本地看）"
  fi
fi

# ---------- B50 LOG_LEVEL + conversion log counts ----------
LOGV=""
PINOV=""
if [ -f "$ENV_FILE" ] && [ -n "$PYTHON" ]; then
  LOGV="$(val_of LOG_LEVEL || true)"
  PINOV="$(val_of PINO_LEVEL || true)"
fi
CONV_HITS="na"
if [ -n "$OUT_LOG" ] && [ -f "$OUT_LOG" ]; then
  CONV_HITS="$(grep -cEi 'conversion|soffice|cjk|wordToPdf' "$OUT_LOG" 2>/dev/null || true)"
  [ -z "$CONV_HITS" ] && CONV_HITS=0
fi
emit B50 "日志级别与转换日志行数" OK "LOG_LEVEL=${LOGV:-unset} PINO_LEVEL=${PINOV:-unset} conversion_like_lines=${CONV_HITS} （只计数）"

# ---------- B51 LibreOffice + wrapper ----------
DPKG_EV=""
if has_cmd dpkg-query; then
  run_rc "$WORKDIR/lo" "$WORKDIR/lo.err" dpkg-query -W -f='${Package}=${Version}; ' libreoffice-core libreoffice-writer
  DPKG_RC=$?
  DPKG_EV="$(tr -d '\n' <"$WORKDIR/lo")"
  [ "$DPKG_RC" -ne 0 ] && DPKG_EV="dpkg-query_rc=${DPKG_RC} ${DPKG_EV}"
else
  DPKG_EV="no_dpkg_query"
fi
WRAP="/usr/local/bin/soffice-sandboxed"
WRAP_EV="wrapper=${WRAP}"
if [ -e "$WRAP" ]; then
  WRAP_MODE="$(stat -c '%a %U:%G' "$WRAP" 2>/dev/null || echo "?")"
  WRAP_EV="wrapper_exists mode=${WRAP_MODE}"
  if [ -x "$WRAP" ]; then
    run_rc "$WORKDIR/sver" "$WORKDIR/sver.err" "$WRAP" --version
    SVER_RC=$?
    # version 行通常不含密钥
    SVER="$(head -1 "$WORKDIR/sver" | tr '\n' ' ')"
    WRAP_EV="${WRAP_EV} --version_rc=${SVER_RC} ${SVER}"
  fi
else
  WRAP_EV="wrapper_missing"
fi
id soffice-runner >/dev/null 2>&1
SR_RC=$?
if [ "$SR_RC" -eq 0 ] && [ -x "$WRAP" ]; then
  emit B51 "LibreOffice 与 soffice 包装" OK "${DPKG_EV} ${WRAP_EV} soffice-runner=yes"
elif has_cmd dpkg-query; then
  emit B51 "LibreOffice 与 soffice 包装" NG "${DPKG_EV} ${WRAP_EV} soffice-runner_id_rc=${SR_RC}"
else
  emit B51 "LibreOffice 与 soffice 包装" UNKNOWN "${DPKG_EV} ${WRAP_EV} soffice-runner_id_rc=${SR_RC}"
fi

# ---------- B52 font packages ----------
if has_cmd dpkg-query; then
  run_rc "$WORKDIR/fonts" "$WORKDIR/fonts.err" dpkg-query -W -f='${Package}=${Version}; ' fonts-noto-cjk fonts-noto-cjk-extra fonts-wqy-microhei fonts-wqy-zenhei 2>/dev/null
  FONT_RC=$?
  FONT_EV="$(tr -d '\n' <"$WORKDIR/fonts")"
  case "$FONT_EV" in
    *fonts-noto-cjk=*) emit B52 "中文字体包" OK "${FONT_EV}" ;;
    "") emit B52 "中文字体包" UNKNOWN "dpkg-query 无输出 rc=${FONT_RC}" ;;
    *) emit B52 "中文字体包" NG "已装=${FONT_EV} 未见 fonts-noto-cjk（B06 fc-list 另计）" ;;
  esac
else
  emit B52 "中文字体包" UNKNOWN "没有 dpkg-query"
fi

# ---------- B53 CORS ----------
if [ ! -f "$ENV_FILE" ] || [ -z "$PYTHON" ]; then
  emit B53 "CORS_ALLOWED_ORIGINS" UNKNOWN "无法安全读取"
else
  CORS="$(val_of CORS_ALLOWED_ORIGINS || true)"
  if [ -n "$CORS" ]; then
    emit B53 "CORS_ALLOWED_ORIGINS" OK "value=${CORS}"
  else
    emit B53 "CORS_ALLOWED_ORIGINS" NG "未配置；生产必须显式白名单"
  fi
fi

# ---------- B54 notify + codepay ----------
if [ ! -f "$ENV_FILE" ] || [ -z "$PYTHON" ]; then
  emit B54 "支付回调与付款码收敛" UNKNOWN "无法安全读取"
else
  NOTIFY="$(val_of PAYMENT_NOTIFY_BASE_URL || true)"
  CODEPAY="$(val_of PAYMENT_CODEPAY_AUTO_CONVERGE_ENABLED || true)"
  PAYN="${PAY_VAL:-$PAY_FILE}"
  case "$NOTIFY" in
    https://*) emit B54 "支付回调与付款码收敛" OK "PAYMENT_NOTIFY_BASE_URL=${NOTIFY} PAYMENT_CODEPAY_AUTO_CONVERGE_ENABLED=${CODEPAY:-unset} PAYMENT_PROVIDER=${PAYN:-unset}" ;;
    "") emit B54 "支付回调与付款码收敛" NG "PAYMENT_NOTIFY_BASE_URL 未配置 PAYMENT_PROVIDER=${PAYN:-unset} codepay=${CODEPAY:-unset}" ;;
    *) emit B54 "支付回调与付款码收敛" NG "PAYMENT_NOTIFY_BASE_URL=${NOTIFY} 生产必须 https:// codepay=${CODEPAY:-unset}" ;;
  esac
fi

# ---------- B55 signing TTL ----------
if [ ! -f "$ENV_FILE" ] || [ -z "$PYTHON" ]; then
  emit B55 "签名 URL TTL" UNKNOWN "无法读取 TENCENT_COS_SIGN_URL_EXPIRES_SECONDS"
else
  TTL="$(val_of TENCENT_COS_SIGN_URL_EXPIRES_SECONDS || true)"
  if [ -z "$TTL" ]; then
    emit B55 "签名 URL TTL" OK "TENCENT_COS_SIGN_URL_EXPIRES_SECONDS 未设，代码默认 1800 且合规上限 1800"
  else
    if [ "$TTL" -le 1800 ] 2>/dev/null && [ "$TTL" -gt 0 ] 2>/dev/null; then
      emit B55 "签名 URL TTL" OK "TENCENT_COS_SIGN_URL_EXPIRES_SECONDS=${TTL} (<=1800)"
    else
      emit B55 "签名 URL TTL" NG "TENCENT_COS_SIGN_URL_EXPIRES_SECONDS=${TTL} 合规上限 1800"
    fi
  fi
fi

# ---------- B56 WEB_ROOT ----------
if [ "$NGINX_RC" -ne 0 ]; then
  emit B56 "静态 WEB_ROOT" UNKNOWN "无 nginx dump"
else
  ROOT_LINES="$(awk 'BEGIN{IGNORECASE=1} $1=="root" {gsub(/;$/,"",$2); print $2}' "$WORKDIR/ngx" | sort -u | tr '\n' ' ')"
  SAMPLE_LS=""
  FIRST_ROOT="$(awk 'BEGIN{IGNORECASE=1} $1=="root" {gsub(/;$/,"",$2); print $2; exit}' "$WORKDIR/ngx")"
  if [ -n "$FIRST_ROOT" ] && [ -d "$FIRST_ROOT" ]; then
    SAMPLE_LS="$(ls -1 "$FIRST_ROOT" 2>/dev/null | head -8 | tr '\n' ',')"
  fi
  emit B56 "静态 WEB_ROOT" OK "roots=${ROOT_LINES} first_ls=${SAMPLE_LS} （只列目录名，确认是前端 dist 而不是用户数据盘）"
fi

# ---------- B57 leftover cred files ----------
# 只列路径与 mode，不 cat。
run_rc "$WORKDIR/creds" "$WORKDIR/creds.err" \
  find /root /srv /var -maxdepth 3 \( -name '*admin*cred*' -o -name '*bootstrap*' -o -name '*pass*.txt' \) 2>/dev/null
CRED_N="$(count_nonempty_lines "$WORKDIR/creds")"
if [ "${CRED_N:-0}" -eq 0 ]; then
  emit B57 "残留凭据文件" OK "find maxdepth3 命中=0 （未打开任何文件）"
else
  CRED_LS="$(head -10 "$WORKDIR/creds" | tr '\n' ';')"
  emit B57 "残留凭据文件" NG "hits=${CRED_N} paths=${CRED_LS} （只报路径，未 cat）"
fi

# ---------- B58 start-log postgres vs sqlite counts ----------
if [ -n "$OUT_LOG" ] && [ -f "$OUT_LOG" ]; then
  PG_H="$(grep -cEi 'postgres' "$OUT_LOG" 2>/dev/null || true)"
  SQ_H="$(grep -cEi 'sqlite' "$OUT_LOG" 2>/dev/null || true)"
  [ -z "$PG_H" ] && PG_H=0
  [ -z "$SQ_H" ] && SQ_H=0
  emit B58 "启动日志 postgres/sqlite 行数" OK "out_log=${OUT_LOG} postgres_hits=${PG_H} sqlite_hits=${SQ_H} （只计数，未打印行；sqlite 命中需人工看是不是 node_modules 噪声）"
else
  emit B58 "启动日志 postgres/sqlite 行数" UNKNOWN "没有 out log 可计数"
fi

# ---------- B59 PG size / connections / redis mem / PrintTask ----------
B59_EV=""
B59_OK=1
if [ "$PG_PROBE_RC" -eq 0 ]; then
  SIZE="$(psql_ro "SELECT pg_size_pretty(pg_database_size(current_database()));" 2>/dev/null | tr -d '\n')"
  CONNS="$(psql_ro "SELECT count(*) FROM pg_stat_activity;" 2>/dev/null | tr -d '\n')"
  TASKS="$(psql_ro "SELECT status || '=' || count(*)::text FROM \"PrintTask\" GROUP BY status ORDER BY 1;" 2>/dev/null | tr '\n' ' ')"
  B59_EV="db_size=${SIZE} pg_stat_activity=${CONNS} PrintTask=${TASKS:-none}"
else
  B59_EV="postgres=unconnected"
  B59_OK=0
fi
if has_cmd redis-cli; then
  run_rc "$WORKDIR/rmem" "$WORKDIR/rmem.err" redis-cli -h 127.0.0.1 INFO memory
  if [ $? -eq 0 ]; then
    RUSED="$(awk -F: '/^used_memory_human:/ {print $2}' "$WORKDIR/rmem" | tr -d '\r')"
    B59_EV="${B59_EV} redis_used=${RUSED}"
  else
    B59_EV="${B59_EV} redis_info=fail"
    B59_OK=0
  fi
else
  B59_EV="${B59_EV} redis-cli=missing"
  B59_OK=0
fi
if [ "$B59_OK" -eq 1 ]; then
  emit B59 "库体积/连接/Redis 内存/打印任务" OK "${B59_EV}"
else
  emit B59 "库体积/连接/Redis 内存/打印任务" UNKNOWN "${B59_EV}"
fi

printf '\n'
printf '=== 合计 items=%s OK=%s NG=%s UNKNOWN=%s ===\n' "$N_TOTAL" "$N_OK" "$N_NG" "$N_UNK"
if [ "$N_TOTAL" -ne 59 ]; then
  printf 'WARNING: 脚本内部计数=%s，期望 59。这是脚本 bug，不是生产状态。\n' "$N_TOTAL" >&2
fi
printf '只读采集结束。临时目录将删除。请把上面 59 行贴进工单，不要再附 .env 或 pm2 env。\n'
