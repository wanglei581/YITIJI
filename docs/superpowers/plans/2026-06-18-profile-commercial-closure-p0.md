# 我的页商用闭环第一批实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Kiosk「我的」页里适合第一批上线的建设中入口接成真实、诚实、可验收的用户操作闭环，同时明确暂缓招聘会凭证、套餐、支付和活动核销域。

**Architecture:** 第一批分为 P0a、P0b、P1。P0a 只做低风险前端真实化与既有页面跳转；P0b 打通 `BenefitGrant` 的用户只读页和 Admin 手动发放/撤销闭环；P1 新建反馈与消息通知域。所有 `/me/*` 用户数据必须走 `EndUserAuthGuard` 和本人 `endUserId`，Admin 写动作必须审计。

**Tech Stack:** React + Vite + TypeScript + Tailwind/shadcn, NestJS + Prisma, PostgreSQL/SQLite 双 schema, 现有 `verify:*` 服务级脚本。

---

## 专家共识

第一批可以做：

- `政策补贴指引`：接现有 `/renshi`，只做 info-only 政策说明、材料清单、官方入口。
- `帮助中心`：静态页面，覆盖登录、打印、AI、政策、招聘会来源入口、隐私留存。
- `账号设置轻量版`：只读手机号/会员状态/协议入口/退出登录，不做换绑、账号合并、账号注销。
- `身份切换`：定义为“退出当前账号并重新登录”，不做多角色切换。
- `我的权益`：Kiosk 只读页消费既有 `GET /me/benefits`，Admin 增加手动发放/撤销，落到 `BenefitGrant`。

第一批不做：

- `招聘会扫码凭证`：无真实预约/签到/入场模型，不能伪造凭证。
- `权益活动`：需 `BenefitActivity`、领取、库存、核销，排到后续。
- `求职打印套餐`、`AI服务套餐`：需订单、支付、退款、对账、额度扣减，排到支付域。
- `账号注销`：涉及 COS 物理删除和 PII 清理，应单独做合规设计，不塞进轻量设置。

## 文件结构

P0a 计划修改：

- Modify: `apps/kiosk/src/pages/profile/ProfilePage.tsx`
- Modify: `apps/kiosk/src/routes/index.tsx`
- Create: `apps/kiosk/src/pages/profile/me/MySettingsPage.tsx`
- Create: `apps/kiosk/src/pages/help/HelpCenterPage.tsx`
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/product/user-data-flow-matrix.md`

P0b 计划修改：

- Create: `apps/kiosk/src/pages/profile/me/MyBenefitsPage.tsx`
- Create: `apps/kiosk/src/services/api/memberBenefits.ts` if not already present; otherwise extend existing API client only.
- Modify: `apps/kiosk/src/routes/index.tsx`
- Modify: `apps/kiosk/src/pages/profile/ProfilePage.tsx`
- Extend: `services/api/src/member-benefits/*`
- Add Admin page under `apps/admin/src/routes/member-benefits/`
- Modify Admin route/layout registry according to existing admin pattern.
- Add service verify script under `services/api/scripts/verify-member-benefits-admin.ts`
- Modify: `services/api/package.json`
- Modify: `docs/progress/current-progress.md`

P1 计划修改:

- Add `FeedbackTicket` / notification models to both Prisma schemas only in a dedicated later branch.
- Add `services/api/src/member-feedback/*`
- Add `services/api/src/member-notifications/*`
- Add Kiosk `/me/feedback` and `/me/notifications`
- Add Admin feedback/notification pages.

## Task P0a-1: 政策补贴指引接现有政策页

**Files:**
- Modify: `apps/kiosk/src/pages/profile/ProfilePage.tsx`
- Verify: `apps/kiosk/src/pages/renshi/RenshiPage.tsx`

- [ ] Step 1: In `BENEFITS`, change `政策补贴指引` from `tag: '建设中'` to `route: '/renshi?tab=policy'` or the currently supported policy tab route after checking `RenshiPage` tab keys.
- [ ] Step 2: Keep text info-only. Do not add subsidy amount, approval result,到账,代办, or internal application wording.
- [ ] Step 3: Run `pnpm --filter @ai-job-print/kiosk typecheck`.
- [ ] Step 4: Browser verify `/profile` → `政策补贴指引` → `/renshi?...` renders policy materials and official entry wording.

## Task P0a-2: 帮助中心静态页

**Files:**
- Create: `apps/kiosk/src/pages/help/HelpCenterPage.tsx`
- Modify: `apps/kiosk/src/routes/index.tsx`
- Modify: `apps/kiosk/src/pages/profile/ProfilePage.tsx`

- [ ] Step 1: Create a Kiosk page with a `PageHeader`, large touch-friendly FAQ sections, and links back to relevant existing routes.
- [ ] Step 2: Include only implemented capabilities: 登录、AI简历服务、文档打印、扫描、政策服务、招聘会来源入口、我的记录、隐私与文件留存。
- [ ] Step 3: Register `/help`.
- [ ] Step 4: Route `帮助中心` to `/help`, remove `建设中`.
- [ ] Step 5: Run Kiosk typecheck and browser verify `/profile` → `帮助中心`.

## Task P0a-3: 账号设置轻量版和身份切换

**Files:**
- Create: `apps/kiosk/src/pages/profile/me/MySettingsPage.tsx`
- Modify: `apps/kiosk/src/routes/index.tsx`
- Modify: `apps/kiosk/src/pages/profile/ProfilePage.tsx`

- [ ] Step 1: Create `/me/settings` using existing auth context. Show masked phone, login state, privacy/legal links, session retention explanation, and logout button.
- [ ] Step 2: Route header settings icon and `账号设置` entry to `/me/settings`.
- [ ] Step 3: For `身份切换`, route to `/me/settings` or open a confirmation flow that clearly says “退出当前账号后重新登录切换用户”.
- [ ] Step 4: Confirm logout clears in-memory token and returns to guest/login state; do not add browser storage persistence.
- [ ] Step 5: Run Kiosk typecheck and browser verify guest/login/logout paths.

## Task P0b-1: 我的权益只读页

**Files:**
- Create: `apps/kiosk/src/pages/profile/me/MyBenefitsPage.tsx`
- Modify: `apps/kiosk/src/routes/index.tsx`
- Modify: `apps/kiosk/src/pages/profile/ProfilePage.tsx`
- Use: existing `GET /api/v1/me/benefits`

- [ ] Step 1: Create `/me/benefits` using `MeListShell`.
- [ ] Step 2: Show empty state honestly when no `BenefitGrant` exists.
- [ ] Step 3: For each item show title, type, status, quantity, valid period, description.
- [ ] Step 4: For `subsidy_eligibility_hint`, display “政策资格提示 / 官方入口指引”，never display到账 or已发放金额.
- [ ] Step 5: Route `我的权益` to `/me/benefits`.
- [ ] Step 6: Run Kiosk typecheck and logged-in browser verification.

## Task P0b-2: Admin 手动发放/撤销权益

**Files:**
- Extend: `services/api/src/member-benefits/*`
- Add: Admin benefit controller/service files if local module style supports split controllers.
- Add: `apps/admin/src/routes/member-benefits/index.tsx`
- Modify: Admin route/layout registry.
- Add: `services/api/scripts/verify-member-benefits-admin.ts`
- Modify: `services/api/package.json`

- [ ] Step 1: Add Admin-only list/create/revoke endpoints for `BenefitGrant`.
- [ ] Step 2: Search users by phone in a way that does not expose plaintext phone in list results; display masked phone only.
- [ ] Step 3: Validate benefit type, quantity, status, valid dates, and text. Reject subsidy wording containing到账、发放金额、保证、通过率.
- [ ] Step 4: Write `AuditLog` for grant and revoke.
- [ ] Step 5: Build Admin page with search, grant form, record list, revoke action, loading/error/empty states.
- [ ] Step 6: Add verify script covering grant, revoke, auth guard, audit, and Kiosk readback through `/me/benefits`.
- [ ] Step 7: Run API typecheck and verify script; run Admin typecheck/build.

## Task P1-1: 意见反馈域

**Files:**
- Later branch only; do not mix with P0.

- [ ] Step 1: Add `FeedbackTicket` / `FeedbackReply` models in both Prisma schemas.
- [ ] Step 2: Add user submit/list endpoints with rate limiting and本人隔离.
- [ ] Step 3: Add Admin handling/status/reply page.
- [ ] Step 4: Add verify script for submit, rate limit, ownership, admin status flow.

## Task P1-2: 消息通知域

**Files:**
- Later branch only; do not mix with P0.

- [ ] Step 1: Add notification models in both Prisma schemas.
- [ ] Step 2: Add `/me/notifications` list/read/delete endpoints.
- [ ] Step 3: Add Kiosk page and header bell wiring.
- [ ] Step 4: Decide whether Admin公告 is in scope; if not, only service/system notifications are allowed.
- [ ] Step 5: Add verify script for本人隔离, read state, deletion, and forbidden marketing/recruitment result content.

## Cross-Cutting Verification

- [ ] `pnpm --filter @ai-job-print/kiosk typecheck`
- [ ] `pnpm --filter @ai-job-print/admin typecheck`
- [ ] `pnpm --filter @ai-job-print/api typecheck`
- [ ] New API verify scripts for any backend changes.
- [ ] Browser verification on `/profile` as guest and logged-in user.
- [ ] Confirm no “一键投递 / 立即投递 / 平台投递 / 预约成功凭证 / 补贴到账 / 保录用 / 保面试” wording appears.

## Execution Notes

- P0a and P0b should be separate branches/worktrees.
- Do not edit the existing QR login branch for this work.
- `ProfilePage.tsx` and `apps/kiosk/src/routes/index.tsx` are hotspot files; one worker owns them per phase.
- Schema migrations for feedback/notifications must be serial, not parallel.
- Do not use `git add .`; stage explicit files only.
