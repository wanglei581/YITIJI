# 用户文件与简历资产预生产 Gate 2 执行审批包

> 状态：APPROVAL REQUIRED，尚未执行。
> 适用候选：`9146fa1c`，即 `codex/file-assets-preprod-integration`。
> 当前预生产事实：Gate 1 只读预检显示预生产部署源自报仍为 `6b055d6b`，且 `/srv/ai-job-print` 是 `local-git-archive` 展开目录，不是 Git 仓库。
> 口径：本文件只用于 Gate 2 远端执行前确认，不代表 Gate 2、Gate 3/Gate 4、正式生产、试运营或 Windows 真机验收完成。

## 一、请确认的目标

确认后，仅在预生产环境执行 Gate 2 候选部署刷新：

- 从本地 `9146fa1c` 生成 `git archive` 候选包。
- 上传候选包到预生产 `/srv`。
- 展开候选目录，复制现有运行时和前端构建时 env 文件但不打印内容。
- 安装依赖、生成 Prisma client、构建 API/Kiosk/Admin。
- 在执行 PostgreSQL schema migration 前生成 DB 备份。
- 只应用候选需要的 additive PostgreSQL migrations。
- 原子重命名当前 `/srv/ai-job-print` 为回滚目录，再提升候选目录。
- 重启既有 PM2 进程 `ai-job-print-api`。
- 复验本机和公网 health、API dist hash、`DEPLOY_SOURCE.txt` 元数据和 PM2 online。

## 二、明确非目标

Gate 2 不做以下事项：

- 不修改正式生产域名、证书、DNS、nginx。
- 不改云密钥、短信、OCR、TRTC、ASR/TTS 配置。
- 不修改 COS 生命周期规则。
- 不执行 COS live put/head/get/signed-url/delete。
- 不创建、上传、修改或删除会员测试文件。
- 不写业务数据、保存期限、删除状态或审计记录；仅允许 schema migration。
- 不执行浏览器账号验收。
- 不执行 Windows 真机、Terminal Agent、奔图打印、扫描、断网/重启恢复验收。
- 不宣布试运营或商用闭环完成。

## 三、允许修改的远端内容

用户确认 Gate 2 后，允许修改的远端范围仅限：

| 类型 | 路径或对象 | 说明 |
| --- | --- | --- |
| 候选包 | `/srv/yitiji-preprod-9146fa1c.tar.gz` | 从本地 commit `9146fa1c` 生成裁剪运行时归档并上传；不包含 `docs/`、`.ccg/`、示例 env 文件或本地工具状态。 |
| 候选包校验 | `/srv/yitiji-preprod-9146fa1c.sha256` | 用于远端 `sha256sum -c`。 |
| 共享时间戳 | `/srv/yitiji-gate2-ts` | 统一备份目录、失败目录、DB 备份命名。 |
| 候选目录 | `/srv/ai-job-print-candidate-9146fa1c` | 构建完成前不替换当前应用目录。 |
| DB 备份 | `/srv/db-backups/pre-file-assets-gate2-<timestamp>.dump` | migration 前必须存在且非空。 |
| 回滚目录 | `/srv/ai-job-print-prev-<timestamp>` | 原当前应用目录通过 `mv` 原子改名保存。 |
| 应用目录 | `/srv/ai-job-print` | 仅在构建、备份和 migration 成功后提升候选目录。 |
| 构建产物 | `/srv/ai-job-print/services/api/dist`、`apps/kiosk/dist`、`apps/admin/dist` | 由候选代码构建产生。 |
| 依赖目录 | `/srv/ai-job-print/node_modules` 及 workspace 相关依赖 | 由 `pnpm install --frozen-lockfile` 产生。 |
| 部署元数据 | `/srv/ai-job-print/DEPLOY_SOURCE.txt` | 写入 commit、artifact hash、API dist hash、built_at、previous。 |
| PostgreSQL schema | 仅候选中已审查的 additive migrations | 预期只包含 `20260621154500_file_asset_retention_model` 与 `20260621162500_file_retention_expires_nullable`。 |
| PM2 | 既有 `ai-job-print-api` 进程 | 仅允许 restart，不新增进程，不打印完整环境变量。 |

本地临时产物允许写入 `/tmp/yitiji-preprod-9146fa1c.tar.gz` 与 `/tmp/yitiji-preprod-9146fa1c.sha256`，仅用于上传到预生产 `/srv`；不得写入仓库或提交到 Git。归档生成必须使用 `gzip -n -9`，确保 sha256 可复现。

## 四、禁止修改的远端内容

- `.env` 文件内容；只允许复制既有文件到候选目录，不允许编辑或输出内容。
- PostgreSQL 业务行数据、Redis 数据、COS 对象。
- COS bucket 生命周期规则、CAM 权限、云密钥。
- nginx、证书、域名解析、hosts 以外的正式域名配置。
- 测试会员账号、文件资产、保存期限、删除状态、AuditLog。
- Windows 设备、Terminal Agent、打印机和扫描仪配置。

## 五、执行前置确认项

执行前必须再次确认并记录：

| 确认项 | 通过标准 |
| --- | --- |
| 本地候选存在 | `git cat-file -e 9146fa1c^{commit}` 通过。 |
| 本地工作区干净 | 无无关未提交变更。 |
| 预生产资源隔离 | `DATABASE_URL` 或 `POSTGRES_URL` 指向 PostgreSQL 预生产资源；`REDIS_URL`、COS bucket/region 为预生产资源；只记录脱敏指纹，不打印值。 |
| 当前应用形态 | `/srv/ai-job-print` 仍为 `local-git-archive` 展开目录，当前部署源自报为 `6b055d6b` 或记录实际差异。 |
| 磁盘空间 | `/srv` 可用空间至少满足 `current_app_mb * 2 + 2048`。 |
| API env | `/srv/ai-job-print/services/api/.env` 存在且权限正常；不输出内容。 |
| 前端 build env | 记录存在的 `.env` / `.env.local` 路径；如 Kiosk build-time env 缺失，需要停下确认是否使用 inline `VITE_*`。 |
| DB 备份工具 | `pg_dump` 可用，且备份目标与 Prisma PostgreSQL deploy 使用同一个 `POSTGRES_URL ?? DATABASE_URL`。 |
| pending migrations | pending 只允许为空，或只包含两个文件资产 migration。 |
| 前端生产构建 guard | Kiosk build 时显式 `VITE_API_MODE=http`、`VITE_API_BASE_URL=/api/v1`、`VITE_USE_TRTC_CALL=true`；Admin build 时显式 `VITE_API_MODE=http`、`VITE_API_BASE_URL=/api/v1`；除非另有审定，不允许启用纯文字逃生口。 |

说明：`VITE_API_MODE=http` 是 Kiosk/Admin 生产构建的代码门禁；`VITE_API_BASE_URL=/api/v1` 是 Gate 2 执行策略要求，用于避免依赖默认回落或未来配置变化。

## 六、验证方式

Gate 2 执行后必须留存以下脱敏证据：

| 验证点 | 证据 |
| --- | --- |
| 候选包 | 本地和远端 sha256 一致。 |
| DB 备份 | `/srv/db-backups/pre-file-assets-gate2-<timestamp>.dump` 存在且非空。 |
| migration | `db:pg:deploy` 通过，最终 `prisma migrate status` up to date。 |
| 构建 | API/Kiosk/Admin build 通过；API dist hash 记录。 |
| 目录提升 | `/srv/ai-job-print-prev-<timestamp>` 与新的 `/srv/ai-job-print` 均存在。 |
| PM2 | `pm2 status ai-job-print-api` 显示 online；不得使用会打印 env 的完整 `pm2 describe`。 |
| health | `127.0.0.1:3010/api/v1/health` 和公网 `/api/v1/health` 均返回 `success=true`、`db=postgres`。 |
| 部署元数据 | `DEPLOY_SOURCE.txt` 记录 `commit=9146fa1c`、artifact hash、API dist hash；但仍只作为元数据，不替代运行证据。 |
| 敏感信息 | 日志不得包含密钥、token、完整手机号、签名 URL 查询串、简历正文、完整数据库连接串。 |

## 七、停止条件

出现任一情况必须停止 Gate 2，不继续 Gate 3/Gate 4：

- 资源隔离无法证明。
- `.env` 缺失或权限异常。
- 磁盘空间不足。
- 候选包 sha256 校验失败。
- Kiosk build-time env 缺失且无法确认 prior build 方式。
- Kiosk/Admin build 未显式使用 `VITE_API_MODE=http`，或未按 Gate 2 执行策略显式设置 `VITE_API_BASE_URL=/api/v1`。
- Kiosk build 未显式启用 `VITE_USE_TRTC_CALL=true`，且没有审定的纯文字例外。
- `pg_dump` 失败或 DB 备份为空。
- pending migrations 包含非预期 migration。
- `db:pg:deploy` 失败。
- 依赖安装、Prisma client 生成、API/Kiosk/Admin build 任一失败。
- PM2 restart 后 health 不返回 `db=postgres`。
- 日志或截图泄露密钥、token、完整手机号、签名 URL 查询串、简历正文。
- 需要修改本审批包“禁止修改”范围内的资源。

## 八、回滚方式

Gate 2 的代码回滚路径：

1. 如果还未提升候选目录：删除 `/srv/ai-job-print-candidate-9146fa1c` 和候选包，保留当前 `/srv/ai-job-print` 不动。
2. 如果已经提升候选目录但 health 失败：
   - 将失败目录移动到 `/srv/ai-job-print-failed-<timestamp>`。
   - 将 `/srv/ai-job-print-prev-<timestamp>` 恢复为 `/srv/ai-job-print`。
   - `pm2 restart ai-job-print-api`。
   - 复验本机和公网 health 均为 `db=postgres`。
3. PostgreSQL additive migrations 不随代码回滚自动撤销；旧代码应忽略新增 nullable/defaulted 字段。
4. 只有在 schema/data 异常被确认且无法通过代码回滚恢复时，才基于 `/srv/db-backups/pre-file-assets-gate2-<timestamp>.dump` 做人工数据库恢复决策；不得无备份手工改表。

## 九、用户确认口径

只有用户明确确认以下内容后，才能执行 Gate 2 远端操作：

```text
确认执行用户文件与简历资产预生产 Gate 2。
目标：仅刷新预生产 `/srv/ai-job-print` 到候选 `9146fa1c`。
同意：上传候选包、展开候选目录、复制既有 env 文件、安装依赖、构建 API/Kiosk/Admin、备份 PostgreSQL、执行候选 additive migrations、原子切换应用目录、重启既有 PM2 进程并复验 health。
不同意：修改正式生产、域名/证书/nginx、云密钥、短信/OCR/TRTC/ASR/TTS、COS 生命周期、业务数据、测试账号文件、Windows 真机或打印扫描配置。
已知：Gate 2 通过后仍需另行确认 Gate 3/Gate 4；Gate 2 通过不等于试运营或商用闭环完成。
```

## 十、Gate 2 通过后的下一步

Gate 2 通过后，才能进入：

1. Gate 3 自动命令证据：`G3-01` 至 `G3-08`。
2. Gate 4 浏览器账号验收：`G4-01` 至 `G4-10`。
3. 正式生产外部 P0：域名/HTTPS、腾讯短信审核后 E2E、OCR/AI/TRTC/ASR/TTS live。
4. Windows 真机和奔图打印扫描验收。
5. 1 台终端 + 1 台打印机小范围试运营。
