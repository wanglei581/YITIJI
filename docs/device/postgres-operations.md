# PostgreSQL 生产数据底座 — 运维手册（第四阶段）

> 当前状态（2026-08-09）：生产 API 已运行 PostgreSQL，日常变更按“备份 → additive
> migration → 应用发布 → 验证”执行，不再按 SQLite→PostgreSQL 首次切库流程操作。
> 早期 37 模型搬数演练仅是历史证据；当前 schema 约 81 个模型，旧搬数脚本没有覆盖
> 全部模型，不能据此宣称“全库对账一致”。

## 1. 架构

- **唯一模型真相源**：`services/api/prisma/schema.prisma`（SQLite，开发默认）。
- **PG schema**：`prisma/postgres/schema.prisma` 由 `pnpm db:pg:sync` 机械生成（仅改
  provider/output），**禁止手改**；CI 两个 job 都跑 `db:pg:sync:check` 防漂移。
- **PG migrations**：`prisma/postgres/migrations/`（baseline `0_init` 由全量 schema diff
  生成 —— SQLite 28 个历史迁移的 drift 在此一次性规范化，PG 侧历史从干净基线开始）。
  此后每次模型变更：改主 schema → `db:pg:sync` → `prisma migrate dev --config
  prisma.postgres.config.ts --name <变更名>`（开发 PG 库上生成增量迁移）→ 一并提交。
- **运行时选择**：`src/prisma/create-client.ts` 按 `DATABASE_URL` 协议显式选择
  （`file:` → libsql/SQLite；`postgres(ql)://` → @prisma/adapter-pg），不支持的协议
  启动即报错，不静默回退。seed / verify / API / 迁移脚本全部走同一工厂。

## 2. 常用命令

```bash
# schema 同步（改模型后必跑）与漂移校验
pnpm --filter @ai-job-print/api db:pg:sync
pnpm --filter @ai-job-print/api db:pg:sync:check

# 生成 PG client（src/generated/prisma-pg，已 gitignore）
pnpm --filter @ai-job-print/api db:pg:generate

# 部署迁移（POSTGRES_URL 优先，未设回落 DATABASE_URL）
POSTGRES_URL="postgresql://user:pass@host:5432/db" \
  pnpm --filter @ai-job-print/api db:pg:deploy

# 当前不提供 SQLite → PG 全库搬数命令；旧工具已退役并从工作树移除
```

> **警告**：历史 `db:pg:migrate-data` 的 `MODEL_ORDER` 只覆盖 37 个模型，且末尾对账仍只遍历
> 同一清单，无法发现未列入清单的表；OfflineAgency、OfflineJob 等模型均被遗漏。该命令和脚本
> 已在招聘内容域 P1 Wave 1A 删除，禁止从 Git 历史恢复执行，也不能用历史“对账通过”输出推断
> 当前整库完整。未来若确需导入其他旧库，必须新建按领域、可 dry-run、可守恒对账的迁移工具。

## 3. 历史首次切换步骤（SQLite → PostgreSQL，禁止直接复用）

本节仅保留早期切库过程作为历史参考，不是当前生产操作手册。若未来确需从其他 SQLite
环境向 PostgreSQL 搬数，必须单独设计替代工具、冻结模型清单、在备份恢复库
完成 dry-run，并取得具名授权。

1. 停止 API 写入（维护窗口；Kiosk 显示维护提示）。
2. 备份 SQLite：复制 `dev.db`（见 §4）。
3. 全新 PG 库：`createdb` → `db:pg:generate` → `db:pg:deploy`。
4. 仅运行另行评审和具名授权的新领域迁移工具；旧 `db:pg:migrate-data` 已删除，禁止恢复。
   新工具输出只作为已覆盖领域的对账证据，还必须独立核对 schema 全模型集合。
5. API 环境改 `DATABASE_URL=postgresql://...`，重启。
6. 验证清单：API 启动日志 `DB connected — postgresql://…`；`GET /api/v1/jobs` 返回
   真实数据；会员登录 → `/me/resumes`；Admin 登录 → 告警中心；打印链路建任务。
7. 观察期（建议 ≥1 天）内保留 SQLite 原文件不删。

## 4. 备份与恢复

```bash
# PG 逻辑备份（生产建议每日 cron + 异机存储；含 schema+数据）
pg_dump --format=custom --file=backup_$(date +%Y%m%d_%H%M).dump "$POSTGRES_URL"

# 恢复到新库（演练恢复每季度至少一次）
createdb restore_test
pg_restore --dbname=postgresql://.../restore_test backup_xxx.dump

# SQLite（仅适用于历史首次切换或开发库备份，不是生产回退点）
cp services/api/prisma/dev.db backups/dev_$(date +%Y%m%d).db
```

## 5. 当前生产回滚（保持 PostgreSQL）

1. Additive migration 发布失败时，优先回退应用到兼容的上一版本；保留新增表、可空字段和索引，
   不切换生产 `DATABASE_URL`，也不尝试 PG→SQLite 搬数。
2. 若故障涉及破坏性数据变更，停止写入并保留现场；将发布前 `pg_dump` 恢复到**新 PostgreSQL
   数据库**完成校验后，再按受控切换流程恢复服务。不得覆盖唯一生产库后再尝试恢复。
3. Contract/drop 类迁移必须与 expand/backfill/switch 分波，并至少经过两个发布周期的 legacy
   零读写观察；发生问题时继续使用兼容字段或回退应用，不现场反向造 migration。
4. 在 `docs/progress/current-progress.md` 记录故障、备份标识、恢复库验证、应用版本和最终决策。

## 6. 故障恢复

| 故障 | 处置 |
|------|------|
| `migrate deploy` 失败 | 立即停写并保留现场；迁移可能处于部分应用状态，先核对 `_prisma_migrations.logs`、实际 schema/数据、日志和备份。`resolve --rolled-back` 仅限确认无残留或已安全清理；`resolve --applied` 仅限人工完成完全等价变更并通过 schema diff/验收；否则恢复到新 PostgreSQL 库 |
| 历史搬数工具或命令被引用 | 立即停止；工具已退役删除，不得从 Git 历史恢复，改为另立具名授权的领域迁移方案 |
| 孤儿行告警 | 如实记录在切换日志；属 SQLite 历史脏数据（FK 未强制），不迁移是正确行为 |
| 连接池耗尽 | adapter-pg 默认池；高并发可在 POSTGRES_URL 加 `?connection_limit=` 或前置 pgbouncer |

## 7. 已知边界（如实声明）

- 生产 PostgreSQL 已投入运行，但每次 schema 变更仍必须在 SQLite 主 CI 与真实
  PostgreSQL CI/恢复库分别验证 fresh install 和已有库 upgrade；公开 health 不能替代私有表盘点。
- 历史 `db:pg:migrate-data` 只列 37 个模型，无法发现 OfflineAgency、OfflineJob 等漏表，
  已在招聘内容域 P1 Wave 1A 退役删除。任何后续旧库导入只能使用另行评审、可 dry-run、
  可逐类守恒对账且获得具名授权的领域迁移工具。
- SQLite 仍是开发默认；两库行为差异（如大小写排序、并发语义）由核心 verify 套件
  在 CI 双 job 上持续回归。生产恢复目标始终是 PostgreSQL，不设计 PG→SQLite 回滚。
