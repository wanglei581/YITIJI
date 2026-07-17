# Wave 1-B Slice 2 方案任务边界

## 真实目标

Slice 1 已合入主线且双 CI 成功，但导出账本会保持 `pending`。本任务只把后续 Slice 2 拆成可实现的恢复型方案，并把主线事实写回正式进度；不写任何运行时代码。

## 允许修改

- `docs/superpowers/plans/2026-07-17-user-center-wave1b-reversible-data-rights.md`
- `docs/superpowers/plans/2026-07-17-user-center-wave1b-slice2-export-artifact.md`（新建）
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- `.ccg/tasks/user-center-wave1b-slice2-plan-20260717/**`

## 禁止修改

- 所有 `apps/`、`services/`、`packages/` 的运行时代码、Prisma schema/migration、CI、生产配置和密钥。
- 不创建 UI、下载路由、导出 worker、队列、artifact、注销或账户状态转换。

## 验收

- 主线 PR #275 的两项 CI 成功事实准确写入。
- 方案覆盖 queue/worker crash、必需审计、白名单、FileObject owner/TTL、对象补偿和双数据库索引。
- 方案明确 Slice 2 不含下载、到期清理、取消、Admin retry 和账户注销。
- 双模型架构分析均已尝试；无有效模型报告时如实记录。
