# 交付就绪审计（七闸门 + 原型↔路由↔接口对齐）· 2026-09-05，2026-09-07 复核

> 审计基线 `origin/main@1d7468cda`（2026-09-05）；**复核基线 `origin/main@f0aa458e5`（2026-09-07）**，两基线之间 main 前进 91 个提交。
> 方法：七路只读子代理（产品合规 / 一体机 / 后端安全 / 部署硬件 / 小程序双后台 / 本地构建实跑 / 原型对齐）+ 主线亲核。
> 每条带「今日状态」与 file:line。配套清单：[launch-audit-2026-09-05.md](launch-audit-2026-09-05.md)（13 路逐条体检，ID 体系）；本文只承载**闸门判定、阻塞项归属、原型对齐与工期估算**，不与它重复列问题。
> 进度唯一信源仍是 [current-progress.md](../progress/current-progress.md) / [next-tasks.md](../progress/next-tasks.md)（CLAUDE.md §7），本文不维护第二份进度。

## 一、判定（按边界，不合并）

| 边界 | 09-05 判定 | 09-07 复核 | 依据 |
|---|---|---|---|
| 本地构建 | PARTIAL 偏 GO | 不变 | typecheck / lint / CI 同款三端构建 / 388 条门禁抽样全绿；`graph:check` 未进 CI（`.github/workflows` 0 命中） |
| 一体机视觉 G2 | NO-GO（1/51） | NO-GO（**4/51**） | `apps/kiosk/src/layouts/KioskRoot.tsx:159-162` `QX_MIGRATED_ROUTES` = `/print/pickup-claim`、`/resume/report`、`/resume/optimize`、`/resume/generate/preview` |
| 生产环境 G4 | NO-GO（`771d53e2`，落后 216） | NO-GO（**`1b2195adf`，09-06 三次发布后落后 34，待跑 migration 0**） | current-progress 09-06 三条发布记录；`git rev-list --count 1b2195adf..f0aa458e5` = 34；`git diff --name-only 1b2195adf f0aa458e5 -- services/api/prisma/postgres/migrations` 为空 |
| 内容 | 三库空 | **仍空**（09-07 公网只读实测 `jobs` / `job-fairs` / `policies` 均 `data:[]`） | `GET https://zyidai.cn/api/v1/{jobs,job-fairs,policies}?pageSize=1` |
| Windows 真机 G5 | NO-GO | NO-GO | 台架四项结果表空（`docs/device/bench-acceptance-2026-08-16.md` §7）；Phase F 复验见 #845，但「建单→到机码→支付→claim→出纸→回流」现网当场证据仍缺 |
| 小程序 | NO-GO | NO-GO | 从未上传体验版；续签端点后端不存在（见 §三 A1） |
| 主干保护 | 未查 | **main 无 branch protection、rulesets 为空**（`gh api repos/{owner}/{repo}/branches/main/protection` → 404） | 主会话 09-07 发现，本轮复核确认 |

七闸门：G0/G1 PARTIAL，G2 NO-GO，G3 PARTIAL（CI 绿但 admin/partner/miniapp 零浏览器 E2E、小程序与 API 无端点契约门禁），G4/G5 NO-GO，G6 未开始。**整体 PRODUCTION NO-GO。**

## 二、09-05 报告中已被 main 关闭的项（09-07 复核）

| 项 | 关闭提交 | 证据 |
|---|---|---|
| A2 `EndUserAuthGuard` Redis 无界等待 | #841 | `services/api/src/common/guards/end-user-auth.guard.ts:95` `MEMBER_SESSION_STORE_UNAVAILABLE`；next-tasks.md:668 已勾 |
| A3 `admin-orgs` 缓存失效无容错 | #841 | `services/api/src/orgs/admin-orgs.service.ts:821-872` try/catch + `staleWindowSeconds`；next-tasks.md:669 已勾 |
| 告警 `take:50` 截断 | #841 | next-tasks.md:670 已勾 |
| A5 合规扫描不含小程序 | #864 | `scripts/verify-compliance-copy.mjs:38-39` 扫 `apps/miniapp/pages` `.js/.wxml` 与 `utils` |
| 扫码上传 Redis 过期后 FileObject 无主动回收 | #842 | current-progress 09-06「扫码上传生命周期收口」 |
| 简历诊断报告 PDF 导出端点缺失 | #866 | `services/api/src/ai/resume-report-export.controller.ts:51` `@Post(':taskId/export')` |
| 原型 03 页登录端点错标 / 28 页 `booth-map` / 42 页缺 `kiosk/` 前缀 | #795 | `docs/design/kiosk-redesign-2026-08/03-login-gate.html:25,29`、`28-jobfair-enhanced.html:29`、`42-offline-agency-directory.html:17,21`（**仅入库版；产品负责人本地副本未同步，见 §四**） |
| 原型 24 页 `/services`、37 页 `/print/pickup` 死链 | #795 | 两串在入库版 0 命中 |
| 生产 PM2 `NODE_ENV` / 启动门禁 / 备份 | 09-01 B1 + 09-06 三次发布 | current-progress 09-06 记录 `DEPLOY_SOURCE=1b2195adf`、health/ready 200、pm2-logrotate 已装 |
| 证书续期 | 自动 | 09-05 实测 `notAfter=2026-12-03`，续期正常（09-05 报告口头引用的「10-04 到期」为旧文档快照，撤回） |

## 三、仍开的阻塞（09-07 复核，按归属）

### A. 代码侧（按主会话 lane 归属）

| # | 问题 | 证据 | lane |
|---|---|---|---|
| A1 | 小程序每次 401 调 `POST /member/auth/wx-resignin`，后端零实现；JWT 30m 过期后补签 404 → 登出，取件页首当其冲。#867 API-18 滑动续期只缓解不解决 | `apps/miniapp/utils/request.js:40`；`git grep resignin -- services/api/src` = 0 | API |
| A4 | `compliance-boundary.md §4.4A` 与 `feature-scope.md §2.7.1` 被 `9d3bc4789` 整批覆盖丢失，CLAUDE.md 引用两处悬空；`JobApplication` 能力已在 main 运行 | `git show 4ab3dd5b2:docs/compliance/compliance-boundary.md \| grep -c 4.4A` = 4，HEAD = 0；须从 `4ab3dd5b2` 精确取回 | 主会话 |
| A6 | `deploy.yml` 判据仍打 `/health`（Redis 降级时 200 `degraded` 也算过）而非 `/health/ready`；`DEPLOY_API_ENABLED` 同时是 job 开关与 API 开关，「只发前端」分支不可达；前端 `rm -rf` 后无独立回滚锚点 | `.github/scripts/deploy-api-release.sh:27,252`；`deploy.yml` `health/ready` 0 命中 | 部署 |
| A7 | `TERMINAL_ADMIN_SECRET` / `TERMINAL_ACTION_TOKEN_SECRET` 未进 `production-runtime-gates.ts`（只 `requireEnv` 非空，不拒 `.env.example` 样值）；`CORS_ALLOWED_ORIGINS` / `PRINT_SCAN_CAPABILITY_MODE` / `TRUST_PROXY_HOPS` 在示例里只是注释 | `services/api/src/config/production-runtime-gates.ts` 两键 0 命中 | API |
| A8 | Kiosk 可读的 AI 能力状态端点不存在（05 页「能力仪表带」无数据源，后端只有 `/admin/ai/usage`） | `git grep "ai/capabilities" -- services/api/src` = 0 | API |
| A9 | `claim-pickup.dto.ts:6-7` 注释仍写「6 位新码」，实际 8 位（`common/pickup-code.ts`） | 同左 | API |
| A10 | 账号注销服务端硬拒；小程序上架审核通常要求注销路径 | `services/api/src/member-privacy/member-data-request.service.ts:63` `ACCOUNT_CLOSURE_NOT_AVAILABLE` | 待产品裁决后归 API |
| A11 | `LegalDocVersion` 无 seed、无激活版本；三端协议为「试运营/草拟版」；小程序在生产库为空时协议正文打不开 | `services/api/prisma/seed.ts` 0 命中；`apps/miniapp/utils/api.js:164-171` | 法务定稿后归 API |
| A12 | `graph:check` 未进 CI；`files.service.ts` 1338 行越过 §8 1000 行红线，另 9 文件在 800–1000 禁堆区 | `pnpm graph:check` exit 1（09-05 实跑） | 治理 |
| A13 | 三端零浏览器 E2E（`@playwright/test` 仅 kiosk 依赖）；小程序与 API 无端点契约门禁（A1 因此漏网） | `apps/admin` / `apps/partner` / `apps/miniapp` 无 `tests/` | QA |

### B. 需产品负责人 / 现场 / 第三方动手

1. **内容录入**：数据负责人定来源授权 → 管理员标机构 `contentTrustStatus=active` → 运营按 `docs/operations/seed-content-entry-checklist-2026-08.md` 录入 → 复测三端 `total>0`。09-07 仍空。
2. **法务审定**用户协议与隐私政策，并在 Admin `/legal-docs` 激活正式版。
3. **账号注销**是否本期开放（裁决后转 A10）。
4. **台架四项与现场 54 项**（`docs/device/production-deployment-and-windows-host-checklist.md` §四/§五）：彩色双面、扫码器、麦克风、断网中打印、卡纸缺纸、U 盘、SMB 扫描、绑定码激活。未验前不得在 Admin 把 `color_print` / `duplex_print` 标 `available`。`apps/terminal-agent/src/printer/types.ts:44`「2026-09-02 产品负责人真机验证通过」仓库内无证据，要么补证要么删。
5. **备份与恢复**：每日 `pg_dump` 定时 + 异机副本 + 生产主机带计时回滚演练（当前只有发布时一次备份且与生产同盘）。
6. **百度 OCR 密钥轮换**（BL-05），仓库内不可验证。
7. **小程序体验版上传**（与后端同 SHA）。
8. **给 main 加 branch protection**（required checks：CI 三 job），当前任何人可直推。

### C. 查实但不阻塞上线（P1）

- `feature-scope §1.1` 承诺「服务端报价与支付」，小程序无 `wx.requestPayment`，实际现场支付。改文档或补渠道。
- 材料包 `POST /orders/package`、职业圈 `/community/feeds`、早报 `/assistant/daily-report` 后端不存在；`community` / `daily-report` 两页已注册可直达。
- 求职进度双实现：小程序本地 storage vs 后端 `/me/job-applications`（无前端消费者）。
- 线上招聘平台目录硬编码 4 家，Admin 无 `/online-platforms` 路由。
- 支付回调 nonce 防重放为进程内 Map（`online-payment.service.ts:131`），横向扩容前迁 Redis；API 进程内 cron 无分布式锁。
- 无稿页体检 16 项修 4 项，余 12（`page-audit-no-design-2026-09-02.md`）。
- 奔图开放 API 服务端零实现（合规预留，未开工）。

## 四、原型 ↔ 运行时路由 ↔ 后端接口 对齐（回答「能否一次做完 106 路由替换、接口零缺口」）

**答案：不能一次零缺口；但路由层已对齐，缺口集中在接口标注与状态定义。** 51 页是静态 HTML，只能作为视觉真值逐页迁进 React（`COVERAGE-MATRIX.md:17` 自述）。

**路由层**：`apps/kiosk/src/routes/index.tsx`、`apps/kiosk/tests/visual/route-manifest.ts`、`docs/design/kiosk-redesign-2026-08/kimi-full-coverage-v2/COVERAGE-MATRIX.md` 表二三份各 106 条，逐条零差异；无「K 待建」。

**入库版 vs 本地副本分歧（09-07 新增事实）**：main 的 #795（09-06 01:42）修了 03/28/42 页接口标注并去掉两处死链；产品负责人主 checkout（分支 `codex/governance-safety-20260822`，该目录未跟踪）的副本**没有这些修复**（03 页仍 `member/sms-code` + `local/qr-login/status`，28 页仍 `booth-map`，42 页仍无前缀），却含 09-05 凌晨的版式改动（01-home 等）。两边各自前进，共 52 个文件不同。**合并前必须以入库版为基底把本地改动 rebase 上去，不能整目录覆盖。**

**原型侧仍要改（对入库版）**
- 37 页 `latestAttempt` → `attempt`（`37-pay-states.html:15`；实际字段 `packages/shared/src/types/cashier.ts:70`）。
- 07/24 页死链：`/me/records`（07:559,566,586）→ `/me/activity`；`/print/arrival-code`（07:556,583,613）→ `/print/pickup-claim`；`/profile/records`（24:899-1386 共 6 处）→ `/me/resumes`。
- 15 页「取件码与页数来自 `/print/jobs/:taskId`」不成立，运行时取自 pay-status（`15-print-fulfill.html:13,347`；`PrintDonePage.tsx:157`）。
- 13 页补 `/materials/tasks*` PII 端点标注（`materials.controller.ts:26-64`）。
- 30 页「看出纸」链到 33 页，台账 099 唯一宿主是 11 页（`30-my-profile.html:393,542`）。

**后端仍要补**：A8 Kiosk AI 能力端点；A9 注释；（可选）`/me/browse-logs/:id` 详情端点，否则 39 页 `not-found` 态只能前端模拟。

**状态层「原型有、后端无」**：`partial-output` / `paid-no-output`（`PrintTaskStatus` 无此值，Agent 无页级回流；台账 §四.1 自禁逐页递增，自相矛盾）；`partial-refunded`（`payment.ts:21-22` 仅预留）；`/me/activity/:id` 详情态。

## 五、待产品负责人裁决（7 项，未裁前对应批次不开工）

1. `partial-output` / `paid-no-output` 两态：删，或立项 Agent 页级出纸回流。
2. `partial-refunded` 本期是否接动作，否则 32 页删该态。
3. 02-services（全部服务）与 36-index（服务导览）要不要成正式路由；不要则 01-home:148,152 入口改指五 Hub，否则 106 冻结基线变 107/108。
4. 33-pickup-code 与 11-arrival-code 是同一 `Order.pickupCode` 的两套页面，裁一个（`REUSE-MAP.md:67`）。
5. 37-pay-states 自称「非真值页」却仍被 36 索引链接，留不留。
6. 05、29 页在 `REUSE-MAP.md:134` 仍「待独立复审」，先复审再迁还是直接迁。
7. `DESIGN-PLAN.md:123-126` 出纸口灯效 / 盖板感知 / 防窥遮罩与台账硬件边界冲突，需明确本期不做并从 15/18 页视觉去掉暗示。

另两项已在 next-tasks 待裁决区：无稿 4 页（`/ai/plan`、`/resume/export`、两个 `freshman-insights`）去留；`GET /me/summary` 不建（30 页已自我更正，与 `useMemberProfileOverview.ts:52` 一致，可关闭）。

## 六、工作量与日历（估算，假设见末）

| 工作流 | 人日 |
|---|---|
| 51 页迁移（09-07 已 4 页；含逐页六条验收、删旧壳层、改旧门禁） | 95 到 115 |
| A 组代码修复 + 两个后端端点 + 文档回写 | 15 到 20 |
| 账号注销 | 4 到 6 |
| 关键链路 E2E 留证（小程序建单→Admin→退款；Partner 导入→Admin 审核发布） | 5 到 8 |
| 发布、备份、回滚演练、密钥轮换 | 3 到 4 |
| 裁决落文档、内容录入 50 条、协调法务 | 5 到 8 |
| **工程合计** | **127 到 161** |

| 口径 | 人力 | 日历 |
|---|---|---|
| 全部解决（含 51 页） | 3 前端 + 1 后端 + 负责人 | 约 3 到 3.5 个月 |
| 全部解决（含 51 页） | 1 人 | 约 9 到 10 个月（第 2 月末可有旧视觉可用系统） |
| 先商用、视觉迁移边运营边推 | 1 后端 + 负责人 + 法务 + 运营 | 约 6 到 8 周 |

假设：每月 20 工作日；迁移按取件码页样板（约 700 行/页）外推，简单 0.75 / 中等 1.75 / 复杂 3.5 人日；法务 2 到 4 周为外部常见值；真机验收后留 1 到 2 周修复缓冲；不含奔图开放 API、材料包与职业圈后端、目录后台化、`files.service.ts` 拆分。**口径二能否选是产品负责人决定**：08-19 阻塞清单写「V6 逐页迁移不卡上线」，09-02 判定写「51 页只落地 1 页不具备商用」，两口径并存，09-03 视觉真值裁决后现行为后者。

## 七、文档与代码不一致（须回写，否则下一个人按旧口径做错）

- `docs/delivery/kiosk-redesign-r1/delivery.yaml:40,47` 仍写 0/51，实际 4/51；`release_revision` 仍指 09-02 分支；BL-02 描述仍是 `771d53e2` 落后 107。
- `docs/reviews/wiring-ledger-2026-09-02.md` §一 仍 0/51。
- `docs/progress/next-tasks.md:69-71` 待裁决第 1 条「sidecar 不存在」已被 #784 关闭。
- `docs/device/production-deployment-and-windows-host-checklist.md:18` 头部「只发 Kiosk、API 不在流水线」过期（`deploy.yml` 已含 API）；§3.2 已核实项（`NODE_ENV`、runtime gates、ready 200）未回填。
- CLAUDE.md §3「彩色/双面待真机验证」与 bench 文档「DTO 硬拒」过期：DTO 已放开，第二层由 `TerminalCapabilitiesService` 逐机 fail-closed。
- `docs/delivery/kiosk-redesign-r1/delivery.yaml` `environments.production.url` 仍写落后 107。

## 八、本轮不做的事

本文只落账。A1 / A7 / A8 / A9 归 API lane，A6 归部署 lane，A4 与原型标注归主会话（「简历优化功能完善」）派发；不在本 PR 内做任何代码修复。
