# 用户文件与简历资产 Gate 2 执行前只读就绪复核

> 状态：READ-ONLY RECHECK ONLY，Gate 2 尚未执行。
> 执行分支：`codex/file-assets-gate2-readiness-recheck`。
> 本地 HEAD：`c8667396`。
> 冻结部署候选：`2187f6a7`。
> 复核时间：2026-06-22。
> 口径：本文件只记录本地和预生产只读复核结果，不代表 Gate 2、Gate 3/Gate 4、正式生产、试运营或 Windows 真机验收完成。

## 一、边界

本次只读复核未执行以下操作：

- 未上传 `/tmp/yitiji-preprod-2187f6a7.tar.gz`。
- 未写入 `/srv`，未展开候选目录，未替换 `/srv/ai-job-print`。
- 未执行 `pnpm install`、构建、`prisma migrate deploy`、`pg_dump` 或 PM2 restart；未迁移数据库，未重启 PM2。
- 未写 PostgreSQL、Redis、COS、会员账号、测试文件、保存期限、删除状态或 AuditLog。
- 未修改 nginx、DNS、证书、云密钥、短信、OCR、TRTC、ASR/TTS、Windows、打印机或扫描仪。

## 二、本地复核

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| 当前分支 | PASS | `codex/file-assets-gate2-readiness-recheck` |
| 本地 HEAD | PASS | `c8667396` |
| 冻结候选可达 | PASS | `git cat-file -e 2187f6a7^{commit}` 通过 |
| 候选后变更范围 | PASS | `git diff --name-only 2187f6a7` 仅显示 `docs/`、`.ccg/` 和 `services/api/scripts/verify-file-assets-trial-acceptance.ts` 等治理/静态门禁路径 |
| 未跟踪文件范围 | PASS | 仅本任务 `.ccg/` 记录和只读复核计划 |
| 静态门禁 | PASS | `pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance` 通过，并明确 `STATIC DOC CHECK ONLY` |
| API typecheck | PASS | `pnpm --filter @ai-job-print/api typecheck` 通过 |
| whitespace | PASS | `git diff --check` 通过 |
| 候选包现状 | PASS | `/tmp/yitiji-preprod-2187f6a7.tar.gz` 存在，sha256 为 `6019de34f837850b22eb7ab12f9b0d25ea6fa14bac3fcfc827441803123e4b07`，与 `.sha256` 文件一致 |

`verify:file-assets-trial-acceptance` 已复核为本地静态门禁：只读取仓库文件和本地 Git 状态，不连接 PostgreSQL、Redis、COS 或外部网络，不写文件。

## 三、预生产只读复核

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| 主机 | PASS | `<PREPROD_HOST>` 可通过 SSH 只读访问；主机名已脱敏为 `<PREPROD_HOSTNAME>` |
| 服务器时间 | PASS | `2026-06-22 06:19 CST` |
| 当前部署源 | NEEDS GATE 2 | `/srv/ai-job-print/DEPLOY_SOURCE.txt` 自报 `source=local-git-archive`、`commit=6b055d6b`，仍不是冻结候选 `2187f6a7` |
| 当前部署包 | INFO | 自报 artifact `/srv/yitiji-preprod-6b055d6b.tar.gz`，sha256 `988b75dbff260e6f136717dcafb90b982fc7df968c92b0e54bad6822a09e019f` |
| PM2 | PASS | `ai-job-print-api` online；restarts `4`，unstable restarts `0` |
| 近期错误日志计数 | PASS | 最近 50 行 error log 行数 `0`，`error|exception|fatal` 关键词行数 `0`；未输出原始日志正文 |
| 本机 health | PASS | `127.0.0.1:3010/api/v1/health` 返回 `success=true`、`db=postgres` |
| 公网 health | PASS | `http://<PREPROD_HOST>/api/v1/health` 返回 `success=true`、`db=postgres` |
| 磁盘预算 | PASS | `app_mb=990`、`avail_mb=28635`、`required_mb=4028`，满足 Gate 2 候选目录 + 回滚目录 + 归档 + DB 备份预算 |
| API env 文件 | PASS | `/srv/ai-job-print/services/api/.env` 存在，权限 `600 root:root`；未输出内容 |
| 工具可用性 | PASS | `node`、`pnpm`、`pg_dump`、`pm2` 均存在 |

## 四、资源指纹

以下仅记录 hint 和 10 位短指纹，不记录任何 env 原值。

| Key | Hint | Fingerprint |
| --- | --- | --- |
| `DATABASE_URL` | `postgres` | `4a100471d7` |
| `POSTGRES_URL` | `postgres` | `4a100471d7` |
| `REDIS_URL` | `set` | `feab31dcfe` |
| `FILE_STORAGE_DRIVER` | `cos` | `9be28bbe03` |
| `TENCENT_COS_BUCKET` | `set` | `7637995480` |
| `TENCENT_COS_REGION` | `set` | `11a91442bf` |
| `NODE_ENV` | `staging` | `e919a75364` |

说明：代码实际使用 `TENCENT_COS_BUCKET` / `TENCENT_COS_REGION`，不是通用 `COS_BUCKET` / `COS_REGION`。本轮已同步修正 Gate 2 主执行计划的只读指纹脚本 key 名。

## 五、Go / No-Go

| Gate 2 前置项 | 状态 | 说明 |
| --- | --- | --- |
| 本地候选冻结口径 | GO | `2187f6a7` 仍为部署候选，后续变更为治理路径 |
| 本地候选包 | GO | `/tmp` 候选包存在且 sha256 与记录一致；正式执行前仍需重新确认 |
| 预生产当前状态 | GO FOR REFRESH | 当前仍是 `6b055d6b`，所以 Gate 2 刷新仍有必要 |
| PostgreSQL health | GO | 本机和公网 health 均为 `db=postgres` |
| Redis / COS 配置存在性 | GO | Redis、COS driver、腾讯 COS bucket/region 均有脱敏指纹 |
| 预生产环境识别 | GO | `NODE_ENV=staging`，不是 `production` |
| 磁盘预算 | GO | 可用空间超过 Gate 2 预算 |
| 工具链 | GO | `node`、`pnpm`、`pg_dump`、`pm2` 存在 |
| 用户授权 | NO-GO UNTIL CONFIRMED | Gate 2 会修改预生产代码目录、schema 和 PM2 状态，仍需用户按审批包明确确认 |

## 六、结论

```text
Gate 2 执行前只读就绪复核：通过
部署候选：2187f6a7
预生产当前自报部署源：6b055d6b
结论：可以向用户请求 Gate 2 执行确认；不得直接执行远端修改。
仍未完成：Gate 2 部署刷新、Gate 3/Gate 4 文件资产真实验收、正式生产、Windows 真机和试运营。
```
