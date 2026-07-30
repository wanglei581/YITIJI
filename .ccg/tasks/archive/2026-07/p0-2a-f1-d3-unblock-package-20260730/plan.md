# P0-2A 执行计划

1. 核对当前 activation / Genesis CLI 参数契约、已完成 D3 审查与生产 runbook 漂移点。
2. Claude 与 Antigravity 并行审查审批包必需字段、权限分离、零流量与残留锁处置边界。
3. 修正 `production-deployment-runbook.md` 的 activation 参数示例，不改发布代码。
4. 新增 `f1-d3-managed-topology-approval-package.md`，仅提供非秘密字段、审批规则、只读核验口径和硬停止条件。
5. 同步两份 progress SSOT，明确本任务只产生 D3 申请输入，不代表 D3 PASS 或 D4 授权。
6. 运行结构、参数、敏感信息、diff 及 release 离线门禁；由 Claude + Antigravity 双审后归档任务。

## 不做

- 不填写真实生产值，不替代机构负责人、运维负责人或安全负责人批准。
- 不重新执行 D3，不进入 D4–D6。
- 不顺手改 Windows 验收、法务、COS 或其他 P0 任务。
