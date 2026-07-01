# 岗位信息 AI 预生产 / 真机执行记录

> PENDING REAL-EVIDENCE
> READ-ONLY PREFLIGHT STARTED：2026-07-01
> LOCAL CANDIDATE ARTIFACT CHECK：2026-07-01
> PREPRODUCTION RUNTIME REFRESH EXECUTED：2026-07-01
> 本文件是脱敏摘要记录，不得填写真实手机号明文、验证码、cookie、JWT、签名 URL、简历正文或密钥。
> 原始截图、命令日志、SQL 输出、真机照片和打印实物照片必须保存在仓库外证据目录。

## Environment Snapshot

| 项 | 脱敏记录 |
| --- | --- |
| 执行时间 | `2026-07-01 10:11-10:42 Asia/Shanghai` |
| 执行人 | `Codex local preflight + SSH preproduction runtime refresh` |
| SSH 目标 | `<PREPROD_SSH_USER>@<PREPROD_HOST>` |
| 预生产根目录 | `<PREPROD_ROOT>` |
| 当前运行目录 | `<PREPROD_ROOT>/current` |
| PM2 进程 | `<PREPROD_API_PM2>` |
| API 本机端口 | `<API_LOCAL_PORT>` |
| 部署 commit | `14a41ceb` |
| 候选包 | `/tmp/job-ai-preprod-14a41ceb.tar.gz` |
| 远端候选包 | `<PREPROD_ROOT>/artifacts/job-ai-preprod-14a41ceb.tar.gz` |
| 候选包 sha256 | `69c242fa67743df9ec76ce709a826baefe2fbadc273073b10e30358b3f0a8bdf` |
| API dist tree sha256 | `d314deca7c7e0aa94abfe44c403bb8a9c9946de0ef833ad4ce21ec1bb79a78d3` |
| Kiosk URL | `<PREPROD_HOST>:<KIOSK_PORT>/jobs` returned HTTP 200 after refresh |
| Admin URL | `<PREPROD_HOST>:<ADMIN_PORT>/` returned HTTP 200 after refresh |
| Partner URL | `<PREPROD_HOST>:<PARTNER_PORT>/` returned HTTP 200 after refresh |
| API health | `<PREPROD_HOST>:<KIOSK_PORT>/api/v1/health` returned `success=true`, `db=postgres` after refresh |
| 数据库 | `PostgreSQL health visible; backup created before migration deploy` |
| Redis | `Runtime env has Redis configured by fingerprint only; no Redis write in this record` |
| 文件存储 | `Runtime env fingerprint showed FILE_STORAGE_DRIVER=local; Tencent COS keys missing in this runtime check` |
| LLM | `Not invoked in this step; runtime env fingerprint showed AI_LLM_API_KEY / TRTC_LLM_API_KEY missing` |
| 百度 OCR | `Not invoked in this step` |
| 证据目录 | `No repository-external screenshot bundle created in this step; command evidence remains outside Git` |

## Local Candidate Artifact Gate

| 证据 ID | 状态 | 摘要 |
| --- | --- | --- |
| JAI-L1-01 | Passed | 从 `14a41ceb` 生成裁剪运行时包，只包含 root workspace manifest、`apps/`、`services/`、`packages/`，不包含 `docs/`、`.ccg/`、`.github/`、env、构建产物、截图或密钥。 |
| JAI-L1-02 | Passed | 候选包 sha256：`69c242fa67743df9ec76ce709a826baefe2fbadc273073b10e30358b3f0a8bdf`。 |
| JAI-L1-03 | Passed | 本地候选构建已完成 `pnpm install --frozen-lockfile`、SQLite / PostgreSQL Prisma client 生成、API build、Kiosk production build、Admin production build、Partner production build。 |
| JAI-L1-04 | Passed With Note | Kiosk / Admin / Partner production build 仅出现既有 Vite chunk-size warning。 |
| JAI-L1-05 | Scope Note | 裁剪运行时包默认不包含 `.github/workflows/ci.yml`，因此依赖 CI 文件的静态仓库门禁不作为远端运行时包内命令执行；本轮完整仓库侧已刷新执行 `verify:job-info-ai-real-acceptance` 与 `verify:job-customer-sample-readiness`。 |

判定：

```text
Local Candidate Artifact Gate: Passed With Static-Gate Scope Note
阻塞项：
- 无候选包构建阻塞。
- 远端运行时包内不执行依赖 .github 的仓库静态门禁；完整仓库静态门禁与运行时包命令分开记录。
```

## Preproduction Deployment Gate

| 证据 ID | 状态 | 摘要 |
| --- | --- | --- |
| JAI-D1-01 | Passed | 远端上传 `<PREPROD_ROOT>/artifacts/job-ai-preprod-14a41ceb.tar.gz` 后执行 sha256 校验，结果为 OK。 |
| JAI-D1-02 | Passed | 候选目录 `<PREPROD_ROOT>/releases/20260701-102104-14a41ceb` 仅复制既有 `services/api/.env`，未把本地 env 或密钥写入仓库。 |
| JAI-D1-03 | Passed | 远端完成 `pnpm install --frozen-lockfile`、Prisma SQLite/PostgreSQL client generate、API / Kiosk / Admin / Partner production build。 |
| JAI-D1-04 | Passed | 迁移前创建 PostgreSQL 备份 `<PREPROD_ROOT>/db-backups/pre-job-ai-20260701102308.dump`，大小 `170612` bytes，`pg_restore -l` 可读取目录。 |
| JAI-D1-05 | Passed | `prisma migrate deploy` 应用 1 个既有 pending additive migration：`20260701092000_add_jobfair_checkin_url`。该 migration 属招聘会 checkin URL，不是岗位 AI 新 schema；最终 `prisma migrate status` 为 up to date。 |
| JAI-D1-06 | Passed | 切换 `current` symlink 到候选目录并重启 PM2 后，等待 5 秒 health 探测成功。 |
| JAI-D1-07 | Passed | 切换后 `DEPLOY_SOURCE.txt` 记录 `commit=14a41ceb`、候选包 sha256、API dist tree hash 和 previous release；PM2 `<PREPROD_API_PM2>` online。 |
| JAI-D1-08 | Passed | 公网 health 返回 `success=true`、`db=postgres`，Kiosk `/jobs`、Admin、Partner 静态入口均返回 HTTP 200。 |
| JAI-D1-09 | Passed With Runtime Caveat | 在远端运行时包内执行 `verify:production-runtime-gates` 与 `verify:production-db-guard` 静态断言套件并通过；这些脚本校验生产门禁逻辑，不等于 live env 探针。本次 env 脱敏复核显示该预生产实例仍是 `NODE_ENV=staging`、`FILE_STORAGE_DRIVER=local`，且 COS / LLM key 缺失，不能视为完整生产形态 Gate。 |

判定：

```text
Preproduction Deployment Gate: Passed For Runtime Route Refresh
不代表：
- 不代表客户真实岗位样本验收通过。
- 不代表预生产公网真实会员浏览器验收通过。
- 不代表 COS / LLM / OCR live 验收通过。
- 不代表一体机真机、打印或外设验收通过。
```

## Customer Job Sample Gate

| 证据 ID | 状态 | 摘要 |
| --- | --- | --- |
| JAI-G1-01 | Not Passed Yet | 客户真实岗位样本来源、导入方式、样本数量仍未提供。 |
| JAI-G1-02 | Blocked | 公开 `/api/v1/jobs?pageSize=100` 抽样 17 条；四要素不缺失，但至少 6 条含演示来源 / 演示标题 / demo externalId，不满足客户真实岗位样本准入。 |
| JAI-G1-03 | Not Passed Yet | `JobDataQualitySnapshot` ready / partial / insufficient 摘要尚未基于客户真实样本验收。 |
| JAI-G1-04 | Not Passed Yet | Admin 岗位来源质量摘要尚未用客户真实样本截图或脱敏摘要验收。 |
| JAI-G1-05 | Not Passed Yet | Partner 本机构岗位质量摘要尚未用客户真实机构样本确认隔离。 |
| JAI-G1-06 | Not Passed Yet | Kiosk `/jobs` 和 `/jobs/:id` 尚未展示并验收客户真实已发布岗位。 |

判定：

```text
Customer Job Sample Gate: Blocked
阻塞项：
- 未提供客户真实 API / Excel / Webhook 岗位样本。
- 当前公开岗位抽样仍包含演示数据，不能作为客户真实样本验收。
```

## Preproduction Browser Gate

会话来源方式：

- [ ] `SESSION-A_REAL_SMS`
- [ ] `SESSION-B_REDIS_TEST_CODE`（候选方式；本记录未登录、不写验证码）
- [ ] `SESSION-C_CONTROLLED_SESSION`

| 证据 ID | 状态 | 摘要 |
| --- | --- | --- |
| JAI-G0 | Passed | 本地完整仓库 `verify:job-info-ai-real-acceptance` 在本记录更新后刷新执行通过。 |
| JAI-G2-01 | Passed Static Guard | 远端运行时包内 `verify:production-runtime-gates` 静态断言套件通过；该脚本校验生产门禁逻辑，不证明当前 live env 达到生产形态。 |
| JAI-G2-02 | Passed Static Guard | 远端运行时包内 `verify:production-db-guard` 静态断言套件通过；该脚本校验数据库门禁逻辑，不证明当前 live env 达到生产形态。 |
| JAI-G2-03 | Blocked For Full Gate | `verify:llm-connectivity -- --all` 本轮未执行；远端 env 脱敏复核显示 LLM key 缺失。 |
| JAI-G2-04 | Not Passed Yet | `verify:ocr-baidu-live` 本轮未执行。 |
| JAI-G2-05 | Passed For Route Availability | 公网路由探测确认新端点不再是路由缺失：`/api/v1/jobs/ai/recommendations` 对不存在简历返回业务错误 `AI_TASK_NOT_FOUND`；`/api/v1/admin/jobs/quality-summary` 与 `/api/v1/partner/jobs/quality-summary` 返回 `AUTH_MISSING_TOKEN`。 |
| JAI-G2-06 | Passed | 预生产已从本地候选包刷新到 `14a41ceb`，并完成 DB 备份、migration deploy、PM2 重启和公网 health 复验。 |
| JAI-G2-07 | Scope Note | 远端裁剪包内 `verify:job-ai-backend` 可能因缺 `.github/workflows/ci.yml` 无法执行，不作为运行时失败；完整仓库静态门禁需本地运行。 |
| JAI-G2-08 | Blocked For Full Gate | 本次远端 env 脱敏复核显示 `FILE_STORAGE_DRIVER=local`，不满足完整预生产浏览器 Gate 对 COS 私有对象存储的要求。 |
| JAI-G3-01 | Not Passed Yet | 会员登录并进入 `/jobs` 尚未执行。 |
| JAI-G3-02 | Not Passed Yet | 确认 `job_ai` 授权尚未执行。 |
| JAI-G3-03 | Not Passed Yet | 选择本人真实已解析简历并生成 AI 推荐尚未执行。 |
| JAI-G3-04 | Not Passed Yet | 打开真实岗位详情并完成 AI 解读尚未执行。 |
| JAI-G3-05 | Not Passed Yet | 完成岗位匹配参考且不出现百分比或录用承诺尚未执行。 |
| JAI-G3-06 | Not Passed Yet | 打开来源二维码 / 外链并只记录 `external_apply` 打开动作尚未执行。 |
| JAI-G3-07 | Not Passed Yet | `/me/ai-records` 展示本人 Job AI 会话元数据尚未执行。 |
| JAI-G3-08 | Not Passed Yet | `/me/settings` 撤回 `job_ai` 授权尚未执行。 |
| JAI-G3-09 | Not Passed Yet | 抽样确认 `JobAiSession`、`JobAiRecommendation`、`AiServiceLog` 元数据和清理状态尚未执行。 |

判定：

```text
Preproduction Browser Gate: Blocked
已解除：
- 岗位 AI 推荐、Admin 岗位质量摘要、Partner 岗位质量摘要公网路由 404 阻塞已解除。
剩余阻塞项：
- 当前预生产实例仍是 staging + local storage，且 COS / LLM key 缺失，不满足完整浏览器 Gate；因此不得进入真实会员浏览器验收。
- 未提供真实会员、真实已解析简历和客户真实岗位样本。
- 未执行真实 AI 推荐、岗位解读、匹配参考、历史回看、授权撤回和 DB 脱敏抽样。
```

## Hardware Gate

| 证据 ID | 状态 | 摘要 |
| --- | --- | --- |
| JAI-H1-01 | Not Passed Yet | Windows 版本、Kiosk 浏览器、竖屏分辨率 |
| JAI-H1-02 | Not Passed Yet | Windows Terminal Agent 版本、terminalId、在线心跳 |
| JAI-H1-03 | Not Passed Yet | Pantum 打印机 Windows 真实识别名 |
| JAI-H2-01 | Not Passed Yet | 27 寸竖屏 `/jobs` 触控、筛选、搜索 |
| JAI-H2-02 | Not Passed Yet | `/jobs/:id`、AI 推荐、AI 解读、岗位匹配参考触控状态 |
| JAI-H2-03 | Not Passed Yet | 来源二维码 / 外链展示可识别 |
| JAI-H3-01 | Not Passed Yet | 生成真实 FileObject 与 PrintTask |
| JAI-H3-02 | Not Passed Yet | Agent 只 claim 本机 terminalId 的 PrintTask |
| JAI-H3-03 | Not Passed Yet | Pantum 真实出纸，纸张和色彩 / 双面模式记录 |
| JAI-H3-04 | Not Passed Yet | 打印完成 / 失败 / 断网恢复状态回传 |
| JAI-H3-05 | Not Passed Yet | 打印后本地缓存 TTL 清理 |

判定：

```text
Hardware Gate: Not Passed Yet
阻塞项：
- 未执行 Windows 一体机、Terminal Agent、Pantum 真机出纸和断网恢复验收。
```

## Evidence Index

| 证据 ID | 仓库外路径 / 摘要 | 脱敏检查 |
| --- | --- | --- |
| JAI-G0 | `pnpm --filter @ai-job-print/api verify:job-info-ai-real-acceptance` | `脱敏静态门禁通过；不连接预生产、不读取密钥` |
| JAI-G1 | `PENDING` | `PENDING` |
| JAI-G2 | `Command evidence kept outside Git; this file stores only sanitized summaries` | `No token, cookie, JWT, signed URL, resume body, DB URL, Redis URL, COS key, SMS key or LLM key recorded` |
| JAI-G3 | `PENDING` | `PENDING` |
| JAI-H1 | `PENDING` | `PENDING` |
| JAI-H2 | `PENDING` | `PENDING` |
| JAI-H3 | `PENDING` | `PENDING` |

## Stop Conditions

如执行客户样本、真实会员浏览器或真机验收时出现以下任一项，记录后立即停止，并先回到修复 / 配置阶段。本轮运行时刷新已识别 `FILE_STORAGE_DRIVER=local`，因此完整预生产浏览器 Gate 保持 Blocked；运行时刷新阶段只允许记录该阻塞，不允许进入验收 Gate，进入验收 Gate 前必须切到合格对象存储并重新复验。

- 禁止链路文案出现在 Kiosk、Admin、Partner 或 AI 输出中。
- AI 输出出现百分比化推荐、通过承诺或录用承诺。
- Partner 看到用户个人信息、个人 AI 明细或其他机构数据。
- 会员 B 能访问会员 A 的 Job AI 会话。
- 日志或截图出现手机号明文、验证码、cookie、JWT、签名 URL、简历正文或密钥。
- 预生产真实验收 Gate 仍使用 mock、disabled OCR、local file storage 或非 PostgreSQL。
- Agent claim 到非本 terminalId 的打印任务。
- 真机未出纸但任务状态为 completed。
- 打印缓存 TTL 后仍能打开用户文件。

## Residual Risks

```text
Not Passed Yet
- 客户真实岗位样本：当前公开抽样含演示数据，未达到 Gate。
- 预生产公网浏览器：新端点 404 已解除，但当前实例仍是 staging + local storage，COS / LLM key 缺失，真实会员、真实简历、真实客户岗位样本和 Job AI 端到端流程未跑通。
- 远端部署：预生产运行时已刷新到 14a41ceb；裁剪包内不包含 .github，依赖 CI 文件的静态门禁仍需本地完整仓库执行。
- 一体机真机：未执行。
- 生产上线前必须复验：客户样本、预生产真实会话、真实简历、LLM/OCR、Terminal Agent、Pantum 真机出纸。
```

## Final Decision

```text
岗位信息 AI 真实验收结论：Not Passed Yet
是否允许宣称生产商用完成：否
是否允许进入小范围试运营：否
签字 / 确认人：
日期：
```
