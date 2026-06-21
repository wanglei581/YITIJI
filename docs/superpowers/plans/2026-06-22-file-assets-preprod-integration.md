# File Assets Preprod Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single preproduction candidate branch that contains both the user file/resume asset commercial-closure stack and the TRTC assistant production build guard/preproduction acceptance record.

**Architecture:** This is an integration-only branch. It merges the already reviewed `codex/preprod-deployment-acceptance` branch into `codex/file-assets-trial-acceptance`, then resolves documentation conflicts so progress files preserve both evidence streams without claiming production is complete.

**Tech Stack:** Git merge, pnpm workspace scripts, NestJS API verify scripts, Vite Kiosk/Admin verify scripts, Markdown progress/runbook documentation.

---

### Task 1: Pre-Merge Review

**Files:**
- Read: `.ccg/tasks/file-assets-preprod-integration/requirements.md`
- Read: `.ccg/tasks/file-assets-preprod-integration/task.json`
- Read: `docs/progress/current-progress.md`
- Read: `docs/progress/next-tasks.md`

- [ ] **Step 1: Confirm branch state**

Run:

```bash
git status --short --branch
git merge-base HEAD codex/preprod-deployment-acceptance
```

Expected: clean worktree except the active task files before merge; merge base is `origin/main@c31e0b10`.

- [ ] **Step 2: Review merge impact**

Run:

```bash
git diff --name-only HEAD..codex/preprod-deployment-acceptance
git merge-tree "$(git merge-base HEAD codex/preprod-deployment-acceptance)" HEAD codex/preprod-deployment-acceptance
```

Expected: merge adds TRTC guard, CI guard, preproduction progress records, and task archives. `git diff HEAD..codex/preprod-deployment-acceptance` may show apparent deletions of the file asset stack because the preproduction branch never contained those files; treat that as a two-dot diff artifact, not as a merge instruction.

### Task 2: Merge And Resolve Conflicts

**Files:**
- Modify as needed: `docs/progress/current-progress.md`
- Modify as needed: `docs/progress/next-tasks.md`
- Modify as needed: `docs/device/production-deployment-runbook.md`
- Merge add: `.github/workflows/ci.yml`
- Merge add: `apps/kiosk/*` TRTC guard files
- Merge add: `.ccg/tasks/archive/2026-06/guard-kiosk-trtc-assistant/*`
- Merge add: `.ccg/tasks/archive/2026-06/preprod-deployment-acceptance/*`

- [ ] **Step 1: Run merge**

```bash
git merge --no-ff codex/preprod-deployment-acceptance
```

Expected: the true conflict should be limited to `docs/progress/current-progress.md`. Resolve it by retaining both file-assets and preproduction acceptance facts.

- [ ] **Step 2: Resolve progress docs**

Keep all file asset rows from `codex/file-assets-trial-acceptance` and all preproduction rows from `codex/preprod-deployment-acceptance`.

Required preserved markers:

```text
codex/file-assets-trial-acceptance
codex/preprod-deployment-acceptance
非生产/试运营验收完成
不等于正式域名/HTTPS、腾讯短信、百度 OCR、AI/TRTC/ASR/TTS live、Windows 真机或小范围试运营完成
```

- [ ] **Step 3: Check merge state**

```bash
git status --short
git diff --check
git diff --name-only "$(git merge-base HEAD codex/preprod-deployment-acceptance)"..HEAD | rg "retention|file-assets|lifecycle|assistant-trtc"
```

Expected: no unresolved conflict markers, no whitespace errors, and both the file asset stack plus TRTC guard files are present.

### Task 3: Verification

**Files:**
- No production code changes expected after merge resolution.

- [ ] **Step 0: Run Gate 0 local static doc check**

`verify:file-assets-trial-acceptance` 是 Gate 0 本地静态文档门禁，依赖完整仓库 `docs/`，只在完整仓库 checkout 中运行；它不属于 Gate 3 远端裁剪运行时包命令清单，不得在裁剪包内执行，也不得为了执行它把 `docs/` 或 `.ccg/` 加回运行时归档。

```bash
pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance
```

Expected: PASS, and it still only proves static evidence-package structure.

- [ ] **Step 1: Run API runtime file asset gates**

```bash
pnpm --filter @ai-job-print/api verify:production-runtime-gates
pnpm --filter @ai-job-print/api verify:cos-lifecycle-policy
pnpm --filter @ai-job-print/api verify:file-retention
pnpm --filter @ai-job-print/api verify:file-lifecycle-summary
```

Expected: all PASS.

- [ ] **Step 2: Run Kiosk/Admin gates**

```bash
pnpm --filter @ai-job-print/kiosk verify:assistant-trtc-guard
pnpm --filter @ai-job-print/kiosk verify:file-retention-ui
pnpm --filter @ai-job-print/kiosk verify:legal-retention-copy
pnpm --filter @ai-job-print/admin verify:admin-file-lifecycle-ui
```

Expected: all PASS.

- [ ] **Step 3: Run type checks**

```bash
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/shared typecheck
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/admin typecheck
```

Expected: all PASS.

### Task 4: Review And Commit

**Files:**
- Create: `.ccg/tasks/file-assets-preprod-integration/review.md`
- Modify: `.ccg/tasks/file-assets-preprod-integration/task.json`

- [ ] **Step 1: Run dual-model review**

Ask Claude and Antigravity to review the integration diff for correctness, deployment risk, compliance wording, and missing validations.

- [ ] **Step 2: Archive task**

```bash
mkdir -p .ccg/tasks/archive/2026-06
mv .ccg/tasks/file-assets-preprod-integration .ccg/tasks/archive/2026-06/
```

- [ ] **Step 3: Stage explicit paths and commit**

Use explicit paths only, never `git add .`.

```bash
git status --short
git add <explicit changed files>
git commit -m "chore: integrate file assets preprod candidate"
```
