# 需求与边界

## 目标

1. 将预生产服务器已应用、但 Git 缺失的 PostgreSQL 迁移 `20260722090000_pg_foundation_batch_tables` 以原始字节回填到仓库。
2. 在全新隔离 PostgreSQL 数据库中验证完整迁移链可从零部署。
3. 使用既有预生产备份，在唯一命名的临时数据库中执行一次恢复冒烟；无论成功或失败都销毁临时数据库。

## 允许修改

- `services/api/prisma/postgres/migrations/20260722090000_pg_foundation_batch_tables/migration.sql`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- 本任务目录内的 CCG 记录

## 禁止修改或操作

- 不修改 Prisma schema、既有迁移、业务代码、账号、手机号、密钥或生产配置。
- 不对预生产业务数据库执行 `migrate reset`、`migrate resolve`、`pg_restore --clean` 或任何写入。
- 不把数据库连接串、服务器地址、凭证或业务数据写入日志和仓库。
- 不使用预生产业务库作为恢复目标。

## 验收标准

- 回填文件 SHA-256 与服务器文件及 `_prisma_migrations.checksum` 完全一致。
- 缺失文件检查先失败，回填后通过。
- 全新隔离数据库可执行全部 PostgreSQL 迁移，且状态为最新。
- 既有备份可恢复到唯一临时数据库；验证完成后临时数据库已不存在。
- 相关测试、类型检查或构建门禁通过，双模型审查无未解决 Critical。
- 更新正式进度文档，任务完成后归档。
