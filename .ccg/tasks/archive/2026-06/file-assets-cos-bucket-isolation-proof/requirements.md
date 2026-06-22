# 用户文件资产 COS bucket 隔离阻塞确认

## 用户指令

用户要求继续下一步。本任务承接 Gate 3 部分通过后的阻塞：G3-06 `verify:cos:live` 和 Gate 4 会写入 COS 对象，必须先确认 COS bucket 为预生产/非生产用途。

## 目标

- 只读复核预生产环境当前 `TENCENT_COS_BUCKET` 的脱敏指纹和环境标签。
- 对比仓库历史记录中的同指纹语义，确认是否可作为预生产 bucket 使用。
- 更新验收记录、runbook 和进度入口，明确后续必须切换独立预生产 bucket 或提供等效隔离证明。

## 非目标

- 不运行 `verify:cos:live`。
- 不上传、下载、删除任何 COS 对象。
- 不修改 `.env`、服务器进程、PM2、nginx、数据库、Redis 或腾讯云配置。
- 不执行 Gate 4 浏览器账号验收。

## 允许修改文件

- `docs/acceptance/user-file-assets-preprod-execution-record.md`
- `docs/acceptance/user-file-assets-gate3-gate4-evidence-runbook.md`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- `services/api/scripts/verify-file-assets-trial-acceptance.ts`
- `.ccg/tasks/archive/2026-06/file-assets-cos-bucket-isolation-proof/*`

## 验证

- `pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance`
- `pnpm --filter @ai-job-print/api typecheck`
- `git diff --check`
- 严格敏感信息扫描
- Claude + Antigravity 双模型审查

## 回滚

本任务只做文档和静态门禁更新；如需回滚，撤销本分支提交即可。
