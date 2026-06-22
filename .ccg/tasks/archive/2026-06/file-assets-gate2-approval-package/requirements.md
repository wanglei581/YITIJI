# 用户文件与简历资产预生产 Gate 2 执行审批包（任务需求）

## 用户请求

持续推进“用户文件与简历资产商用闭环”，下一步应进入预生产 Gate 2，但生产相关操作必须先列明目标、非目标、允许修改文件/远端内容、验证方式和回滚方式，得到用户确认后才能执行。

## 本分支目标

- 新增 Gate 2 执行审批包，作为用户确认前的短入口。
- 从既有 Gate 2 刷新方案中提炼可审批事项：目标、非目标、远端允许修改范围、禁止事项、验证证据、停止条件、回滚方式。
- 明确 Gate 2 仍不执行 COS live、账号验收、业务数据写入或 Windows 真机验收。
- 更新预生产执行记录和进度入口，让下一步可以直接按审批包确认。

## 非目标

- 不连接预生产服务器。
- 不上传归档包、不展开候选目录、不执行 PostgreSQL migration、不重启 PM2。
- 不写 DB/COS/Redis/账号数据。
- 不修改运行时代码、schema、脚本或第三方配置。
- 不宣称预生产 Gate 2、Gate 3/Gate 4、正式生产、试运营或 Windows 真机验收已经完成。

## 允许修改文件

- `docs/acceptance/user-file-assets-gate2-approval-package.md`
- `docs/acceptance/user-file-assets-preprod-execution-record.md`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- `.ccg/tasks/file-assets-gate2-approval-package/*`

## 验证方式

- `pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance`
- `git diff --check`
- 敏感信息和招聘红线扫描。
- Claude + Antigravity 双模型审查；如 Antigravity 无有效输出，必须如实记录。

## 回滚方式

本分支仅文档变更。回滚时删除新增审批包，撤回预生产执行记录和进度入口引用，删除或撤回本任务归档即可。
