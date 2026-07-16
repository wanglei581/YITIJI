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

- Claude 首轮为 `REJECT`，Critical 0，指出两项披露 Warning：注销工单在 Wave 1 前无终态；旧会员级批量 AI 删除被撤下。补齐文档、API 提示与权益文案后，完整复审为 `APPROVE（Critical 0 / Warning 0）`。
- Antigravity 旧 OAuth 会话两次未产生有效报告，不计入通过；重新建立 OAuth 会话后，对完整 diff 给出 `APPROVE（98/100，Critical 0 / Warning 0）`。
- 最终 consent 撤回测试增量：Antigravity `APPROVE（100/100，Critical 0 / Warning 0）`；Claude `APPROVE`，唯一非阻塞假设为未来 consent API 新增其他 actor 审计时需扩展清理。当前服务不写该类审计，PostgreSQL 验收库也已整体删除，故不新增假设性分支。

## 已知边界

- `delete` 工单在 Wave 1 前只能停留于 `pending/handling`，无完成、驳回、取消或 SLA，且当前无 Admin 前端处置页。
- 会员级批量 AI 数据删除暂停；本人逐条 AI 记录删除和 `expiresAt` 小时级清理仍保留。
- 既有 Admin API 对部分放行状态仍接受调用方 `auditRef`，Wave 1 必须改为服务端生成。
- Antigravity 旧 OAuth token 已保留为权限 600 的本机备份；新会话已用只读探针和有效最终审查验证。备份未读取、未提交到仓库。
