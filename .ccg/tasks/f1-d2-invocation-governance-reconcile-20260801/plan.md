# Latest-main reconciliation plan

## 基线与文件预算

- 基线：`origin/main@218a33e6`。
- 候选来源（只作选择性移植）：`d08014bc`。
- production `governance*.mjs`：单文件 ≤300，入口 ≤400。
- verifier：单文件 ≤500；主干既有 `verify-contract.mjs` 只做缺陷修复/接线，不扩大无关范围。

## Layer 1A：治理内核与测试闭集

从 `d08014bc` 机械移植并复验以下文件：

- `governance-contract.mjs`
- `governance-git.mjs`
- `governance-invocation.mjs`
- `governance-reservation.mjs`
- `governance-state.mjs`
- `governance-store.mjs`
- `governance.mjs`
- `verify-governance-crash.mjs`
- `verify-governance-git.mjs`
- `verify-governance-invocation.mjs`
- `verify-governance-reservation.mjs`
- `verify-governance-store.mjs`
- `verify-governance.mjs`
- `invocation-worker-fixture.mjs`
- `reservation-worker-fixture.mjs`

删除主干旧 `invocation-governance.mjs` 与 `verify-invocation-governance.mjs`；更新 `package.json` 与
CI 独立 gate。此层不得修改 `run.sh`、`verify-contract.mjs`、cleanup 或 docs。

## Layer 1B：`run.sh` 与 wiring

以 `218a33e6` 的 `run.sh` 为底：

1. 先写/迁移 wiring regression，使未接线主干处于 RED。
2. 只替换旧 consume/env governance 前缀为 `D2_GOVERNANCE_INVOKE_START/END` + fd 3 manifest 块。
3. 禁止 caller evidence/work overrides，`WORK_DIR` 固定为脚本内 `.work`。
4. 保留主干 LoadState+ActiveState cleanup、法证保留、systemd/cgroup/port/nonce 主体。
5. 保留多阶段 clone drift 检查语义，但校验基准必须从已通过 manifest invoke 的当前 clone 内部派生，
   不能继续接受 caller raw identity env。
6. 重算最终源码的 prefix/block digest，29 mutation 与 6 harness 全绿。

## Layer 1C：旧 contract 增量适配

以 `218a33e6` 的 `verify-contract.mjs` 为底：

- 保留 `verifyReconciledCleanupContract` import/call与 rollback 后 `managedAppPid` 静态锚。
- 移除旧 `verifyInvocationGovernanceContract` import/call。
- 只移植新的 canonical reserve/invoke 命令、governance guard、固定 no-go 闭集和精确 mutation。
- 不搬回旧候选内联 cleanup 断言。

## Layer 2：文档、审查与 PR

- 三方合并 runbook：治理命令采用最终单一 manifest 路径；cleanup/systemd 未验证事实采用最新主干。
- 在 progress SSOT 记录 #463 被更强内核替换但 #460/#464–#469 保留；不得宣称演练或 PASS。
- 串行执行所有门禁与 audit，记录既有依赖漏洞，不改依赖/lockfile。
- Claude + Antigravity + Cursor + CCG 复审；Critical/Warning 归零后归档本任务。
- 推送新集成分支并创建 PR；不部署、不合并、不运行真实演练。
