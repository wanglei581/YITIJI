# AI Resume Commercial Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a commercial-grade AI resume workflow that connects diagnosis, targeted optimization, template rendering, preview editing, multi-format export, direct printing, service pricing, package/coupon deduction, payment, refund, and audit without crossing recruitment-platform compliance boundaries.

**Architecture:** Keep the existing Kiosk resume routes as the user-facing entry points. Add explicit backend action boundaries for paid AI optimization/export, introduce a dedicated commerce domain for quote/order/payment/benefit/refund/reconciliation, and keep printing as fulfillment handled by PrintTask/Terminal Agent. The source of truth for rendered resumes is structured `GeneratedResume` plus a selected template; final PDF/PNG/print are rendered from the same backend renderer so the optimized final output is consistent across preview, export, and print.

**Tech Stack:** React + Vite + TypeScript + Tailwind/shadcn/lucide on Kiosk, NestJS + Prisma + PostgreSQL/SQLite dual schema on API, COS/FileObject for artifacts, existing LLM/OCR services for AI, Windows Terminal Agent for print/scan, future WeChat/Alipay/campus-card payment providers.

---

## Reviewed Inputs

- Frontend subagent: confirmed existing `/resume/source -> /resume/parse -> /resume/report -> /resume/optimize -> /print/confirm` path, partial online editing, PDF export, JobFit system/manual JD support, and missing voice/multi-format/template-fill features.
- Backend/payment subagent: confirmed `/resume/generate/export` is PDF-only, `GET /resume/records/:taskId/optimize` has write side effects, `Order` is a zero-amount print skeleton, and `BenefitGrant` lacks a consumption ledger.
- Compliance subagent: found no Critical issue in the plan boundary, but required no platform delivery, no candidate data return to enterprises, no external URL crawling by default, idempotent coupon/payment/refund ledgers, and full production/hardware gates.
- Claude review: required changing the product promise from original-layout preservation to template reflow; prohibited arbitrary external job URL fetching; required a new payment/benefit/refund domain before charging.
- Antigravity review: agreed on backend-rendered export, FileObject handoff to print, card-based editing on the 27-inch touch kiosk, and a dedicated payment/benefit domain.

## Product Decisions

1. **Do not promise original-layout preservation.**
   Current AI export renders structured resume data into platform templates. The supported commercial promise is: AI optimizes the content and reflows it into selected resume templates. Original uploaded PDF/Word layout can be shown in a side-by-side reference preview, but exact layout preservation is not guaranteed.

2. **Guarantee final-output consistency, not original-layout consistency.**
   The optimized preview, exported PDF, exported PNG, and print file must come from the same backend renderer and template version. This gives high consistency for the final optimized resume. Saving as image preserves the final rendered template, not the source document layout.

3. **Do not fetch arbitrary external job URLs in v1.**
   Users may select an approved system job or manually paste JD text. An optional source URL can be stored only as a user-provided reference in the session/artifact metadata, not as a trusted published job and not as a platform delivery target. URL parsing can only become a future allowlisted source-sync feature after legal/security review.

4. **Charge for the final service result, not every button click.**
   Diagnosis can be free or low-price. AI optimization/generation is the paid service. Once paid, the user can re-export the same final version for a limited window without repeated charges. Printing remains a separate per-page service unless bundled by package/coupon.

5. **Paid actions require member login.**
   Anonymous users can use free diagnosis/preview flows within rate limits. Any paid optimization, package/coupon use, refund, long-term artifact retention, or order history must bind to `endUserId`.

6. **Preview page must include direct print.**
   The direct print action must generate or reuse a real FileObject with a short signed URL, then navigate to `/print/confirm` with print parameters. It must not ask the user to re-upload the generated resume.

7. **No recruitment-platform closure.**
   The system never sends resumes to employers, never records third-party delivery results, never provides candidate management, and never uses matching as an employment probability or recommendation to enterprises.

## Current Capability Map

| Area | Current state | Gap to commercial-grade |
| --- | --- | --- |
| Diagnosis | Real parse/diagnosis exists with LLM/OCR gates and owner/accessToken isolation | Add optional diagnosis dimensions without breaking DTO stability |
| Optimization | Existing page shows before/after diff and editable generated resume, exports PDF and prints | Split page before adding full editor, paid action, layout tools, and richer export |
| Generation without electronic resume | Existing guided form and preview editor, PDF export and print | Add voice-assisted input, TXT/Markdown/DOCX/PNG export, template selection |
| Template library | Kiosk route exists but uses static materials and disabled print | Add real template records, template selection, backend rendering |
| JobFit | System job or manual JD, three-level reference, no percentage | Keep URL out of auto-fetch; improve optional source URL reference only |
| Export | PDF only through `resume/generate/export` | Add deterministic TXT/Markdown, then DOCX/PNG through backend renderer |
| Printing | PDF artifact can go to `/print/confirm` | Replace front-end hardcoded price with quote/order; keep PrintTask fulfillment-only |
| Order/payment | `Order` exists, amount is 0, Admin read-only | Add Quote, OrderItem, PaymentAttempt, PaymentTransaction, Refund, BenefitLedger, Reconciliation |
| Benefits | BenefitGrant/Activity/Claim exist for display/claim | Add reserve/consume/release ledger and order binding |

## File Structure Plan

### Frontend

- Modify `apps/kiosk/src/pages/resume/ResumeOptimizePage.tsx`: keep as route container; remove editor/export subtrees into local components before feature expansion.
- Create `apps/kiosk/src/pages/resume/components/ResumeBeforeAfterPreview.tsx`: original report/diff and rendered final preview shell.
- Create `apps/kiosk/src/pages/resume/components/ResumeStructuredEditor.tsx`: editable `GeneratedResume` fields, add/remove sections, validation messages.
- Create `apps/kiosk/src/pages/resume/components/ResumeExportPanel.tsx`: export format controls, print action, export status.
- Create `apps/kiosk/src/pages/resume/components/ResumeAiLayoutActions.tsx`: one-click actions such as compress to one page, layout cleanup, keyword emphasis, and concise rewrite.
- Modify `apps/kiosk/src/pages/resume/ResumeGeneratePage.tsx`: add voice-assisted input buttons inside existing form sections.
- Modify `apps/kiosk/src/pages/resume/ResumeGeneratePreviewPage.tsx`: support template selection and multi-format export panel.
- Modify `apps/kiosk/src/pages/resume/ResumeTemplateLibraryPage.tsx`: replace static materials with backend-backed templates, selected template handoff, and real render gate.
- Modify `apps/kiosk/src/pages/resume/JobFitPage.tsx`: keep system job/manual JD modes; add optional source URL reference field only for display if accepted by backend contract.
- Modify `apps/kiosk/src/pages/print/PrintConfirmPage.tsx`: remove frontend hardcoded pricing after commerce quote lands; display backend quote/order items.
- Create `apps/kiosk/src/pages/commerce/CheckoutPage.tsx`: member login guard, quote review, coupons/packages, QR payment status.

### Backend

- Modify `packages/shared/src/types/ai.ts`: add `ResumeExportFormat`, `ResumeTemplateSummary`, `ResumeExportRequest`, explicit paid-action result types, and avoid duplicating literals in apps.
- Create `services/api/src/ai/resume/export/resume-export.service.ts`: single facade that routes formats to concrete renderers.
- Create `services/api/src/ai/resume/export/resume-pdf-exporter.ts`: wrap existing `ResumePdfService` for common export interface.
- Create `services/api/src/ai/resume/export/resume-text-exporter.ts`: deterministic TXT renderer.
- Create `services/api/src/ai/resume/export/resume-markdown-exporter.ts`: deterministic Markdown renderer.
- Create `services/api/src/ai/resume/export/resume-docx-exporter.ts`: DOCX renderer after dependency review.
- Create `services/api/src/ai/resume/export/resume-image-exporter.ts`: PDF-to-PNG renderer after deciding multi-page output shape.
- Create `services/api/src/ai/resume/templates/*`: template list, template version metadata, rendering constraints.
- Modify `services/api/src/ai/ai.controller.ts`: keep current compatibility endpoints; add explicit POST actions for paid optimize/export when commerce is enabled.
- Modify `services/api/src/ai/ai.service.ts`: route export through `ResumeExportService`, bind `sourceFileId`, and enforce order/fulfillment token when commerce is enabled.
- Modify `services/api/src/files/retention-policy.ts`: add `resume_export` or `resume_artifact` purpose with sensitive retention rules.
- Create `services/api/src/commerce/*`: quote, order, order item, checkout, payment attempt, refund, reconciliation, benefit ledger services.
- Modify `services/api/prisma/schema.prisma` and `services/api/prisma/postgres/schema.prisma`: add commerce models additively and keep SQLite/PostgreSQL parity.
- Modify `services/api/src/print-jobs/print-jobs.service.ts`: accept only paid/free-authorized print fulfillment once commerce is enabled; keep PrintTask free of money fields.

### Admin / Operations

- Extend `apps/admin/src/routes/orders/index.tsx`: show order items, payment attempts, refund status, benefit deductions, fulfillment status.
- Add Admin order detail sections only after backend read APIs exist; do not add mutation buttons before refund/payment state machines are implemented.
- Add reconciliation evidence pages after real payment providers are connected.

### Verification

- Add `services/api/scripts/verify-resume-export-formats.ts`.
- Add `services/api/scripts/verify-resume-template-rendering.ts`.
- Add `services/api/scripts/verify-ai-commercial-flow.ts`.
- Add `services/api/scripts/verify-commerce-quote-order.ts`.
- Add `services/api/scripts/verify-benefit-ledger.ts`.
- Add `services/api/scripts/verify-payment-attempts.ts`.
- Add `services/api/scripts/verify-refunds.ts`.
- Add Kiosk static guard for banned recruitment/payment copy in resume/commerce pages.

## Phase 0: Product and Compliance Contract Lock

**Purpose:** Lock the product promise and non-goals before runtime changes.

**Files:**
- Modify `docs/product/feature-scope.md`
- Modify `docs/compliance/compliance-boundary.md`
- Modify `docs/progress/current-progress.md`
- Modify `docs/progress/next-tasks.md`
- Create `docs/reviews/ai-resume-commercial-closure-review.md`

- [ ] **Step 1: Update product wording**

  Add a product-scope paragraph under AI resume service:

  ```markdown
  AI 简历优化以“内容优化 + 模板重排”为主，不承诺完整保留用户上传原件的字体、分栏、表格、图片和页边距。优化前原件可作为对比参考；优化后预览、PDF、PNG 和打印应由同一服务端模板渲染链路生成，以保证最终成果物一致。
  ```

- [ ] **Step 2: Add external JD boundary**

  Add a compliance paragraph:

  ```markdown
  外部岗位链接不得默认由平台抓取和解析。首期仅支持用户选择已审核发布的系统岗位，或手动粘贴 JD 文本作为本人简历优化参考。任意外部 URL 只能作为用户提供的来源备注或二维码参考，不能被记录为平台已审核岗位，不能触发平台内投递、简历发送、候选人推荐或第三方投递结果记录。
  ```

- [ ] **Step 3: Add charging promise**

  Add service-package wording:

  ```markdown
  AI 简历商业化按服务成果计费：诊断可免费或低价引流；AI 优化、AI 生成、模板成果和打印按后台 SKU/套餐/优惠券规则报价。已支付的同一最终成果在有效期内可重复导出支持格式，不按每次点击导出重复收费。打印按实际打印参数单独计费，除非被套餐或券抵扣。
  ```

- [ ] **Step 4: Verify wording**

  Run:

  ```bash
  rg -n "原版式保真|一键投递|立即投递|平台投递|投递简历|保录用|保面试|补贴必到账|录用概率|通过率" docs/product docs/compliance docs/superpowers/plans docs/reviews
  ```

  Expected: No forbidden promise. Allowed phrase `去来源平台投递` may appear only as the approved compliance wording.

## Phase 1: Resume Optimize Page Split and Final Preview

**Purpose:** Make the current optimize page safe to extend and add a commercial-grade before/after preview/edit surface.

**Files:**
- Modify `apps/kiosk/src/pages/resume/ResumeOptimizePage.tsx`
- Create `apps/kiosk/src/pages/resume/components/ResumeBeforeAfterPreview.tsx`
- Create `apps/kiosk/src/pages/resume/components/ResumeStructuredEditor.tsx`
- Create `apps/kiosk/src/pages/resume/components/ResumeExportPanel.tsx`
- Create `apps/kiosk/src/pages/resume/components/ResumeAiLayoutActions.tsx`
- Test/verify with Kiosk typecheck/lint

- [ ] **Step 1: Split route container**

  Keep `ResumeOptimizePage.tsx` responsible for routing, loading `taskId/accessToken`, and wiring handlers only. Move diff and preview UI into `ResumeBeforeAfterPreview`.

- [ ] **Step 2: Expand structured editing**

  `ResumeStructuredEditor` must edit:
  - summary
  - basic contact fields
  - intention
  - education descriptions
  - experience descriptions
  - project descriptions
  - skills
  - certificates

  Fact fields may be edited by the user, but AI actions must not invent new schools, companies, certificates, dates, or degrees.

- [ ] **Step 3: Add AI one-click layout actions**

  `ResumeAiLayoutActions` starts disabled until backend action APIs exist. Button labels:
  - `压缩到一页`
  - `优化版式`
  - `强化岗位关键词`
  - `统一表达风格`

  Each action must show a confirmation and then return a visible diff before the user accepts changes.

- [ ] **Step 4: Add final-output consistency note**

  Show page copy:

  ```text
  预览、PDF、图片和打印使用同一模板渲染结果。上传原件仅作优化前参考，原件复杂排版不承诺完全保留。
  ```

- [ ] **Step 5: Verify**

  Run:

  ```bash
  pnpm --filter @ai-job-print/kiosk typecheck
  pnpm --filter @ai-job-print/kiosk lint
  ```

  Expected: Typecheck passes. Lint has no new errors.

## Phase 2: Explicit AI Optimize Action and Job/JD Contract

**Purpose:** Stop relying on side-effecting GET for future paid optimization and keep Job/JD behavior compliant.

**Files:**
- Modify `packages/shared/src/types/ai.ts`
- Modify `services/api/src/ai/dto/resume-optimize.dto.ts`
- Modify `services/api/src/ai/ai.controller.ts`
- Modify `services/api/src/ai/ai.service.ts`
- Modify `services/api/src/ai/resume/job-fit.service.ts`
- Modify `services/api/src/ai/resume/llm-resume-optimize.service.ts`
- Modify `apps/kiosk/src/pages/resume/JobFitPage.tsx`
- Add/modify `services/api/scripts/verify-resume-optimize.ts`
- Add/modify `services/api/scripts/verify-job-fit.ts`

- [ ] **Step 1: Keep GET read-compatible**

  `GET /resume/records/:taskId/optimize` remains for current compatibility while commerce is disabled. Once commerce is enabled, it must only read an existing optimized result and return a clear `NEED_SUBMIT_OPTIMIZE` style error if no result exists.

- [ ] **Step 2: Add explicit POST optimize action**

  Add:

  ```text
  POST /resume/records/:taskId/optimize
  ```

  Request fields:
  - `targetContext`: industry, target job, experience, scene
  - `selectedDimensions`: allowed enum values only
  - `manualJob`: title and requirements text, with strict length limits
  - `orderItemId` or fulfillment token when commerce is enabled

- [ ] **Step 3: Keep external URL out of analysis**

  If a source URL field is added, it is stored only as user-provided metadata for display. It is not fetched, not trusted, not recorded as an approved job source, and not used to open a platform delivery path.

- [ ] **Step 4: Verify no recruitment-platform copy**

  Run:

  ```bash
  pnpm --filter @ai-job-print/api verify:resume-optimize
  pnpm --filter @ai-job-print/api verify:job-fit
  rg -n "一键投递|立即投递|平台投递|投递简历|录用概率|通过率|企业筛选|候选人推荐" apps/kiosk/src/pages/resume services/api/src/ai packages/shared/src/types/ai.ts
  ```

  Expected: Verify scripts pass. No forbidden copy except approved compliance wording.

## Phase 3: Multi-Format Resume Export

**Purpose:** Add PDF/TXT/Markdown first, then DOCX/PNG, all through FileObject and signed URLs.

**Files:**
- Modify `packages/shared/src/types/ai.ts`
- Create `services/api/src/ai/resume/export/resume-export.service.ts`
- Create `services/api/src/ai/resume/export/resume-pdf-exporter.ts`
- Create `services/api/src/ai/resume/export/resume-text-exporter.ts`
- Create `services/api/src/ai/resume/export/resume-markdown-exporter.ts`
- Create `services/api/src/ai/resume/export/resume-docx-exporter.ts`
- Create `services/api/src/ai/resume/export/resume-image-exporter.ts`
- Modify `services/api/src/ai/ai.controller.ts`
- Modify `services/api/src/ai/ai.service.ts`
- Modify `services/api/src/files/dto/kiosk-upload.dto.ts`
- Modify `services/api/src/files/retention-policy.ts`
- Modify `apps/kiosk/src/pages/resume/components/ResumeExportPanel.tsx`
- Add `services/api/scripts/verify-resume-export-formats.ts`

- [ ] **Step 1: Add shared export format**

  Add literal type:

  ```ts
  export type ResumeExportFormat = 'pdf' | 'txt' | 'markdown' | 'docx' | 'png'
  ```

- [ ] **Step 2: Add resume artifact purpose**

  Add a dedicated FileObject purpose such as `resume_export`. It must use sensitive-file retention and must not expand `resume_upload` to become a general artifact bucket.

- [ ] **Step 3: Implement TXT and Markdown**

  Use deterministic rendering from `GeneratedResume`. Do not call LLM during TXT/Markdown export.

- [ ] **Step 4: Implement DOCX after dependency review**

  Use a server-side DOCX generator from structured data. Do not claim conversion from uploaded original Word layout.

- [ ] **Step 5: Implement PNG through the same rendered PDF**

  PNG is produced from the final rendered template. For multi-page resumes, define one of these before implementation:
  - one PNG per page
  - first-page preview only
  - bundled archive after zip support

- [ ] **Step 6: Verify**

  Run:

  ```bash
  pnpm --filter @ai-job-print/api verify:resume-export-formats
  pnpm --filter @ai-job-print/api verify:file-retention
  pnpm --filter @ai-job-print/api verify:ai-result-ownership
  pnpm --filter @ai-job-print/kiosk typecheck
  ```

  Expected: Every format creates a FileObject with correct MIME, signed URL, owner boundary, asset category, source binding, and retention policy.

## Phase 4: Template Library Real Rendering

**Purpose:** Turn the existing template page into a real template selection and rendering surface.

**Files:**
- Modify `packages/shared/src/types/ai.ts`
- Create `services/api/src/ai/resume/templates/resume-template.service.ts`
- Create `services/api/src/ai/resume/templates/resume-template.controller.ts`
- Modify `services/api/src/ai/resume/export/resume-export.service.ts`
- Modify `apps/kiosk/src/pages/resume/ResumeTemplateLibraryPage.tsx`
- Modify `apps/kiosk/src/pages/resume/ResumeGeneratePage.tsx`
- Modify `apps/kiosk/src/pages/resume/ResumeGeneratePreviewPage.tsx`
- Add `services/api/scripts/verify-resume-template-rendering.ts`

- [ ] **Step 1: Add template metadata**

  Template fields:
  - `id`
  - `name`
  - `category`
  - `tags`
  - `previewImageFileId`
  - `supportedFormats`
  - `status`
  - `version`

- [ ] **Step 2: Replace static template cards**

  The Kiosk template page must read backend templates. Disabled/unsupported templates stay visible only if they clearly show unavailable status.

- [ ] **Step 3: Pass template ID to generate/optimize preview**

  Template selection must flow into preview/export. It must not only navigate back to upload without preserving user choice.

- [ ] **Step 4: Enable template print only after real artifact exists**

  The print button stays disabled until backend export returns a FileObject and signed URL.

- [ ] **Step 5: Verify**

  Run:

  ```bash
  pnpm --filter @ai-job-print/api verify:resume-template-rendering
  pnpm --filter @ai-job-print/kiosk typecheck
  pnpm --filter @ai-job-print/kiosk lint
  ```

## Phase 5: Voice-Assisted Resume Generation

**Purpose:** Help users without an electronic resume generate structured text from speech while keeping confirmation and privacy controls.

**Files:**
- Modify `apps/kiosk/src/pages/resume/ResumeGeneratePage.tsx`
- Create `apps/kiosk/src/pages/resume/components/ResumeVoiceInputButton.tsx`
- Create `apps/kiosk/src/pages/resume/components/ResumeTranscriptConfirmDialog.tsx`
- Create `services/api/src/ai/resume/resume-transcription.controller.ts`
- Create `services/api/src/ai/resume/resume-transcription.service.ts`
- Add `services/api/scripts/verify-resume-voice-generate.ts`

- [ ] **Step 1: Add voice only inside existing form**

  Do not add a new homepage card. Add mic buttons beside long text fields: education description, experience description, project description, self introduction.

- [ ] **Step 2: Require transcript confirmation**

  Speech text must enter a confirmation dialog before filling the form. The user can edit or discard the transcript.

- [ ] **Step 3: Keep sensitive fields manual**

  Name, phone, email, school, company, certificate, and dates remain manual or explicitly confirmed fields. Voice can suggest text but cannot silently populate them.

- [ ] **Step 4: Avoid long-term audio retention**

  Audio buffers are transient. Logs record only metadata: duration, status, provider, and error class.

- [ ] **Step 5: Verify**

  Run:

  ```bash
  pnpm --filter @ai-job-print/api verify:resume-voice-generate
  pnpm --filter @ai-job-print/api verify:audit-logs
  pnpm --filter @ai-job-print/kiosk typecheck
  ```

## Phase 6: Commerce Quote and Order Foundation

**Purpose:** Replace front-end hardcoded pricing with backend quotes and real order items while still allowing mock/no-payment operation behind a feature flag.

**Files:**
- Modify `services/api/prisma/schema.prisma`
- Modify `services/api/prisma/postgres/schema.prisma`
- Create `services/api/src/commerce/commerce.module.ts`
- Create `services/api/src/commerce/quote.service.ts`
- Create `services/api/src/commerce/order.service.ts`
- Create `services/api/src/commerce/commerce.controller.ts`
- Modify `services/api/src/print-jobs/print-jobs.service.ts`
- Modify `apps/kiosk/src/pages/print/PrintConfirmPage.tsx`
- Create `apps/kiosk/src/pages/commerce/CheckoutPage.tsx`
- Add `services/api/scripts/verify-commerce-quote-order.ts`

- [ ] **Step 1: Add ServiceSku, Quote, QuoteItem, OrderItem**

  Core model behavior:
  - quote locks service items and prices
  - order is created from a quote
  - order items represent AI optimize, resume export, print job, template unlock, and package purchase
  - amounts are integer cents
  - PrintTask remains fulfillment-only

- [ ] **Step 2: Add quote API**

  Add:

  ```text
  POST /commerce/quotes
  ```

  Response includes subtotal, discounts, total, available benefits, quote expiry, and item breakdown.

- [ ] **Step 3: Add order API**

  Add:

  ```text
  POST /commerce/orders
  GET /commerce/orders/:id
  ```

  Orders accept `idempotencyKey`. Duplicate submission with the same key returns the existing order.

- [ ] **Step 4: Replace print page pricing**

  `PrintConfirmPage` displays backend quote values. Remove `PRICE_BW` and `PRICE_COLOR` hardcoded calculations after the quote API is active.

- [ ] **Step 5: Verify**

  Run:

  ```bash
  pnpm --filter @ai-job-print/api verify:commerce-quote-order
  pnpm --filter @ai-job-print/api verify:order
  pnpm --filter @ai-job-print/api verify:print-jobs
  pnpm --filter @ai-job-print/kiosk typecheck
  ```

## Phase 7: Benefit Ledger and Package/Coupon Deduction

**Purpose:** Make coupons, free quota, and package entitlements safely consumable.

**Files:**
- Modify `services/api/prisma/schema.prisma`
- Modify `services/api/prisma/postgres/schema.prisma`
- Create `services/api/src/commerce/benefit-ledger.service.ts`
- Modify `services/api/src/member-benefits/member-benefits.service.ts`
- Modify `services/api/src/benefit-activities/benefit-activities.service.ts`
- Modify `apps/kiosk/src/pages/commerce/CheckoutPage.tsx`
- Modify `apps/kiosk/src/pages/profile/me/MyBenefitsPage.tsx`
- Add `services/api/scripts/verify-benefit-ledger.ts`

- [ ] **Step 1: Add BenefitLedger**

  Ledger entry types:
  - `reserve`
  - `consume`
  - `release`
  - `adjust`

  Each entry has an `idempotencyKey`, order/orderItem reference, delta, and balance snapshot.

- [ ] **Step 2: Implement reserve/consume/release**

  Use database transactions. A grant can be consumed only if active, not expired, and quantity remaining is sufficient.

- [ ] **Step 3: Bind 0-yuan orders**

  Fully discounted orders still create Order, OrderItem, BenefitLedger, and AuditLog records. They do not bypass commerce.

- [ ] **Step 4: Verify**

  Run:

  ```bash
  pnpm --filter @ai-job-print/api verify:benefit-ledger
  pnpm --filter @ai-job-print/api verify:member-favorites-benefits
  pnpm --filter @ai-job-print/api verify:activity-logs
  ```

## Phase 8: Payment Attempts, Refunds, and Reconciliation

**Purpose:** Connect real payment only after the commerce and benefit ledgers are safe.

**Files:**
- Modify `services/api/prisma/schema.prisma`
- Modify `services/api/prisma/postgres/schema.prisma`
- Create `services/api/src/commerce/payment-attempt.service.ts`
- Create `services/api/src/commerce/payment-webhook.controller.ts`
- Create `services/api/src/commerce/payment-provider.wechat.ts`
- Create `services/api/src/commerce/payment-provider.alipay.ts`
- Create `services/api/src/commerce/refund.service.ts`
- Create `services/api/src/commerce/reconciliation.service.ts`
- Modify `apps/kiosk/src/pages/commerce/CheckoutPage.tsx`
- Extend `apps/admin/src/routes/orders/index.tsx`
- Add `services/api/scripts/verify-payment-attempts.ts`
- Add `services/api/scripts/verify-refunds.ts`

- [ ] **Step 1: Add PaymentAttempt and PaymentTransaction**

  Enforce one active payment attempt per order. Before switching channels, close or sync the old active attempt.

- [ ] **Step 2: Add webhook validation**

  Provider webhook must verify signature, amount, currency, order id, provider transaction id, and idempotency key. Raw sensitive provider payload is not logged.

- [ ] **Step 3: Add refunds**

  Refunds are idempotent. Duplicate-payment refunds are transaction-scoped and do not consume normal order refund budget. Ordinary refunds are order-scoped and use atomic pending reserve/release semantics.

- [ ] **Step 4: Add reconciliation**

  Reconciliation imports provider bills, matches PaymentTransaction/Refund rows, and reports unmatched, amount mismatch, duplicated, and suspended-payment cases.

- [ ] **Step 5: Verify**

  Run:

  ```bash
  pnpm --filter @ai-job-print/api verify:payment-attempts
  pnpm --filter @ai-job-print/api verify:refunds
  pnpm --filter @ai-job-print/api verify:commerce-quote-order
  pnpm --filter @ai-job-print/api db:pg:sync:check
  ```

  Real payment live checks require merchant credentials and must run only in approved preproduction/production payment sandbox or merchant test mode.

## Phase 9: End-to-End Commercial AI Resume Flow

**Purpose:** Prove the complete user journey in browser, backend, storage, order, benefit, payment, and print paths.

**Files:**
- Add `services/api/scripts/verify-ai-commercial-flow.ts`
- Add Kiosk Playwright smoke if the project has the browser gate ready
- Update `docs/acceptance/` with a commercial acceptance runbook

- [ ] **Step 1: Verify free diagnosis**

  User uploads resume, gets diagnosis, sees no recruitment guarantees, and can continue to optimization preview.

- [ ] **Step 2: Verify paid AI optimization**

  Logged-in user creates quote, applies coupon/package if available, pays or gets a 0-yuan benefit order, then receives optimized resume.

- [ ] **Step 3: Verify multi-format export**

  Same paid optimized resume exports PDF, TXT, Markdown, PNG, and DOCX according to enabled formats without repeated service charges during the entitlement window.

- [ ] **Step 4: Verify direct print**

  Preview page prints without re-upload. The print order uses backend quote, creates PrintTask only after payment/free entitlement, and updates print progress independently from payment status.

- [ ] **Step 5: Verify account records**

  Results appear in:
  - `/me/resumes`
  - `/me/ai-records`
  - `/me/documents`
  - `/me/print-orders`
  - `/me/benefits`

- [ ] **Step 6: Verify deletion/retention**

  Original uploads follow short retention. Optimized/derived artifacts can use 90 days, 180 days, or long-term retention only after consent where allowed.

- [ ] **Step 7: Verify production gates**

  Run:

  ```bash
  pnpm --filter @ai-job-print/api verify:ai-commercial-flow
  pnpm --filter @ai-job-print/api verify:resume-export-formats
  pnpm --filter @ai-job-print/api verify:benefit-ledger
  pnpm --filter @ai-job-print/api verify:payment-attempts
  pnpm --filter @ai-job-print/api verify:refunds
  pnpm --filter @ai-job-print/api verify:file-retention
  pnpm --filter @ai-job-print/api verify:member-assets-c2d
  pnpm --filter @ai-job-print/api verify:audit-logs
  pnpm --filter @ai-job-print/api verify:production-runtime-gates
  pnpm --filter @ai-job-print/api db:pg:sync:check
  pnpm --filter @ai-job-print/kiosk typecheck
  pnpm --filter @ai-job-print/kiosk lint
  ```

## Recommended Charging Rules

These are product defaults for backend-configured SKUs, not frontend hardcoded prices.

| Service | Recommended rule | Notes |
| --- | --- | --- |
| Resume diagnosis | Free first use or free basic diagnosis | Keep as acquisition and trust-building feature |
| AI resume optimization | Charge per final optimized version | Suggested range: CNY 6.90-9.90; include re-export window |
| AI resume generation from form/voice | Charge per final generated version | Suggested range: CNY 6.90-12.90 depending on voice/template use |
| Template | Free basic templates, paid premium templates | Suggested range: CNY 3.00-5.00 or included in optimization package |
| Export formats | Included after paid final version | Do not charge repeatedly for PDF/TXT/Markdown/PNG/DOCX of the same paid artifact during the entitlement window |
| Printing | Charged by backend quote using paper/color/duplex/copies | Remove frontend hardcoded unit price after Phase 6 |
| Package | Bundle AI optimization/generation plus print quota/template | Example only: optimization x1 + black-white print quota + premium template |
| Coupon/free quota | Deduct through BenefitLedger | Free order still creates Order/OrderItem/Ledger/AuditLog |
| Refund | Refund through payment/refund domain | Payment anomalies never become print task statuses |

## Commercial Acceptance Checklist

- [ ] No new duplicate homepage or Profile entries.
- [ ] No platform delivery, candidate management, employer resume collection, interview invitation, Offer, or recommendation-to-enterprise feature.
- [ ] No arbitrary external URL fetch in v1.
- [ ] No percentage match, admission probability, interview promise, or employment guarantee.
- [ ] No original-layout preservation promise unless a separate verified original-layout engine exists.
- [ ] All generated artifacts use FileObject, signed URL, owner boundary, retention policy, and audit.
- [ ] Paid actions require member login.
- [ ] Quote/order/payment/benefit/refund/reconciliation are separated from PrintTask.
- [ ] Free orders are recorded.
- [ ] Coupon/package consumption is idempotent and auditable.
- [ ] Refunds are idempotent and transaction/order scoped as appropriate.
- [ ] Preview, export, image, and print use the same final renderer.
- [ ] Production claims wait for PostgreSQL, Redis, COS, HTTPS, real provider credentials, Windows Terminal Agent, Pantum printer/scanner, and small-scale trial evidence.

## Execution Order

1. Phase 0: product/compliance wording lock.
2. Phase 1: optimize page split and before/after/editor surface.
3. Phase 2: explicit optimize POST and compliant JD contract.
4. Phase 3: export format foundation.
5. Phase 4: template rendering.
6. Phase 5: voice-assisted generation.
7. Phase 6: quote/order foundation.
8. Phase 7: benefit ledger.
9. Phase 8: real payment/refund/reconciliation.
10. Phase 9: browser + backend + storage + payment + printer acceptance.

Do not start Phase 8 before Phase 6 and Phase 7 pass verification. Do not claim commercial launch before Phase 9 and Windows hardware evidence are complete.
