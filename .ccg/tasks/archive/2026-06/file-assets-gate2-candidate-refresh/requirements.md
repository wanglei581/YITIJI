# 用户文件与简历资产 Gate 2 候选刷新本地预检（任务需求）

## 背景

Gate 2 审批包、执行记录和本地构建预检最初以 `9146fa1c` 作为预生产目标候选。随后同一候选链继续补齐了 Gate 2 裁剪包本地构建预检、Gate 3/Gate 4 证据模板、AuditLog 证据链和 Gate 3 命令清单防回退，当前 HEAD 为 `9a702981`。

如果后续仍按 `9146fa1c` 执行远端 Gate 2，预生产会缺少后续已完成的验收门禁和证据修正。因此需要在不触碰服务器的前提下，刷新本地 Gate 2 候选口径，并重新证明当前 HEAD 的裁剪运行时包可安装和构建。

## 本分支目标

- 明确当前建议 Gate 2 目标候选为 `9a702981`，即包含 `9146fa1c` 之后的本地验收门禁补丁。
- 重新生成当前 HEAD 的裁剪运行时归档并在 `/tmp` 解压目录完成 install、Prisma client 生成、API build、Kiosk build、Admin build。
- 更新 Gate 2 审批包、执行记录和本地构建预检文档，使后续远端执行不会误用旧候选。
- 同步更新进度入口，明确这仍只是本地预检，不代表远端 Gate 2 已执行。

## 非目标

- 不连接预生产或生产服务器。
- 不上传候选包到 `/srv`。
- 不复制或读取远端 `.env` 内容。
- 不执行 PostgreSQL migration、DB 备份、PM2 restart、COS live、账号验收或浏览器验收。
- 不修改运行时代码或新增业务功能。
- 不宣布 Gate 2、Gate 3/Gate 4、试运营、商用闭环或 Windows 真机验收完成。

## 允许修改文件

- `docs/acceptance/user-file-assets-gate2-approval-package.md`
- `docs/acceptance/user-file-assets-gate2-local-artifact-check.md`
- `docs/acceptance/user-file-assets-gate2-runtime-build-check.md`
- `docs/acceptance/user-file-assets-preprod-execution-record.md`
- `docs/acceptance/user-file-assets-gate3-gate4-evidence-runbook.md`
- `docs/superpowers/plans/2026-06-22-file-assets-preprod-gate2-refresh.md`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- `.ccg/tasks/file-assets-gate2-candidate-refresh/*`

本地临时产物仅允许写入 `/tmp/yitiji-preprod-9a702981.tar.gz`、`/tmp/yitiji-preprod-9a702981.sha256` 和 `/tmp/yitiji-gate2-runtime-build-check-9a702981/`，不得进入 Git。

## 验证方式

- 双模型分析：Claude + Antigravity。
- 本地裁剪包构建预检：
  - `pnpm install --frozen-lockfile`
  - `pnpm --filter @ai-job-print/api exec prisma generate`
  - `pnpm --filter @ai-job-print/api db:pg:generate`
  - `pnpm --filter @ai-job-print/api build`
  - `VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 VITE_USE_TRTC_CALL=true pnpm --filter @ai-job-print/kiosk build`
  - `VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 pnpm --filter @ai-job-print/admin build`
- `pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance`
- `git diff --check`
- 敏感信息和招聘红线扫描。
- Claude + Antigravity 双模型审查；如 Antigravity 无有效输出，必须如实记录。
