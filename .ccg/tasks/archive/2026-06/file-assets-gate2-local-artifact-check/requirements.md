# 用户文件与简历资产 Gate 2 本地候选包预检（任务需求）

## 背景

持续目标下一步是预生产 Gate 2 候选刷新。远端执行仍需用户确认，但本地可以先验证候选 `9146fa1c` 是否能生成可上传归档包，并检查归档范围是否包含不必要的文档、历史记录或工具状态。

## 本分支目标

- 在本地 `/tmp` 生成候选归档包，不连接预生产服务器。
- 验证 gzip checksum 可复现。
- 检查完整 `git archive` 是否包含不必要的 `docs/`、`.ccg/` 等内容。
- 将 Gate 2 计划修正为裁剪运行时归档，只包含构建所需的 tracked 路径。
- 记录本地候选包预检结果，更新进度入口。

## 非目标

- 不上传归档包。
- 不连接预生产服务器。
- 不执行 PostgreSQL migration。
- 不重启 PM2。
- 不写 DB、COS、Redis、账号或第三方资源。
- 不宣称 Gate 2、Gate 3/Gate 4、正式生产、试运营或 Windows 真机验收完成。

## 允许修改文件

- `docs/superpowers/plans/2026-06-22-file-assets-preprod-gate2-refresh.md`
- `docs/acceptance/user-file-assets-gate2-approval-package.md`
- `docs/acceptance/user-file-assets-gate2-local-artifact-check.md`
- `docs/acceptance/user-file-assets-preprod-execution-record.md`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- `.ccg/tasks/file-assets-gate2-local-artifact-check/*`

## 本地允许写入

- `/tmp/yitiji-preprod-9146fa1c.tar.gz`
- `/tmp/yitiji-preprod-9146fa1c.sha256`
- `/tmp/yitiji-preprod-9146fa1c.contents`
- `/tmp/yitiji-preprod-9146fa1c-runtime.tar.gz`
- `/tmp/yitiji-preprod-9146fa1c-runtime.sha256`
- `/tmp/yitiji-preprod-9146fa1c-runtime.contents`

这些文件不得进入 Git。

## 验证方式

- 本地归档生成和 checksum 复现。
- 归档内容清单检查。
- 候选 commit 文本敏感信息扫描。
- `pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance`
- `git diff --check`
- Claude + Antigravity 双模型审查；如 Antigravity 无有效输出，必须如实记录。

## 回滚方式

本分支仅文档变更和 `/tmp` 本地临时产物。回滚时删除新增本地预检文档，恢复 Gate 2 计划与进度入口，并删除 `/tmp/yitiji-preprod-9146fa1c*` 临时文件即可。
