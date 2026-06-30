# 岗位信息 AI 预生产 / 真机执行记录模板

> PENDING REAL-EVIDENCE
> READ-ONLY PREFLIGHT STARTED：2026-07-01
> LOCAL CANDIDATE ARTIFACT CHECK：2026-07-01
> 本文件是脱敏摘要模板，不得填写真实手机号明文、验证码、cookie、JWT、签名 URL、简历正文或密钥。
> 原始截图、命令日志、SQL 输出、真机照片和打印实物照片必须保存在仓库外证据目录。

## Environment Snapshot

| 项 | 脱敏记录 |
| --- | --- |
| 执行时间 | `2026-07-01 00:03 Asia/Shanghai` |
| 执行人 | `Codex local read-only preflight` |
| 部署 commit | `current local candidate 14a41ceb; remote not changed in this step` |
| Kiosk URL | `<PREPROD_HOST>/jobs` returned HTTP 200 |
| Admin URL | `<PREPROD_HOST>:8081/` returned HTTP 200 |
| Partner URL | `<PREPROD_HOST>:8082/` returned HTTP 200 |
| API health | `<PREPROD_HOST>/api/v1/health` returned `success=true`, `db=postgres` |
| 数据库 | `PostgreSQL health visible; no direct DB query executed` |
| Redis | `Not checked; no Redis write executed` |
| COS | `Not checked; no COS read/write executed` |
| LLM | `Not checked in this step` |
| 百度 OCR | `Not checked in this step` |
| 证据目录 | `No repository-external screenshot/log bundle created in this read-only preflight` |

## Local Candidate Artifact Gate

| 证据 ID | 状态 | 摘要 |
| --- | --- | --- |
| JAI-L1-01 | Passed | 从 `14a41ceb` 生成裁剪运行时包 `/tmp/job-ai-preprod-14a41ceb.tar.gz`，只包含 root workspace manifest、`apps/`、`services/`、`packages/`，不包含 `docs/`、`.ccg/`、`.github/`、env、构建产物、截图或密钥。 |
| JAI-L1-02 | Passed | 候选包 sha256：`69c242fa67743df9ec76ce709a826baefe2fbadc273073b10e30358b3f0a8bdf`。 |
| JAI-L1-03 | Passed | 在 `/tmp/job-ai-preprod-candidate/ai-job-print` 完成 `pnpm install --frozen-lockfile`、SQLite Prisma client 生成、PostgreSQL Prisma client 生成。 |
| JAI-L1-04 | Passed | 候选包完成 API build、Kiosk production build、Admin production build、Partner production build；Kiosk / Admin 仅有既有 chunk-size warning。 |
| JAI-L1-05 | Mixed | Admin `verify:job-ai-ops-dashboard-ui` 与 Partner `verify:job-quality-dashboard-ui` 在裁剪包内通过；API / Kiosk 的 Job AI 静态门禁会读取 `.github/workflows/ci.yml`，因裁剪包按部署规则不包含 `.github/` 而失败，不能作为运行时包构建失败处理。完整仓库内这些门禁仍需继续运行。 |

判定：

```text
Local Candidate Artifact Gate: Passed With Static-Gate Scope Note
阻塞项：
- 本地环境未配置预生产 SSH 目标，未执行上传、远端构建、DB 备份、migration deploy、PM2 重启或公网端点复验。
- 如要在远端运行仓库静态门禁脚本，必须另行明确是否允许把 `.github/` 纳入验收包；默认运行时裁剪包不包含 `.github/`。
```

## Customer Job Sample Gate

| 证据 ID | 状态 | 摘要 |
| --- | --- | --- |
| JAI-G1-01 | Not Passed Yet | 客户真实岗位样本来源、导入方式、样本数量 |
| JAI-G1-02 | Blocked | 公开 `/api/v1/jobs?pageSize=100` 抽样 17 条；四要素不缺失，但至少 6 条含演示来源 / 演示标题 / demo externalId，不满足客户真实岗位样本准入 |
| JAI-G1-03 | Not Passed Yet | `JobDataQualitySnapshot` ready / partial / insufficient 摘要未在预生产脱敏查询中核验 |
| JAI-G1-04 | Not Passed Yet | Admin 岗位来源质量摘要截图或脱敏摘要 |
| JAI-G1-05 | Not Passed Yet | Partner 本机构岗位质量摘要，确认无法看到其他机构 |
| JAI-G1-06 | Not Passed Yet | Kiosk `/jobs` 和 `/jobs/:id` 展示真实已发布岗位 |

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
- [ ] `SESSION-B_REDIS_TEST_CODE`
- [ ] `SESSION-C_CONTROLLED_SESSION`

| 证据 ID | 状态 | 摘要 |
| --- | --- | --- |
| JAI-G0 | Not Passed Yet | 本地静态门禁 `verify:job-info-ai-real-acceptance` |
| JAI-G2-01 | Not Passed Yet | `verify:production-runtime-gates` |
| JAI-G2-02 | Not Passed Yet | `verify:production-db-guard` |
| JAI-G2-03 | Not Passed Yet | `verify:llm-connectivity -- --all` |
| JAI-G2-04 | Not Passed Yet | `verify:ocr-baidu-live` 或本轮不参与说明 |
| JAI-G2-05 | Blocked | 公网路由探测：`/api/v1/jobs/ai/recommendations`、`/api/v1/admin/jobs/quality-summary`、`/api/v1/partner/jobs/quality-summary` 返回 HTTP 404；说明当前预生产 API 尚未部署本地岗位 AI 后端 / 看板端点 |
| JAI-G2-06 | Blocked | 本地已生成并构建通过 `14a41ceb` 裁剪候选包，但当前 Codex 环境没有 `PREPROD_HOST` / SSH config / shell history 中可复用的预生产 root 目标，未执行远端部署刷新 |
| JAI-G3-01 | Not Passed Yet | 会员登录并进入 `/jobs` |
| JAI-G3-02 | Not Passed Yet | 确认 `job_ai` 授权 |
| JAI-G3-03 | Not Passed Yet | 选择本人真实已解析简历并生成 AI 推荐 |
| JAI-G3-04 | Not Passed Yet | 打开真实岗位详情并完成 AI 解读 |
| JAI-G3-05 | Not Passed Yet | 完成岗位匹配参考，不出现百分比或录用承诺 |
| JAI-G3-06 | Not Passed Yet | 打开来源二维码 / 外链，只记录 `external_apply` 打开动作 |
| JAI-G3-07 | Not Passed Yet | `/me/ai-records` 展示本人 Job AI 会话元数据 |
| JAI-G3-08 | Not Passed Yet | `/me/settings` 撤回 `job_ai` 授权 |
| JAI-G3-09 | Not Passed Yet | 抽样确认 `JobAiSession`、`JobAiRecommendation`、`AiServiceLog` 元数据和清理状态 |

判定：

```text
Preproduction Browser Gate: Blocked
阻塞项：
- 当前预生产 API 未暴露岗位 AI 推荐、Admin 质量摘要、Partner 质量摘要端点。
- 当前本机缺预生产 SSH 目标配置，无法继续远端上传 / 构建 / migration / PM2 重启。
- 未选择 `SESSION-A_REAL_SMS` / `SESSION-B_REDIS_TEST_CODE` / `SESSION-C_CONTROLLED_SESSION`。
- 未提供真实会员、真实已解析简历和客户真实岗位样本。
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
```

## Evidence Index

| 证据 ID | 仓库外路径 / 摘要 | 脱敏检查 |
| --- | --- | --- |
| JAI-G0 | `PENDING` | `PENDING` |
| JAI-G1 | `PENDING` | `PENDING` |
| JAI-G2 | `PENDING` | `PENDING` |
| JAI-G3 | `PENDING` | `PENDING` |
| JAI-H1 | `PENDING` | `PENDING` |
| JAI-H2 | `PENDING` | `PENDING` |
| JAI-H3 | `PENDING` | `PENDING` |

## Stop Conditions

如出现以下任一项，记录后立即停止：

- 禁止链路文案出现在 Kiosk、Admin、Partner 或 AI 输出中。
- AI 输出出现百分比化推荐、通过承诺或录用承诺。
- Partner 看到用户个人信息、个人 AI 明细或其他机构数据。
- 会员 B 能访问会员 A 的 Job AI 会话。
- 日志或截图出现手机号明文、验证码、cookie、JWT、签名 URL、简历正文或密钥。
- 预生产仍使用 mock、disabled OCR、local file storage 或非 PostgreSQL。
- Agent claim 到非本 terminalId 的打印任务。
- 真机未出纸但任务状态为 completed。
- 打印缓存 TTL 后仍能打开用户文件。

## Residual Risks

```text
Not Passed Yet
- 客户真实岗位样本：当前公开抽样含演示数据，未达到 Gate。
- 预生产公网浏览器：当前公网 API 缺岗位 AI 新端点，未达到 Gate。
- 远端部署：本地候选包已通过构建预检，但当前 Codex 环境缺预生产 SSH 目标，未部署。
- 一体机真机：未执行。
- 生产上线前必须复验：客户样本、预生产部署、真实会话、真实简历、LLM/OCR、Terminal Agent、Pantum 真机出纸。
```

## Final Decision

```text
岗位信息 AI 真实验收结论：Not Passed Yet
是否允许宣称生产商用完成：否
是否允许进入小范围试运营：否
签字 / 确认人：
日期：
```
