# 用户文件与简历资产预生产执行记录

> 状态：PREPRODUCTION GATE 4 API-LEVEL ACCEPTANCE PASSED WITH NOTES；Gate 2 已部署，Gate 3 自动命令门禁已通过，Gate 4 受控账号/API 级验收已通过；完整浏览器截图验收、正式生产、试运营和 Windows 真机尚未执行。
> 基线候选：当前本地 Gate 2/Gate 3/Gate 0 门禁收口链 / `2187f6a7`（包含 `9146fa1c` 和上一代 `9a702981` 之后的本地门禁与证据口径修正）
> 执行分支：`codex/file-assets-gate2-execution`
> 口径：本文件记录预生产 Gate 2/Gate 3/Gate 4 API 级执行证据和后续证据入口，不代表正式生产部署、真实试运营或 Windows 真机验收完成。

## 一、目标和非目标

目标：

- 基于 `2187f6a7` 在预生产环境执行用户文件与简历资产验收；Gate 1 历史实测仍保留当时目标候选 `9146fa1c` 的记录。
- 覆盖 PostgreSQL、COS 私有桶、会员账号、原始文件、优化后或修改后文件、90 天 / 180 天 / 长期保存、重登查看、删除三态一致、过期清理、`long_term` 防误删和 AuditLog 审计。
- 留存命令日志、浏览器截图、COS 控制台截图、PostgreSQL 抽样和审计查询结果，所有证据必须脱敏。

非目标：

- 不新增业务功能、API、数据库 schema、Kiosk 页面或 Admin 页面。
- 不修改 COS 生命周期规则、云密钥、短信、OCR、TRTC、ASR/TTS、域名或证书。
- 不把本地 SQLite、mock verify、静态文档检查或阶段性预生产结果写成真实试运营完成。
- 不验收 Windows 真机、Terminal Agent、奔图打印真实出纸或扫描链路；这些仍按设备验收清单另行执行。

## 二、操作许可边界

| Gate | 操作类型 | 是否可在本任务直接执行 | 说明 |
| --- | --- | --- | --- |
| Gate 0 | 本地静态门禁 | 是 | 只运行本地文档/静态检查，不连接服务器或云资源。 |
| Gate 1 | 预生产只读预检 | 需计划审查通过 | 只读 SSH、PM2 状态、health、commit，不改服务器。 |
| Gate 2 | 候选部署或刷新 | 已执行 | 已改变预生产代码、构建产物、PostgreSQL schema 和进程状态；未写业务数据/COS。 |
| Gate 3 | 自动命令门禁 | 已执行 | 安全子集已通过；预生产 COS bucket 切换后，`verify:cos:live` 已通过 put/head/get/signed-url/delete。 |
| Gate 4 | 账号/API 验收 | 已执行（B 方案） | 腾讯短信审核未完成，用户确认临时切 `SMS_PROVIDER=log`；已创建受控会员、测试文件、保存期限、删除状态和审计记录；执行后已回滚 `SMS_PROVIDER=tencent`。完整浏览器截图证据仍需补齐，不能视为完整 Gate 4 浏览器验收。 |

## 三、Gate 0 本地静态门禁

| 项目 | 命令 | 结果 | 证据 |
| --- | --- | --- | --- |
| 当前分支 | `git status --short --branch` | PASS | 2026-06-22：`codex/file-assets-preprod-execution`，HEAD `9146fa1c`；仅本任务文档为未提交变更。 |
| 静态证据包检查 | `pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance` | PASS | 2026-06-22：脚本输出 `verify:file-assets-trial-acceptance passed`，并明确 `STATIC DOC CHECK ONLY`。 |
| whitespace | `git diff --check` | PASS | 2026-06-22：无输出。 |

说明：`verify:file-assets-trial-acceptance` 依赖完整仓库文档目录，只作为 Gate 0 本地/仓库侧静态门禁；Gate 2 裁剪运行时归档不包含 `docs/` 或 `.ccg/`，因此 Gate 3 远端自动命令清单不再执行该命令。

## 四、Gate 1 预生产只读预检

> 2026-06-22 已执行只读预检。仅执行 SSH/curl 只读命令；未部署、未拉取、未 checkout、未重启 PM2、未迁移数据库、未写 COS/DB。

| 项目 | 证据要求 | 结果 |
| --- | --- | --- |
| 主机与时间 | `hostname`、`date`，确认时区 | PASS：主机名已脱敏为 `<PREPROD_HOSTNAME>`，服务器时间 `2026-06-22 01:53 CST`。 |
| 部署 commit | `/srv/ai-job-print` 下 `git rev-parse --short HEAD` | STOP：`/srv/ai-job-print` 不是 Git 仓库；`DEPLOY_SOURCE.txt` 显示部署源 commit 为 `6b055d6b`，不是目标候选 `9146fa1c`。`DEPLOY_SOURCE.txt` 是部署脚本自报元数据，不等于 Git HEAD 校验；实际运行代码与该 commit 的一致性需在 Gate 2 重新构建/部署时核验。 |
| 工作区状态 | 服务器工作区不得有不明改动 | N/A：部署目录为 `local-git-archive` 展开目录，无 `.git`；未发现 `/srv` 三层内 `.git` 目录。 |
| PM2 状态 | `ai-job-print-api` 在线状态 | PASS：PM2 `ai-job-print-api` online，脚本路径 `/srv/ai-job-print/services/api/dist/main.js`，cwd `/srv/ai-job-print/services/api`。 |
| health | `GET /api/v1/health` 显示 PostgreSQL | PASS：本机 `127.0.0.1:3010/api/v1/health` 与公网 `http://<PREPROD_HOST>/api/v1/health` 均返回 `success=true`、`status=ok`、`db=postgres`。 |

Gate 1 结论：

- 预生产主机、API 进程和 PostgreSQL health 可达。
- 当前部署源自报仍是 `6b055d6b` 阶段性预生产包，不是用户文件资产候选 `9146fa1c`；实际运行代码一致性待 Gate 2 重新部署时核验。
- 已触发计划停止条件：实际部署 commit 不是目标候选；本轮停止在 Gate 1，不执行 Gate 2 候选部署或刷新。

## 五、Gate 2 候选部署或刷新

> 已执行。Gate 1 曾显示预生产未部署当时目标候选 `9146fa1c`；本轮 Gate 2 执行候选 `2187f6a7` 已刷新到预生产 `/srv/ai-job-print`。
> 2026-06-22 已补充 Gate 2 刷新方案：由于 `/srv/ai-job-print` 不是 Git 仓库，执行使用本地 `git archive` 生成 `2187f6a7` 候选归档包、上传到 `/srv`、展开候选目录、保留运行时和前端构建时 env 文件、生成 Prisma client、构建、备份 PostgreSQL、执行候选所需 additive migrations、原子重命名当前目录为回滚目录、提升候选目录并重启既有 PM2 进程。
> 2026-06-22 已新增 [Gate 2 执行审批包](./user-file-assets-gate2-approval-package.md)：执行前已按审批包确认目标、非目标、远端允许修改内容、禁止事项、验证方式、停止条件和回滚方式。
> 2026-06-22 已完成 [Gate 2 本地候选包预检](./user-file-assets-gate2-local-artifact-check.md)：完整归档会带入 `docs/` 和 `.ccg/` 等非运行时内容，Gate 2 计划已修正为裁剪运行时归档并使用 `gzip -n -9` 生成可复现 sha256；该预检未连接预生产或修改远端状态。
> 2026-06-22 已完成 [Gate 2 裁剪包本地构建预检](./user-file-assets-gate2-runtime-build-check.md)：`2187f6a7` 裁剪包在 `/tmp` 解压目录中完成 install、Prisma client 生成、API build、Kiosk build、Admin build；预检确认 Kiosk/Admin 生产构建必须显式设置 `VITE_API_MODE=http` 与 `VITE_API_BASE_URL=/api/v1`，Kiosk 还必须显式 `VITE_USE_TRTC_CALL=true`。
> 2026-06-22 已完成 [Gate 2 执行前只读就绪复核](./user-file-assets-gate2-readiness-recheck.md)：预生产当时仍自报部署源 `6b055d6b`，本机和公网 health 均为 `db=postgres`，磁盘预算、API env、`node` / `pnpm` / `pg_dump` / `pm2`、PostgreSQL/Redis/Tencent COS 脱敏指纹均满足执行前只读检查；该复核本身未上传包、未写 `/srv`、未迁移数据库、未重启 PM2。
> 2026-06-22 用户已明确确认 `确认执行用户文件与简历资产预生产 Gate 2。`；执行前已复述目标、非目标、允许修改范围、验证方式和回滚方式，并完成 Claude + Antigravity 双模型执行前审查，结论均为 GO。

| 项目 | 证据要求 | 结果 |
| --- | --- | --- |
| 部署前 commit | 记录上一部署源自报 commit、备份目录和回滚路径；`DEPLOY_SOURCE.txt` 仅为自报元数据 | PASS：执行前自报 `commit=6b055d6b`；共享时间戳 `20260622120958`；回滚目录为 `/srv/ai-job-print-prev-20260622120958`。 |
| 资源隔离 | 预生产 `DATABASE_URL`、`REDIS_URL`、COS bucket/region 指向隔离资源；只记录脱敏指纹，不打印密钥 | PASS：`DATABASE_URL` / `POSTGRES_URL` hint 为 `postgres`，`REDIS_URL` 为 set，`FILE_STORAGE_DRIVER=cos`，`TENCENT_COS_BUCKET` / `TENCENT_COS_REGION` 为 set，`NODE_ENV=staging`；只记录短指纹。 |
| 候选归档 | 本地从 `2187f6a7` 生成裁剪运行时归档 `/tmp/yitiji-preprod-2187f6a7.tar.gz` 和 sha256，并上传到 `/srv`；归档不包含 `docs/`、`.ccg/`、示例 env 文件或本地工具状态 | PASS：sha256 `6019de34f837850b22eb7ab12f9b0d25ea6fa14bac3fcfc827441803123e4b07`；远端 `sha256sum -c` 通过。 |
| PostgreSQL 备份 | 迁移前生成 `/srv/db-backups/pre-file-assets-gate2-<timestamp>.dump`，不打印连接串 | PASS：`/srv/db-backups/pre-file-assets-gate2-20260622120958.dump` 存在且非空；`pg_restore -l` 可读；未打印连接串、用户名或密码。 |
| PostgreSQL migration | 执行候选 `db:pg:deploy`；仅应用 additive schema migration，不写业务数据 | PASS：执行前 pending 仅为 `20260621154500_file_asset_retention_model` 与 `20260621162500_file_retention_expires_nullable`；两项已应用；最终 `prisma migrate status` 为 `Database schema is up to date!`。 |
| 依赖安装 | `pnpm install --frozen-lockfile` | PASS：候选目录安装成功。 |
| Prisma client | `prisma generate` 与 `db:pg:generate` | PASS：SQLite 与 PostgreSQL Prisma clients 均生成成功。 |
| 构建 | API / Kiosk / Admin build；Kiosk/Admin production build 明确 `VITE_API_MODE=http`、`VITE_API_BASE_URL=/api/v1`；Kiosk production build 明确 `VITE_USE_TRTC_CALL=true` 或有审定的纯文字例外 | PASS：API build、Kiosk build、Admin build 均通过；Kiosk 显式 `VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 VITE_USE_TRTC_CALL=true`，产物包含 `AiAdvisorCall` / `trtc` chunk。 |
| 进程重启 | PM2 restart、API dist hash、PM2 online 与 health 复验；不得打印完整 `pm2 describe` 环境变量 | PASS：PM2 restart 后 online；首次立即 health 命中启动瞬间未监听，随后重试成功；本机与公网 health 均为 `success=true`、`db=postgres`；API dist hash `d309c660b685680409ddf441f8ec5401d4810d61ad2162bc666bf7ab7e27b5b8` 匹配；未打印 `pm2 describe` 环境。 |

Gate 2 结论：

```text
PREPRODUCTION GATE 2 PASSED
Gate 2 执行候选 2187f6a7
预生产部署源已刷新为 commit=2187f6a7
PostgreSQL schema 已应用文件资产保存期限 additive migrations
本机/公网 health 均为 db=postgres
Gate 3/Gate 4 尚未执行
不得宣称正式生产、试运营或 Windows 真机验收完成
```

## 六、Gate 3 自动命令门禁

> 已执行（自动命令门禁，含 G3-06 COS live）。所有日志进入证据包前必须脱敏，不得提交 `.env`、token、签名 URL 查询串或简历正文。
> 详细证据编号、日志命名和脱敏规则见 [Gate 3/Gate 4 证据执行模板](./user-file-assets-gate3-gate4-evidence-runbook.md)。

| 命令 | 结果 | 证据 |
| --- | --- | --- |
| `pnpm --filter @ai-job-print/api verify:production-runtime-gates` | PASS | 2026-06-22 预生产运行时包执行通过；证据目录 `/srv/ai-job-print-evidence/file-assets-gate34-20260622123254`，日志 `G3-01-runtime-gates-20260622123254.log`。 |
| `pnpm --filter @ai-job-print/api verify:production-db-guard` | PASS | 2026-06-22 预生产运行时包执行通过；证据目录 `/srv/ai-job-print-evidence/file-assets-gate34-20260622123254`，日志 `G3-02-db-guard-20260622123254.log`。 |
| `pnpm --filter @ai-job-print/api verify:cos-lifecycle-policy` | PASS（本地完整仓库）/ REMOTE N/A | 2026-06-22 本地完整仓库执行通过，证据目录 `/tmp/ai-job-print-gate34-local-20260622123403`；预生产裁剪运行时包不包含 `docs/`，远端直接执行会失败，不能为运行该 docs-only 门禁把 `docs/` 加回运行时包。 |
| `pnpm --filter @ai-job-print/api verify:file-retention` | PASS | 2026-06-22 预生产运行时包执行通过；证据目录 `/srv/ai-job-print-evidence/file-assets-gate34-runtime-static-20260622123427`，日志 `G3-04-file-retention-20260622123427.log`。 |
| `pnpm --filter @ai-job-print/api verify:file-lifecycle-summary` | PASS | 2026-06-22 预生产运行时包执行通过；证据目录 `/srv/ai-job-print-evidence/file-assets-gate34-runtime-static-20260622123427`，日志 `G3-05-file-lifecycle-summary-20260622123427.log`。 |
| `pnpm --filter @ai-job-print/api verify:cos:live` | PASS | 2026-06-22 已先切换到预生产隔离 COS：bucket 指纹 `d855f7e900`、`strict_nonprod=true`、`prod_label=false`、region `ap-guangzhou`；远端 `.env` 备份 `/srv/ai-job-print-env-backups/api.env.20260622134416.bak`；命令执行 put/head/get/预签名下载/delete 全部通过，删除后对象不存在；未打印密钥或完整签名 URL 查询串。 |
| `pnpm --filter @ai-job-print/api verify:member-assets-c2d` | PASS | 2026-06-22 预生产运行时包执行通过；证据目录 `/srv/ai-job-print-evidence/file-assets-gate34-runtime-20260622123346`，日志 `G3-07-member-assets-c2d-20260622123346.log`；单次命令显式覆盖 `SMS_PROVIDER=log`，脚本强制 `FILE_STORAGE_DRIVER=local`，不触达 COS 或真实短信。 |
| `pnpm --filter @ai-job-print/api verify:audit-logs` | PASS | 2026-06-22 预生产运行时包执行通过；证据目录 `/srv/ai-job-print-evidence/file-assets-gate34-runtime-20260622123346`，日志 `G3-09-audit-logs-20260622123346.log`；该命令仅证明 AuditLog 基础审计门禁，不能替代 Gate 4 针对本轮测试文件的审计抽样。 |

Gate 3 结论：

```text
PREPRODUCTION GATE 3 PASSED FOR AUTOMATED COMMANDS
已通过：G3-01、G3-02、G3-03（本地完整仓库）、G3-04、G3-05、G3-06、G3-07、G3-09
COS live：预生产隔离 bucket 指纹 d855f7e900，strict_nonprod=true，prod_label=false
健康复核：G3 安全子集执行后，预生产 health 仍为 success=true、db=postgres，PM2 ai-job-print-api online
结论口径：Gate 3 自动命令门禁通过；仍不能宣称 Gate 4、正式生产、试运营或 Windows 真机验收完成
```

## 七、Gate 4 账号/API 验收

> 已执行（2026-06-22，B 方案）。由于腾讯短信仍在审核，执行前用户确认临时将预生产 `SMS_PROVIDER` 切换为 `log`；脚本通过真实 HTTP API、PostgreSQL、Redis 和 COS 私有桶完成受控验收，输出仅保留脱敏摘要。执行后已运行回滚命令将 `SMS_PROVIDER=tencent` 并重启 PM2，公网 HTTPS health 复核 `success=true`、`db=postgres`；SSH 只读环境复核确认 `SMS_PROVIDER=tencent`、`FILE_STORAGE_DRIVER=cos`、`DATABASE_URL=postgres`、`REDIS_URL=set`。
>
> 说明：本轮是账号/API 级真实链路验收，不包含浏览器截图和人工 UI 证据；不得写成完整浏览器验收完成。优化/修改后文件长期保存使用受控 DB 夹具把通过 API 上传的测试文件标记为 `assetCategory=optimized` 后再走保存期限 API，证明服务端规则和资产中心可管理，但不等于 AI 优化产物真实业务生成链路已完整打通。

| 场景 | 必留证据 | 结果 |
| --- | --- | --- |
| 会员 A 登录 | 账号脱敏、终端编号、时间、截图 | API PASS：MEMBER_A `139****7032` 登录成功，会员 ID digest `bf165f504d98`；未输出验证码或 token。浏览器截图待补。 |
| 上传原始文件 | 文件 ID 脱敏、size、sha256 前 8 位、COS 前缀脱敏 | API PASS：原始文件 digest `2b44f637ef7b`，`assetCategory=original`，bucket 指纹 `d855f7e9004c`，region `ap-guangzhou`；未输出 objectKey 或完整签名 URL。 |
| 默认 90 天 | DB `retentionPolicy`、`expiresAt`、`retentionSetBy` | API/DB PASS：原始文件默认 `retentionPolicy=months_3`、`retentionSetBy=system`。 |
| 设置 180 天 | `retentionConsentVersion=file-retention-v1`、consent at、审计记录 | API/DB PASS：原始文件设置 `months_6` 成功；原始文件设置 `long_term` 按预期 400 拒绝。 |
| 生成或上传成果物 | 任务 ID、文件 ID、我的文档截图 | PARTIAL：通过受控上传 + DB 夹具生成 optimized 测试文件 digest `6c4869d21445`；真实 AI 优化导出自动标记 optimized 的业务链路待补。 |
| 设置长期保存 | `retentionPolicy=long_term`、`expiresAt = null`、`retentionConsentVersion=file-retention-v1` | API/DB PASS（夹具）：optimized 测试文件设置 `long_term` 成功，`expiresAt=null`。 |
| 签名 URL 预览 | TTL <= 30min、过期后不可访问、截图和日志中的签名 URL 查询串已脱敏 | API PASS：本人 `preview-url` 与 `download-url` 返回成功，脚本内部 fetch 签名 URL 成功；未打印完整 URL。过期后访问待浏览器/等待窗口补证。 |
| 重登查看 | 文件仍可见，API 只返回本人 active 文件 | API PASS：`/me/documents` 仅返回本人 active 文件；删除后的原始文件不可见，长期保存 optimized 夹具仍可见。真实浏览器重登截图待补。 |
| 跨账号否定测试 | 会员 B 403/404，无签名 URL 泄露 | API PASS：MEMBER_B `138****7032` 访问/删除 MEMBER_A 文件均为 403，无签名 URL 泄露。 |
| 删除三态一致 | UI 不可见、DB deleted、COS 404、AuditLog | API/DB PASS：原始文件删除后 `status=deleted`、`deletedAt` 存在，`preview-url` 拒绝；`file.delete` 审计存在。COS 物理删除通过应用链路执行，控制台/HEAD 截图待补。 |
| 过期清理 | 清理前用查询限定仅命中指定测试账号和测试文件 ID；过期文件被清，long_term 对照仍 active/COS 200；生命周期聚合审计优先走整点 cron 路径；如使用手动接口，也需核对管理员操作 AuditLog、返回值、DB 与 COS 状态 | API/DB PASS：清理前确认除本轮过期测试文件外无其它 active expired 文件；手动 cleanup 删除 1 个测试文件 digest `9e14136ea1ee`，`long_term` 对照仍 active；`file.cleanup_expired` 审计存在。 |
| Admin 生命周期视图 | 统计、状态、长期保存、删除/清理结果截图 | API PASS：临时 Admin 调用生命周期汇总，清理前 `totalActive=3`、`longTermCount=1`、`expiredPendingCleanup=1`，清理后 `totalActive=2`、`longTermCount=1`、`expiredPendingCleanup=0`；临时 Admin 已禁用。Admin 浏览器截图待补。 |

## 八、停止条件与回滚记录

停止条件：

- 计划审查出现 Critical。
- 预生产实际 commit 与目标候选不一致且未获确认。
- 预生产 `DATABASE_URL`、`REDIS_URL` 或 COS bucket/region 不能证明与生产资源隔离。
- 日志、截图或报告出现密钥、token、完整手机号、签名 URL 查询串或简历正文。
- PostgreSQL 与 COS 删除状态不一致。
- `long_term` 长期保存被过期清理误删。
- 会员 B 可访问会员 A 文件。
- COS 生命周期规则覆盖 `users/`、会员简历、AI 成果物或长期保存对象。

回滚记录：

| 时间 | 触发原因 | 操作 | 结果 |
| --- | --- | --- | --- |
| 2026-06-22 | 腾讯短信审核未完成，Gate 4 选择 B 方案 | 临时将预生产 `SMS_PROVIDER=tencent` 切到 `log`，执行受控账号/API 验收 | Gate 4 API 级验收通过；未输出验证码、token、密钥、完整手机号或签名 URL；不是完整浏览器验收。 |
| 2026-06-22 | B 方案回滚收尾 | 将 `.env` 回滚为 `SMS_PROVIDER=tencent` 并重启 `ai-job-print-api` | 回滚命令返回 `rollback-ok`，公网 HTTPS health 复核 `success=true`、`db=postgres`；SSH 只读环境复核确认 `SMS_PROVIDER=tencent`、`FILE_STORAGE_DRIVER=cos`、`DATABASE_URL=postgres`、`REDIS_URL=set`。 |

## 九、结论

当前结论：

```text
用户文件与简历资产预生产执行：PREPRODUCTION GATE 4 API-LEVEL ACCEPTANCE PASSED WITH NOTES
执行环境：预生产
执行时间：2026-06-22 Gate 0 + Gate 1 + Gate 2 + Gate 3 自动命令门禁 + 预生产 COS 切换 + G3-06 COS live + Gate 4 受控账号/API 验收
部署 commit：Gate 2 执行候选 2187f6a7；执行前部署源为 6b055d6b，执行后 DEPLOY_SOURCE.txt 自报 commit=2187f6a7
COS 状态：已切换到明确隔离的预生产 bucket，脱敏复核为 fp=d855f7e900、strict_nonprod=true、prod_label=false，G3-06 verify:cos:live 已通过；env 备份为 /srv/ai-job-print-env-backups/api.env.20260622134416.bak
Gate 4 结果：受控账号/API 验收通过；SMS B 方案已回滚到 tencent，SSH 只读环境复核通过；优化成果长期保存使用 optimized DB 夹具，真实 AI 优化产物自动入库分类待补；浏览器截图和 COS 控制台/HEAD 证据待补。
结论：不得宣称生产验收、试运营或 Windows 真机验收完成
```
