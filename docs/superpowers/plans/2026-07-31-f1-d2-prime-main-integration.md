# F1 D2 Prime Latest-Main Integration Plan

> **For Codex:** REQUIRED SUB-SKILL: Use subagent-driven-development to execute this plan task-by-task.

**Goal:** 在 `origin/main@7b33447d38f16c9e251802052d2c95e9fe6df0d9` 上形成只存在于本地的 D2 Prime 运行时加固、集成审查安全修复与治理文档候选。

**Architecture:** 代码与事实叙事分离集成。四个运行时脚本先从精确提交 `166fe9dc3f612d8b6780951261d23540568a456b` 取材，再按集成质量审查补齐 user-systemd 控制面与 transient unit 的环境净化合同；文档不直接 cherry-pick，而以最新主线为权威基线，增量协调早期 Colima NO-GO、历史 `166fe9dc` Lima PASS、当前加固候选待新 fresh retake、宿主退出状态澄清和 D3 只读预授权边界。

**Tech Stack:** Bash、Node.js ESM、pnpm、NestJS/TypeScript、Git worktree。

## 功能归位与文件预算

- 功能闭环：F1 D2′ 非生产同机双端口演练的运行时加固与可审计状态收口。
- 后端脚本：`services/api/scripts/d2-same-host/`，仅四文件。
- 文档：`docs/device/`、`docs/progress/`、`docs/reviews/` 与本计划。
- 不涉及前端、Terminal Agent、共享包、数据库、生产配置、密钥或云资源。
- 复用现有 D2 合同验证器、API build/lint 和磁盘 evidence verifier，不引入依赖。

允许修改：

- `services/api/scripts/d2-same-host/drill.mjs`
- `services/api/scripts/d2-same-host/procfs.mjs`
- `services/api/scripts/d2-same-host/run.sh`
- `services/api/scripts/d2-same-host/verify-contract.mjs`
- `docs/device/f1-d2-same-host-dual-port-runbook.md`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- `docs/reviews/f1-d3-production-readonly-precheck-2026-07-30.md`
- `docs/superpowers/plans/2026-07-31-f1-d2-prime-main-integration.md`
- `.ccg/tasks/f1-d2-prime-main-integration-20260731/task.json`
- `.ccg/tasks/f1-d2-prime-main-integration-20260731/requirements.md`
- `.ccg/tasks/f1-d2-prime-main-integration-20260731/plan.md`
- `.ccg/tasks/f1-d2-prime-main-integration-20260731/review.md`
- `.ccg/tasks/archive/2026-07/f1-d2-prime-main-integration-20260731/task.json`
- `.ccg/tasks/archive/2026-07/f1-d2-prime-main-integration-20260731/requirements.md`
- `.ccg/tasks/archive/2026-07/f1-d2-prime-main-integration-20260731/plan.md`
- `.ccg/tasks/archive/2026-07/f1-d2-prime-main-integration-20260731/review.md`

禁止修改：业务生产代码、数据库迁移、部署配置、PM2/Nginx 实例、远端分支和生产资源。

### Task 1: 冻结最新主线基线

**Files:** 无源码修改。

1. 确认分支从精确 `origin/main@7b33447d` 创建。
2. 执行 `pnpm install --frozen-lockfile`。
3. 在未改代码前执行 D2 合同、API build、API lint；任何失败立即停止。
4. 记录基线结果，不把生成物加入 Git。

### Task 2: 精确移植 D2 运行时代码

**Files:** 四个 `services/api/scripts/d2-same-host/` 文件。

1. 先仅使用 `166fe9dc3f612d8b6780951261d23540568a456b` 的四文件内容，不按分支名取材。
2. 不带入该提交之前或之后的其他文件。
3. 比较初始移植后的四文件 blob 与源提交最终树；必须完全一致。
4. 对集成审查发现的 ambient D-Bus / user manager 环境继承风险按 RED→GREEN 补合同：所有 user-systemd CLI 通过净化包装，preflight 与正式 transient unit 均禁用 systemd 参数展开并通过绝对 `env -i` 最小白名单启动实际命令。
5. 执行 Bash/Node 语法检查和 D2 合同验证；新增安全修复必须独立于历史 `166fe9dc` PASS evidence 记录。

### Task 3: 增量协调治理文档

**Files:** runbook、current-progress、next-tasks、旧 D3 报告。

1. 以主线当前文本为基线，不整体覆盖文件。
2. 保留早期 Colima retake NO-GO 的完整历史事实。
3. 增量记录历史 `166fe9dc` Lima fresh drill PASS 和真实 evidence 摘要，同时明确当前加固集成候选尚无自己的 fresh PASS evidence。
4. 合入宿主 wrapper 退出状态澄清，不把已解释的 wrapper 退出码继续列为阻塞。
5. 明确 productionF1 仍 NO-GO、D3 未授权；旧 D3 报告只增加“已被新门禁澄清”的注记，不改写旧结果。

### Task 4: 完整验证

**Files:** 无新增源码修改。

1. `bash -n services/api/scripts/d2-same-host/run.sh`。
2. 对三个 `.mjs` 文件执行 `node --check`。
3. 执行 `pnpm --filter @ai-job-print/api verify:d2-same-host-contract`。
4. 执行 `pnpm --filter @ai-job-print/api build` 和 `lint`。
5. 使用新验证器只读复核已归档 Lima evidence的兼容性，但不得把该 evidence 当成当前加固候选的精确运行证明；禁止本任务重跑 full drill。
6. 执行 `git diff --check`、文件白名单检查和“初始移植 blob 一致 + 后续安全修复仅限已审范围”检查。

### Task 5: 审查、提交与本地收口

**Files:** 本任务全部白名单文件与 CCG 归档记录。

1. 先做规格符合性审查，再做代码质量/安全审查。
2. 对完整 diff 并行执行 Antigravity + Claude 双模型审查。
3. Critical/Warning 必须修复并重新审查，直至清零。
4. 更新并归档 CCG task，提交本地候选。
5. 不 push、不建 PR、不部署；后续外部动作必须重新取得用户明确授权。
