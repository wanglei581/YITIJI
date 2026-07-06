# PostgreSQL 高并发 / 高负载加固 Runbook

> 状态：代码与迁移准备文档。**不在本线程直接修改生产服务器**。所有生产数据库参数、PM2、PgBouncer、压测或索引并发构建步骤均需等待用户确认后，在独立部署窗口执行。

## 1. 本轮代码侧变更

本轮只补打印任务高频查询索引，不改变业务状态机：

- `PrintTask(status, terminalId, createdAt)`：支撑 Terminal Agent 高频 `claimTasks()`。
- `PrintTask(status, claimExpiry)`：支撑 claimed 租约过期回收。
- `PrintTask(status, claimedAt)`：支撑 printing 卡住任务回收。
- `PrintTaskStatusLog(taskId, createdAt)`：支撑 Admin 订单详情状态日志。

不新增后台全局分页、会员订单分页或单列 `status` 冗余索引；后续只有在 `pg_stat_statements` 或 `EXPLAIN` 证明慢查询后再单独加。

已审查但本轮暂不加的查询：

- Admin 告警轮询 `status = failed + updatedAt desc + take 50` 属低频后台查询，本轮不为它新增 `(status, updatedAt)`，避免扩大写放大。
- 会员打印订单分页现有 `endUserId` 索引已覆盖隔离过滤，单会员行数预期较小，本轮不新增 `(endUserId, createdAt)`。

生产数据量显著增长后，可在单独任务评估 PostgreSQL partial index；Prisma schema 当前不表达 partial index，本轮不把它混入双 schema 迁移。

## 2. 生产前只读预检

在生产主机上只读执行，保存输出，不改参数：

```bash
psql "$POSTGRES_URL" -c "select version();"
psql "$POSTGRES_URL" -c "show shared_buffers; show effective_cache_size; show work_mem; show max_connections;"
psql "$POSTGRES_URL" -c "select relname, n_live_tup, n_dead_tup from pg_stat_user_tables where relname in ('PrintTask','PrintTaskStatusLog','Order');"
psql "$POSTGRES_URL" -c "select schemaname, relname, indexrelname, pg_size_pretty(pg_relation_size(indexrelid)) from pg_stat_user_indexes where relname in ('PrintTask','PrintTaskStatusLog') order by relname, indexrelname;"
```

建议先启用观测而不是先调大参数。`pg_stat_statements` 如未启用，需在用户确认维护窗口后设置：

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements';
```

该项需要重启 PostgreSQL，不能在本线程执行。

## 3. 索引部署

小表或停机维护窗口内，标准发布可走仓库迁移；迁移 SQL 使用 `CREATE INDEX IF NOT EXISTS`，用于避免并发预建索引后重复执行失败：

```bash
pnpm --filter @ai-job-print/api db:pg:deploy
```

如果生产 `PrintTask` / `PrintTaskStatusLog` 已经较大，**不得先让自动发布流程直接执行标准迁移建索引**；为减少写入阻塞，等待用户确认后先在生产窗口并发预建索引，再发布代码或记录迁移状态。注意 `CREATE INDEX CONCURRENTLY` 不能放在事务里，不能直接塞进 Prisma migration：

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS "PrintTask_status_terminalId_createdAt_idx"
  ON "PrintTask"("status", "terminalId", "createdAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "PrintTask_status_claimExpiry_idx"
  ON "PrintTask"("status", "claimExpiry");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "PrintTask_status_claimedAt_idx"
  ON "PrintTask"("status", "claimedAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "PrintTaskStatusLog_taskId_createdAt_idx"
  ON "PrintTaskStatusLog"("taskId", "createdAt");
```

并发索引完成后再处理 Prisma migration 记录：

- 若 `_prisma_migrations` 尚未记录 `20260706070000_add_db_load_indexes`，优先使用直连 PostgreSQL 的 `db:pg:deploy`；因迁移 SQL 是 `IF NOT EXISTS`，会跳过已存在索引并记录迁移。
- 若部署系统必须跳过该 migration 或当时状态不允许重跑，才按 Prisma 官方流程评估 `prisma migrate resolve --applied 20260706070000_add_db_load_indexes`。
- 具体采用 `migrate deploy` 还是 `migrate resolve` 必须以当时 `_prisma_migrations` 状态为准，不能盲目执行。

## 4. PostgreSQL 参数建议

当前 2 核 / 3.8GiB 内存只给保守起点，必须结合实际 `SHOW`、系统内存和 `pg_stat_statements` 调整：

```conf
shared_buffers = 1GB
effective_cache_size = 2.5GB
work_mem = 8MB
maintenance_work_mem = 256MB
max_connections = 80
random_page_cost = 1.1
checkpoint_timeout = 15min
max_wal_size = 2GB
```

变更方式建议先写入变更单，低峰执行 `ALTER SYSTEM SET ...`，再 `SELECT pg_reload_conf();`。`shared_buffers` 和 `shared_preload_libraries` 需要重启 PostgreSQL，必须有回滚窗口。

## 5. PgBouncer / Prisma 连接池

API 多进程或高并发前，先约束数据库连接数：

- Prisma 连接池：在 `DATABASE_URL` 上显式配置 `connection_limit`，单 PM2 进程建议从 `5` 起步。
- PgBouncer：建议 transaction pooling，监听本机 `6432`，后端连 PostgreSQL `5432`。
- API 环境变量示例：`DATABASE_URL=postgresql://app:***@127.0.0.1:6432/ai_job_print?pgbouncer=true&connection_limit=5`。

PgBouncer 上线同样等待用户确认；必须先验证 Prisma adapter 与迁移命令在直连 PostgreSQL 下执行，应用流量再走 PgBouncer。

执行 Prisma 数据库迁移时，`DATABASE_URL` 必须绕过 PgBouncer transaction pooling 端口，直连 PostgreSQL 原生端口；应用运行流量再使用 PgBouncer 连接串。

## 6. PM2 cluster

当前 API PM2 单进程。数据库索引通过后，才评估 PM2 cluster：

```bash
pm2 start dist/main.js --name ai-job-print-api -i 2
pm2 save
```

上线前提：

- `REDIS_URL` 已启用，不能依赖进程内存做跨进程一致性。
- `Payment` replay / 限流如仍有进程内存态，必须先确认不影响资金正确性。
- 每个进程 Prisma 连接池总和不能超过 PostgreSQL / PgBouncer 容量。

## 7. 压测命令

只在预生产或经用户确认的低峰生产窗口执行。建议工具 `autocannon`：

```bash
npx autocannon -c 20 -d 60 --renderStatusCodes -H "x-performance-test: true" https://zyidai.cn/api/v1/health
npx autocannon -c 20 -d 60 --renderStatusCodes -m POST -H "content-type: application/json" -H "x-performance-test: true" -H "x-terminal-id: KSK-001" -H "authorization: Bearer <agent-token>" -b '{"maxTasks":1}' https://zyidai.cn/api/v1/terminals/KSK-001/tasks/claim
```

支付、创建打印任务、真实出纸链路不能用生产真实用户数据做盲压；需要专用终端、测试文件和可清理订单。

## 8. 验收阈值

部署后至少满足：

- `EXPLAIN (ANALYZE, BUFFERS)` 的 claim / reset / status log 查询走 Index Scan 或 Bitmap Index Scan，无全表 Seq Scan。
- `pg_stat_statements` 中 claim / reset 查询 p95 < 50ms，Admin 详情日志查询 p95 < 100ms。
- API health p95 < 200ms，错误率 < 0.1%。
- PostgreSQL CPU 15 分钟平均 < 70%，连接数低于上限 70%。
- `PrintTask` 状态不混入支付异常；打印状态仍只由打印履约链路写入。

## 9. 停止和回滚

以下任一情况立即停止：

- migration 或并发索引创建失败。
- API 5xx 持续 > 1%。
- PostgreSQL 连接耗尽或 CPU 持续 > 90%。
- `PrintTask` claim、状态回传或订单详情出现功能回归。

回滚优先级：

1. 回滚 API 代码包到上一版。
2. 如仅索引导致写入异常，在用户确认后 `DROP INDEX CONCURRENTLY IF EXISTS ...`。
3. 保留 `pg_dump`、PM2 日志、Nginx access/error log 和 `pg_stat_statements` 快照。
