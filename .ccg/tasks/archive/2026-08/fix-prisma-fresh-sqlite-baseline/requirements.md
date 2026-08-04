# Fresh SQLite Prisma 基线修复要求

## 目标

在不读取或修改生产数据库的前提下，让最新 `main` 的全新临时 SQLite 数据库能够完成 Prisma schema 初始化，并恢复 `verify:member-assets` 与 `verify:scan-tasks` 的动态基线，为合同审查 Task 3 提供可信迁移门禁。

## 已知复现

- `prisma generate` 与全仓 typecheck 通过。
- 对全新 SQLite 运行 `prisma migrate deploy` 或 `prisma db push`，schema engine 均以空详情失败。
- `verify:member-assets` 的静态段通过，动态段因数据库初始化不可用而停止。
- `verify:scan-tasks` 在内部临时 SQLite 的 `migrate deploy` 阶段同因失败。

## 已确认根因

- `prisma validate` 与 `prisma migrate diff --from-empty` 均成功，说明 schema 可解析。
- 不存在的 SQLite 文件路径会使本机 Prisma 7.8 `db push` / `migrate deploy` 在打开数据库阶段返回空 `Schema engine error`。
- 对同一路径先执行 `closeSync(openSync(path, 'a'))` 后，`db push` 成功且 74 条迁移全部部署成功。
- 仓库已有正确范式：`verify-member-data-request-truth.ts` 与 `verify-member-data-request-contract.ts`。
- 实际 RED：`verify:scan-tasks`、无 `DATABASE_URL` 的 `verify:member-favorites-benefits`、无 `DATABASE_URL` 的 `verify:member-print-orders` 均稳定失败；`verify:change-password` 已实测通过，不得修改。

## 调试约束

- 先定位根因，未形成单一可证伪假设前不修改实现。
- 只使用临时或任务专用 SQLite 文件，不连接、不复制、不改生产数据库。
- 不删除、重排或压平既有迁移；若根因涉及历史迁移，采用最小、向后兼容修复。
- 必须先增加能稳定复现的失败测试或 verifier，再实施修复。
- 修复后至少通过：全仓 typecheck、fresh SQLite 初始化、`verify:member-assets`、`verify:scan-tasks`。

## 最终允许范围

- `.ccg/tasks/fix-prisma-fresh-sqlite-baseline/`
- `.ccg/spec/guides/index.md`（沉淀临时 SQLite verifier 约束）
- `docs/progress/current-progress.md`（记录前置阻塞已解除）
- `services/api/scripts/verify-scan-tasks.ts`
- `services/api/scripts/verify-member-favorites-benefits.ts`
- `services/api/scripts/verify-member-print-orders.ts`
- `services/api/scripts/verify-member-assets.ts`

## 实施要求

- `verify-scan-tasks.ts` 增加本地 `ensureSqliteFile(path)`，在三个 SQLite `runPrisma(... migrate deploy)` 前调用；PostgreSQL 分支不动。
- 两个 member verifier 只在 fallback `prepareFallbackDb()` 的 `db push` 前，以追加模式创建随机 SQLite 文件；不得截断已有数据库。
- 复用 `closeSync(openSync(path, 'a'))`，确保文件描述符立即关闭，既有 cleanup 继续负责删除。
- 不抽取跨脚本公共模块，不升级依赖，不修改 schema、migration、生产服务或行为。
- RED 已由现有三个真实 verifier 记录；GREEN 必须重跑三者及 API typecheck。
- Fresh SQLite 恢复后，`verify:member-assets` 暴露同型旧 fixture：有效会员桩缺少当前 `EndUserAuthGuard` 必需的 `status:'active'`。只允许补齐该桩的真实字段，不得添加假的 Redis 方法来绕过分支，也不得修改鉴权业务代码。

## 禁止范围

- 生产数据库、生产密钥和部署配置
- `services/api/scripts/run-verify-change-password.mjs`（已实测通过）
- `services/api/prisma/`、任何 schema 或 migration
- 合同审查业务实现
- 既有迁移的破坏性删除、改序或历史数据重写
- 当前主工作区及其中的用户未提交文件
