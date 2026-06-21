# Gate 2 候选一致性防回退审查记录

## 范围

- 分支：`codex/file-assets-gate2-candidate-guard`
- 基线：`012f7c98`
- 目标候选：`9a702981`
- 历史候选：`9146fa1c`
- 范围：本地静态门禁和文档收口；未连接预生产、未上传候选包、未迁移数据库、未重启 PM2、未触碰 COS/账号/浏览器验收。

## TDD 与本地验证

- RED：先增加 Gate 2 候选一致性断言，`pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance` 按预期失败，错误为 `superseded preprod execution plan must clearly point operators to the 9a702981 Gate 2 refresh plan`。
- GREEN：补齐 superseded 提示、候选一致性断言和历史命令“已废弃，勿执行”提示后，同一命令通过。
- `git diff --check`：通过。
- 精确密钥与招聘红线扫描：通过；未发现真实 secret、连接串、token 或合规红线文案。

## 双模型分析

- Claude 分析结论：建议增加候选一致性防回退门禁；纯操作文档不得再出现旧候选操作标记；历史材料可保留 `9146fa1c` 作为事实对照；旧 preprod execution plan 是潜在误复制风险，需要 superseded 标记。
- Antigravity 分析结论：同意检查操作型 plan、审批包、执行记录、Gate 3/Gate 4 runbook、构建检查和进度入口；需要区分历史引用与 active deployment marker。

## 双模型审查

### 第一轮审查

- Antigravity：无 Critical、无 Warning，APPROVE；Info 提醒 refresh plan 对旧 hash 完全禁止较严格，后续如需解释旧候选可能需要调整策略。
- Claude：无 Critical；提出两条 Warning：
  - `docs/acceptance/user-file-assets-gate2-local-artifact-check.md` 顶部仍有可复制的旧 `9146fa1c` 归档命令，建议加近旁“历史/勿执行”提示。
  - `docs/superpowers/plans/2026-06-22-file-assets-preprod-execution.md` 旧 Gate 2 命令块仅靠顶部 banner 防护，建议在命令块附近加“已废弃，勿执行”提示。

### 修复

- `docs/acceptance/user-file-assets-gate2-local-artifact-check.md`：顶部和两个旧归档命令块前均补充历史记录、已废弃、勿执行提示，并说明后续 Gate 2 以 `9a702981` refresh plan 为准。
- `docs/superpowers/plans/2026-06-22-file-assets-preprod-execution.md`：旧 Gate 2 命令块前补充已废弃、勿执行提示。
- `services/api/scripts/verify-file-assets-trial-acceptance.ts`：强制断言上述提示存在，防止后续删除。

### 第二轮复审

- Claude：无 Critical、无新增 Warning；确认旧命令主体和哈希证据保留，仅增加废弃提示；无远端副作用、无合规/秘密风险。
- Antigravity：无 Critical、无 Warning，APPROVE；确认静态验证脚本与文档提示对齐。

## 结论

本分支可合入。它只增强本地静态门禁和文档防误执行提示，不代表 Gate 2、Gate 3/Gate 4、生产、试运营或 Windows 真机验收完成。下一步仍需用户显式确认后，才能执行预生产 Gate 2 远端刷新。
