# 岗位信息 AI 商用闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将岗位信息板块升级为基于真实简历、真实岗位、真实 AI 和真实运营数据的商用级 AI 求职辅助闭环。

**Architecture:** 复用现有岗位接入、审核发布、AI 简历解析、`job_fit`、收藏、浏览、外部跳转、求职材料和打印链路；新增岗位 AI 会话、推荐结果、数据质量、生产真实化门禁、Admin / Partner 运营视图。Kiosk 只呈现求职者决策所需内容，运营验收与字段质量移到 Admin / Partner。

**Tech Stack:** React + Vite + TypeScript + Tailwind CSS + NestJS + Prisma + PostgreSQL + Redis + COS + LLM Provider + 百度 OCR + 既有打印链路。

---

## Scope

本计划覆盖：

- Kiosk `/jobs`、`/jobs/:id`、`/resume/job-fit`、`/resume/optimize`、`/resume/materials`、模拟面试入口的岗位上下文打通。
- API 侧岗位 AI 推荐、岗位解读、岗位匹配、AI 调用日志、数据质量、生产禁 mock 门禁。
- Prisma 模型、共享类型、verify 脚本、Admin / Partner 运营页面。
- 真实数据验收：客户岗位样本、真实会员、真实简历、真实 LLM、PostgreSQL、COS、浏览器和一体机触控。

本计划不覆盖：

- 平台内投递。
- 企业查看或筛选候选人。
- 简历发送给企业。
- 面试邀约、Offer 管理、投递状态追踪。
- 录用概率、百分比匹配率、保面试或保录用承诺。
- 静态 mock 推荐、随机匹配等级、假 PDF 或假岗位。

## Product Boundary

允许链路：

```text
查看岗位 -> AI 解读 / AI 匹配参考 / 收藏 -> 定向优化简历 / 生成求职材料 / 模拟面试 -> 去来源平台投递 / 扫码投递
```

禁止链路：

```text
用户简历 -> 平台内投递 -> 企业收简历 -> 企业筛候选人 -> 面试邀约 / Offer
```

## Real Data Contract

生产环境必须满足：

- `VITE_API_MODE=http`，Kiosk 不允许用 mock 适配器冒充岗位、材料、AI 结果。
- `AI_PROVIDER=llm` 或明确接入的真实服务提供方；生产不得使用 `mock`、未实现的 stub provider 或 disabled OCR。
- `FILE_STORAGE_DRIVER=cos` 或客户正式存储驱动；用户文件只用短时签名 URL。
- `DATABASE_URL` 指向 PostgreSQL，Redis 可用，AI 调用限流依赖 Redis。
- 未配置真实 AI / OCR / COS / Redis 时，页面必须诚实显示“服务未启用 / 暂不可用”，不得生成假结果。

---

## Data Model Plan

### Existing Models To Reuse

- `Job`：真实岗位来源、审核、发布、来源链接、岗位描述与要求。
- `JobSource`：客户 API / Excel / Webhook 数据源配置。
- `AiResumeResult`：现有 `parse`、`optimize`、`generate`、`job_fit`、`career_plan` 结果沉淀。
- `Favorite`：岗位收藏。
- `BrowseLog`：本人浏览岗位记录。
- `ExternalJumpLog`：本人打开来源投递入口记录。
- `FileObject` / `PrintTask`：优化简历、求职材料 PDF 与打印。
- `AuditLog`：管理员操作与敏感业务动作审计。

### New Or Extended Models

- Add `JobAiSession`
  - Purpose: 一次岗位 AI 会话，包括推荐、解读、对比、岗位详情匹配。
  - Fields: `id`、`endUserId`、`resumeTaskId`、`operation`、`intentJson`、`status`、`provider`、`terminalId`、`createdAt`、`expiresAt`。
  - Privacy: 不存简历原文，不存完整聊天原文。

- Add `JobAiRecommendation`
  - Purpose: 批量推荐结果明细。
  - Fields: `id`、`sessionId`、`jobId`、`rank`、`fitLevel`、`summary`、`matchPointsJson`、`gapPointsJson`、`actionChecklistJson`、`createdAt`。
  - Constraint: `fitLevel` 只能是 `reference_high | reference_medium | reference_low`。

- Add `AiServiceLog`
  - Purpose: 替换或补强当前内存型 `AiLogService`，让 Admin 能看到真实成功率、错误码、延迟和成本估算。
  - Fields: `id`、`operation`、`provider`、`status`、`latencyMs`、`errorCode`、`tokenUsageJson`、`estimatedCostCny`、`terminalId`、`endUserId`、`createdAt`。
  - Privacy: 禁止存简历正文、岗位完整要求、AI 输出全文、文件名、签名 URL。

- Add `UserAiConsent`
  - Purpose: 记录用户把简历送入 AI 分析前的授权版本。
  - Fields: `id`、`endUserId`、`consentVersion`、`scope`、`grantedAt`、`revokedAt`、`terminalId`。

- Add `UserDataRequest`
  - Purpose: 本人数据导出 / 删除 / 撤回同意请求。
  - Fields: `id`、`endUserId`、`requestType`、`status`、`requestedAt`、`handledAt`、`handledBy`、`auditRef`。

- Add `JobDataQualitySnapshot`
  - Purpose: 管理端查看真实岗位数据是否足以支撑 AI 推荐。
  - Fields: `id`、`jobId`、`sourceOrgId`、`missingFieldsJson`、`qualityLevel`、`sourceUrlReachable`、`checkedAt`、`lastError`。

- Add optional job normalized fields or JSON payload
  - `educationRequirement`、`experienceRequirement`、`skillsJson`、`benefitsJson`、`salaryMin`、`salaryMax`、`salaryUnit`、`validThrough`。
  - SQLite / PostgreSQL 双栈阶段优先用 additive nullable columns 和 JSON string，禁止破坏已有导入。

---

## File Structure

### Shared

- Modify: `packages/shared/src/types/job.ts`
  - Add standard job quality and normalized field contracts.
- Modify: `packages/shared/src/types/ai.ts`
  - Add `JobAiSessionDTO`、`JobRecommendationRequest`、`JobRecommendationResponse`、`JobExplainResponse`、`TargetJobContext`。
- Modify: `packages/shared/src/index.ts`
  - Export new contracts.

### API

- Modify: `services/api/prisma/schema.prisma`
  - Add additive models and nullable fields.
- Create: `services/api/prisma/migrations/20260701090000_add_job_ai_commercial_closure/migration.sql`
- Create: `services/api/prisma/migrations/20260701091000_add_job_quality_fields/migration.sql`
- Create: `services/api/src/job-ai/job-ai.module.ts`
- Create: `services/api/src/job-ai/job-ai.controller.ts`
- Create: `services/api/src/job-ai/job-ai.service.ts`
- Create: `services/api/src/job-ai/job-ai-llm.service.ts`
- Create: `services/api/src/job-ai/job-context.service.ts`
- Create: `services/api/src/job-ai/job-quality.service.ts`
- Create: `services/api/src/job-ai/job-ai.types.ts`
- Modify: `services/api/src/ai/ai-log.service.ts`
- Modify: `services/api/src/ai/ai.module.ts`
- Modify: `services/api/src/jobs/jobs.service.ts`
- Modify: `services/api/src/jobs/jobs.controller.ts`
- Modify: `services/api/src/job-sync/job-sync.service.ts`
- Modify: `services/api/src/app.module.ts`
- Create: `services/api/scripts/verify-job-ai.ts`
- Create: `services/api/scripts/verify-job-data-quality.ts`
- Create: `services/api/scripts/verify-production-real-services.ts`

### Kiosk

- Modify: `apps/kiosk/src/pages/jobs/JobsPage.tsx`
- Modify: `apps/kiosk/src/pages/jobs/JobDetailPage.tsx`
- Create: `apps/kiosk/src/pages/jobs/components/JobAiEntryPanel.tsx`
- Create: `apps/kiosk/src/pages/jobs/components/JobAiRecommendationList.tsx`
- Create: `apps/kiosk/src/pages/jobs/components/JobAiExplanationPanel.tsx`
- Create: `apps/kiosk/src/pages/jobs/components/JobSourceActionBar.tsx`
- Modify: `apps/kiosk/src/pages/resume/JobFitPage.tsx`
- Modify: `apps/kiosk/src/pages/resume/ResumeOptimizePage.tsx`
- Modify: `apps/kiosk/src/pages/resume/JobMaterialLibraryPage.tsx`
- Modify: `apps/kiosk/src/pages/interview/InterviewSetupPage.tsx`
- Modify: `apps/kiosk/src/services/api/interview.ts`
- Create: `apps/kiosk/src/services/api/jobAi.ts`
- Modify: `apps/kiosk/src/services/api/jobFit.ts`
- Create: `apps/kiosk/scripts/verify-job-ai-ui.mjs`

### Admin

- Create: `apps/admin/src/routes/job-quality/index.tsx`
- Create: `apps/admin/src/routes/job-ai-operations/index.tsx`
- Create: `apps/admin/src/services/api/jobQuality.ts`
- Create: `apps/admin/src/services/api/jobAiOperations.ts`
- Modify: `apps/admin/src/routes/job-sources/index.tsx`
- Modify: `apps/admin/src/routes/index.tsx`
- Modify: `apps/admin/src/layouts/AdminLayoutWrapper.tsx`
- Create: `apps/admin/scripts/verify-admin-job-ai-ui.mjs`

### Partner

- Modify: `apps/partner/src/routes/jobs/index.tsx`
- Modify: `apps/partner/src/routes/sources/index.tsx`
- Modify: `apps/partner/src/services/api/dataSources.ts`
- Modify: `apps/partner/src/routes/index.tsx`
- Modify: `apps/partner/src/layouts/PartnerLayoutWrapper.tsx`
- Create: `apps/partner/scripts/verify-partner-job-quality-ui.mjs`

### Docs

- Modify: `docs/product/feature-scope.md`
- Modify: `docs/product/user-data-flow-matrix.md`
- Modify: `docs/compliance/compliance-boundary.md` if new AI consent or privacy text changes existing compliance boundary.
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`

---

## Task 1: Production Real-Service Gates

**Files:**
- Create: `services/api/src/common/runtime/production-real-service.guard.ts`
- Modify: `services/api/src/main.ts`
- Modify: `services/api/src/ai/llm/llm-config.service.ts`
- Modify: `services/api/src/ai/ai.service.ts`
- Modify: `apps/kiosk/src/services/api/client.ts`
- Create: `services/api/scripts/verify-production-real-services.ts`
- Modify: `services/api/package.json`
- Modify: `apps/kiosk/package.json`

- [ ] Add an API startup guard that rejects production startup when `AI_PROVIDER=mock`, OCR provider is disabled, `FILE_STORAGE_DRIVER=local`, Redis is missing, or `DATABASE_URL` is not PostgreSQL unless an explicit non-production override is set.
- [ ] Add Kiosk production guard that rejects production builds with `VITE_API_MODE=mock`.
- [ ] Make mock branches in Kiosk services return explicit development-only unavailable errors in production.
- [ ] Write `verify:production-real-services` to scan API/Kiosk configs and fail on production mock paths.
- [ ] Run `pnpm --filter @ai-job-print/api verify:production-real-services`.

Expected result: production cannot silently run fake AI, fake OCR, fake file, fake job recommendation, or fake API mode.

## Task 2: Shared Contracts And Additive Schema

**Files:**
- Modify: `packages/shared/src/types/job.ts`
- Modify: `packages/shared/src/types/ai.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `services/api/prisma/schema.prisma`
- Create: `services/api/prisma/migrations/20260701090000_add_job_ai_commercial_closure/migration.sql`
- Create: `services/api/prisma/migrations/20260701091000_add_job_quality_fields/migration.sql`
- Create: `services/api/scripts/verify-job-ai.ts`

- [ ] Define `TargetJobContext` with `jobId`、`title`、`company`、`sourceName`、`sourceUrl`、`externalId`、`description`、`requirements`、`skills`、`city`、`category`。
- [ ] Define `JobRecommendationRequest` with `resumeTaskId`、optional `accessToken` mode、`intent`、`filters`、`limit`。
- [ ] Define `JobRecommendationResponse` with only real published jobs and three-level `fitLevel` values.
- [ ] Add `JobAiSession`、`JobAiRecommendation`、`AiServiceLog`、`UserAiConsent`、`UserDataRequest`、`JobDataQualitySnapshot` to Prisma as additive changes.
- [ ] Add nullable normalized job fields without breaking existing `Job` inserts.
- [ ] Generate Prisma clients for SQLite and PostgreSQL.
- [ ] Run shared and API typecheck.

Expected result: frontend, API, Admin and Partner use the same contract; schema migration is additive and safe.

## Task 3: Job Data Quality And Source Readiness

**Files:**
- Create: `services/api/src/job-ai/job-quality.service.ts`
- Modify: `services/api/src/jobs/jobs.service.ts`
- Modify: `services/api/src/job-sync/job-sync.service.ts`
- Modify: `services/api/src/jobs/dto/import-jobs.dto.ts`
- Modify: `services/api/src/jobs/dto/excel-import.dto.ts`
- Create: `services/api/scripts/verify-job-data-quality.ts`

- [ ] Compute required field quality: title, company, city, sourceName, sourceUrl, externalId, syncTime, description or requirements.
- [ ] Compute recommended AI-ready fields: salary, category, industry, skills, education, experience, validThrough.
- [ ] Validate `sourceUrl` format and periodically check reachability without blocking Kiosk browse.
- [ ] Mark stale jobs whose `syncTime` exceeds the configured freshness window.
- [ ] Add a server method returning quality summary by source organization and data source.
- [ ] Keep Kiosk responses honest: missing fields display “来源平台未提供”, never invented content.
- [ ] Run `verify:job-data-quality` against seeded and real imported samples.

Expected result: Admin/Partner can see whether customer job data is good enough for AI; Kiosk does not show internal field completeness panels.

## Task 4: Job AI Backend

**Files:**
- Create: `services/api/src/job-ai/job-ai.module.ts`
- Create: `services/api/src/job-ai/job-ai.controller.ts`
- Create: `services/api/src/job-ai/job-ai.service.ts`
- Create: `services/api/src/job-ai/job-ai-llm.service.ts`
- Create: `services/api/src/job-ai/job-context.service.ts`
- Modify: `services/api/src/ai/resume/job-fit.service.ts`
- Modify: `services/api/src/ai/resume/llm-job-fit.service.ts`
- Modify: `services/api/src/ai/ai-log.service.ts`
- Modify: `services/api/src/app.module.ts`

- [ ] Add `POST /api/v1/jobs/ai/recommendations`.
  - Input: authorized `resumeTaskId`, optional intent and filters.
  - Output: only approved + published jobs.
  - Ranking: deterministic prefilter by city/category/skills/title plus LLM explanation for top results.
  - Failure: if AI unavailable, return service-unavailable error, not fake recommendations.
- [ ] Add `POST /api/v1/jobs/:id/ai/explain`.
  - Output: responsibilities, must-have requirements, nice-to-have requirements, preparation tips, data quality warning.
  - No resume required, but rate-limited by terminal/IP/member.
- [ ] Add `POST /api/v1/jobs/:id/ai/match`.
  - Reuse existing `JobFitService` contract and persist a `JobAiSession` reference.
- [ ] Add `GET /api/v1/me/job-ai-sessions` and `DELETE /api/v1/me/job-ai-sessions/:id`.
  -本人只能看自己的 AI 岗位记录。
- [ ] Persist `AiServiceLog` for recommendations, explain, match, resume optimize, materials, interview operations.
- [ ] Add service-level output guards:
  - reject percentages and录用概率。
  - reject platform投递 wording。
  - reject unsupported claims not grounded in job/resume text.

Expected result: Kiosk AI 能力全部来自后端真实服务，并能回看、删除、审计和限流。

## Task 5: User Consent, Privacy And Quota

**Files:**
- Create: `services/api/src/member-privacy/member-privacy.module.ts`
- Create: `services/api/src/member-privacy/member-privacy.controller.ts`
- Create: `services/api/src/member-privacy/admin-member-privacy.controller.ts`
- Create: `services/api/src/member-privacy/member-privacy.service.ts`
- Create: `services/api/src/member-privacy/member-privacy.types.ts`
- Modify: `services/api/src/app.module.ts`
- Modify: `services/api/src/job-ai/job-ai.controller.ts`
- Modify: `apps/kiosk/src/pages/resume/ResumeParsePage.tsx`
- Modify: `apps/kiosk/src/pages/jobs/JobsPage.tsx`
- Modify: `apps/kiosk/src/pages/jobs/JobDetailPage.tsx`
- Create: `services/api/scripts/verify-job-ai-privacy.ts`

- [ ] Before sending resume content to AI recommendation or matching, require current consent version.
- [ ] Kiosk displays concise consent copy: AI will analyze the user resume and selected jobs only for本人求职辅助; it will not send resume to enterprises.
- [ ] Add revoke / delete / export request endpoints in `MemberPrivacyController` and processing actions in `AdminMemberPrivacyController`.
- [ ] Add Redis rate limits by terminalId, endUserId, IP and operation.
- [ ] Add daily per-terminal and per-member quota configuration.
- [ ] Ensure anonymous access token flows inherit existing resume result TTL and fail closed after expiry.
- [ ] Run privacy verifier to ensure no logs contain resume text, signed URL, file name or AI full output.

Expected result: AI use has consent, quota, expiry and deletion path; public terminal abuse is controlled.

## Task 6: Kiosk Job List Redesign To User-First AI Flow

**Files:**
- Modify: `apps/kiosk/src/pages/jobs/JobsPage.tsx`
- Modify: `apps/kiosk/src/pages/jobs/components/JobListInsights.tsx`
- Create: `apps/kiosk/src/pages/jobs/components/JobAiEntryPanel.tsx`
- Create: `apps/kiosk/src/pages/jobs/components/JobAiRecommendationList.tsx`
- Modify: `apps/kiosk/src/pages/jobs/components/JobResultsSection.tsx`
- Create: `apps/kiosk/src/services/api/jobAi.ts`
- Create: `apps/kiosk/scripts/verify-job-ai-ui.mjs`

- [ ] Remove or relocate front-facing `DataReadinessPanel` and `JobBusinessNote` from the Kiosk seeker page.
- [ ] Keep first screen focused on search, filters, “用我的简历智能推荐”, and 4 to 6 visible real job cards.
- [ ] Add AI recommendation entry that requires a real `resumeTaskId` or routes user to upload/select resume.
- [ ] Display recommendation cards with fit level, source, city, salary if provided, and concise reason.
- [ ] If no AI result exists, show honest empty state, not a synthetic recommendation.
- [ ] Add Busy Lock while recommendations are being generated.
- [ ] Ensure all buttons are 48px or taller and touch spacing is 12px or more.
- [ ] Run `verify:job-ai-ui` and Kiosk browser screenshot checks.

Expected result: Kiosk 岗位列表像求职工具，不像运营看板；AI 推荐从真实后端返回。

## Task 7: Kiosk Job Detail AI And Source Action Closure

**Files:**
- Modify: `apps/kiosk/src/pages/jobs/JobDetailPage.tsx`
- Modify: `apps/kiosk/src/pages/jobs/components/JobDetailSections.tsx`
- Create: `apps/kiosk/src/pages/jobs/components/JobAiExplanationPanel.tsx`
- Create: `apps/kiosk/src/pages/jobs/components/JobSourceActionBar.tsx`
- Modify: `apps/kiosk/src/services/api/activity.ts`
- Modify: `apps/kiosk/src/services/api/jobAi.ts`

- [ ] Add “AI 帮我解读岗位” using `POST /jobs/:id/ai/explain`.
- [ ] Add “用我的简历匹配这个岗位” using `POST /jobs/:id/ai/match`.
- [ ] Show responsibilities, requirements, gap suggestions and preparation checklist in compact sections.
- [ ] Keep one primary source action: “扫码投递” or “去来源平台投递” depending on device flow.
- [ ] Record `BrowseLog` when detail loads.
- [ ] Record `ExternalJumpLog(action=external_apply)` only when the user opens the source QR/link.
- [ ] Do not record whether the user actually submitted on the third-party platform.
- [ ] Route contextual actions with `TargetJobContext` to resume optimize, job materials and mock interview.

Expected result: 岗位详情完成“理解岗位 -> 准备材料 -> 来源平台办理”的闭环。

## Task 8: Cross-Page Job Context Integration

**Files:**
- Modify: `apps/kiosk/src/pages/resume/JobFitPage.tsx`
- Modify: `apps/kiosk/src/pages/resume/ResumeOptimizePage.tsx`
- Modify: `apps/kiosk/src/pages/resume/JobMaterialLibraryPage.tsx`
- Modify: `apps/kiosk/src/pages/interview/InterviewSetupPage.tsx`
- Modify: `apps/kiosk/src/services/api/interview.ts`
- Modify: `apps/kiosk/src/routes/index.tsx`
- Modify: `services/api/src/ai/dto/resume-optimize.dto.ts`
- Modify: `services/api/src/job-materials/dto/generate-job-material.dto.ts`
- Modify: `services/api/src/mock-interview/mock-interview.controller.ts`
- Modify: `services/api/src/mock-interview/mock-interview.service.ts`
- Modify: `services/api/src/mock-interview/mock-interview-llm.service.ts`

- [ ] Standardize `TargetJobContext` in route state and API request payloads.
- [ ] `JobFitPage` accepts a preselected job from `/jobs/:id` and does not force user to search again.
- [ ] `ResumeOptimizePage` accepts target job context and makes the prompt optimize for that job without fabricating experience.
- [ ] `JobMaterialLibraryPage` pre-fills company, position and source context for求职信 / 自荐信.
- [ ] Mock interview setup pre-fills job title, company, requirements and difficulty defaults.
- [ ] Generated PDFs and reports include source context when appropriate, but never include “已投递” or similar status.
- [ ] AI service records keep only metadata and safe summaries.

Expected result: 用户不需要重复输入岗位信息，各页面都围绕同一真实岗位继续服务。

## Task 9: Admin Job Quality And AI Operations

**Files:**
- Create: `apps/admin/src/routes/job-quality/index.tsx`
- Create: `apps/admin/src/routes/job-ai-operations/index.tsx`
- Create: `apps/admin/src/services/api/jobQuality.ts`
- Create: `apps/admin/src/services/api/jobAiOperations.ts`
- Modify: `apps/admin/src/routes/job-sources/index.tsx`
- Modify Admin route and layout registries.
- Create: `apps/admin/scripts/verify-admin-job-ai-ui.mjs`
- Modify API admin controller/service for quality and logs.

- [ ] Add Admin “岗位数据质量” page:
  - source coverage.
  - missing required fields.
  - stale jobs.
  - invalid source URLs.
  - AI-ready field completeness.
  - unpublished/rejected counts.
- [ ] Add Admin “岗位 AI 运营” page:
  - calls by operation.
  - success / failure.
  - latency.
  - cost estimate.
  - top error codes.
  - no content payloads.
- [ ] Enhance job source detail drawer with quality warnings before publish.
- [ ] Add prompt/model config version display to `apps/admin/src/routes/ai-config/index.tsx`; if the API has no version model yet, add a read-only “当前版本 / 上次更新时间 / 操作人” block backed by `AiServiceLog` metadata first.
- [ ] Run Admin UI verify and typecheck.

Expected result: 管理员能判断客户岗位数据能不能支撑 AI 推荐，也能监控 AI 成本和错误。

## Task 10: Partner Source Quality And Statistics

**Files:**
- Modify: `apps/partner/src/routes/jobs/index.tsx`
- Modify: `apps/partner/src/routes/sources/index.tsx`
- Modify: `apps/partner/src/services/api/dataSources.ts`
- Create: `apps/partner/scripts/verify-partner-job-quality-ui.mjs`
- Modify API partner endpoints for source-scoped stats.

- [ ] Show field quality warnings during manual entry, Excel import and source mapping.
- [ ] Show source-scoped browse count and external-open count as aggregated numbers only.
- [ ] Keep Partner unable to view user resumes, user names, phone numbers, AI result details or candidate lists.
- [ ] If Partner edits a published job, force pending + draft and require Admin re-review.
- [ ] If Partner disables a source, clearly show affected published/draft job counts and require confirmation.
- [ ] Run Partner verify and typecheck.

Expected result: 合作机构能把源数据补齐，但不能触碰求职者个人数据或招聘闭环。

## Task 11: Verification And Acceptance Gates

**Files:**
- Modify package scripts in `services/api/package.json`、`apps/kiosk/package.json`、`apps/admin/package.json`、`apps/partner/package.json`.
- Create / modify focused verify scripts from previous tasks.
- Modify: `docs/product/user-data-flow-matrix.md`
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`

- [ ] API verification:
  - `pnpm --filter @ai-job-print/api typecheck`
  - `pnpm --filter @ai-job-print/api verify:production-real-services`
  - `pnpm --filter @ai-job-print/api verify:job-ai`
  - `pnpm --filter @ai-job-print/api verify:job-data-quality`
  - `pnpm --filter @ai-job-print/api verify:job-ai-privacy`
- [ ] Frontend verification:
  - `pnpm --filter @ai-job-print/kiosk typecheck`
  - `pnpm --filter @ai-job-print/kiosk verify:job-ai-ui`
  - `pnpm --filter @ai-job-print/admin typecheck`
  - `pnpm --filter @ai-job-print/admin verify:admin-job-ai-ui`
  - `pnpm --filter @ai-job-print/partner typecheck`
  - `pnpm --filter @ai-job-print/partner verify:partner-job-quality-ui`
- [ ] Build verification:
  - API build.
  - Kiosk production build with `VITE_API_MODE=http`.
  - Admin production build.
  - Partner production build.
- [ ] Browser verification:
  - `/jobs`
  - `/jobs/:id`
  - AI recommendation with a real parsed resume.
  - AI explain with a real published job.
  - match -> optimize -> materials -> print confirm.
  - source QR/link external open record.
- [ ] Database verification:
  - `BrowseLog` exists after detail browse.
  - `ExternalJumpLog` exists after source open.
  - `JobAiSession` and `JobAiRecommendation` exist after recommendation.
  - `AiServiceLog` contains metadata only.
  - `FileObject` exists for generated PDF and has safe owner fields.
- [ ] Preproduction verification:
  - real PostgreSQL.
  - real Redis.
  - real COS private bucket.
  - real OCR and LLM keys.
  - controlled member account.
  - customer job API / Excel / Webhook sample.
  - browser screenshots with redacted tokens and signed URLs.
- [ ] Hardware verification:
  - 27 inch vertical touch display.
  - Windows Terminal Agent.
  - Pantum printer real output for generated job materials.
  - QR scan and source link flow.

Expected result: 验收能证明每个页面、接口、数据表、AI 调用和打印动作都是真结果。

## Task 12: Dual-Model Review And Release Decision

**Files:**
- Modify: `.ccg/tasks/job-info-ai-commercial-closure/review.md`
- Modify: docs progress files.

- [ ] Run Claude reviewer on final diff.
- [ ] Run Antigravity reviewer on final diff.
- [ ] Fix all Critical findings.
- [ ] Decide which Warnings must be fixed before preproduction.
- [ ] Record commands, browser evidence and residual risks.
- [ ] Do not call the result “commercial complete” until preproduction real data, real AI, and at least one hardware path have passed.

Expected result: final delivery has dual-model review evidence and does not overclaim production readiness.

---

## Execution Order

1. Real-service gates and no-mock policy.
2. Shared contracts and additive schema.
3. Job data quality and source readiness.
4. Backend Job AI APIs.
5. Kiosk user-first AI flow.
6. Cross-page job context integration.
7. Admin and Partner operational views.
8. Verification, preproduction and hardware acceptance.

## Commercial Acceptance Criteria

- Kiosk seeker pages are simple, touch-friendly and useful on first screen.
- AI recommendations only appear after real resume + real published jobs + real backend AI result.
- Every AI output has explanation, safe fallback, no percentage, no录用承诺.
- Admin can see data quality and AI operation health.
- Partner can improve source data and see aggregate source stats, but cannot view candidates or resumes.
- All generated documents become real `FileObject` records and can enter the print flow.
- All source actions only open source platform entry and record only that opening.
- Production cannot run with mock AI, mock API, mock file, mock OCR or fake recommendations.
