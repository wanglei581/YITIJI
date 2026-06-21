# 用户文件资产 Gate 2 目标候选刷新到最新本地门禁提交（任务需求）

## 背景

后续预生产 Gate 2 刷新文档仍以 `9a702981` 为目标候选，但当前分支在该候选之后又追加了两项本地防误执行收口：

- `b4aecf14`：明确 `verify:file-assets-trial-acceptance` 仅为 Gate 0 本地静态文档门禁，不在 Gate 3 远端裁剪运行时包执行。
- `2187f6a7`：历史集成计划也已将该 docs-only 命令从 API runtime gates 中拆出。

如果后续仍按 `9a702981` 执行 Gate 2，预生产候选会缺少这些门禁口径修正。

## 目标

- 将 Gate 2 建议目标候选刷新为当前 HEAD `2187f6a7`。
- 更新 `verify:file-assets-trial-acceptance` 的 Gate 2 候选防回退断言。
- 更新 Gate 2 refresh plan、审批包、执行记录、Gate 3/Gate 4 runbook、构建预检和进度入口中的操作型候选引用。
- 重新生成本地裁剪运行时归档并在 `/tmp` 解压目录完成 install、Prisma client、API/Kiosk/Admin build 预检。

## 非目标

- 不连接预生产或生产服务器。
- 不上传候选包、不迁移数据库、不重启 PM2、不写 COS/账号/浏览器验收数据。
- 不修改运行时代码、API 契约、数据库 schema、前端页面或 UI。
- 不宣布 Gate 2、Gate 3/Gate 4、生产、试运营或 Windows 真机验收完成。

## 允许修改文件

- `services/api/scripts/verify-file-assets-trial-acceptance.ts`
- `docs/superpowers/plans/2026-06-22-file-assets-preprod-gate2-refresh.md`
- `docs/superpowers/plans/2026-06-22-file-assets-preprod-execution.md`
- `docs/acceptance/user-file-assets-gate2-approval-package.md`
- `docs/acceptance/user-file-assets-gate2-runtime-build-check.md`
- `docs/acceptance/user-file-assets-gate2-local-artifact-check.md`
- `docs/acceptance/user-file-assets-gate3-gate4-evidence-runbook.md`
- `docs/acceptance/user-file-assets-preprod-execution-record.md`
- `docs/acceptance/user-file-assets-commercial-closure-audit.md`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- `.ccg/tasks/file-assets-gate2-latest-candidate-guard/*`

## 验证方式

- TDD RED：先把 `verify:file-assets-trial-acceptance` 的当前 Gate 2 候选改为 `2187f6a7`，预期因文档仍指向 `9a702981` 而失败。
- GREEN：更新候选文档和本地构建预检证据后，同一命令通过。
- 本地裁剪包构建预检：`pnpm install --frozen-lockfile`、Prisma client 生成、API build、Kiosk production build、Admin production build。
- `git diff --check`。
- 精确密钥和招聘红线扫描。
- Claude + Antigravity 双模型审查。
