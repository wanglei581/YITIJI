# 用户文件与简历资产 Gate 2 审批确认口径防回退（任务需求）

## 背景

用户文件与简历资产 Gate 2 远端刷新尚未执行。现有审批包已经列出目标、非目标、允许修改远端内容、禁止事项、验证方式、停止条件、回滚方式和用户确认口径，但当前 `verify:file-assets-trial-acceptance` 主要检查候选 commit、路径和旧候选 marker，尚未强制保护审批包的“确认口径”和关键许可边界。

如果后续文档改动削弱审批包，可能导致远端执行前缺少明确授权语句，或者把 Gate 3/Gate 4、业务数据、COS/账号/Windows 等范围误混入 Gate 2。

## 本分支目标

- 在 `verify:file-assets-trial-acceptance` 中增加 Gate 2 审批确认口径防回退检查。
- 强制审批包包含用户确认文本块，并覆盖“同意”和“不同意”两类边界。
- 强制审批包保留 Gate 2 与 Gate 3/Gate 4 的分离口径：Gate 2 通过后仍需另行确认 Gate 3/Gate 4。
- 强制审批包明确 `Gate 2 通过不等于试运营或商用闭环完成`。
- 同步记录到进度入口。

## 非目标

- 不连接预生产或生产服务器。
- 不上传候选包到 `/srv`。
- 不执行 PostgreSQL migration、DB 备份、PM2 restart、COS live、账号验收或浏览器验收。
- 不修改业务运行时代码、数据库 schema、前端页面或 API 契约。
- 不宣布 Gate 2、Gate 3/Gate 4、生产、试运营或 Windows 真机验收完成。

## 允许修改文件

- `services/api/scripts/verify-file-assets-trial-acceptance.ts`
- `docs/acceptance/user-file-assets-gate2-approval-package.md`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- `.ccg/tasks/file-assets-gate2-approval-guard/*`

## 验证方式

- TDD RED：先新增 Gate 2 审批确认口径断言，运行 `pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance`，预期因审批包缺少新增 guard 标记或进度入口记录失败。
- GREEN：补齐审批包和进度入口后运行同一命令通过。
- `git diff --check`
- 精确密钥和招聘红线扫描。
- Claude + Antigravity 双模型分析和双模型审查；如 Antigravity 无有效输出，必须如实记录。
