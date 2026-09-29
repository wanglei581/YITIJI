#!/usr/bin/env bash
# 启动 K1 走查用的两个常驻无头 Chromium（一体机 9531、手机 9532），各用独立用户目录。
# 用法：browsers.sh start|stop  ；PID 记在 $STATE/browsers.pid，只停自己起的进程。
set -euo pipefail
CHROME="${HOME}/Library/Caches/ms-playwright/chromium-1193/chrome-mac/Chromium.app/Contents/MacOS/Chromium"
STATE="${K1_STATE:-${HOME}/.cache/walk0929/k1-browsers}"
mkdir -p "${STATE}"
case "${1:-start}" in
  start)
    : > "${STATE}/browsers.pid"
    for spec in "kiosk:9531:1080,1920" "phone:9532:390,844"; do
      IFS=: read -r name port size <<< "${spec}"
      nohup "${CHROME}" --headless=new --remote-debugging-port="${port}" \
        --user-data-dir="${STATE}/${name}" --window-size="${size}" \
        --no-first-run --no-default-browser-check --lang=zh-CN about:blank \
        > "${STATE}/${name}.log" 2>&1 &
      echo $! >> "${STATE}/browsers.pid"
    done
    ;;
  stop)
    [ -f "${STATE}/browsers.pid" ] && xargs kill < "${STATE}/browsers.pid" || true
    ;;
esac
