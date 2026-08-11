#!/bin/sh
# ============================================================
# 生成回归台的页面清单 pages.json
# ------------------------------------------------------------
# 每次全量回归前必须先跑，否则新增页会被静默漏测。
#   用法：sh tools/make-pages.sh      （在设计稿目录下）
#
# 为什么不让回归台自己扫目录：浏览器读不到文件系统，而 python 的
# http.server 在有 index.html 时不出目录列表 —— 只能从外面生成。
#
# 为什么要显式列 retired：01-home.html / v4 / v5 是被替代的旧首页
# （已定：全站统一 V6）。它们**不删**（还留着做版本对照），但也
# 不该进交付集。静默跳过会让报告读起来像"全站都跑了"，
# 所以这里把排除项和排除原因一起写进 json，让报告能说清楚。
# ============================================================
cd "$(dirname "$0")/.." || exit 1

# 退役页：不进交付集、不进全量回归，但保留文件
RETIRED="01-home.html 01-home-v4.html 01-home-v5.html"

is_retired () {
  for r in $RETIRED; do [ "$1" = "$r" ] && return 0; done
  return 1
}

ALL=$(ls -1 [0-9]*.html | sort)
LIVE=""
for f in $ALL; do is_retired "$f" || LIVE="$LIVE $f"; done

n=0; for f in $LIVE; do n=$((n+1)); done

{
  printf '{\n'
  printf '  "generatedAt": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '  "note": "由 tools/make-pages.sh 生成。全量回归前必须重跑，否则新增页会被静默漏测。",\n'
  printf '  "retiredNote": "retired 里的页保留文件但不进交付集：已定全站统一 V6 首页。",\n'
  printf '  "retired": ['
  first=1
  for f in $RETIRED; do
    [ -f "$f" ] || continue
    [ $first -eq 1 ] || printf ','
    printf '"%s"' "$f"; first=0
  done
  printf '],\n'
  printf '  "pages": [\n'
  i=0
  for f in $LIVE; do
    i=$((i+1))
    if [ $i -lt $n ]; then printf '    "%s",\n' "$f"; else printf '    "%s"\n' "$f"; fi
  done
  printf '  ]\n}\n'
} > pages.json

echo "pages.json：交付集 $n 页，退役 $(echo $RETIRED | wc -w | tr -d ' ') 页"
