# Profile Notifications And Feedback P1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Kiosk "消息通知" and "意见反馈" from construction placeholders into closed-loop, commercial-safe user flows with Admin handling and auditable backend data.

**Architecture:** Add two bounded domains: member feedback tickets and member notifications. Kiosk `/me/*` endpoints are always protected by `EndUserAuthGuard` and read the user id only from the token; Admin endpoints are protected by `JwtAuthGuard + RolesGuard + @Roles('admin')` and write audit logs for handling actions. The first commercial slice supports feedback submit/list/detail/reply/close, Admin list/detail/reply/status, Admin broadcast notifications, Kiosk notification list/read/delete, and automatic user notification when Admin replies to feedback.

**Tech Stack:** Prisma 7 SQLite + PostgreSQL schemas, NestJS controllers/services/DTOs, React + Vite + TypeScript, existing Kiosk `MeListShell`, Admin `AdminLayoutWrapper`, service-level verify scripts.

---

## Scope Decisions

- Include: `FeedbackTicket`, `FeedbackReply`, `MemberNotification`, `SystemBroadcast`, `BroadcastReadState`.
- Include: Admin reply to feedback creates a `MemberNotification` for that feedback owner.
- Include: broadcast read/dismiss state per end user, without fan-out rows for every user.
- Exclude: rich text, file attachments, WebSocket/push, SMS notifications, payment/package events, interview/offer/recruiting notifications, public anonymous feedback.
- Exclude: storing plaintext phone in feedback. Use `contactPhoneEnc` plus masked return values, or null.

## Files

- Modify: `services/api/prisma/schema.prisma`
- Modify: `services/api/prisma/postgres/schema.prisma`
- Create: `services/api/prisma/migrations/20260618180000_add_feedback_notifications/migration.sql`
- Create: `services/api/prisma/postgres/migrations/20260618180000_add_feedback_notifications/migration.sql`
- Modify: `services/api/src/prisma/prisma.service.ts`
- Modify: `services/api/src/app.module.ts`
- Create: `packages/shared/src/types/memberFeedback.ts`
- Create: `packages/shared/src/types/memberNotifications.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `services/api/src/member-feedback/*`
- Create: `services/api/src/member-notifications/*`
- Create: `services/api/scripts/verify-feedback-notifications.ts`
- Modify: `services/api/package.json`
- Modify: `apps/kiosk/src/pages/profile/ProfilePage.tsx`
- Modify: `apps/kiosk/src/routes/index.tsx`
- Create: `apps/kiosk/src/services/api/memberFeedback.ts`
- Create: `apps/kiosk/src/services/api/memberNotifications.ts`
- Create: `apps/kiosk/src/pages/profile/me/MyFeedbackPage.tsx`
- Create: `apps/kiosk/src/pages/profile/me/MyNotificationsPage.tsx`
- Modify: `apps/admin/src/layouts/AdminLayoutWrapper.tsx`
- Modify: `apps/admin/src/routes/index.tsx`
- Create: `apps/admin/src/services/api/memberFeedbackAdmin.ts`
- Create: `apps/admin/src/services/api/memberNotificationsAdmin.ts`
- Create: `apps/admin/src/routes/member-feedback/index.tsx`
- Create: `apps/admin/src/routes/member-notifications/index.tsx`
- Modify: `docs/product/user-data-flow-matrix.md`
- Modify: `docs/progress/current-progress.md`

## Tasks

### Task 1: Backend Schema And Shared Types

- [ ] Add Prisma models and migrations to both SQLite and PostgreSQL schemas.
- [ ] Add `EndUser.feedbackTickets`, `EndUser.notifications`, `EndUser.broadcastReadStates`, `User.feedbackReplies`, `MemberNotification`, `SystemBroadcast`, `BroadcastReadState`, `FeedbackTicket`, `FeedbackReply`.
- [ ] Use string fields for category/status/related types; validate values in service/DTO code.
- [ ] Add PrismaService delegates for the five new models.
- [ ] Add shared TS types for Kiosk/Admin DTO return shapes.

### Task 2: Backend Feedback Domain

- [ ] Add DTOs with class-validator checks: category whitelist, content 10-500 chars, optional title 80 chars, optional contact phone valid China mobile, optional related print task id, reply 1-500 chars, status whitelist.
- [ ] Add `MemberFeedbackService` and `MemberFeedbackController` under `/me/feedback`.
- [ ] Add `AdminMemberFeedbackService` and `AdminMemberFeedbackController` under `/admin/feedback`.
- [ ] Enforce本人隔离 by using only `@CurrentEndUser().endUserId`.
- [ ] Encrypt optional contact phone and return only masked values.
- [ ] Reject recruitment-process wording in user/admin content: `一键投递|立即投递|平台投递|面试邀约|录用通知|Offer|候选人推荐|企业筛选|收取简历|投递结果|预约结果`.
- [ ] Write audit logs for Admin view/reply/status change with masked phone only.
- [ ] Admin reply must also create a member notification for the ticket owner.

### Task 3: Backend Notifications Domain

- [ ] Add `MemberNotificationsController` under `/me/notifications`.
- [ ] List merged personal notifications and active broadcasts with cursor/pageSize and unread filters.
- [ ] Mark single personal notification or broadcast as read.
- [ ] Mark all visible notifications as read.
- [ ] Soft-delete personal notifications and dismiss broadcasts.
- [ ] Add `AdminMemberNotificationsController` under `/admin/notifications`.
- [ ] Admin can list/create/delete broadcasts. Broadcast creation writes audit and rejects recruitment-process wording.

### Task 4: Service Verify Script

- [ ] Add `verify:feedback-notifications`.
- [ ] The script must create temp SQLite tables or use the real schema in a temp DB, then clean up.
- [ ] Verify: user A cannot see or close user B feedback.
- [ ] Verify: Admin reply changes ticket status and creates a notification visible to that user only.
- [ ] Verify: broadcast read state is per user.
- [ ] Verify: forbidden recruitment wording is rejected for feedback replies and broadcasts.
- [ ] Verify: AuditLog payload does not contain plaintext phone.
- [ ] Verify: controller metadata includes required guards and roles.

### Task 5: Kiosk Pages

- [ ] Update `ProfilePage` entry cards: `消息通知 -> /me/notifications`, `意见反馈 -> /me/feedback`.
- [ ] Bell icon in logged-in header opens `/me/notifications`; it does not need a live badge in P1.
- [ ] Add `/me/notifications`: login prompt, tabs all/unread, list, read/delete/read-all actions, route CTA for known related types.
- [ ] Add `/me/feedback`: login prompt, submit form, history list, detail timeline, append reply, close ticket.
- [ ] Mock mode returns honest empty states and disabled submit behavior rather than fake feedback.

### Task 6: Admin Pages

- [ ] Add sidebar entries under 用户管理: `意见反馈`, `消息通知`.
- [ ] Add `/member-feedback`: filters, list, selected detail, reply, status update.
- [ ] Add `/member-notifications`: broadcast create form, list, delete.
- [ ] Do not expose plaintext phone or recruiting workflow language.

### Task 7: Verification And Review

- [ ] Run API verify/typecheck/lint.
- [ ] Run Kiosk and Admin typecheck/lint/build.
- [ ] Run browser smoke for: Kiosk feedback submit -> Admin reply -> Kiosk notification readback; Admin broadcast -> Kiosk notification readback.
- [ ] Run dual-model code review and fix Critical/Warning issues.
- [ ] Update progress docs and commit.

