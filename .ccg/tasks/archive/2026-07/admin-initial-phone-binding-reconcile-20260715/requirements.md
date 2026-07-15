# 管理员首次手机号绑定对账加固

## 背景

`main` 在本轮并行工作中已合入通用内部账号首次绑定（Admin 与 Partner）。独立候选分支随后验证出更严格的 Admin 恢复安全不变量。两者路径重叠，不能直接 rebase 或同时保留两个可绕过的 Admin 入口。

## 目标

- 保留 `main` 已合入的 Partner 首次绑定闭环和现有组件，不删除或降级它。
- 对 Admin 使用严格的独立绑定状态机：仅 admin、enabled、三个手机号字段全为空；当前密码失败限流；300 秒加密 ticket；一次活动 ticket；一次验证；tokenVersion 与三个手机号字段 CAS；统一不可用错误；审计只写脱敏电话。
- 旧通用 `/auth/phone/initial-bind/*` 对 Admin 必须委派到同一严格状态机，不能成为绕过路径；Partner 保持 `main` 的通用服务。
- Admin 账号设置页只显示 Admin 专用卡片；当前 Admin 应用不存在可达的 Partner 会话，Partner 仅保留已合入的后端通用能力，不在本任务新增 Partner 页面或 UI 入口。

## 允许层与文件预算

- 后端：`services/api/src/auth/` 的 controller/module/OTP 常量、新 Admin service、DTO（仅确有差异时）；`services/api/src/audit/audit.types.ts`；`services/api/scripts/verify-internal-auth-phone.ts`。
- Admin：`apps/admin/src/services/auth/index.ts`、`apps/admin/src/routes/account-settings/index.tsx`、新增 Admin 专用卡片、静态 verifier；现有 `PhoneBindingCard.tsx` 不作为 Admin 入口且不修改，除非安全验证证明无法避免。
- 共享：`packages/shared/src/types/audit.ts`。
- 文档：只更新 `docs/progress/current-progress.md`、`docs/progress/next-tasks.md`，记录 main 对账和本地证明。

## 明确不做

- 不改 Prisma schema/migration、生产/共享数据库、Redis、环境变量、密钥、支付、价格、终端、打印、Partner 业务逻辑。
- 不发真实短信、不部署、不推送、不建 PR。
- 不删除 main 已合入的 Partner 首次绑定代码或入口；不创建第二套 Admin UI 入口。

## 验收

- 隔离 API verifier：Admin 严格状态、密码限流、统一错误、ticket/replay/TTL/并发/CAS/tokenVersion、Admin 通用旧路径不能绕过；Partner 主线仍可用。
- Admin 静态 verifier：Admin 仅渲染专用卡片且不导入通用卡片、专用 endpoint、无本地敏感持久化/日志/ticket DOM、未知 start 状态保守锁定、无重复发送。
- API/Admin typecheck、lint、Admin build、`git diff --check`。
- 交付清晰区分本地隔离证明与未执行的真实短信、浏览器、CI、部署、生产验收。
