# 用户文件与简历资产 Gate 3 命令清单防回退（任务需求）

## 背景

Gate 3/Gate 4 证据执行模板已经定义 G3-01 至 G3-09 自动命令证据，但当前 `verify:file-assets-trial-acceptance` 只检查部分命令关键字存在，不能防止 runbook 中出现拼写错误、漏命令，或引用已经不存在的 API package script。

## 本分支目标

- 让 `verify:file-assets-trial-acceptance` 读取 `services/api/package.json`。
- 从 Gate 3/Gate 4 runbook 中提取 `pnpm --filter @ai-job-print/api verify:*` 命令。
- 断言 runbook 中 G3 命令清单等于预期 9 条命令。
- 断言每条 runbook 命令都存在于 API package scripts。
- 同步记录到进度入口。

## 非目标

- 不执行 Gate 2、Gate 3 或 Gate 4。
- 不连接预生产或生产服务器。
- 不写 DB、COS、Redis、账号或第三方资源。
- 不修改运行时业务逻辑。
- 不宣称生产、试运营或 Windows 真机验收完成。

## 允许修改文件

- `services/api/scripts/verify-file-assets-trial-acceptance.ts`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- `.ccg/tasks/file-assets-gate3-command-guard/*`

## 验证方式

- `pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance`
- `git diff --check`
- 敏感信息和招聘红线扫描。
- Claude + Antigravity 双模型审查；如 Antigravity 无有效输出，必须如实记录。
