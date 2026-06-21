# 用户文件与简历资产 Gate 3 AuditLog 证据链补齐（任务需求）

## 背景

用户文件与简历资产商用闭环要求保存期限变更、删除、过期清理都能被审计。现有商业闭环审计文档已写明 Gate 3 应覆盖 activity/audit logs，但 Gate 3/Gate 4 证据模板和执行记录只列 G3-01 至 G3-08，没有纳入现有 `verify:audit-logs` 命令，证据链口径不一致。

## 本分支目标

- 将 `verify:audit-logs` 纳入 Gate 3 自动命令证据。
- 同步更新 Gate 3/Gate 4 模板、预生产执行记录、试运营验收证据包和进度入口。
- 更新 `verify:file-assets-trial-acceptance` 静态检查，防止后续文档漏掉 AuditLog 命令证据和文件生命周期审计写入点。

## 非目标

- 不连接预生产或生产服务器。
- 不执行 Gate 2、Gate 3 或 Gate 4。
- 不写 DB、COS、Redis、账号或第三方资源。
- 不修改运行时业务逻辑。
- 不宣称试运营、生产验收或 Windows 真机验收完成。

## 允许修改文件

- `docs/acceptance/user-file-assets-gate3-gate4-evidence-runbook.md`
- `docs/acceptance/user-file-assets-preprod-execution-record.md`
- `docs/acceptance/user-file-assets-trial-acceptance.md`
- `docs/acceptance/user-file-assets-commercial-closure-audit.md`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- `services/api/scripts/verify-file-assets-trial-acceptance.ts`
- `.ccg/tasks/file-assets-gate3-activity-log-evidence/*`

## 验证方式

- `pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance`
- `git diff --check`
- 敏感信息和招聘红线扫描。
- Claude + Antigravity 双模型审查。
