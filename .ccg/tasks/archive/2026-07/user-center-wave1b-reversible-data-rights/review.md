# Wave 1-B 审查记录

日期：2026-07-17

## 已完成的审查

- 本地独立安全/正确性审查覆盖 step-up、会员归属、幂等、CAS、Redis ticket/claim、私有对象存储、补偿和 SQLite/PostgreSQL migration 一致性。
- 本地审查发现 worker 可在写入 `workerJobId` 前把请求推进到 `handling`；原 CAS 错误依赖 `status=pending`，会给已成功入队的请求返回 503。已改为仅以请求 ID、`executionVersion` 与空 `workerJobId` 做 CAS，并新增 RED→GREEN 状态机用例。
- 导出 processor verify 中的 `ready` 测试夹具曾缺少 `exportFileId`，与生产端严格工件校验冲突；已改为合法私有工件夹具并保留租约不改写状态的断言。
- 此前成功的 Antigravity/Gemini 只读审查没有 Critical；提出的两项 Warning 已处理：`rejected/cancelled` 队列 job 终态 no-op，Admin retry 返回重新入队后的 `workerJobId`。

## 外部双模型复审状态

- 本次 Antigravity 复审调用未返回模型报告：账号所在地不支持当前 API。该失败不是有效审查结论。
- 本次 Claude 复审包装器已调用但未产出报告正文；因此不得宣称 Claude 审查已通过。

需要在外部服务恢复可用后补跑 Antigravity 与 Claude 的只读复审；截至本记录，未发现未修复的本地 Critical/High 问题。

## 回归结论

rebase 到 `origin/main@0ae51289` 后，发现并修复两个 migration 收口问题：旧切片遗留的空 migration 目录会令 Prisma 报 P3015；双库 unique index 的换行格式不符合静态契约门禁。仅清理空目录并统一 SQLite/PostgreSQL additive migration 的等价 SQL 格式，未改变 schema 或运行时语义。

重放后所有 Wave 1-B formal verify、step-up integration、账户状态和文件保留门禁、PostgreSQL schema 同步检查、typecheck、lint、生产配置 build、diff check 均通过。`pnpm audit --prod --audit-level=critical` 通过（仅报告一项现有 moderate 漏洞）。
