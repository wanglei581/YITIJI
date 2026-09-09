#!/usr/bin/env bash
# ============================================================
# 摘掉 runner 上我们从不使用的第三方 apt 源，避免它有权否决整条 CI。
#
# 2026-09-10 实测：dl.google.com 的 Chrome apt 索引出现 Hash Sum mismatch，
# `apt-get update` 直接 exit 100，于是
#   - postgres-readiness  的「Install CJK font + sqlite3 + redis-server」红
#   - kiosk-browser-smoke 的「Install Playwright Chromium」红
#     （`playwright install --with-deps` 内部也会跑 apt-get update）
# 同一个 run 连试两次、落在两台不同 runner 上，两次同样这两步红 —— 不是偶发抖动。
#
# 而我们**从不从这个源装任何东西**：
#   - fonts-noto-cjk / sqlite3 / redis-server 都来自 Ubuntu 官方源；
#   - Chromium 由 Playwright 自己下载，`--with-deps` 只装 Ubuntu 的运行库。
#
# 注意这里删的是**源清单文件**，不是已安装的包。runner 镜像预装的
# google-chrome-stable 二进制不受影响 ——
# `apps/kiosk/tests/visual/kiosk-p1-visual-evidence.spec.ts` 里 target 64 用的
# `chromium.launch({ channel: 'chrome' })` 照常可用。
#
# 幂等：源不存在时什么都不做，退出 0。
# ============================================================
set -u

removed=0
for f in /etc/apt/sources.list.d/*; do
  [ -e "$f" ] || continue
  if grep -qE 'dl\.google\.com|google-chrome' "$f" 2>/dev/null; then
    sudo rm -f "$f" && removed=$((removed + 1))
    printf '已摘掉未使用的第三方 apt 源: %s\n' "$f"
  fi
done

if [ "$removed" -eq 0 ]; then
  printf '没有需要摘掉的第三方 apt 源（本步为幂等操作）\n'
fi
exit 0
