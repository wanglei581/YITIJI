# Admin File Lifecycle View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a commercial-grade Admin file lifecycle view that shows retention policy metadata, global lifecycle counts, and expiring files without allowing admins to modify user retention choices.

**Architecture:** Reuse the existing Admin `/files` route. Add one read-only backend aggregate endpoint for accurate global lifecycle numbers, because list-based `limit:200` counts are not sufficient for operations. Split the existing Admin files page into small route-local modules before adding lifecycle UI so the page does not continue growing.

**Tech Stack:** NestJS + Prisma for the read-only aggregate endpoint; React + Vite + TypeScript + Tailwind + lucide-react for Admin UI; existing Node verify scripts for TDD-style regression gates.

---

### Task 1: RED Verification Gates

**Files:**
- Create: `services/api/scripts/verify-file-lifecycle-summary.ts`
- Create: `services/api/src/files/lifecycle-summary.ts`
- Create: `apps/admin/scripts/verify-admin-file-lifecycle.mjs`
- Modify: `services/api/package.json`
- Modify: `apps/admin/package.json`

- [ ] **Step 1: Write failing API verification**

Create a script that imports `summarizeFileLifecycleRows` from `services/api/src/files/lifecycle-summary.ts` and asserts:
- `long_term` rows count as long-term.
- `expiresAt=null` rows do not count as expiring.
- deleted rows do not count.
- expiring windows include 7-day and 30-day counts.
- policy and set-by distributions are counted.

- [ ] **Step 2: Run API verification and confirm RED**

Run: `pnpm --filter @ai-job-print/api verify:file-lifecycle-summary`

Expected: FAIL because the script command and exported summary helper do not exist yet.

- [ ] **Step 3: Write failing Admin UI verification**

Create a script that checks:
- `AdminFileRecord` has retention fields.
- `/files` route includes `RetentionSummary` and `FileTable`.
- route-local lifecycle helper files exist.
- no Admin route/service file contains `updateRetention`, `/retention`, `consentVersion` write UI, or `retentionPolicy` editing controls.

- [ ] **Step 4: Run Admin verification and confirm RED**

Run: `pnpm --filter @ai-job-print/admin verify:admin-file-lifecycle-ui`

Expected: FAIL because the lifecycle UI files and fields do not exist yet.

### Task 2: Backend Read-Only Lifecycle Summary

**Files:**
- Modify: `packages/shared/src/types/file.ts`
- Modify: `services/api/src/files/file.types.ts`
- Modify: `services/api/src/files/files.service.ts`
- Modify: `services/api/src/files/files.controller.ts`

- [ ] **Step 1: Add shared/API local response types**

Add `FileLifecycleSummaryResponse` plus policy/set-by count item interfaces to both file type sources.

- [ ] **Step 2: Add pure summarizer and service method**

In `lifecycle-summary.ts`, export `summarizeFileLifecycleRows(rows, now)`. In `files.service.ts`, add `lifecycleSummary(now = new Date())`.

The pure summarizer handles date windows and deleted rows. The service method fetches only lifecycle fields from all file rows and returns full-table counts.

- [ ] **Step 3: Add admin-only controller endpoint**

Add `GET /files/lifecycle-summary`, guarded by `JwtAuthGuard + RolesGuard + @Roles('admin')`, returning `ApiResponse<FileLifecycleSummaryResponse>`.

- [ ] **Step 4: Run API verification**

Run: `pnpm --filter @ai-job-print/api verify:file-lifecycle-summary`

Expected: PASS.

### Task 3: Admin Adapter and Mock Data

**Files:**
- Modify: `apps/admin/src/services/api/files.ts`

- [ ] **Step 1: Extend `AdminFileRecord`**

Add lifecycle metadata fields matching backend `FileMetadata`: `status`, `assetCategory`, `ownerType`, `ownerId`, `retentionPolicy`, `retentionSetBy`, `retentionConsentAt`, `retentionConsentVersion`, `retentionLockedReason`.

- [ ] **Step 2: Add `AdminFileLifecycleSummary` and `getFileLifecycleSummary()`**

The HTTP adapter calls `GET /files/lifecycle-summary`; the mock adapter computes a matching summary from mock rows.

- [ ] **Step 3: Update mock rows**

Seed at least one `long_term` optimized/derived row and one soon-expiring row. Keep id_scan/system rows locked to `system_short`.

### Task 4: Admin Files Page Split and Lifecycle UI

**Files:**
- Create: `apps/admin/src/routes/files/fileMeta.ts`
- Create: `apps/admin/src/routes/files/retentionMeta.ts`
- Create: `apps/admin/src/routes/files/RetentionSummary.tsx`
- Create: `apps/admin/src/routes/files/FileTable.tsx`
- Modify: `apps/admin/src/routes/files/index.tsx`

- [ ] **Step 1: Move existing metadata helpers to `fileMeta.ts`**

Move purpose, sensitivity, clean status, formatting, and view mapping helpers out of `index.tsx`.

- [ ] **Step 2: Add lifecycle label helpers**

Create read-only labels for retention policy, set-by, consent time, asset category, and owner type. Do not add any mutation helper.

- [ ] **Step 3: Create `RetentionSummary`**

Render accurate global summary from `GET /files/lifecycle-summary`: total active, long-term count, expiring within 7/30 days, expired pending cleanup, and policy distribution.

- [ ] **Step 4: Create `FileTable`**

Render the table with existing actions plus read-only retention columns. Keep “查看文件” and “手动删除”; add a non-mutating lifecycle detail text block, not a retention edit button.

- [ ] **Step 5: Update `index.tsx` container**

Fetch `listFiles` and `getFileLifecycleSummary` together, keep existing filters, add a retention filter, pass props to split components, and keep container under the file-size threshold.

### Task 5: Verification, Review, Docs, Commit

**Files:**
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`
- Create: `.ccg/tasks/admin-file-lifecycle-view/review.md`

- [ ] **Step 1: Run verification**

Run:
- `pnpm --filter @ai-job-print/api verify:file-lifecycle-summary`
- `pnpm --filter @ai-job-print/admin verify:admin-file-lifecycle-ui`
- `pnpm --filter @ai-job-print/api verify:file-retention`
- `pnpm --filter @ai-job-print/api typecheck`
- `pnpm --filter @ai-job-print/admin typecheck`
- `pnpm --filter @ai-job-print/admin lint`
- `pnpm --filter @ai-job-print/admin build`
- `git diff --check`

- [ ] **Step 2: Run Claude + Antigravity final review**

Review the full diff for correctness, privacy, no Admin retention mutation, and line-count control. Fix Critical/Warning items and rerun verification.

- [ ] **Step 3: Update progress docs and task archive**

Mark Admin lifecycle view complete, list remaining COS/privacy/production acceptance tasks, and archive `.ccg/tasks/admin-file-lifecycle-view`.

- [ ] **Step 4: Commit explicitly staged files**

Do not use `git add .`. Stage exact paths only and commit with:

`feat: add admin file lifecycle view`
