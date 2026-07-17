# Wave 1-B 审查记录

日期：2026-07-17

## 已完成的审查

- 本地独立安全/正确性审查覆盖 step-up、会员归属、幂等、CAS、Redis ticket/claim、私有对象存储、补偿和 SQLite/PostgreSQL migration 一致性。
- 本地审查发现 worker 可在写入 `workerJobId` 前把请求推进到 `handling`；原 CAS 错误依赖 `status=pending`，会给已成功入队的请求返回 503。已改为仅以请求 ID、`executionVersion` 与空 `workerJobId` 做 CAS，并新增 RED→GREEN 状态机用例。
- 导出 processor verify 中的 `ready` 测试夹具曾缺少 `exportFileId`，与生产端严格工件校验冲突；已改为合法私有工件夹具并保留租约不改写状态的断言。
- 此前成功的 Antigravity/Gemini 只读审查没有 Critical；提出的两项 Warning 已处理：`rejected/cancelled` 队列 job 终态 no-op，Admin retry 返回重新入队后的 `workerJobId`。

## 外部双模型复审状态

- Claude 全量只读审查在时间预算内返回 `INCOMPLETE`：已覆盖 step-up、会员归属、幂等/CAS、白名单、私有对象、下载和补偿，未覆盖 Redis 原子实现、migration 逐字对比、审计事务和 controller 装配；已覆盖部分没有 Critical。它识别出 Admin retry 仍保留 `status=pending` 的 worker 抢先竞态。
- 该竞态已按 RED→GREEN 修复：新增真实运行时状态机用例，先证明旧实现返回 `DATA_REQUEST_EXECUTION_INCOMPLETE`，再将 retry 的事后 `workerJobId` CAS 收窄为请求 ID、`executionVersion` 与空 `workerJobId`。入口事务的旧状态/文件/failure CAS、队列 jobId 唯一约束均未放宽。
- 修复后的精确 diff 已分别由 Antigravity/Gemini 与 Claude 只读复审；两者均 `APPROVE`，无 Critical/Warning。该批准只覆盖本次竞态补丁，不替代仍未完成的全量外部复审。

仍建议在集成前补齐全量外部只读复审，重点为 Redis ticket/claim 原子性、双 migration、AuditService 事务语义和 controller 鉴权/下载 header；截至本记录，未发现未修复的本地 Critical/High 问题。

2026-07-17 追加：针对上述未覆盖路径再次分段调用双模型。Antigravity 在获取模型配置时收到外部 EOF，未生成报告；Claude 两次在输出结论前超时，恢复同一会话也未返回报告。三次失败均不是有效审查结论，故该分段仍保持待全量外部复审状态。

2026-07-17 授权恢复后，Antigravity 已通过模型列表和最小只读探针验证可用，并完成上述 11 个未覆盖文件的聚焦审查，结论为 `APPROVE`（无 Critical/Warning）；覆盖 Redis ticket/claim/finish 原子性、迁移一致性、审计事务和 controller 鉴权/下载 header。Claude 对同一范围的恢复会话仍在输出报告前超时，未形成有效结论。因此该候选仍不宣称完成双模型全量外部复审，待 Claude 提供有效报告后再解除集成前审查阻塞。

2026-07-17 再次以 360 秒时限提交同一聚焦只读审查，并要求即使时间有限也输出结论；Claude 在完整时限内未输出任何报告，包装器以 execution timeout 结束。该轮同样不计作审查通过，且没有产生需修复的新发现。

## 设计取舍确认

- 失败或清理不确定的 export 请求保留 `activeKey`，且 `EXPORT_CLEANUP_FAILED` 禁止 Admin retry/reject；这是为了防止未确认清理的私有对象被新请求绕过。普通失败项在 API 中仍以 `canRetry=true` 表示可由受控运营动作处理；本切片未新增用户或 Admin UI。
- 下载的“单次”语义是“单次成功交付”：claim 后断连会释放/恢复 claim 而不误删 ready 对象，只有 finish 的原子收口才写 `downloadConsumedAt`。该取舍由现有下载/对账门禁覆盖，前端产品文案在新增下载 UI 前必须按此语义表述。

## 回归结论

rebase 到 `origin/main@0ae51289` 后，发现并修复两个 migration 收口问题：旧切片遗留的空 migration 目录会令 Prisma 报 P3015；双库 unique index 的换行格式不符合静态契约门禁。仅清理空目录并统一 SQLite/PostgreSQL additive migration 的等价 SQL 格式，未改变 schema 或运行时语义。

重放后所有 Wave 1-B formal verify、step-up integration、账户状态和文件保留门禁、PostgreSQL schema 同步检查、typecheck、lint、生产配置 build、diff check 均通过。`pnpm audit --prod --audit-level=critical` 通过（仅报告一项现有 moderate 漏洞）。
