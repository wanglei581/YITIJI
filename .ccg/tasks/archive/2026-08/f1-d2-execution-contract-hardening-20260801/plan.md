# 执行计划索引

正式逐步计划：`docs/superpowers/plans/2026-08-01-f1-d2-execution-contract-hardening.md`。

## 当前检查点

- [x] PR #453 合入 `main@b274e6bc`。
- [x] 隔离分支与 offline contract 基线全绿。
- [x] 正式入口/Spec、代码图与关键源码已审查；两份必读文档仍不存在并已知悉。
- [x] Antigravity + Claude 写码前分析均为 `ANALYSIS GO`。
- [x] 文件预算、禁止范围、RED→GREEN 与验证命令已固定。
- [x] Task 1：offline entry contract RED（exit 2，`D2_PRIME_EXECUTION_ENTRY_CONTRACT_INVALID`）。
- [x] Task 2：`run.sh` minimal GREEN；Bash 语法通过，合同按计划仍因 runbook 缺模板而 RED。
- [x] Task 3：runbook canonical command GREEN；新增入口合同 PASS，末行 `D2_PRIME_CONTRACT_ALL_PASS`。
- [x] Task 4：全串行离线验证通过；并行 lint/build 的 Prisma 生成目录竞态已用串行复验排除。
- [x] Task 5：正式进度已同步，第二轮 Antigravity + Claude 均 APPROVE；最终复验通过并进入归档提交。
