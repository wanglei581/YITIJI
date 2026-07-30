# P0-2A 需求与边界

## 目标

- 修正生产发布 runbook 中已过期的 activation 16 参数示例，与当前 20 参数契约一致。
- 在现有 `docs/device/` 正式体系中提供 F1 D3 managed 拓扑与治理审批模板，固定非秘密输入和硬停止条件。
- 不预填生产主机、路径、账户或摘要；未经具名人工审批时始终保持 D3 NO-GO。

## 允许修改

- `docs/device/production-deployment-runbook.md`
- `docs/device/f1-d3-managed-topology-approval-package.md`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- `.ccg/tasks/p0-2a-f1-d3-unblock-package-20260730/*`

## 禁止范围

- 不修改 `apps/`、`services/`、`packages/`、CI、依赖、schema 或 migration。
- 不连接生产、不 SSH、不读取密钥/日志/业务数据、不执行 Genesis/activate/PM2/Nginx/切流。
- 不创建第二套发布架构，不用 legacy 主机、PM2 `online`、HTTP 200 或 D2 fixture 替代 managed D3 证据。
- 不把审批模板的示例值表述为已批准的生产事实。

## 验收标准

- runbook activation 命令完整包含当前 10 个 flag / 20 个 CLI 参数，含 runtime-env contract path/SHA。
- 审批包覆盖 managed 主机/端点、PM2、current/artifact/control/launcher/contract 路径、摘要、账户权限、control root 长期留存、残留锁 SOP 与零流量证明。
- 模板明确分离“申请人填写”、“审批人结论”和“执行人只读核验”，任一项缺失均 NO-GO。
- Claude + Antigravity 双模型终审无 Critical；本地 release provenance/Genesis verify、API typecheck/lint/build 和文档 diff 门禁通过。
