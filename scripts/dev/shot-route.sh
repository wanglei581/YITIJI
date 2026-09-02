#!/usr/bin/env bash
# 截取 kiosk 运行时任意路由的 1080×1920 实图。
#
# 为什么需要它：51 页新稿迁移每页都要「实测渲染」验收，而这条链路有四个坑，
# 每个都会让人对着错误的东西下结论：
#   1. .claude/launch.json 里 kiosk 的路径写死成主仓绝对路径 —— 在 worktree 里
#      改的代码根本不会被那个 server 加载，截到的是主仓旧页面。用 kiosk-worktree。
#   2. worktree 缺 apps/kiosk/.env.local 与 services/api/.env，缺后者 API 直接
#      FATAL（TERMINAL_ADMIN_SECRET is required），页面会卡在会话清除态。
#   3. KioskPrivacyGuard 会把隐私边界写进 localStorage/cookie；一旦留下残留，
#      该 origin 上任何页面都被遮罩并重载回首页，且清不掉就永远出不来。
#      故每次都用全新 profile。
#   4. Firefox 的 --screenshot 不等 SPA 渲染，截出来是空白页。
#      Chrome 的 --virtual-time-budget 会推进虚拟时间后再截，但它截完不退出，
#      所以必须用 timeout 包住，否则调用方一直挂着。
#
# 用法：scripts/dev/shot-route.sh /print/pickup-claim [输出路径] [端口]
set -euo pipefail
ROUTE="${1:?用法: shot-route.sh /path [out.png] [port]}"
OUT="${2:-/tmp/kiosk-shot.png}"
PORT="${3:-5279}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$CHROME" ] || { echo "找不到 Chrome：$CHROME" >&2; exit 1; }
curl -s -o /dev/null --max-time 3 "http://localhost:$PORT/" || {
  echo "dev server 未运行（端口 $PORT）。先启动 launch.json 里的 kiosk-worktree。" >&2; exit 1; }
PROFILE="$(mktemp -d)"
trap 'rm -rf "$PROFILE"' EXIT
# Chrome headless 截完不会自己退出（已知行为），必须外层 timeout 兜住
timeout 30 "$CHROME" --headless --disable-gpu --no-first-run --no-default-browser-check \
  --user-data-dir="$PROFILE" \
  --window-size=1080,1920 --force-device-scale-factor=1 \
  --virtual-time-budget=8000 \
  --screenshot="$OUT" "http://localhost:$PORT$ROUTE" >/dev/null 2>&1 || true
[ -s "$OUT" ] || { echo "截图未生成：$OUT" >&2; exit 1; }
echo "$OUT"
