# 权益活动中心 MVP 双模型审查

时间：2026-06-18

范围：当前工作树的 `BenefitActivity` / `BenefitClaim` 数据模型、Kiosk 权益活动页面、Admin 权益活动页面、领取事务、审计、合规文案、文档与 verify 脚本。

## 首轮 Claude 审查

结论：Request changes。

Critical：

- `benefit_activity.claim` 审计最初把 `EndUser.id` 写入 `AuditLog.actorId`，但 `AuditLog.actorId` 外键指向 `User.id`，生产 PostgreSQL 会因 FK 失败而被 `AuditService.write` 静默吞掉。
- PostgreSQL 迁移最初修改了已应用的 `postgres/migrations/0_init/migration.sql`，会导致已有 PG 数据库 `migrate deploy` 校验失败。

已修复：

- 领取审计改为 `actorId: null`、`actorRole: 'end_user'`，并在 `payload.endUserId` 保存领取会员 id。
- PG 侧改为新增 `services/api/prisma/postgres/migrations/20260618190000_add_benefit_activities/migration.sql`，不再修改 `0_init`。
- `verify:benefit-activities` 增强检查：claim 审计必须 `actorId=null` 且 payload 携带 endUserId；fallback AuditLog DDL 增加 `AuditLog_actorId_fkey`。

## 第二轮 Claude 审查

结论：Approve。

- 确认领取审计不再把 `EndUser.id` 写入 `actorId`。
- 确认 PostgreSQL `0_init` 无 diff，新增独立时间戳迁移。
- Critical = 0，Major = 0。
- Minor：`claimLimitPerUser` 当前固定为 1，属于 MVP 字段语义提醒，后续如需每人多次领取再单独设计。

## 第二轮 Antigravity 审查

结论：Approve。

- Correctness / Security / Performance / Maintainability 均通过。
- 确认 `actorId=null + payload.endUserId` 的领取审计方案。
- 确认 PG 迁移策略为新增时间戳迁移，不修改 `0_init`。
- Critical = 0，Warning = 0。

## 处理结论

已处理全部 Critical。剩余 `claimLimitPerUser` 为后续增强项，不影响当前 MVP：本阶段产品定义为每个活动每个会员限领 1 次，实际约束由 `BenefitClaim(activityId,endUserId)` 唯一索引保证。
