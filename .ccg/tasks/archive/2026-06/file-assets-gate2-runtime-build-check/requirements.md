# 用户文件与简历资产 Gate 2 裁剪包本地构建预检（任务需求）

## 背景

上一轮已确认 Gate 2 应使用裁剪运行时归档，而不是完整仓库归档。本轮继续验证：裁剪包在干净 `/tmp` 解压目录中是否能完成 `pnpm install --frozen-lockfile`、Prisma client 生成、API build、Kiosk production build 和 Admin build。

## 本分支目标

- 从裁剪候选包解压到 `/tmp/yitiji-gate2-runtime-build-check/ai-job-print`。
- 在解压目录运行 install/build，验证裁剪范围不缺构建输入。
- 捕获并修正 Gate 2 计划中的生产构建变量缺口。
- 更新 Gate 2 计划、审批包、执行记录和进度入口。

## 非目标

- 不连接预生产服务器。
- 不上传候选包。
- 不执行 PostgreSQL migration。
- 不重启 PM2。
- 不写 DB、COS、Redis、账号或第三方资源。
- 不修改运行时代码。
- 不宣称 Gate 2、Gate 3/Gate 4、正式生产、试运营或 Windows 真机验收完成。

## 允许修改文件

- `docs/acceptance/user-file-assets-gate2-runtime-build-check.md`
- `docs/superpowers/plans/2026-06-22-file-assets-preprod-gate2-refresh.md`
- `docs/acceptance/user-file-assets-gate2-approval-package.md`
- `docs/acceptance/user-file-assets-preprod-execution-record.md`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- `.ccg/tasks/file-assets-gate2-runtime-build-check/*`

## 本地允许写入

- `/tmp/yitiji-gate2-runtime-build-check/`
- `/tmp/yitiji-preprod-9146fa1c.tar.gz`
- `/tmp/yitiji-preprod-9146fa1c.sha256`

这些文件不得进入 Git。

## 验证方式

- `pnpm install --frozen-lockfile` 在 `/tmp` 解压目录通过。
- Prisma SQLite/PostgreSQL client 生成通过。
- API build 通过。
- Kiosk production build 使用 `VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 VITE_USE_TRTC_CALL=true` 通过。
- Admin production build 使用 `VITE_API_MODE=http VITE_API_BASE_URL=/api/v1` 通过。
- `pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance`
- `git diff --check`
- 敏感信息和招聘红线扫描。
- Claude + Antigravity 双模型审查；如 Antigravity 无有效输出，必须如实记录。

## 回滚方式

本分支仅文档变更和 `/tmp` 本地临时构建目录。回滚时删除新增构建预检文档，恢复 Gate 2 计划与进度入口，并删除 `/tmp/yitiji-gate2-runtime-build-check` 临时目录即可。
