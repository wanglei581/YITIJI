#!/usr/bin/env bash
set -euo pipefail

secret_dir=/srv/ai-job-print-secrets
secret_file="$secret_dir/bos-release.env"
script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

read -r -s -p 'BOS access key: ' access_key
printf '\n'
read -r -s -p 'BOS secret key: ' secret_key
printf '\n'

umask 077
mkdir -p "$secret_dir"
{
  printf '%s\n' 'BOS_RELEASE_ENDPOINT=bj.bcebos.com'
  printf '%s\n' 'BOS_RELEASE_BUCKET=ai-job-print-release'
  printf 'BOS_RELEASE_ACCESS_KEY=%s\n' "$access_key"
  printf 'BOS_RELEASE_SECRET_KEY=%s\n' "$secret_key"
} > "$secret_file"
chmod 600 "$secret_file"
unset access_key secret_key

set -a
. "$secret_file"
set +a
node "$script_dir/bos-object.mjs" head latest-deployed.txt >/dev/null 2>&1
case $? in
  0) echo '可达（基线 latest-deployed.txt 已存在）' ;;
  3) echo '可达（桶可访问，基线尚未建立：首次发布将回退 GitHub 拉取，成功后自动写入）' ;;
  *) echo '不可达（密钥、桶名或网络有误；密钥文件已写入，可修正后重跑本脚本）' ;;
esac
