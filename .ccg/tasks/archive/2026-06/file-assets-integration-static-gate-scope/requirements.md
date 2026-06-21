# 用户文件资产集成计划静态门禁执行范围收口（任务需求）

## 背景

`docs/superpowers/plans/2026-06-22-file-assets-preprod-integration.md` 是用户文件资产栈与预生产验收候选的历史集成计划。该计划的本地验证步骤把 `verify:file-assets-trial-acceptance` 与 `verify:production-runtime-gates`、COS 生命周期、文件保存期限等 runtime/API gates 并列，虽然该文档本身不是 Gate 3 远端执行清单，但后续读者可能误解为该 docs-only 静态门禁也应该在预生产裁剪运行时包中执行。

上一分支已明确：`verify:file-assets-trial-acceptance` 依赖完整仓库 `docs/`，只能作为 Gate 0 本地/仓库侧静态文档门禁；Gate 3 远端裁剪运行时包不得执行该命令，也不得为了执行它把 `docs/` 或 `.ccg/` 加回运行时归档。

## 目标

- 在历史集成计划中明确 `verify:file-assets-trial-acceptance` 属于本地完整仓库的静态文档门禁，而不是 runtime/API gate 或 Gate 3 远端命令。
- 在 `verify:file-assets-trial-acceptance` 中增加对该历史集成计划口径的防回退检查。
- 同步进度入口，记录这是本地文档口径收口，不代表预生产、生产、试运营或 Windows 真机验收完成。

## 非目标

- 不执行预生产或生产远端操作。
- 不上传候选包、不迁移数据库、不重启 PM2、不写 COS/账号/浏览器验收数据。
- 不修改 Gate 2 裁剪归档策略。
- 不改运行时代码、API 契约、数据库 schema、前端页面或 UI。
- 不把历史计划整体重写为新执行方案。

## 允许修改文件

- `services/api/scripts/verify-file-assets-trial-acceptance.ts`
- `docs/superpowers/plans/2026-06-22-file-assets-preprod-integration.md`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- `.ccg/tasks/file-assets-integration-static-gate-scope/*`

## 验证方式

- TDD RED：先给 `verify:file-assets-trial-acceptance` 增加历史集成计划口径断言，预期当前文档不满足而失败。
- GREEN：修正文档后同一验证通过。
- `git diff --check`
- 精确密钥和招聘红线扫描。
- Claude + Antigravity 双模型审查。
