# Fresh SQLite Prisma 基线修复评审

## 根因

- Prisma schema validate 与 from-empty migration diff 均正常。
- 本机 Prisma 7.8 对不存在的 SQLite 目标执行 `db push` / `migrate deploy` 时，在打开数据库阶段返回空 `Schema engine error`。
- 同一路径先以 `closeSync(openSync(path, 'a'))` 创建零字节文件后，`db push` 和 74 条迁移全部成功。
- 生产 PostgreSQL、schema 与 migration 本身不受影响。

## 修复范围

- `verify-scan-tasks.ts` 的三个真实 SQLite migration 块在迁移前预创建文件。
- `verify-member-favorites-benefits.ts` 与 `verify-member-print-orders.ts` 使用 `__dirname` 派生的绝对路径创建和清理 fallback DB，并固定 Prisma 子进程 `cwd`。
- `verify-member-assets.ts` 与收藏 verifier 的有效会员 fixture 补齐当前鉴权契约要求的 `status:'active'`；没有伪造注销方法或修改生产鉴权逻辑。

## 审查

- 独立需求符合性审查：`Spec compliant`。
- 独立代码质量审查：Critical / Important / Minor 均为 None，`Ready to merge: Yes`。
- Antigravity 首轮指出两个 member verifier 仍依赖相对 cwd；修复后最终 `APPROVE`，无 Critical / Warning。
- Claude 最终 `APPROVE`，确认绝对路径生命周期、fallback skip 分支和有效会员 fixture 均符合契约，无 Critical / Warning。

## 最终验证

- `verify:scan-tasks`：PASS；SQLite 真实迁移段执行，未配置的 PostgreSQL 专项按既有逻辑跳过。
- `verify:member-favorites-benefits`：PASS。
- `verify:member-print-orders`：PASS。
- fresh SQLite 预创建后 74 条 `migrate deploy`：PASS。
- `verify:member-assets`：ALL PASS。
- API typecheck：PASS。
- `git diff --check`：PASS。

## 结论

前置数据库基线阻塞已解除；变更仅影响 verifier，不修改生产 schema、migration 或运行时服务，可以继续 AI 合同审查 Task 1。
