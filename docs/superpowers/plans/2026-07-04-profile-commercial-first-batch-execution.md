# 我的页商用闭环第一批收口执行计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不重复开发已合入能力的前提下，把「我的页商用闭环第一批」收口为可独立执行、可验证、互不影响其他分支的 P0a / P0b / P1 工作区。

**Architecture:** 当前 `main` 已包含 `/me/ai-records`、`/me/benefits`、`/me/documents`、`/me/feedback`、`/me/notifications`、打印订单详单、支付会话安全补丁和 `RedemptionRecord` 核销 SSOT。下一步不是复活 6 月旧计划，而是补收口证据、验收 runbook、防回退守卫和 C5-4 前置设计门禁。每个任务从最新 `main` 新建独立 worktree，禁止共用旧 payment/profile/benefit 分支。

**Tech Stack:** React + Vite + TypeScript + Tailwind CSS；NestJS + Prisma；SQLite / PostgreSQL 双 schema；现有 `pnpm` workspace、GitHub CI、Kiosk/API verify 脚本。

---

## Current Truth

- PR #157 已合入 `main`（`8633fc1`）：支付会话 token 已保护 `/orders/:id/pay` 与 `/orders/:id/pay-status`，Kiosk 全链路透传 `paymentSessionToken`。
- `RedemptionRecord` 已由 P1 权益核销落地为唯一核销账本并随 PR #146 合入；C5-4 只能 additive 扩展同一张表。
- `MyAiRecordsPage`、`MyBenefitsPage`、`MySettingsPage`、`MyDocumentsPage`、`MyFeedbackPage`、`MyNotificationsPage` 已存在，不能按旧计划重复创建。
- `/me/print-orders` 已完成支付详单、取件码、分页、状态自动刷新和支付会话相关收口。
- 未完成的真实边界仍是：预生产/真机验收、正式支付 live、C5-4 退款 + Order 抵扣核销、C5-5 对账、C5-6 微信/支付宝真实渠道。

## Global Rules

- 一窗口 = 一任务 = 一分支 = 一 worktree。
- 不使用 `git add .`，只显式暂存本任务文件。
- 不触碰根目录两个未跟踪登录页文档。
- 不清理 `.claude/worktrees`、`feature/payment-c5-4`、`feature/benefit-redemption-p1` 或其他候选工作区。
- 任何 auth / db / payment / crypto / benefit redemption diff 必须先双模型只读分析，完成后再双模型 security review；有 Critical 不得 Ready。
- 不新增招聘闭环文案：`一键投递`、`立即投递`、`平台投递`、`投递简历`。
- 不新增支付/核销口径：`微信支付`、`支付宝`、`到账`、`确认核销`、`办理成功`，除非任务明确进入 C5-4+ 且通过审查。

## Worktree P0a: `codex/profile-commercial-first-batch-guard`

**Purpose:** 用静态守卫锁住「第一批已完成能力」的边界，防止后续分支误删页面、回退路由、恢复旧建设中口径或重复入口。

**Allowed Files:**

- Create: `apps/kiosk/scripts/verify-profile-commercial-first-batch.mjs`
- Modify: `apps/kiosk/package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`

**Forbidden Files:**

- `services/api/**`
- `packages/shared/**`
- `apps/kiosk/src/**`
- `apps/admin/**`
- `apps/partner/**`
- Prisma schema / migrations

**Steps:**

- [ ] Create worktree from latest `main`: `git worktree add .worktrees/profile-commercial-first-batch-guard -b codex/profile-commercial-first-batch-guard origin/main`.
- [ ] Add a Kiosk static guard that asserts these files/routes exist: `MyAiRecordsPage`, `MyBenefitsPage`, `MyDocumentsPage`, `MyFeedbackPage`, `MyNotificationsPage`, `MySettingsPage`, `MyPrintOrdersPage`, `/me/ai-records`, `/me/benefits`, `/me/documents`, `/me/feedback`, `/me/notifications`, `/me/settings`, `/me/print-orders`.
- [ ] Guard must assert `/me/print-orders` still imports `OrderPaymentSummary`, `PickupCodePanel`, status refresh helpers, and does not expose `errorCode`, `errorMessage`, or `failureReasonForUser`.
- [ ] Guard must assert payment-session code paths remain present in Kiosk payment adapter: `x-payment-session-token`, `paymentSessionToken`, `createPayAttempt({ orderId, paymentSessionToken })`, `getPayStatus({ orderId, paymentSessionToken })`.
- [ ] Guard must assert first-batch pages do not contain forbidden recruitment or payout wording.
- [ ] Register `verify:profile-commercial-first-batch` in `apps/kiosk/package.json`.
- [ ] Add the verify command to CI after existing profile-specific guards.
- [ ] Update progress docs with the guard name and scope.

**Verification:**

- `pnpm --filter @ai-job-print/kiosk verify:profile-commercial-first-batch`
- `pnpm --filter @ai-job-print/kiosk verify:profile-inkpaper-home`
- `pnpm --filter @ai-job-print/kiosk verify:profile-ai-records-inkpaper`
- `pnpm --filter @ai-job-print/kiosk verify:profile-documents-inkpaper`
- `pnpm --filter @ai-job-print/kiosk verify:member-print-orders-ui`
- `git diff --check`

**Review Gate:** Single-model review is acceptable only if diff stays docs/scripts only and <= 120 lines. If CI or workflow changes exceed that, run dual-model review.

## Worktree P0b: `codex/profile-commercial-first-batch-acceptance`

**Purpose:** 建立第一批预生产/浏览器验收执行包，不改运行时代码。该任务产出验收 runbook 和防过度宣称门禁。

**Allowed Files:**

- Create: `docs/acceptance/profile-commercial-first-batch-acceptance.md`
- Create: `docs/acceptance/profile-commercial-first-batch-execution-record.md`
- Create: `services/api/scripts/verify-profile-commercial-first-batch-acceptance.ts`
- Modify: `services/api/package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/progress/next-tasks.md`

**Forbidden Files:**

- Runtime page/component/service code under `apps/**/src/**`
- Prisma schema / migrations
- Payment, redemption, refund, order, auth service implementation

**Steps:**

- [ ] Create a runbook with gates `PC-G0` to `PC-G5`.
- [ ] `PC-G0`: local static verify commands for profile pages, payment session, benefits redemption, member print orders, feedback notifications.
- [ ] `PC-G1`: preproduction read-only health and deployed commit check; stop if deployed commit is older than `8633fc1`.
- [ ] `PC-G2`: authenticated member browser check for `/me/ai-records`, `/me/benefits`, `/me/documents`, `/me/print-orders`, `/me/feedback`, `/me/notifications`, `/me/settings`.
- [ ] `PC-G3`: print order payment-session browser check: paid order can query pickup code only with token; missing token must fail honestly.
- [ ] `PC-G4`: benefit redemption read-only evidence: show existing `RedemptionRecord` count and sample shape without exposing user PII.
- [ ] `PC-G5`: evidence review: no screenshots with tokens, phone numbers, full names, pickup codes, signed URLs, prompt bodies, or raw model outputs enter Git.
- [ ] Add a static verify script that checks the runbook contains all gates, stop conditions, privacy redaction rules, and “not production complete” wording.
- [ ] Register the verify script and add it to CI.

**Verification:**

- `pnpm --filter @ai-job-print/api verify:profile-commercial-first-batch-acceptance`
- `pnpm --filter @ai-job-print/kiosk verify:member-print-orders-ui`
- `pnpm --filter @ai-job-print/api verify:benefit-redemption`
- `pnpm --filter @ai-job-print/api verify:feedback-notifications`
- `git diff --check`

**Review Gate:** Docs + static verify still touch API package/CI, so run dual-model review before Ready.

## Worktree P1: `codex/c5-4-refund-redemption-readonly-gate`

**Purpose:** 在写 C5-4 退款/Order 抵扣代码前，先完成只读设计门禁和攻击面审查。此分支不得写运行时代码。

**Allowed Files:**

- Create: `docs/reviews/c5-4-refund-redemption-readiness.md`
- Create: `docs/superpowers/plans/2026-07-04-c5-4-refund-redemption-implementation.md`
- Modify: `docs/product/payment-domain-c5-plan-2026-07.md`
- Modify: `docs/progress/next-tasks.md`

**Forbidden Files:**

- `services/api/src/**`
- `services/api/prisma/**`
- `apps/**/src/**`
- `packages/shared/**`
- `.github/workflows/**`

**Read-Only Analysis Must Cover:**

- Current `RedemptionRecord` schema fields, unique constraints, and `BenefitRedemptionService` idempotency behavior.
- Current `OrderStatusService` refund behavior and Admin mark-paid / refund endpoint constraints.
- Current `PaymentAttempt` and sandbox callback idempotency behavior.
- Required additive C5-4 shape: `Refund` model, `POST /orders/:id/refund`, `POST /orders/:id/redeem`, `RedemptionRecord.orderId`, `RedemptionRecord.amountCents`, audit events, and verify scripts.
- Race cases: duplicate refund, refund after closed/failed/unpaid, redeem after paid, redeem after refund, replayed idempotency key, concurrent last entitlement, cross-user order/grant mismatch.
- Operational boundary: C5-4 still does not enable live WeChat/Alipay; C5-6 remains separate.

**Steps:**

- [ ] Use codebase-memory `search_graph` / `get_code_snippet` for `BenefitRedemptionService`, `OrderStatusService`, `OnlinePaymentService`, `PaymentController`, and Prisma redemption/order models.
- [ ] Write the readiness review with `Go / No-Go` for implementation.
- [ ] Write a separate implementation plan with exact future files and test commands, but do not implement it in this branch.
- [ ] Record explicit No-Go conditions: second redemption ledger, live channel code, frontend-only discounting, missing audit, missing idempotency, or token/secret exposure.

**Verification:**

- `git diff --check`
- Manual review that the diff is docs-only.

**Review Gate:** Mandatory dual-model security review. If either reviewer finds Critical/High design flaws, stop before creating C5-4 implementation branch.

## Recommended Execution Order

1. Merge or close the docs-only PR that synced PR #157 status.
2. Execute P0a guard worktree.
3. Execute P0b acceptance runbook worktree.
4. Execute P1 C5-4 readonly gate worktree.
5. Only after P1 returns Go, create a fresh C5-4 implementation branch.

## Stop Conditions

- Any task discovers main has drifted past the worktree base.
- Any task would require touching files outside its allowed list.
- Any task needs real production credentials, live payment credentials, real member PII, or Windows printer operation.
- Any dual-model review returns Critical.
- GitHub CI cannot be checked.
