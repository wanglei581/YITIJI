# 用户中心 Wave 0 复审记录

## 结论

本地候选满足 Wave 0 计划；未 push、未创建 PR、未运行 GitHub CI、未部署。真实数据导出、账号注销执行器、Admin 隐私工单运营页和手机号换绑均未越界实现。

## TDD 与实现

- 页面真值守卫先失败，再删除重复/占位 Profile 入口和邮箱登录。
- 数据请求集成守卫先证明 `export→completed`、`delete→completed`、`delete→rejected` 会产生虚假终态，再将三者 fail closed。
- 最终守卫会先建立真实 `job_ai` consent，证明 `revoke_consent` 工单创建写入 `revokedAt`，再证明完成状态引用真实审计。
- Profile 固定 22 个已接真目的地；“我的权益”不再暗示未开放套餐。

## 验证证据

- Kiosk：`verify:user-center-wave0`、`verify:qr-login-ui`、`verify:profile-inkpaper-home`、`verify:lightflow-profile-entry`、`verify:lightflow-4188-layout-parity`、`verify:profile-commercial-first-batch`、`verify:member-session-closure` 全部通过。
- API：`verify:member-data-request-truth`、`verify:job-ai-privacy`、`db:pg:sync:check` 全部通过。
- 类型与 lint：Kiosk/API/Admin typecheck 通过；三端 lint 0 error，Kiosk 仅 2 条既有 Fast Refresh warning。
- 构建：API、Kiosk production + `verify:prod-build-config`、Admin production build 全部通过；仅有既有 Vite chunk-size warning。
- SQLite：一次性空库应用 57 个正式 migration；数据请求真值、打印订单、权益核销通过；临时文件已删除。
- PostgreSQL 16.14：最终一次性空库 `ai_job_print_wave0_final_20260716_1842` 应用 29 个正式 migration；数据请求真值、打印订单、权益核销通过；数据库已 drop 并复核不存在。
- 浏览器：540×960 验收 Profile/Login/Settings；1080×1920 验收 Profile；无横向溢出，目标页面控制台 0 error / 0 warning。

## 双模型审查

- 独立规格复审和代码质量/安全复审最终均为 `APPROVE（Critical 0 / Warning 0）`；安全复审指出的 consent 真实副作用测试缺口已补齐并在 SQLite/PostgreSQL 转绿。
- Claude 对完整最终 diff 给出 `APPROVE（Critical 0 / Warning 0）`；仅提示放行状态仍接受调用方 `auditRef` 属主线既有且已披露的 Wave 1 边界。
- Antigravity 默认模型调用未产生有效报告，不计入通过；显式指定 `Gemini 3.5 Flash (High)` 后对完整最终 diff 给出 `APPROVE（100/100，Critical 0 / Warning 0）`。

## 已知边界

- `delete` 工单在 Wave 1 前只能停留于 `pending/handling`，无完成、驳回、取消或 SLA，且当前无 Admin 前端处置页。
- 会员级批量 AI 数据删除暂停；本人逐条 AI 记录删除和 `expiresAt` 小时级清理仍保留。
- 既有 Admin API 对部分放行状态仍接受调用方 `auditRef`，Wave 1 必须改为服务端生成。
