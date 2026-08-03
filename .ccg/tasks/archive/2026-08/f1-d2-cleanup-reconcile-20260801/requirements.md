# F1 D2 cleanup reconciliation

## 目标

在已合入 PR #464 的 `origin/main@2751030d` 上做最小增量 reconciliation：保留其 forensic retention guard、mutation no-op 与现有 cleanup 退出语义，同时补齐严格状态元组、真实 Bash 行为合同和 evidence 防删断言。

## 严格合同

1. `stop_user_unit_and_prove_inactive` 的成功证明只允许 `loaded+inactive` 或 `not-found+inactive`。
2. `systemctl stop` 非零不能直接成功，仍须由单次 `systemctl show` 同时返回两项按键解析的状态证明。
3. 轮询中被 collect 为 `not-found+inactive` 可成功。
4. show 失败、缺失/重复/空/未知字段、`failed`、`not-found+active` 全部 fail closed。
5. 保留 PR #464 对 `RUN_DIR` / `PM2_CONTROL_ROOT` 各自 forensic guard、mutation 必须实际改写源码的断言。
6. cleanup 不得删除或改写 evidence。

## 允许修改

- `services/api/scripts/d2-same-host/run.sh`
- `services/api/scripts/d2-same-host/verify-contract.mjs`
- `services/api/scripts/d2-same-host/verify-cleanup-contract.mjs`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- `.ccg/tasks/f1-d2-cleanup-reconcile-20260801/`

## 禁止事项

- 不修改 drill、diagnostics、evidence schema、invocation governance、runbook 或 package scripts。
- 不启动 Colima/systemd/PM2/Nginx/API。
- 不执行 reserve、consume 或 full drill，不生成 nonce/evidence。
- 不 SSH、不连接 production、不部署、不进入 D3–D6。
- 不 push、不创建重复 PR，除非后续获得明确授权。

## 验证

- RED→GREEN：`pnpm --filter @ai-job-print/api verify:d2-same-host-contract`。
- Shell/Node 语法、API lint/typecheck/build、audit critical、diff/range/secret checks。
- Antigravity + Claude 终审，Critical/Warning 清零。
