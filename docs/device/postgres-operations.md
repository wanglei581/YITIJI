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

## 8. 每日备份、恢复演练与日志留存（E2）

生产服务器由产品负责人安装依赖并执行，仓库脚本不会连接真实环境。先把 `backup-postgres.sh`、`restore-postgres-drill.sh` 复制到服务器并赋予执行权限；脚本优先使用环境里的连接串，没有时读取 `${API_ENV_FILE:-/srv/ai-job-print/services/api/.env}`。每日任务可选 `cron-backup.example` 或 systemd 的 `.service` / `.timer`；systemd 的 `EnvironmentFile=-...` 只是可选覆盖，脚本仍会自行读 `.env`。脚本先写 `.partial`，以 `pg_restore -l` 校验后原子改名，默认保留 30 天；失败会推送企业微信（若有 `ALERT_WEBHOOK_URL`）并返回非零，成功写 `LAST_SUCCESS`。

恢复演练必须指向临时 PostgreSQL 库，库名必须含 `drill` 或 `verify`，例如：

```bash
POSTGRES_URL='postgresql://.../backup-drill-20260928' \
  services/api/scripts/restore-postgres-drill.sh /var/backups/ai-job-print/postgres_2026-09-28.dump
```

脚本会拒绝其他库名，运行 `pg_restore` 后执行 Prisma migration status；验收输出以 `RESTORE_OK: restored ...; migration status checked` 开头，并且迁移状态命令成功。不得把生产库作为目标。

日志留存：产品负责人在服务器执行 `pm2-logrotate-setup.sh`（它通过 `pm2 set` 配置按日轮转、压缩、保留 180 天），PM2 日志不再交给 logrotate。将 `logrotate/nginx` **替换** `/etc/logrotate.d/nginx`，不要与系统自带那份并存；它只管理 `/var/log/nginx/*.log`，按日压缩保留 180 天。安装后由产品负责人用 `logrotate -d /etc/logrotate.d/nginx` 预演。企业微信群机器人告警由 API 复用后台派生告警的每分钟节奏；服务器可设置 `ALERT_WEBHOOK_URL`，未设置时不发送。告警消息只含标题、级别、终端编号和发生 / 恢复状态，不含详情；发送失败只记录 `ALERT_PUSH_FAILED`，不影响业务请求。

## 9. 1.6 发布回退演练记录（2026-09-29，本机临时库，不碰生产）

**环境。** 本机 PostgreSQL 16 临时实例（只监听 127.0.0.1，库名都含 `drill`）；数据库结构按生产 API 版本 `50483cd` 的 73 个迁移建出，给机构、账号、终端、文件、AI 服务日志、政策、法务文档 7 张表各插 3 行标 `drill` 的样例数据（其中 5 张是新迁移要加列的表）。脚本全部用候选分支里的真实版本。

| 步骤 | 做法 | 结果 |
|---|---|---|
| 备份 | `backup-postgres.sh`（不设 `ALERT_WEBHOOK_URL`） | `BACKUP_OK`，写出 dump 与 `LAST_SUCCESS`；`pg_restore -l` 可读，含 102 张表的数据 |
| 恢复 | `restore-postgres-drill.sh`，在与备份同版本的目录下运行 | 库名不含 `drill`/`verify` 时拒绝（退出码 2）；恢复到 `…_drill_restore` 后迁移状态与备份一致（73），样例数据齐全 |
| 新迁移 | 候选的 `prisma migrate deploy --config prisma.postgres.config.ts` | 9 个新迁移全部执行成功，状态为最新（82）；样例数据不变，5 张新表建好；9 个迁移都只新增，没有删除、改名或改列类型 |
| 缺法务文档 | 真实发布脚本，3d 预检对着模拟线上接口，隐私政策返回空 | 3d 报缺「隐私政策」，在备份前中止：没有备份、没有迁移（仍是 73）、运行目录与 PM2 都没动 |
| 就绪失败 | 真实发布脚本，三份齐全；新版本就绪检查一直失败 | 真实备份三件齐全（dump 可读），真实执行 9 个迁移（82）；就绪失败后运行目录、依赖、发布指针回到上一版，PM2 重启两次（新版一次、回退一次），回退后就绪检查通过；数据库按设计不回退，迁移记录保留在本次备份的 `.migrations.log` |
| 静态目录 | `verify:deploy-rollback` 抽出 `deploy.yml` 里三端静态目录那段真实脚本，在沙箱里跑 | 切到一半失败、nginx 重载失败，三端都恢复成旧版本；失败时不清理任何备份 |

**用桩的部分。** PM2、依赖安装与构建（发布脚本 1b 步）、就绪检查的 HTTP 请求、3c 的生产闸门预检（它要加载构建产物，另有门禁覆盖）。

**演练中踩到的本机问题（服务器上不会遇到，记下供下次演练）。** 本机 55432 端口已有别的 PostgreSQL，换到空闲端口；草稿目录路径超过 macOS 本地套接字 103 字节上限，改为只走 TCP；macOS 上 `pg_ctl` 要在 `LC_ALL=C` 下启动。

**结论。** 数据库不回退是有意的：这 9 个迁移都只新增，发布失败回到旧代码后，旧代码照样能跑在新结构上。以后若有删除、改名或改类型的迁移，必须先单独评估回退办法，不能照搬本次结论。
