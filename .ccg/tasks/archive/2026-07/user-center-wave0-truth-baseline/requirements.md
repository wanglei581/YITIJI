# 用户中心 Wave 0 真实表达与验证基线

## 真实闭环

把用户中心从“重复/占位入口 + 可伪造隐私工单完成态”收口为真实、可验证的上线基线，为后续账户安全和数据权利能力提供可信前置。

## 功能归位

- Kiosk：`apps/kiosk/src/pages/profile/**`、`apps/kiosk/src/pages/auth/**` 只清理重复/占位/不可用入口和旧口径。
- API：`services/api/src/member-privacy/**` 只阻断未执行的 export/delete 完成态与 delete 普通拒绝。
- 验证：Kiosk/API verify 与 `.github/workflows/ci.yml` 锁定真实表达和状态门禁。
- 数据库：只重放现有 SQLite/PostgreSQL migration，不新增 schema 或 migration。
- 文档：只同步用户数据流、进度、下一步和 Wave 0 验收证据。
- 不涉及：Admin UI、Partner、shared 类型、worker、Terminal Agent、打印机、支付、权益、线上环境。

## 允许修改

- `.github/workflows/ci.yml`
- `apps/kiosk/package.json`
- `apps/kiosk/scripts/verify-user-center-wave0.mjs`
- `apps/kiosk/scripts/verify-profile-inkpaper-home.mjs`
- `apps/kiosk/scripts/verify-profile-commercial-first-batch.mjs`
- `apps/kiosk/scripts/verify-lightflow-profile-entry.mjs`
- `apps/kiosk/scripts/verify-lightflow-4188-layout-parity.mjs`
- `apps/kiosk/src/pages/profile/profileEntries.ts`
- `apps/kiosk/src/pages/auth/LoginPage.tsx`
- `apps/kiosk/src/pages/auth/styles/login-form.css`
- `apps/kiosk/src/pages/profile/me/MySettingsPage.tsx`
- `services/api/package.json`
- `services/api/scripts/verify-member-data-request-truth.ts`
- `services/api/scripts/verify-job-ai-privacy.ts`
- `services/api/src/member-privacy/member-privacy.service.ts`
- `docs/product/user-data-flow-matrix.md`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- `docs/acceptance/user-center-wave0-acceptance.md`
- `.ccg/tasks/user-center-wave0-truth-baseline/**`（工具状态，完成后归档）

## 禁止

- 不新增用户中心首页入口、页面、服务、数据模型、migration 或外部依赖。
- 不回退现有二维码登录实现/守卫，不新增邮箱/OAuth 登录。
- 不实现真实导出/注销，不把部分删除包装为完成。
- 不触碰 `legacy-miaoda/**`、`apps/terminal-agent/**`、支付/退款/权益或生产配置。
- 不修改根工作区及其他 worktree 的未提交内容。

## TDD 顺序

1. 新建 Kiosk Wave 0 守卫并确认因现有重复/占位/邮箱/设置口径失败。
2. 按 Profile → 登录 → 设置顺序最小实现，逐段转绿。
3. 新建 API 隐私工单真实状态守卫，确认 export/delete completed 与 delete rejected 当前失败。
4. 在服务层 fail closed，更新旧 Job AI 隐私守卫，保持 revoke_consent 完成语义。

## 验证

- Kiosk：Wave 0、QR、Profile 三类守卫、session closure、typecheck、build。
- API：数据请求真实态、Job AI 隐私、typecheck、build。
- 数据库：fresh SQLite migration、打印订单/权益核销 verify、PostgreSQL schema sync 与 CI readiness。
- 质量：`git diff --check`、双模型复审、敏感信息扫描、变更范围检查。

## 完成边界

本波只代表真实表达、静态/集成守卫与双数据库验证基线完成；不代表 Wave 1 数据导出/注销、预生产、真实短信、Windows 或真机验收完成。
