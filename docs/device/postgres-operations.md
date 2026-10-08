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

生产服务器由产品负责人安装依赖并执行，仓库脚本不会连接真实环境。先把 `backup-postgres.sh`、`restore-postgres-drill.sh` 复制到服务器并赋予执行权限；脚本优先使用环境里的连接串，没有时读取 `${API_ENV_FILE:-/srv/ai-job-print/services/api/.env}`。每日任务可选 `cron-backup.example` 或 systemd 的 `.service` / `.timer`；systemd 的 `EnvironmentFile=-...` 只是可选覆盖，脚本仍会自行读 `.env`。脚本先写 `.partial`，以 `pg_restore -l` 校验后原子改名，本机默认保留 30 天；失败会推送企业微信（若有 `ALERT_WEBHOOK_URL`）并返回非零，成功写 `LAST_SUCCESS`。异地副本默认关闭；开通、上传后校验、本机与异地分开的保留天数，以及在另一台机器上的恢复演练，见第 10 节。

恢复演练必须指向临时 PostgreSQL 库，库名必须含 `drill` 或 `verify`，例如：

```bash
POSTGRES_URL='postgresql://.../backup-drill-20260928' \
  services/api/scripts/restore-postgres-drill.sh /var/backups/ai-job-print/postgres_2026-09-28.dump
```

脚本会拒绝其他库名，运行 `pg_restore` 后执行 Prisma migration status；验收输出以 `RESTORE_OK: restored ...; migration status checked` 开头，并且迁移状态命令成功。不得把生产库作为目标。

日志留存：产品负责人在服务器执行 `pm2-logrotate-setup.sh`（它通过 `pm2 set` 配置按日轮转、压缩、保留 180 天），PM2 日志不再交给 logrotate。将 `logrotate/nginx` **替换** `/etc/logrotate.d/nginx`，不要与系统自带那份并存；它只管理 `/var/log/nginx/*.log`，按日压缩保留 180 天。安装后由产品负责人用 `logrotate -d /etc/logrotate.d/nginx` 预演。企业微信群机器人告警由 API 复用后台派生告警的每分钟节奏；服务器可设置 `ALERT_WEBHOOK_URL`，未设置时不发送。告警消息只含标题、级别、终端编号和发生 / 恢复状态，不含详情；发送失败只记录 `ALERT_PUSH_FAILED`，不影响业务请求。

### 8.1 删掉的数据多久才从备份里彻底消失（等待期）

数据库里删掉的数据（会员注销、机构退出、存量清理）在**已经做好的备份**里还在，要等备份轮换掉才算清干净。数字以脚本实际值为准：

| 备份 | 在哪 | 怎么轮换 | 删除后最长还留多久 |
|---|---|---|---|
| 每日备份 | 本机 `BACKUP_DIR`（默认 `/var/backups/ai-job-print/postgres`） | `backup-postgres.sh` 按 `RETENTION_DAYS`（默认 30）删旧 dump | 30 天 |
| 每日备份的异地副本 | `BACKUP_OBJECT_URI`（`BACKUP_UPLOAD_ENABLED=1` 时）；没有 rclone 的验证环境可以用 `BACKUP_MIRROR_DIR` | 同一脚本上传并校验后，按 `BACKUP_REMOTE_RETENTION_DAYS`（默认 30，不跟随本机 `RETENTION_DAYS`）清理。rclone 用 `delete --min-age`；本地目录用 `find -mtime`。2026-10-06 起与本机分开配置；2026-10-04 之前只传不删 | `BACKUP_REMOTE_RETENTION_DAYS`（默认 30 天）。对象存储若开了版本控制或回收站，还要加上它的生命周期 |
| 发布前备份 | `/srv/ai-job-print-backups`（`DEPLOY_BACKUP_ROOT`） | `deploy-api-release.sh` 按组数保留：`DEPLOY_BACKUP_KEEP` 默认 3 组，另外最近一次成功发布前的那组永远保留 | **没有时间上限**：删除之后再成功发布 3 次，删除前做的备份才会全部被轮换掉；长期不发布就一直在 |
| 应用日志 | PM2 日志 | `pm2-logrotate-setup.sh` 按日轮转、保留 180 天 | 180 天（日志里的手机号都是打码形式） |

**对外说「已经清干净」之前**：等满本机 `RETENTION_DAYS` 与异地 `BACKUP_REMOTE_RETENTION_DAYS` 中较长的天数（默认都是 30），对象存储若开了版本控制或回收站，再等生命周期把旧版本删掉，并且确认删除之后已经有 3 次成功发布（或由运维人工删除删除时间之前的发布前备份组，删除要按「生产写操作逐次请示」办）。机构退出、存量清理的完成时间都按这个口径算，不按「数据库里删掉的那一刻」算。

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

## 10. 异地备份

生产库每天的逻辑备份要有一份异地副本，并每季度在另一台机器上恢复一次。仓库只放脚本、配置样例和本文。填好的密钥、桶名、账号和服务器地址只放在服务器上，不要写回仓库。脚本不会自己连接生产。

对象存储用腾讯云 COS 的 S3 兼容接口，经 rclone 上传。样例是 `services/api/scripts/rclone-offsite.conf.example`。没有 rclone 的环境可以把同一条脚本跑在本地目录模式（`BACKUP_UPLOAD_BACKEND=local`），用来验证「备份、拷贝、校验、拉回、恢复」这条链路；那不是对象存储，不能代替异地副本。

### 10.1 开通步骤

按这个顺序做。尖括号都是占位，在控制台和服务器上替换。

1. 产品负责人开一个只放数据库备份的桶。桶名不要和业务文件桶混用。建议打开版本控制。
2. 建一个子账号，只授权这一个桶：`PutObject`、`GetObject`、`ListBucket`、`DeleteObject`。控制台里的 ListBucket 通常对应 CAM 的 `cos:GetBucket`（资源是桶本身）；对象上的 `cos:HeadObject` 给 rclone 校验用，如果策略里要单列，只加这一项。不要授权列出所有桶、建桶、删桶、改桶策略或 CAM 管理。
3. 加生命周期：当前版本和非当前版本都在 `BACKUP_REMOTE_RETENTION_DAYS` 天之后删除。版本控制会让已经删掉的对象继续留着，对外说「已经清干净」时要把这段天数算进第 8.1 节的等待期。
4. 把样例复制到 `/etc/ai-job-print/rclone-offsite.conf`，替换占位后执行 `chmod 600` 和 `chown root:root`。当前备份 unit 没有 `User=`，以 root 运行，属主就是 root。以后如果给 unit 加了 `User=`，属主改成那个用户，权限仍是 `600`。S3 兼容端点的形态是 `cos.<地域>.myqcloud.com`，地域用桶所在地域。
5. 在 API 的 `.env` 里写入第 10.2 节的变量。systemd 的 `EnvironmentFile` 会把它们传给 `backup-postgres.sh`；手动执行时，脚本也会在环境变量为空时从 `API_ENV_FILE` 读。不要把这些值写进 unit 或 cron 行。

### 10.2 环境变量

只写名字和含义。值由运维在服务器上设置。

| 变量 | 含义 |
|---|---|
| `BACKUP_DIR` | 本机 dump 目录。`backup-postgres.sh` 读取，缺省 `/var/backups/ai-job-print/postgres`。 |
| `RETENTION_DAYS` | 本机 dump 保留天数。`backup-postgres.sh` 读取，缺省 30。必须是 1 到 9999 的整数。 |
| `BACKUP_REMOTE_RETENTION_DAYS` | 异地副本保留天数。`backup-postgres.sh` 读取，缺省 30。不跟随 `RETENTION_DAYS`。只在开启上传时校验。 |
| `BACKUP_UPLOAD_ENABLED` | 为 `1` 时才上传异地副本。`backup-postgres.sh` 读取，缺省 `0`。不是 `1` 时本机备份照常成功，并只在标准错误提示一次。 |
| `BACKUP_UPLOAD_BACKEND` | `rclone` 或 `local`。`backup-postgres.sh` 与 `restore-offsite-drill.sh` 都读取。空着时：有 `BACKUP_OBJECT_URI` 就用 rclone，否则有 `BACKUP_MIRROR_DIR` 就用本地目录。 |
| `BACKUP_OBJECT_URI` | rclone 目的地，形如 `offsite:<桶名>/<前缀>`。两个脚本都读取。 |
| `BACKUP_MIRROR_DIR` | 本地目录模式的目的地。两个脚本都读取。没有 rclone 时用它把脚本跑通。 |
| `RCLONE_CONFIG` | 填好的 rclone 配置文件路径。两个脚本调用 rclone 时读取。文件权限 `600`。 |
| `ALERT_WEBHOOK_URL` | 企业微信机器人地址。`backup-postgres.sh` 读取。上传失败、校验失败、本机备份失败都会走这条现有告警。空则不发送。异地过期清理失败只告警，不把当天已校验通过的备份判失败。 |
| `API_ENV_FILE` | 上面这些变量在环境里为空时，`backup-postgres.sh` 从这个文件读。缺省 `/srv/ai-job-print/services/api/.env`。 |
| `DATABASE_URL` | 备份源库连接串。`backup-postgres.sh` 在 `POSTGRES_URL` 为空时读取。 |
| `POSTGRES_URL` | 备份源库连接串，优先于 `DATABASE_URL`。`backup-postgres.sh` 读取。 |
| `DRILL_DATABASE_URL` | 要新建的临时库连接串，库名必须含小写 `drill`，并且只由字母、数字、下划线组成。`restore-offsite-drill.sh` 在没有参数时读取。也可以把这条连接串当作脚本的第一个参数。 |
| `DRILL_ADMIN_URL` | 用来建库和删库的维护库连接串，不能是临时库本身。`restore-offsite-drill.sh` 读取。空则把目标地址的库名换成 `postgres`。 |
| `DRILL_SOURCE` | `local` 或 `rclone`。`restore-offsite-drill.sh` 读取。空则按 `BACKUP_UPLOAD_BACKEND`、`BACKUP_OBJECT_URI`、`BACKUP_MIRROR_DIR` 决定。 |
| `DRILL_WORK_DIR` | 把 dump 拉到这个目录。`restore-offsite-drill.sh` 读取。空则用临时目录。这里的文件是整库副本，留档后删除。 |
| `DRILL_RECORD_PATH` | 演练记录文件。`restore-offsite-drill.sh` 读取。空则写在工作目录里的 `drill-record.txt`。 |
| `DRILL_DROP_DATABASE` | 为 `1` 时，核对结束后删除临时库。`restore-offsite-drill.sh` 读取，缺省 `0`。只删除库名含 `drill` 的那一个。 |
| `DRILL_MIGRATIONS_DIR` | 用来对照的 PostgreSQL 迁移目录。`restore-offsite-drill.sh` 读取。缺省是脚本旁边的 `prisma/postgres/migrations`。演练机上的代码版本要和做备份时的生产版本一致，否则「迁移一致」会失败。 |

未开启上传时，脚本在 `BACKUP_DIR/.offsite-upload-disabled-notice` 写下标记，以后不再重复提示。删掉这个标记会再提示一次。

### 10.3 首次跑通

1. `ls -l /etc/ai-job-print/rclone-offsite.conf` 显示权限 `600`，属主是运行备份的用户。
2. `rclone --config "$RCLONE_CONFIG" lsf "$BACKUP_OBJECT_URI"` 退出码为 0。空桶也可以。
3. 手动执行 `services/api/scripts/backup-postgres.sh`。标准输出里要有 `BACKUP_OFFSITE_OK` 和 `BACKUP_OK`。`BACKUP_OFFSITE_OK` 表示上传之后 `rclone check` 通过（对象没有可用校验和时，rclone 退回到比对大小）。
4. 桶里能看到当天的 `postgres_<UTC 日期>.dump`。
5. 同一天再跑一次，仍然是 `BACKUP_OK`，对象被覆盖成新的那一份。
6. 告警不要在生产上故意把备份弄失败来试。要抽查时，在维护窗口把 `BACKUP_OBJECT_URI` 临时指到一个不存在的前缀，确认企业微信收到「数据库每日备份失败」、进程退出码非 0，然后立刻改回。

本地目录模式的对应输出是 `BACKUP_OFFSITE_OK: checked local ... sha256=...`。它比对字节数和 SHA-256。

### 10.4 另一台机器上的恢复演练

在一台没有这份生产库的机器上做。安装与生产主版本一致的 PostgreSQL。用 rclone 时还要安装 rclone，并放一份权限 `600` 的配置（至少要有 GetObject 和 ListBucket）。代码用做备份时的同一个版本。

1. 导出 `BACKUP_OBJECT_URI`、`RCLONE_CONFIG`，或者在没有 rclone 时导出 `DRILL_SOURCE=local` 和 `BACKUP_MIRROR_DIR`。
2. 准备 `DRILL_ADMIN_URL`，指向已经存在的维护库。常见是 `postgres`。`initdb -U drill` 只是把超级用户叫做 drill，默认库往往仍是 `postgres`；连不上时改用 `template1`。
3. 目标连接串的库名必须含 `drill`，例如 `offsite_drill`。脚本发现库已经存在会拒绝，避免覆盖。不要把生产库的连接串传进去。
4. 执行 `services/api/scripts/restore-offsite-drill.sh '<目标连接串>'`。库名不含 `drill` 时，脚本在拉取之前退出，退出码 2。
5. 脚本拉最新一份 `postgres_YYYY-MM-DD.dump` 到 `DRILL_WORK_DIR`，用 `pg_restore -l` 校验，建库，再以 `--no-owner --no-acl` 恢复。然后只读核对：public 表数、`_prisma_migrations` / `User` / `Organization` / `Terminal` 的行数、迁移表最新一条是否等于仓库迁移目录里排序后的最后一个目录名。
6. 需要脚本删掉临时库时加上 `DRILL_DROP_DATABASE=1`。
7. 把演练记录另存。工作目录里的 dump 含有个人数据，留档后删除整个工作目录。

记录模板（脚本按这个字段写出）：

```text
异地恢复演练记录
时间: <YYYY-MM-DD HH:MM:SS ±HHMM>
文件名: postgres_<日期>.dump
大小: <字节数>
校验结果: pg_restore -l 通过；sha256=<校验和>
耗时: <秒> 秒
核对结果: 表数=<n>；_prisma_migrations=<n>；User=<n>；Organization=<n>；Terminal=<n>；库迁移=<名称>；仓库迁移=<名称>；迁移一致=是
临时库: <库名含 drill>
删除临时库: 是
结论: 通过
```

结论不是「通过」就不要当成恢复演练成功。迁移不一致时，先核对演练机的代码版本是不是备份当时的版本。

### 10.5 每季度演练

每季度做一次，下一次不晚于上一次之后的三个月。机器不能是生产服务器。步骤用第 10.4 节，记录留在运维档案里。演练完删除临时库和拉下来的 dump。不在生产库上执行 `restore-offsite-drill.sh`。

