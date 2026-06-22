# 用户文件与简历资产 Gate 2 候选一致性防回退（任务需求）

## 背景

后续预生产 Gate 2 建议目标候选已经从 `9146fa1c` 刷新为 `9a702981`，并且操作型 plan、审批包、执行记录和进度入口已同步。但这些目前主要依赖人工维护，后续很容易在文档复制或再改 plan 时重新出现旧候选、旧归档文件名或旧候选目录，导致真正远端 Gate 2 部署执行错包。

## 本分支目标

- 在 `verify:file-assets-trial-acceptance` 中增加 Gate 2 候选一致性静态门禁。
- 断言操作型 Gate 2 plan、审批包、执行记录、Gate 3/Gate 4 runbook 和进度入口一致指向 `9a702981`。
- 断言待执行/操作型文档不再使用旧候选归档文件名、旧候选目录或旧 API hash sidecar 文件。
- 保留 `9146fa1c` 作为历史事实和旧候选对照，但必须出现在被允许的历史上下文中。
- 同步记录到进度入口。

## 非目标

- 不连接预生产或生产服务器。
- 不上传候选包到 `/srv`。
- 不执行 PostgreSQL migration、DB 备份、PM2 restart、COS live、账号验收或浏览器验收。
- 不修改业务运行时代码、数据库 schema、前端页面或 API 契约。
- 不宣布 Gate 2、Gate 3/Gate 4、生产、试运营或 Windows 真机验收完成。

## 允许修改文件

- `services/api/scripts/verify-file-assets-trial-acceptance.ts`
- `docs/acceptance/user-file-assets-gate2-local-artifact-check.md`
- `docs/superpowers/plans/2026-06-22-file-assets-preprod-execution.md`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- `.ccg/tasks/file-assets-gate2-candidate-guard/*`

## 验证方式

- TDD RED：先新增 Gate 2 候选一致性断言，运行 `pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance`，预期因缺少进度入口记录或 guard 标记失败。
- GREEN：补齐必要文档记录后运行同一命令通过。
- `git diff --check`
- 精确密钥和招聘红线扫描。
- Claude + Antigravity 双模型分析和双模型审查；如 Antigravity 无有效输出，必须如实记录。
