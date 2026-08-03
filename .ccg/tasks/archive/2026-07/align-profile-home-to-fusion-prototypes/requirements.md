# 需求与文件预算

## 真实闭环

- `/profile` 以融合原型 `14-profile.html` 为唯一视觉基准，保留真实身份、概览数据、会话记录和现有入口。
- 首页在后台配置启用时必须显示并可点击“百宝箱”“智慧校园”，位置和可见性与 `01-home.html` 一致。
- 重新执行 86 原型路由/功能矩阵门禁，防止其他正式入口回退。

## 允许修改

- `apps/kiosk/src/pages/profile/ProfilePage.tsx`
- `apps/kiosk/src/pages/profile/components/ProfileHeader.tsx`
- `apps/kiosk/src/pages/profile/profile-lightflow-shell.css`
- `apps/kiosk/src/pages/profile/profile-lightflow-directory.css`
- `apps/kiosk/src/pages/profile/profile-lightflow-state.css`
- `apps/kiosk/src/styles/prototype-v1.css`（仅当首页几何验证证明必要）
- `apps/kiosk/scripts/verify-fusion-home.mjs`
- `apps/kiosk/scripts/verify-fusion-w5.mjs`
- `apps/kiosk/scripts/verify-lightflow-profile-entry.mjs`（用户本轮明确以原型 14 覆盖旧扁平化视觉合同）
- `apps/kiosk/scripts/verify-profile-inkpaper-home.mjs`（同步 CI 中仍执行的旧视觉合同，保留其路由/真实数据与 `/me/*` 边界守卫）
- `apps/kiosk/package.json`（仅新增或调整必要 verify script）
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- 本 CCG task 内文件

## 禁止范围

- 不修改 `/me/*` 页面业务功能、API、DTO、Prisma、认证、权限、支付、打印、扫描、AI、TRTC、Terminal Agent。
- 不把原型示例姓名、手机号、数量或会话记录写成生产假数据。
- 不改变百宝箱/智慧校园的后台开关语义；关闭时仍按原型诚实隐藏首页入口并保留直达空态。
- 不新增页面、路由、重复入口或依赖。

## 验证

- TDD：先增强静态 verify 并确认 RED，再实施 GREEN。
- 1080×1920、390×844、390×700 浏览器实点，检查入口、几何、溢出和返回路径。
- Kiosk typecheck、lint、build，新增/相关 verify，86 原型路由/功能矩阵门禁，`git diff --check`。
- 变更超过 30 行时 Antigravity + Claude 双模型分析与审查。
