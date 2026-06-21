# 用户文件与简历资产预生产 Gate 2 候选部署刷新方案

## 背景

Gate 1 只读预检确认：

- 预生产主机、PM2 API 进程和 PostgreSQL health 可达。
- `/srv/ai-job-print` 不是 Git 仓库，而是 `local-git-archive` 展开目录。
- `DEPLOY_SOURCE.txt` 自报部署源 commit 为 `6b055d6b`，不是目标候选 `9146fa1c`。

因此 Gate 2 不能按早期草案在服务器目录执行 `git checkout --detach 9146fa1c`。本方案改为本地从目标 commit 生成归档包，上传到预生产 `/srv`，在服务器上展开候选目录、保留 `.env` 与本地运行配置、安装依赖、生成 Prisma client、构建、备份 PostgreSQL、执行候选所需 additive migrations、原子重命名应用目录、重启 PM2 并复验 health。

## 本轮目标

- 设计可执行的 Gate 2 候选部署刷新步骤。
- 明确远端允许修改范围、验证方式、停止条件和回滚方式。
- 更新执行记录，让后续执行者不会误用 Git checkout 流程。
- 仅提交方案与审查记录，不执行远端部署刷新。

## 非目标

- 本轮不上传归档包、不替换 `/srv/ai-job-print`、不重启 PM2。
- 不运行 seed、`verify:cos:live`、浏览器账号验收或文件上传。
- 不写业务数据；Gate 2 只允许在数据库备份后执行 `9146fa1c` 所需 PostgreSQL additive schema migration。
- 不修改 `.env`、云密钥、COS 生命周期、域名、证书、短信、OCR、TRTC、ASR/TTS 配置。
- 不宣称预生产文件资产验收、正式生产上线、试运营或 Windows 真机验收完成。

## 允许修改文件

- `.ccg/tasks/file-assets-preprod-gate2-plan/*`
- `docs/superpowers/plans/2026-06-22-file-assets-preprod-gate2-refresh.md`
- `docs/acceptance/user-file-assets-preprod-execution-record.md`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`

## 远端允许修改范围（仅用户确认后）

- 新增候选归档包：`/srv/yitiji-preprod-9146fa1c.tar.gz`
- 新增数据库备份：`/srv/db-backups/pre-file-assets-gate2-<timestamp>.dump`
- 通过原子重命名新增应用备份目录：`/srv/ai-job-print-prev-<timestamp>`
- 替换当前应用目录：`/srv/ai-job-print`
- 更新部署源记录：`/srv/ai-job-print/DEPLOY_SOURCE.txt`
- 安装或更新依赖：`/srv/ai-job-print/node_modules` 与 workspace 子目录依赖
- 生成构建产物：`/srv/ai-job-print/services/api/dist`、`apps/*/dist`
- 执行 PostgreSQL schema migration：仅限 `db:pg:deploy` 应用 `9146fa1c` 中已审查的 additive migrations
- PM2 只允许重启既有进程：`ai-job-print-api`

禁止修改：

- PostgreSQL 业务数据、Redis 数据、COS 对象、COS 生命周期规则
- `.env` 内容、云密钥、短信/OCR/TRTC/ASR/TTS 配置
- nginx 配置、域名、证书
- Windows 真机、Terminal Agent、打印机或扫描配置

## 执行前必须确认

- 目标候选：`9146fa1c`
- 当前部署源自报：`6b055d6b`
- 预生产 DB、Redis、COS 与正式生产资源隔离；只能记录脱敏指纹，不打印密钥。PostgreSQL migration 目标按 `POSTGRES_URL ?? DATABASE_URL` 判定，备份必须使用同一个 URL。
- 当前 `/srv/ai-job-print/services/api/.env` 存在且权限正常；复制到候选目录时不输出内容。
- 若存在前端构建时 `.env` / `.env.local`，必须按路径复制到候选目录，不输出内容。
- 当前 PM2 进程 `ai-job-print-api` online；备份目录有足够磁盘空间。
- `9146fa1c` 相对 `6b055d6b` 存在 PostgreSQL schema migration；若不允许执行 migration，停止 Gate 2，不部署代码。

## 停止条件

- 候选归档无法生成或校验 sha256。
- 服务器磁盘空间不足以同时保存当前目录、候选目录和候选包。
- `.env` 缺失或权限异常。
- 资源隔离无法证明。
- `prisma migrate status` 无法连接 PostgreSQL，或 pending migrations 与候选预期不一致；候选预期只允许 `20260621154500_file_asset_retention_model` 与 `20260621162500_file_retention_expires_nullable`。
- `pg_dump` 备份失败。
- `db:pg:deploy` 失败。
- `pnpm install --frozen-lockfile`、Prisma client 生成、API/Kiosk/Admin 构建任一失败。
- Kiosk production build 未显式设置 `VITE_USE_TRTC_CALL=true`，且没有审定的纯文字例外。
- PM2 restart 后 health 不返回 `db=postgres`。
- 任意命令输出密钥、token、签名 URL 查询串、真实手机号或简历正文。

## 回滚方式

- Gate 2 不触碰业务数据/COS；但会在确认后执行 additive PostgreSQL schema migration。
- 代码回滚不自动删除新增列或放回 `expiresAt NOT NULL`；这些 additive schema changes 对旧代码应为兼容状态，旧代码会忽略新增列。
- 如 migration 失败且数据库处于异常状态，使用 `/srv/db-backups/pre-file-assets-gate2-<timestamp>.dump` 做人工恢复决策；不得无备份手工改表。
- 若替换目录前失败：删除候选目录和候选包，保留当前 `/srv/ai-job-print` 不动。
- 若替换目录后失败：
  1. 停止当前 PM2 进程或保持失败状态。
  2. 将失败目录移动到 `/srv/ai-job-print-failed-<timestamp>`。
  3. 将最近备份目录恢复为 `/srv/ai-job-print`。
  4. `pm2 restart ai-job-print-api`。
  5. 复验 `http://127.0.0.1:3010/api/v1/health` 与公网 health 均为 `db=postgres`。

## 本地验证

- `pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance`
- `git diff --check`
- 禁词与敏感信息扫描
- Claude + Antigravity 双模型审查无 Critical
