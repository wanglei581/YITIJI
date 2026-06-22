# COS Lifecycle Privacy Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align COS lifecycle acceptance and user-facing privacy copy with the commercial file-retention model.

**Architecture:** Keep retention behavior unchanged and make this a compliance/acceptance branch. Static verify scripts guard copy and runbook constraints, while production COS validation remains an explicit human gate because this branch must not mutate third-party resources.

**Tech Stack:** React + TypeScript Kiosk, shared TypeScript copy constants, NestJS service docs, Node verify scripts.

---

### Task 1: TDD Verify Scripts

**Files:**
- Create: `apps/kiosk/scripts/verify-legal-retention-copy.mjs`
- Create: `services/api/scripts/verify-cos-lifecycle-policy.ts`
- Modify: `apps/kiosk/package.json`
- Modify: `services/api/package.json`

- [ ] **Step 1: Write failing legal copy verifier**

Create `apps/kiosk/scripts/verify-legal-retention-copy.mjs` that reads:
- `apps/kiosk/src/pages/legal/LegalDocPage.tsx`
- `apps/kiosk/src/pages/help/HelpCenterPage.tsx`
- `packages/shared/src/types/complianceCopy.ts`

The script must fail until those files contain `90 天`, `180 天`, `长期保存`, `短期`, and must fail if they contain old universal promises such as `分析完成后 1 小时内自动删除`, `通常 1 小时内`, or `默认 24 小时`.

- [ ] **Step 2: Run legal copy verifier RED**

Run:

```bash
pnpm --filter @ai-job-print/kiosk verify:legal-retention-copy
```

Expected: FAIL because the script is new or because current copy still has old 1-hour/24-hour wording.

- [ ] **Step 3: Write failing COS lifecycle verifier**

Create `services/api/scripts/verify-cos-lifecycle-policy.ts` that reads:
- `docs/compliance/file-retention-and-cos-lifecycle.md`
- `docs/device/production-deployment-and-windows-host-checklist.md`
- `docs/device/production-deployment-runbook.md`
- `services/api/src/storage/cos-storage.backend.ts`

The script must require the docs to mention bucket global lifecycle prohibition, `long_term`, `expiresAt = null`, screenshot evidence, manual console acceptance, and must fail if backend source contains `putBucketLifecycle`, `deleteBucketLifecycle`, or `BucketLifecycle`.

- [ ] **Step 4: Run COS verifier RED**

Run:

```bash
pnpm --filter @ai-job-print/api verify:cos-lifecycle-policy
```

Expected: FAIL because the compliance doc and checklist entries do not exist yet.

### Task 2: Update User-Facing Copy

**Files:**
- Modify: `packages/shared/src/types/complianceCopy.ts`
- Modify: `apps/kiosk/src/pages/legal/LegalDocPage.tsx`
- Modify: `apps/kiosk/src/pages/help/HelpCenterPage.tsx`

- [ ] **Step 1: Update shared compliance copy**

Change `KIOSK_RESUME_UPLOAD_PRIVACY` to explain: no resume library, no third-party forwarding, guest/high-sensitive files short retention, logged-in resume files default 90 days, user can adjust or delete.

Change `ADMIN_FILES_TOP` to explain: high-sensitive files short retention, member resume files 90 days by default, user-confirmed 180 days or long-term, cleanup follows `expiresAt`.

- [ ] **Step 2: Update Kiosk privacy policy**

Update `LegalDocPage.tsx` privacy section “三、保存期限与自动清理” with the same segmented model. State that 180-day and long-term retention require separate user confirmation of retention terms.

- [ ] **Step 3: Update Help Center**

Update the “文件会保存多久？” answer to stop saying all resume files are normally deleted within 1 hour.

- [ ] **Step 4: Run legal copy verifier GREEN**

Run:

```bash
pnpm --filter @ai-job-print/kiosk verify:legal-retention-copy
```

Expected: PASS.

### Task 3: Add COS Lifecycle Acceptance Docs

**Files:**
- Create: `docs/compliance/file-retention-and-cos-lifecycle.md`
- Modify: `docs/device/production-deployment-and-windows-host-checklist.md`
- Modify: `docs/device/production-deployment-runbook.md`

- [ ] **Step 1: Add compliance doc**

Document the retention matrix, COS lifecycle prohibition, allowed temporary-prefix-only lifecycle use, manual console acceptance steps, screenshot evidence requirements, and consent-version coupling.

- [ ] **Step 2: Update production checklist**

Add checklist items under COS and legal/compliance sections:
- no bucket global expiration lifecycle;
- no lifecycle rule covers `long_term`/member asset prefixes;
- screenshots archived before trial operation;
- privacy/legal copy references 90/180/long-term retention and still labels legal review as pending until approved.

- [ ] **Step 3: Update deployment runbook**

Add COS lifecycle acceptance instructions near object storage configuration and rollback/retention notes.

- [ ] **Step 4: Run COS verifier GREEN**

Run:

```bash
pnpm --filter @ai-job-print/api verify:cos-lifecycle-policy
```

Expected: PASS.

### Task 4: Progress, Review, Verification, Commit

**Files:**
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`
- Modify: `.ccg/tasks/cos-lifecycle-privacy-acceptance/task.json`
- Create: `.ccg/tasks/cos-lifecycle-privacy-acceptance/review.md`

- [ ] **Step 1: Run final verification**

Run:

```bash
pnpm --filter @ai-job-print/kiosk verify:legal-retention-copy
pnpm --filter @ai-job-print/api verify:cos-lifecycle-policy
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/kiosk lint
pnpm --filter @ai-job-print/api typecheck
git diff --check
```

- [ ] **Step 2: Request Claude + Antigravity review**

Review current diff for correctness, privacy compliance, and no accidental COS mutation.

- [ ] **Step 3: Update progress docs and archive CCG task**

Move this branch to completed in progress docs only after verification and dual review pass.

- [ ] **Step 4: Stage explicit paths and commit**

Use explicit `git add <paths>` only. Commit message:

```bash
git commit -m "docs: add cos lifecycle privacy acceptance"
```
