# Print Status Tracking UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Kiosk `/me/print-orders` automatically refresh active print task status without adding backend fields, duplicate routes, or failure-reason disclosure.

**Architecture:** Keep `/print/progress` as the blocking live progress page and enhance only the existing member order list. Add a small print-order refresh helper for active status detection, first-page refresh merging, and bounded backoff; wire it into `MyPrintOrdersPage` with cleanup-safe polling and a low-noise status line.

**Tech Stack:** React + TypeScript + Vite, existing `getMyPrintOrders()` API client, static Node verify guard.

---

## Scope

功能归位声明：
- 功能/业务闭环名称：我的打印订单状态自动刷新
- 涉及层和具体目录：
  - 前端：`apps/kiosk/src/pages/profile/me/MyPrintOrdersPage.tsx` and `apps/kiosk/src/pages/profile/me/printOrders/statusRefresh.ts`
  - 后端：不涉及；只跑 `verify:member-print-orders` 回归
  - 终端：不涉及
  - 共享类型：不涉及
  - 共享 UI：不涉及
  - 文档：`docs/progress/current-progress.md`, `docs/progress/next-tasks.md`, `docs/product/user-data-flow-matrix.md`
- 明确不涉及的层：Prisma schema, API DTO, Terminal Agent, Admin, payment/refund/cashier, failure-reason display
- 复用确认：复用现有 `/api/v1/me/print-orders`, `getMyPrintOrders()`, `verify:member-print-orders-ui`
- 跨层契约：前端只消费既有 safe metadata，不请求 file URL/hash/internal errors

本任务允许修改：
- `apps/kiosk/src/pages/profile/me/MyPrintOrdersPage.tsx`
- `apps/kiosk/src/pages/profile/me/printOrders/statusRefresh.ts`
- `apps/kiosk/scripts/verify-member-print-orders-ui.mjs`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- `docs/product/user-data-flow-matrix.md`

本任务禁止：
- 新增订单页面、进度页或重复入口
- 新增后端字段、Prisma migration、共享类型字段
- 展示 `errorCode` / `errorMessage` / `failureReasonForUser`
- 依据支付状态推断打印状态或取件码
- 轮询时整表替换导致已加载分页丢失

## Tasks

### Task 1: RED - Extend Static Guard

**Files:**
- Modify: `apps/kiosk/scripts/verify-member-print-orders-ui.mjs`

- [x] Add static assertions that should fail before implementation:
  - `statusRefresh.ts` exists.
  - `MEMBER_ORDERS_POLL_MS = 5000`.
  - Active status helper includes only `pending`, `claimed`, `printing`.
  - `mergePrintOrderRefresh()` uses `new Map` keyed by `id` and is used in `setItems(prev => ...)`.
  - Polling cleanup clears timeout and removes `visibilitychange`.
  - Polling failure does not call `setState('error')`.

- [x] Run:

```bash
pnpm --filter @ai-job-print/kiosk verify:member-print-orders-ui
```

Expected: FAIL because the helper and polling code do not exist yet.

### Task 2: GREEN - Add Refresh Helper

**Files:**
- Create: `apps/kiosk/src/pages/profile/me/printOrders/statusRefresh.ts`

- [x] Add helper constants and pure functions:
  - `MEMBER_ORDERS_POLL_MS = 5000`
  - `MEMBER_ORDERS_POLL_MAX_MS = 60000`
  - `isActivePrintStatus(status)`
  - `hasActivePrintOrders(items)`
  - `nextPrintOrdersPollDelay(currentDelay)`
  - `mergePrintOrderRefresh(current, freshFirstPage)` preserving loaded pagination while updating by `id`

- [x] Run:

```bash
pnpm --filter @ai-job-print/kiosk typecheck
```

Expected: PASS.

### Task 3: GREEN - Wire Conditional Polling UI

**Files:**
- Modify: `apps/kiosk/src/pages/profile/me/MyPrintOrdersPage.tsx`

- [x] Import refresh helpers and `useRef`.
- [x] Keep latest items/loading state in refs to avoid stale timer closures.
- [x] Start polling only when logged in and loaded items contain active print status.
- [x] Refresh with `getMyPrintOrders(getToken(), { pageSize: Math.min(50, Math.max(PAGE_SIZE, items.length)) })`.
- [x] On success:
  - `setItems(prev => mergePrintOrderRefresh(prev, r.items))`
  - update `total`
  - reset backoff
  - keep existing `nextCursor` unchanged
- [x] On failure:
  - keep current list visible
  - set a small auto-refresh error state
  - back off up to 60 seconds
  - do not switch the whole shell to error state
- [x] Cleanup timeout and `visibilitychange` listener on unmount or when active count becomes zero.
- [x] Show one compact, token-colored status line only while active orders exist.

- [x] Run:

```bash
pnpm --filter @ai-job-print/kiosk verify:member-print-orders-ui
pnpm --filter @ai-job-print/kiosk typecheck
```

Expected: PASS.

### Task 4: Verification And Docs

**Files:**
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`
- Modify: `docs/product/user-data-flow-matrix.md`

- [x] Update docs to mark `/me/print-orders` auto refresh as complete and keep failure reason display as separate product-confirmation work.
- [x] Run:

```bash
pnpm --filter @ai-job-print/kiosk verify:member-print-orders-ui
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/api verify:member-print-orders
git diff --check
```

Expected: all pass.

### Task 5: Review

- [x] Run dual-model review on `git diff`.
- [x] Fix Critical issues, rerun relevant verification, and update this plan/status if scope changes.
