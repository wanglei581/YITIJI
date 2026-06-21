# File Assets Preproduction Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Superseded for Gate 2 execution:** 本计划保留为 `9146fa1c` 历史执行准备记录；后续预生产 Gate 2 远端执行已被 `docs/superpowers/plans/2026-06-22-file-assets-preprod-gate2-refresh.md` 取代，目标候选为 `2187f6a7`。不要复制本文中的旧 `9146fa1c` 部署命令执行远端刷新。

**Goal:** Execute the next controlled step toward commercial closure for user files and resume assets by preparing and reviewing a preproduction acceptance run based on `9146fa1c`.

**Architecture:** This plan treats the current code candidate as already built and shifts work to evidence-driven preproduction acceptance. It separates local/read-only preflight from any external mutation, and records every future server, PostgreSQL, COS, browser, and audit proof in a dedicated acceptance record.

**Tech Stack:** pnpm monorepo, NestJS API, Prisma SQLite/PostgreSQL clients, Tencent COS private bucket, Kiosk/Admin React apps, CCG task records, Claude + Antigravity review.

---

## Scope

### Target

- Baseline: `codex/file-assets-preprod-integration` at `9146fa1c`.
- Execution branch: `codex/file-assets-preprod-execution`.
- Acceptance area: member-owned raw files, resumes, optimized/modified output files, AI-derived documents, `/me/documents`, Admin `/files`, PostgreSQL, COS private bucket, AuditLog.

### Non-Target

- No new business functionality.
- No runtime code changes.
- No schema or migration changes.
- No direct production deployment in this planning task.
- No server, database, COS, DNS, certificate, SMS, OCR, TRTC, ASR/TTS, or Windows hardware mutation before review and explicit operator confirmation.
- No statement that production, trial operation, or Windows hardware acceptance is complete.

### Allowed Files

- `.ccg/tasks/file-assets-preprod-execution/*`
- `docs/superpowers/plans/2026-06-22-file-assets-preprod-execution.md`
- `docs/acceptance/user-file-assets-preprod-execution-record.md`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`

## Execution Gates

### Gate 0: Local Plan and Static Evidence Only

Allowed now:

```bash
git status --short --branch
git log --oneline --decorate -5
pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance
git diff --check
```

Expected:

- Current branch is `codex/file-assets-preprod-execution`.
- Static acceptance document check passes.
- No whitespace errors.

### Gate 1: Read-Only Preproduction Inspection

Allowed only after plan review:

```bash
ssh <deploy-user>@<preprod-host> 'hostname && date && cd /srv/ai-job-print && git rev-parse --short HEAD && git status --short --branch'
ssh <deploy-user>@<preprod-host> 'pm2 status ai-job-print-api || true'
ssh <deploy-user>@<preprod-host> 'curl -fsS http://127.0.0.1:3010/api/v1/health'
```

Expected:

- Host, time zone, deployed commit, PM2 status, and health are recorded.
- Output is redacted before entering the repo if it includes host-only details, private paths, tokens, signed URLs, or secrets.
- If deployed commit is not `9146fa1c`, stop and decide whether to deploy the candidate in a separate approved operation.

### Gate 2: Candidate Deployment or Refresh

External mutation. Requires explicit operator confirmation after Gate 1.

以下旧命令仅保留为 `9146fa1c` 历史执行准备记录，已废弃，勿执行；后续 Gate 2 远端刷新必须使用 `2187f6a7` refresh plan。

Allowed only if approved:

```bash
cd /srv/ai-job-print
git fetch --all --prune
git checkout --detach 9146fa1c
pnpm install --frozen-lockfile
pnpm --filter @ai-job-print/api exec prisma generate
pnpm --filter @ai-job-print/api db:pg:generate
pnpm --filter @ai-job-print/api build
VITE_USE_TRTC_CALL=true pnpm --filter @ai-job-print/kiosk build
pnpm --filter @ai-job-print/admin build
pm2 restart ai-job-print-api
```

Expected:

- Previous deployed commit and build artifact path are recorded before checkout/restart.
- No `.env` is printed.
- Preproduction `DATABASE_URL`, `REDIS_URL`, and COS bucket/region are confirmed to point to isolated preproduction resources before Gate 3 or Gate 4. Record only redacted host/bucket fingerprints, never full secrets.
- If build or restart fails, restore previous commit/artifact and stop.

### Gate 3: Automated Preproduction Commands

External state may be touched by COS live checks or test fixture creation. Requires explicit operator confirmation.

Run in order:

```bash
pnpm --filter @ai-job-print/api verify:production-runtime-gates
pnpm --filter @ai-job-print/api verify:production-db-guard
pnpm --filter @ai-job-print/api verify:cos-lifecycle-policy
pnpm --filter @ai-job-print/api verify:file-retention
pnpm --filter @ai-job-print/api verify:file-lifecycle-summary
pnpm --filter @ai-job-print/api verify:cos:live
pnpm --filter @ai-job-print/api verify:member-assets-c2d
pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance
```

Expected:

- Every command log records environment, time, commit, and result.
- `verify:cos:live` must either PASS against preproduction COS credentials or be marked SKIPPED with the exact missing configuration variable names, without printing values.
- Passing `verify:member-assets-c2d` and `verify:file-assets-trial-acceptance` is not enough to claim real trial acceptance.

### Gate 4: Browser and Account Acceptance

External state mutation. Requires controlled test accounts and explicit confirmation.

Manual flow:

1. Member A logs in on preproduction Kiosk.
2. Member A uploads one raw resume/material file.
3. `/me/documents` shows the raw file with default 90-day retention.
4. Member A changes raw file retention to 180 days after consent.
5. Member A creates or uploads one optimized/modified output file.
6. Member A changes output file retention to long term after consent.
7. Member A logs out and logs back in; both files remain visible according to policy.
8. Member B attempts to read or delete Member A files and receives 403/404 without signed URL leakage.
9. Member A deletes one controlled file; UI, PostgreSQL, COS, and AuditLog all agree.
10. Verify signed URL preview/download TTL is no more than 30 minutes, the URL expires as expected, and screenshots/logs redact the query string.
11. Prepare one expired short-retention file and one long-term control file belonging only to designated test accounts; query-match the exact test file IDs before cleanup; prove the expired file is deleted and long-term file remains. Cleanup AuditLog evidence must come from the scheduled cron path; manual cleanup can only prove return value, PostgreSQL, and COS state.
12. Admin `/files` shows lifecycle summary and deleted/active/long-term state without offering retention edits.

Expected:

- Evidence is recorded in `docs/acceptance/user-file-assets-preprod-execution-record.md`.
- Screenshots are not committed unless intentionally redacted and small enough for repo policy.
- Real user files, raw screenshots with secrets, DB dumps, and COS object exports stay outside Git.

## Task 1: Create the Execution Record

**Files:**
- Create: `docs/acceptance/user-file-assets-preprod-execution-record.md`
- Modify: `.ccg/tasks/file-assets-preprod-execution/task.json`

- [ ] **Step 1: Add an execution record with empty evidence slots**

Create `docs/acceptance/user-file-assets-preprod-execution-record.md` with these sections:

```markdown
# 用户文件与简历资产预生产执行记录

> 状态：PLANNED，尚未执行会修改服务器/数据库/COS/账号的真实验收。
> 基线：codex/file-assets-preprod-integration / 9146fa1c

## 目标和非目标

## 操作许可边界

## Gate 0 本地静态门禁

## Gate 1 预生产只读预检

## Gate 2 候选部署或刷新

## Gate 3 自动命令门禁

## Gate 4 浏览器和账号验收

## 停止条件与回滚记录

## 结论
```

- [ ] **Step 2: Keep task status in planning**

Update `.ccg/tasks/file-assets-preprod-execution/task.json`:

```json
{
  "currentPhase": "review",
  "nextAction": "完成进度文档和最终审查后等待用户确认 Gate 1 预生产只读预检"
}
```

## Task 2: Run Dual-Model Plan Review

**Files:**
- Create or Modify: `.ccg/tasks/file-assets-preprod-execution/review.md`

- [ ] **Step 1: Request Antigravity review**

Run:

```bash
~/.claude/bin/codeagent-wrapper --progress --backend antigravity - "$(pwd)" <<'EOF'
ROLE_FILE: ~/.claude/.ccg/prompts/antigravity/reviewer.md
<TASK>
Review the preproduction execution plan for user file and resume asset commercial closure.
Focus on scope control, external mutation safety, evidence sufficiency, compliance wording, and whether any step overclaims production/trial completion.
Read:
- .ccg/tasks/file-assets-preprod-execution/requirements.md
- docs/superpowers/plans/2026-06-22-file-assets-preprod-execution.md
- docs/acceptance/user-file-assets-preprod-execution-record.md
- docs/acceptance/user-file-assets-trial-acceptance.md
- docs/progress/current-progress.md
- docs/progress/next-tasks.md
OUTPUT: Critical / Warning / Info review with concrete file references.
</TASK>
EOF
```

- [ ] **Step 2: Request Claude review**

Run:

```bash
~/.claude/bin/codeagent-wrapper --progress --backend claude - "$(pwd)" <<'EOF'
ROLE_FILE: ~/.claude/.ccg/prompts/claude/reviewer.md
<TASK>
Review the preproduction execution plan for user file and resume asset commercial closure.
Focus on scope control, external mutation safety, evidence sufficiency, compliance wording, and whether any step overclaims production/trial completion.
Read:
- .ccg/tasks/file-assets-preprod-execution/requirements.md
- docs/superpowers/plans/2026-06-22-file-assets-preprod-execution.md
- docs/acceptance/user-file-assets-preprod-execution-record.md
- docs/acceptance/user-file-assets-trial-acceptance.md
- docs/progress/current-progress.md
- docs/progress/next-tasks.md
OUTPUT: Critical / Warning / Info review with concrete file references.
</TASK>
EOF
```

- [ ] **Step 3: Record and resolve review**

Write `.ccg/tasks/file-assets-preprod-execution/review.md` with:

```markdown
# Review

## Antigravity

## Claude

## Integrated Decision

- Critical:
- Warning:
- Info:
- Resolution:
```

Expected:

- Critical findings are fixed before proceeding.
- Warning findings are either fixed or explicitly deferred.

## Task 3: Run Local Static Gate

**Files:**
- Modify: `docs/acceptance/user-file-assets-preprod-execution-record.md`
- Modify: `.ccg/tasks/file-assets-preprod-execution/task.json`

- [ ] **Step 1: Run static acceptance check**

Run:

```bash
pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance
```

Expected: PASS.

- [ ] **Step 2: Run whitespace check**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 3: Record Gate 0 results**

Update the execution record with command, result, date, branch, and commit. Do not paste large logs or secrets.

- [ ] **Step 4: Update task status**

Update `.ccg/tasks/file-assets-preprod-execution/task.json`:

```json
{
  "currentPhase": "review",
  "nextAction": "等待用户确认后进入 Gate 1 预生产只读预检"
}
```

## Task 4: Progress Documentation

**Files:**
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`

- [ ] **Step 1: Record the planning result**

Add a progress entry that says the execution plan and local Gate 0 are prepared, but no real preproduction mutation, production deployment, Windows hardware acceptance, or trial operation has completed.

- [ ] **Step 2: Keep the next task explicit**

Update next tasks to name the next required action:

```markdown
- [ ] 基于 `codex/file-assets-preprod-execution`，在用户确认后执行 Gate 1 预生产只读预检；若 commit 不一致，先停止并确认是否部署 `9146fa1c` 候选。
```

## Self-Review Checklist

- [ ] Plan does not modify runtime code.
- [ ] Plan distinguishes static checks, read-only preflight, deployment, COS live mutation, browser account mutation, and trial operation.
- [ ] Plan does not claim production or trial completion.
- [ ] Plan preserves compliance boundary: AI job-materials and print service terminal, not a recruiting platform.
- [ ] Plan includes rollback and stopping conditions.
- [ ] Plan requires evidence for PostgreSQL, COS, member ownership, UI, Admin lifecycle view, and AuditLog.
- [ ] Plan includes the Prisma PostgreSQL client generation step before production runtime gates in cold environments.
