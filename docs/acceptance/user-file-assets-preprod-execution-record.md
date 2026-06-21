# 用户文件与简历资产预生产执行记录

> 状态：PLANNED，尚未执行会修改服务器、数据库、COS、账号或第三方配置的真实验收。
> 基线候选：`codex/file-assets-preprod-integration` / `9146fa1c`
> 执行分支：`codex/file-assets-preprod-execution`
> 口径：本文件是预生产执行记录模板和后续证据入口，不代表正式生产部署、真实试运营或 Windows 真机验收完成。

## 一、目标和非目标

目标：

- 基于 `9146fa1c` 在预生产环境执行用户文件与简历资产验收。
- 覆盖 PostgreSQL、COS 私有桶、会员账号、原始文件、优化后或修改后文件、90 天 / 180 天 / 长期保存、重登查看、删除三态一致、过期清理、`long_term` 防误删和 ActivityLog 审计。
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
| Gate 2 | 候选部署或刷新 | 需用户确认 | 会改变预生产代码、构建产物和进程状态。 |
| Gate 3 | 自动命令门禁 | 需用户确认 | `verify:cos:live`、测试数据和部分 verify 可能写入 COS/DB。 |
| Gate 4 | 浏览器和账号验收 | 需用户确认 | 会创建/修改测试会员文件、保存期限、删除状态和审计记录。 |

## 三、Gate 0 本地静态门禁

| 项目 | 命令 | 结果 | 证据 |
| --- | --- | --- | --- |
| 当前分支 | `git status --short --branch` | PASS | 2026-06-22：`codex/file-assets-preprod-execution`，HEAD `9146fa1c`；仅本任务文档为未提交变更。 |
| 静态证据包检查 | `pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance` | PASS | 2026-06-22：脚本输出 `verify:file-assets-trial-acceptance passed`，并明确 `STATIC DOC CHECK ONLY`。 |
| whitespace | `git diff --check` | PASS | 2026-06-22：无输出。 |

## 四、Gate 1 预生产只读预检

> 2026-06-22 已执行只读预检。仅执行 SSH/curl 只读命令；未部署、未拉取、未 checkout、未重启 PM2、未迁移数据库、未写 COS/DB。

| 项目 | 证据要求 | 结果 |
| --- | --- | --- |
| 主机与时间 | `hostname`、`date`，确认时区 | PASS：主机 `instance-061dyczx`，服务器时间 `2026-06-22 01:53 CST`。 |
| 部署 commit | `/srv/ai-job-print` 下 `git rev-parse --short HEAD` | STOP：`/srv/ai-job-print` 不是 Git 仓库；`DEPLOY_SOURCE.txt` 显示部署源 commit 为 `6b055d6b`，不是目标候选 `9146fa1c`。`DEPLOY_SOURCE.txt` 是部署脚本自报元数据，不等于 Git HEAD 校验；实际运行代码与该 commit 的一致性需在 Gate 2 重新构建/部署时核验。 |
| 工作区状态 | 服务器工作区不得有不明改动 | N/A：部署目录为 `local-git-archive` 展开目录，无 `.git`；未发现 `/srv` 三层内 `.git` 目录。 |
| PM2 状态 | `ai-job-print-api` 在线状态 | PASS：PM2 `ai-job-print-api` online，脚本路径 `/srv/ai-job-print/services/api/dist/main.js`，cwd `/srv/ai-job-print/services/api`。 |
| health | `GET /api/v1/health` 显示 PostgreSQL | PASS：本机 `127.0.0.1:3010/api/v1/health` 与公网 `http://<PREPROD_HOST>/api/v1/health` 均返回 `success=true`、`status=ok`、`db=postgres`。 |

Gate 1 结论：

- 预生产主机、API 进程和 PostgreSQL health 可达。
- 当前部署源自报仍是 `6b055d6b` 阶段性预生产包，不是用户文件资产候选 `9146fa1c`；实际运行代码一致性待 Gate 2 重新部署时核验。
- 已触发计划停止条件：实际部署 commit 不是目标候选；本轮停止在 Gate 1，不执行 Gate 2 候选部署或刷新。

## 五、Gate 2 候选部署或刷新

> 尚未执行。若 Gate 1 显示预生产未部署 `9146fa1c`，必须先停下并确认是否执行候选部署或刷新。

| 项目 | 证据要求 | 结果 |
| --- | --- | --- |
| 部署前 commit | 记录上一部署 commit 和回滚路径 | PENDING |
| 资源隔离 | 预生产 `DATABASE_URL`、`REDIS_URL`、COS bucket/region 指向隔离资源；只记录脱敏指纹，不打印密钥 | PENDING |
| 依赖安装 | `pnpm install --frozen-lockfile` | PENDING |
| Prisma client | `prisma generate` 与 `db:pg:generate` | PENDING |
| 构建 | API / Kiosk / Admin build；Kiosk production build 明确 `VITE_USE_TRTC_CALL=true` 或有审定的纯文字例外 | PENDING |
| 进程重启 | PM2 restart 与 health 复验 | PENDING |

## 六、Gate 3 自动命令门禁

> 尚未执行。所有日志进入证据包前必须脱敏，不得提交 `.env`、token、签名 URL 查询串或简历正文。

| 命令 | 结果 | 证据 |
| --- | --- | --- |
| `pnpm --filter @ai-job-print/api verify:production-runtime-gates` | PENDING | 待执行 |
| `pnpm --filter @ai-job-print/api verify:production-db-guard` | PENDING | 待执行 |
| `pnpm --filter @ai-job-print/api verify:cos-lifecycle-policy` | PENDING | 待执行 |
| `pnpm --filter @ai-job-print/api verify:file-retention` | PENDING | 待执行 |
| `pnpm --filter @ai-job-print/api verify:file-lifecycle-summary` | PENDING | 待执行 |
| `pnpm --filter @ai-job-print/api verify:cos:live` | PENDING | PASS 需记录脱敏桶指纹；SKIPPED 需记录缺少的配置项名称，不记录值 |
| `pnpm --filter @ai-job-print/api verify:member-assets-c2d` | PENDING | 待执行 |
| `pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance` | PENDING | 待执行 |

## 七、Gate 4 浏览器和账号验收

| 场景 | 必留证据 | 结果 |
| --- | --- | --- |
| 会员 A 登录 | 账号脱敏、终端编号、时间、截图 | PENDING |
| 上传原始文件 | 文件 ID 脱敏、size、sha256 前 8 位、COS 前缀脱敏 | PENDING |
| 默认 90 天 | DB `retentionPolicy`、`expiresAt`、`retentionSetBy` | PENDING |
| 设置 180 天 | `retentionConsentVersion=file-retention-v1`、consent at、审计记录 | PENDING |
| 生成或上传成果物 | 任务 ID、文件 ID、我的文档截图 | PENDING |
| 设置长期保存 | `retentionPolicy=long_term`、`expiresAt = null`、`retentionConsentVersion=file-retention-v1` | PENDING |
| 签名 URL 预览 | TTL <= 30min、过期后不可访问、截图和日志中的签名 URL 查询串已脱敏 | PENDING |
| 重登查看 | 文件仍可见，API 只返回本人 active 文件 | PENDING |
| 跨账号否定测试 | 会员 B 403/404，无签名 URL 泄露 | PENDING |
| 删除三态一致 | UI 不可见、DB deleted、COS 404、ActivityLog | PENDING |
| 过期清理 | 清理前用查询限定仅命中指定测试账号和测试文件 ID；过期文件被清，long_term 对照仍 active/COS 200；审计取证须走整点 cron 路径，手动接口仅核对返回值/DB/COS | PENDING |
| Admin 生命周期视图 | 统计、状态、长期保存、删除/清理结果截图 | PENDING |

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
| PENDING | PENDING | PENDING | PENDING |

## 九、结论

当前结论：

```text
用户文件与简历资产预生产执行：已计划 / Gate 0 本地静态门禁通过 / 未执行外部状态变更
执行环境：预生产
执行时间：2026-06-22 Gate 0 + Gate 1
部署 commit：目标候选 9146fa1c；Gate 1 只读预检确认预生产实际部署源仍为 6b055d6b
阻塞项：需用户确认是否执行 Gate 2 候选部署或刷新；Gate 2 及以后任何外部状态变更需再次确认
结论：不得宣称生产验收、试运营或 Windows 真机验收完成
```
