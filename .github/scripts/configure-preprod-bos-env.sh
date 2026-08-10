#!/usr/bin/env bash
# 预生产 BOS 环境校验与原子配置写入。
#
# 仅由 deploy-preprod-bos.yml 调用：
# - check：只读核对隔离目录、数据库身份、历史 COS 和 BOS 配置；
# - apply：在 deploy-api-release.sh 完成运行目录备份后，原子更新受保护 .env。
set -euo pipefail

MODE="${1:-}"
if [ "$MODE" != "check" ] && [ "$MODE" != "apply" ]; then
  echo "::error::usage: configure-preprod-bos-env.sh check|apply" >&2
  exit 1
fi

fail() {
  echo "::error::$1" >&2
  exit 1
}

if [ "${DEPLOY_TARGET_ENV:-}" != "preprod" ]; then
  fail "DEPLOY_TARGET_ENV must be exactly preprod"
fi
if [ "${PRINT_REQUIRE_PII_SCAN:-}" != "true" ]; then
  fail "PRINT_REQUIRE_PII_SCAN must be explicitly true in preprod"
fi

: "${DEPLOY_API_DIR:?DEPLOY_API_DIR is required}"
: "${DEPLOY_PM2_NAME:?DEPLOY_PM2_NAME is required}"
: "${DEPLOY_HEALTH_URL:?DEPLOY_HEALTH_URL is required}"
: "${PREPROD_PUBLIC_ORIGIN:?PREPROD_PUBLIC_ORIGIN is required}"
: "${BAIDU_BOS_ACCESS_KEY_ID:?BAIDU_BOS_ACCESS_KEY_ID is required}"
: "${BAIDU_BOS_SECRET_ACCESS_KEY:?BAIDU_BOS_SECRET_ACCESS_KEY is required}"
: "${BAIDU_BOS_BUCKET:?BAIDU_BOS_BUCKET is required}"
: "${BAIDU_BOS_REGION:?BAIDU_BOS_REGION is required}"
: "${BAIDU_BOS_ENDPOINT:?BAIDU_BOS_ENDPOINT is required}"

RUNTIME_ROOT="$DEPLOY_API_DIR"
API_DIR="$RUNTIME_ROOT/services/api"
ENV_FILE="$API_DIR/.env"

case "$RUNTIME_ROOT" in
  /*preprod*) ;;
  *) fail "preprod runtime path must be absolute and contain preprod" ;;
esac
if [ "$RUNTIME_ROOT" = "/srv/ai-job-print" ]; then
  fail "preprod runtime path must not equal the production default"
fi
case "$DEPLOY_PM2_NAME" in
  *preprod*) ;;
  *) fail "preprod PM2 name must contain preprod" ;;
esac
if [ "$DEPLOY_PM2_NAME" = "ai-job-print-api" ]; then
  fail "preprod PM2 name must not equal the production default"
fi
case "$DEPLOY_HEALTH_URL" in
  http://127.0.0.1:*/api/v1/health) ;;
  *) fail "preprod health URL must use an explicit loopback port and /api/v1/health" ;;
esac
if [ "$DEPLOY_HEALTH_URL" = "http://127.0.0.1:3010/api/v1/health" ]; then
  fail "preprod health URL must not use the production default"
fi
case "$PREPROD_PUBLIC_ORIGIN" in
  https://*) ;;
  *) fail "preprod public origin must use HTTPS" ;;
esac
case "$PREPROD_PUBLIC_ORIGIN" in
  *zyidai.cn*) fail "preprod public origin must not use the production domain" ;;
esac

case "$BAIDU_BOS_ENDPOINT" in
  https://*.bcebos.com) ;;
  *) fail "preprod BOS endpoint must be an official HTTPS regional endpoint" ;;
esac
case "$BAIDU_BOS_BUCKET" in
  *preprod*) ;;
  *) fail "preprod BOS bucket name must contain preprod" ;;
esac

[ -f "$ENV_FILE" ] || fail "preprod API .env must be provisioned before deployment"
if ENV_MODE="$(stat -c '%a' "$ENV_FILE" 2>/dev/null)"; then
  ENV_OWNER="$(stat -c '%u:%g' "$ENV_FILE")"
else
  ENV_MODE="$(stat -f '%Lp' "$ENV_FILE")"
  ENV_OWNER="$(stat -f '%u:%g' "$ENV_FILE")"
fi
case "$ENV_MODE" in
  '' | *[!0-7]*) fail "unable to determine preprod API .env permissions" ;;
esac
if [ $((8#$ENV_MODE & 077)) -ne 0 ]; then
  fail "preprod API .env must not be group/world accessible"
fi

read_env() {
  local key="$1"
  sed -n -E "s/^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*=[[:space:]]*\"?([^\"]*)\"?[[:space:]]*$/\\2/p" "$ENV_FILE" | tail -n1
}

if [ "$(read_env DEPLOYMENT_ENV)" != "preprod" ]; then
  fail "server .env must contain DEPLOYMENT_ENV=preprod before first deployment"
fi

DBURL="$(read_env DATABASE_URL)"
case "$DBURL" in
  postgresql://* | postgres://*) ;;
  *) fail "preprod DATABASE_URL must be PostgreSQL" ;;
esac
command -v psql >/dev/null 2>&1 || fail "psql is required for database identity checks"
DBNAME="$(psql "$DBURL" -X -A -t -v ON_ERROR_STOP=1 -c 'SELECT current_database()')"
case "$DBNAME" in
  *preprod* | *staging*) ;;
  *) fail "database name must contain preprod or staging" ;;
esac

for key in TENCENT_COS_SECRET_ID TENCENT_COS_SECRET_KEY TENCENT_COS_BUCKET TENCENT_COS_REGION; do
  [ -n "$(read_env "$key")" ] || fail "historical COS configuration is incomplete: $key"
done

if [ "$MODE" = "check" ]; then
  echo "PASS: isolated preprod runtime, PostgreSQL identity, BOS target and legacy COS configuration verified"
  exit 0
fi

export FILE_STORAGE_DRIVER=bos
export FILE_STORAGE_LEGACY_DRIVER=cos
export FILE_STORAGE_SIGN_URL_EXPIRES_SECONDS=1800
export CONTRACT_REVIEW_REPORT_PRINT_ENABLED=false
export DEPLOYMENT_ENV=preprod

ENV_TMP="$(mktemp "$API_DIR/.env.preprod.XXXXXX")"
cleanup() {
  rm -f -- "$ENV_TMP"
}
trap cleanup EXIT

awk '
  BEGIN {
    count = split("DEPLOYMENT_ENV FILE_STORAGE_DRIVER FILE_STORAGE_LEGACY_DRIVER FILE_STORAGE_SIGN_URL_EXPIRES_SECONDS BAIDU_BOS_ACCESS_KEY_ID BAIDU_BOS_SECRET_ACCESS_KEY BAIDU_BOS_BUCKET BAIDU_BOS_REGION BAIDU_BOS_ENDPOINT CONTRACT_REVIEW_REPORT_PRINT_ENABLED", keys, " ")
    for (i = 1; i <= count; i++) desired[keys[i]] = ENVIRON[keys[i]]
  }
  {
    normalized = $0
    sub(/^[[:space:]]*export[[:space:]]+/, "", normalized)
    split(normalized, parts, "=")
    key = parts[1]
    gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
    if (key in desired) {
      if (!written[key]) {
        print key "=" desired[key]
        written[key] = 1
      }
      next
    }
    print
  }
  END {
    for (i = 1; i <= count; i++) {
      key = keys[i]
      if (!written[key]) print key "=" desired[key]
    }
  }
' "$ENV_FILE" > "$ENV_TMP"

chmod "$ENV_MODE" "$ENV_TMP"
chown "$ENV_OWNER" "$ENV_TMP" 2>/dev/null || true
mv -f -- "$ENV_TMP" "$ENV_FILE"
trap - EXIT

echo "PASS: preprod BOS settings applied atomically; contract review remains disabled"
