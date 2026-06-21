# 用户文件与简历资产 Gate 3 文档静态门禁执行范围修正（审查记录）

## 变更摘要

- 将 `verify:file-assets-trial-acceptance` 明确为 Gate 0 本地/仓库侧静态文档门禁。
- 从 Gate 3 远端裁剪运行时包命令清单中移除 `verify:file-assets-trial-acceptance`。
- 保留 G3-09 `verify:audit-logs`，并将 G3-08 标记为不适用、已移至 G0-01。
- 在 `verify:file-assets-trial-acceptance` 脚本中新增断言，防止该 docs-only 门禁回流到 Gate 3 远端命令清单。
- 同步执行记录、商业闭环审查、进度和下一步任务说明；本分支未连接预生产、未上传候选包、未迁移 DB、未重启 PM2。

## TDD 记录

1. RED：先从 `expectedGate3Commands` 中移除 `verify:file-assets-trial-acceptance` 并增加禁止回流断言，运行 `pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance`，因 runbook 仍含远端命令而失败。
2. GREEN：修正 Gate 3/Gate 4 runbook、执行记录和进度入口后，`verify:file-assets-trial-acceptance` 通过。
3. 复审 Warning 修复 RED：新增对 `docs/acceptance/user-file-assets-commercial-closure-audit.md` 的断言，运行同一命令因商业闭环审查仍未声明 Gate 0 本地静态门禁而失败。
4. GREEN：修正商业闭环审查中的 Gate 3 说明，并将招聘合规描述收紧为“不承接招聘闭环动作”，同一命令通过。

## 验证

- `pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance`：PASS
- `git diff --check`：PASS
- 变更文件与任务文件密钥/招聘红线扫描：PASS，无命中

## 双模型分析结论

- Antigravity：建议保持 Gate 2 裁剪运行时包排除 `docs/` 和 `.ccg/`，将 `verify:file-assets-trial-acceptance` 限定为 Gate 0 本地静态门禁，避免为远端执行把文档目录加回运行时归档。
- Claude：同意上述方向，并建议保留 G3-09 AuditLog 槽位，将 G3-08 标记为已移至 G0，避免 Gate 3 编号和证据链误读。

## 双模型审查结论

### 第一轮

- Antigravity：APPROVE，无 Critical/Warning。
- Claude：无 Critical；Warning 指出 `docs/acceptance/user-file-assets-commercial-closure-audit.md` 仍把 `verify:file-assets-trial-acceptance` 写成 Gate 3 远端重点命令。

### 第二轮

- Antigravity：APPROVE，无 Critical/Warning。
- Claude：APPROVE，无 Critical/Warning。Info：历史计划 `docs/superpowers/plans/2026-06-22-file-assets-preprod-integration.md` 中还有本地合并验证语境下的同名命令，可后续顺手统一口径；不属于本分支范围，不阻塞。

## 结论

本分支已关闭 Gate 0 本地静态文档门禁与 Gate 3 远端裁剪运行时命令清单之间的矛盾。当前仍未执行 Gate 2 远端候选刷新、Gate 3/Gate 4 真实证据、生产验收、Windows 真机验收或试运营。
