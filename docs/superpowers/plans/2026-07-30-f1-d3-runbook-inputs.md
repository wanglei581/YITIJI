# F1 D3 Runbook 与 Managed 输入清单 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修正 future-only `release:activate` 运维示例与当前代码契约的漂移，并建立不含秘密、fail-closed 的 D3 managed 拓扑输入清单。

**Architecture:** 本任务只修改正式运维文档和进度入口。`services/api` 中的 activation / Genesis 解析器继续作为参数契约权威来源；新输入清单只保存非秘密标识、摘要、角色和只读证据引用，不保存环境变量值或生产凭据。D3、D4、D5、D6 保持分层、独立授权，任何未关闭字段都维持 production F1 `NO-GO`。

**Tech Stack:** Markdown、pnpm、NestJS release-provenance 离线验证脚本、Git

---

## Task 1：固定代码契约与文档边界

**Files:**
- Read: `services/api/src/release-provenance/release-activation.ts`
- Read: `services/api/src/release-provenance/release-genesis-cli.ts`
- Read: `docs/reviews/f1-d3-production-readonly-precheck-2026-07-30.md`
- Modify: `.ccg/tasks/f1-d3-runbook-inputs-20260730/task.json`

- [x] 核验 activation 为 10 flag / 20 参数，并记录精确 flag 名称。
- [x] 核验 Genesis 为 11 flag / 22 参数，并记录与 activation 不同的 `current`、runtime contract 与 control root 参数名。
- [x] 由 Claude、antigravity、Cursor 独立只读分析并交叉确认风险。
- [x] 将 CCG 任务推进到 implementation 阶段。

## Task 2：修正 future-only activation runbook

**Files:**
- Modify: `docs/device/production-deployment-runbook.md`

- [x] 将 §6 明确限定为 D4 Genesis、D5 切流之后的 D6 稳态 activation；不得把 activation 描述成首次建链。
- [x] 补齐审批输入：managed current、artifact/control root、managed PM2 名称、launcher cwd/path/SHA、runtime-env contract path/SHA 与固定 health URL。
- [x] 将 `release:activate` 示例修正为 10 个 flag，把 legacy 字面 PM2 名称改成 `<MANAGED_PM2_NAME>`。
- [x] 写清 Genesis 与 activation 的参数名/数量不可混用；只提供非可执行对照，不新增 D4/D5 自动化。
- [x] 写清 runtime-env contract 收窄的是 PM2 编排命令环境，不得宣称完整收窄 API 进程环境。
- [x] 将 PM2 dump 路径保持为 `<PM2_HOME>/dump.pm2` 泛化标识，不新增主机专属值。

## Task 3：建立 D3 managed 拓扑输入清单

**Files:**
- Create: `docs/device/f1-d3-managed-topology-inputs.md`

- [x] 在文档顶部声明“输入模板、非审批单、非 D4 授权”。
- [x] 定义 `UNSET`、`NOT_VERIFIED`、`VERIFIED_READ_ONLY`、`BLOCKED` 状态和任一未关闭即 `NO-GO` 的规则。
- [x] 覆盖 B1–B9：独立主机、PM2 名称、managed current、control root、长期保留、launcher、runtime contract、零流量、权限与锁 SOP。
- [x] 只允许非秘密标识、绝对路径标识、SHA-256、账户角色、只读证据与 SOP 引用；明确禁止变量值、凭据、连接串、token、日志正文、业务数据、`.env`、`pm2 env` 和 dump 全文。
- [x] 加入 Genesis / activation 非可执行参数对照以及“legacy online、HTTP 200、D2、本地 fixture、CI 绿不得替代 D3”的防过度宣称条款。
- [x] 初始总体结论保持 `NO-GO`。

## Task 4：同步正式进度入口

**Files:**
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`

- [x] 记录 runbook 漂移已修正、D3 输入模板已建立，但所有生产输入仍未获批/未核验。
- [x] 明确本轮未 SSH、未读取秘密、未部署、未执行 Genesis/activate、未切流，production F1 仍为 `NO-GO`。
- [x] 在下一任务入口链接新清单并保留 D3–D6 未完成状态。

## Task 5：离线验证与多模型终审

**Files:**
- Create: `.ccg/tasks/f1-d3-runbook-inputs-20260730/review.md`
- Modify: `.ccg/tasks/f1-d3-runbook-inputs-20260730/task.json`

- [x] 运行 `pnpm --filter @ai-job-print/api verify:release-provenance`。
- [x] 运行 `pnpm --filter @ai-job-print/api verify:release-genesis`。
- [x] 对照源码核对 runbook 的 10 个 activation flag 和 Genesis/activation 差异。
- [x] 运行 `git diff --check`、链接/字段检查、敏感信息扫描与文件范围检查。
- [x] 由 Claude、antigravity 并行终审，Cursor 补充独立审查；修复全部阻塞项并复验。
- [x] 将审查结论写入 `review.md`，完成 CCG 任务并归档。
