# 用户文件与简历资产 Gate 3 文档静态门禁执行范围修正（任务需求）

## 背景

Gate 2 裁剪运行时归档已明确排除 `docs/`、`.ccg/` 等非运行时资料，避免把历史预生产资料、示例配置和任务记录上传到预生产服务器。

但 Gate 3/Gate 4 证据 runbook 和执行记录中，远端 Gate 3 自动命令清单仍包含 `pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance`。该脚本读取 `docs/acceptance`、`docs/progress`、`docs/device` 等仓库文档；若在裁剪包远端环境运行，文档不存在，会导致 Gate 3 执行失败或诱导把 docs 重新打进运行时归档。

## 本分支目标

- 将 `verify:file-assets-trial-acceptance` 明确定位为本地/仓库静态门禁，而不是预生产裁剪包内 Gate 3 远端命令。
- 从 Gate 3 远端自动命令清单中移除 `verify:file-assets-trial-acceptance`。
- 在 `verify:file-assets-trial-acceptance` 中更新 Gate 3 命令顺序断言，防止后续把文档静态门禁误加回远端 Gate 3。
- 在执行记录和进度入口同步说明：本地文档门禁仍必须在仓库侧运行通过，但不要求预生产裁剪包内运行。

## 非目标

- 不修改 Gate 2 裁剪归档策略，不把 `docs/` 或 `.ccg/` 加回运行时包。
- 不连接预生产或生产服务器。
- 不上传候选包、不迁移 DB、不重启 PM2、不写 COS/账号/浏览器验收数据。
- 不修改业务运行时代码、数据库 schema、前端页面或 API 契约。
- 不宣布 Gate 2、Gate 3/Gate 4、生产、试运营或 Windows 真机验收完成。

## 允许修改文件

- `services/api/scripts/verify-file-assets-trial-acceptance.ts`
- `docs/acceptance/user-file-assets-commercial-closure-audit.md`
- `docs/acceptance/user-file-assets-gate3-gate4-evidence-runbook.md`
- `docs/acceptance/user-file-assets-preprod-execution-record.md`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- `.ccg/tasks/file-assets-gate3-doc-verify-scope/*`

## 验证方式

- TDD RED：先更新 `verify:file-assets-trial-acceptance` 对 Gate 3 命令清单的期望，运行同一命令，预期因 runbook 仍包含远端 `verify:file-assets-trial-acceptance` 而失败。
- GREEN：修正 runbook、执行记录和进度入口后运行同一命令通过。
- `git diff --check`
- 精确密钥和招聘红线扫描。
- Claude + Antigravity 双模型分析和双模型审查；如 Antigravity 无有效输出，必须如实记录。
