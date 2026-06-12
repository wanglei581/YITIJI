# PostgreSQL 生产数据底座 — 运维手册（第四阶段）

> 状态：本地（macOS PG 16.14）与 CI（postgres:16 容器）已真实验证：空库 deploy、seed、
> 核心 verify（含会员真实 HTTP E2E）、API 启动、SQLite→PG 数据迁移演练（37 表对账一致）。
> **生产环境（Windows 服务器/云）部署后须按本手册再走一遍验证清单方可宣称生产就绪。**

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

# SQLite → PG 数据迁移（默认要求目标库为空；孤儿行跳过并告警；行数对账不一致退出码 1）
DATABASE_URL="file:./prisma/dev.db" POSTGRES_URL="postgresql://..." \
  pnpm --filter @ai-job-print/api db:pg:migrate-data
```

## 3. 上线切换步骤（SQLite → PostgreSQL）

1. 停止 API 写入（维护窗口；Kiosk 显示维护提示）。
2. 备份 SQLite：复制 `dev.db`（见 §4）。
3. 全新 PG 库：`createdb` → `db:pg:generate` → `db:pg:deploy`。
4. `db:pg:migrate-data` 迁移数据；确认输出「迁移完成并对账通过」，记录孤儿行告警。
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

# SQLite（切换前的最后状态，保留为回退点）
cp services/api/prisma/dev.db backups/dev_$(date +%Y%m%d).db
```

## 5. 回滚（PG 切换失败 → 退回 SQLite）

1. API 环境改回 `DATABASE_URL=file:./prisma/dev.db`，重启 —— 代码无需改动
   （工厂按协议自动选 SQLite adapter）。
2. 切换窗口内 PG 上产生的增量数据会丢失：回滚决策须在观察期内尽早做出；
   若已有不可丢增量，先用 `pg_dump` 留档再回滚，事后人工合并。
3. 回滚后在 docs/progress/current-progress.md 记录原因与失败现象。

## 6. 故障恢复

| 故障 | 处置 |
|------|------|
| `migrate deploy` 失败 | 迁移有事务保护；查 `_prisma_migrations` 表失败行，修复 SQL 后 `prisma migrate resolve --applied/--rolled-back <name> --config prisma.postgres.config.ts` |
| 迁移数据对账不一致 | 脚本已退出码 1；drop 目标库重来（脚本默认拒绝写非空库） |
| 孤儿行告警 | 如实记录在切换日志；属 SQLite 历史脏数据（FK 未强制），不迁移是正确行为 |
| 连接池耗尽 | adapter-pg 默认池；高并发可在 POSTGRES_URL 加 `?connection_limit=` 或前置 pgbouncer |

## 7. 已知边界（如实声明）

- 本手册验证环境为 macOS 本地 PG 16 + ubuntu CI 容器；**Windows 生产服务器上的
  PG 实例尚未实测**（上线部署时按 §3 清单逐项执行）。
- `db:pg:migrate-data` 的 MODEL_ORDER 需随新模型手工维护（漏表会被对账兜底抓住，
  但仍应在新增模型的 PR 中同步更新）。
- SQLite 仍是开发默认；两库行为差异（如大小写排序、并发语义）由核心 verify 套件
  在 CI 双 job 上持续回归。
