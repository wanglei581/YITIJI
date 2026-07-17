# Wave 1-B 可逆数据权利计划审查

## 代码与文档事实核验

- 已以 Codebase Memory 图谱定位并读取 `MemberPrivacyService`、`MemberDataRequestController`、`FilesService`、`AuditService`、`RedisService`、`JobSyncModule` 与 `UserDataRequest`。
- 已以当前干净 worktree 复核 `MemberStepUpService`、双 Prisma schema、文件 purpose/保留策略、Kiosk router、`member-personal-data-retention.md` 与进度 SSOT。
- 结论：现有 `delete` 仍会创建 pending 请求；现有 audit `write()` 会吞错；JobSync 的无 Redis inline fallback 不适合敏感导出；这些均已写入执行前置与验证项。

## 外部模型审查状态

- Claude 架构复审已启动（`claude-opus-4-8`），但仅返回内部 thinking 事件，未产生可核验的最终文本；为避免无限等待已中止，**不计作审批或有效审查结论**。
- Antigravity 依照本任务既有已记录的认证/路由不可用例外未再次调用，**不计作审批或有效审查结论**。
- 本计划因此只标注为「待实施前安全复审」，不得写为已获得双模型批准。每个运行时代码切片仍需在最终 diff 上重新请求双模型审查；若任一服务不可用，必须如实记录并补充人工逐项复审，不能伪造通过。

## 自审结果

- Critical：0（计划未引入运行时代码、迁移或外部状态变更）。
- Warning：1（v1 导出字段范围仍需法务/隐私负责人确认是否构成适用的完整数据副本；已作为可见入口的阻断条件写入计划）。
- Info：计划明确不实现注销执行器，只将其置于零副作用 fail-closed gate。
