# Windows Acceptance Candidate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a clean Windows true-device acceptance candidate from `origin/main@eba2dd0f` without regressing the job-materials or phone-upload flows.

**Architecture:** Preserve the latest mainline as the source of truth, then selectively migrate terminal device profile, public Kiosk terminal config, and disabled-terminal task guards from `codex/terminal-device-profile-closure`. The backend owns terminal configuration and validation; shared types define public contracts; Kiosk and Admin only consume API adapters. Terminal toolbox backend configuration is explicitly excluded from this Windows acceptance candidate because it was not part of the committed source branch.

**Tech Stack:** React + Vite + TypeScript, NestJS, Prisma SQLite/PostgreSQL schemas, pnpm workspace verify scripts.

---

### Task 1: Baseline And External Analysis

**Files:**
- Modify: `.ccg/tasks/windows-acceptance-candidate-integration/task.json`
- Create: `.ccg/tasks/windows-acceptance-candidate-integration/review.md`

- [ ] **Step 1: Confirm clean baseline**

Run:

```bash
git status --short --branch
git rev-parse --short HEAD
git rev-parse --short origin/main
```

Expected: branch `codex/windows-acceptance-candidate`, clean worktree except task files, and both commits at `eba2dd0f`.

- [ ] **Step 2: Ask both external reviewers for migration risks**

Run the CCG dual-model analysis template with `ROLE_FILE` set to `architect.md`, asking both models to review the migration scope, conflict risks, and validation list.

Expected: both reports mention preserving `job-materials` and `upload-sessions`; any warnings are incorporated before implementation.

### Task 2: Migrate Backend Terminal Profile And Config

**Files:**
- Modify: `services/api/prisma/schema.prisma`
- Modify: `services/api/prisma/postgres/schema.prisma`
- Create: `services/api/prisma/migrations/20260629120000_add_terminal_device_profile/migration.sql`
- Create: `services/api/prisma/postgres/migrations/20260629120000_add_terminal_device_profile/migration.sql`
- Modify: `services/api/src/terminals/terminals.service.ts`
- Modify: `services/api/src/terminals/terminals.controller.ts`
- Modify: `services/api/src/terminals/admin-terminals.controller.ts`
- Create: `services/api/src/terminals/dto/update-terminal-profile.dto.ts`
- Modify: `services/api/src/terminals/dto/heartbeat.dto.ts`
- Modify: `services/api/src/terminals/dto/register-terminal.dto.ts`
- Create or modify: `services/api/src/terminals/terminal-config.types.ts`
- Modify: `services/api/src/smart-campus/smart-campus.service.ts`
- Modify: `services/api/src/audit/audit.types.ts`
- Modify: `packages/shared/src/types/audit.ts`
- Modify: `packages/shared/src/types/device.ts`

- [ ] **Step 1: Copy terminal profile schema fields and migrations**

Bring across `displayName`, `macAddress`, `locationLabel`, and `enabled` fields on `Terminal`, including additive SQLite and PostgreSQL migrations.

- [ ] **Step 2: Copy DTO and service behavior**

Bring across update profile DTO, register/heartbeat profile inputs, MAC normalization, disabled-terminal claim/status guards, and public Kiosk config shaping.

- [ ] **Step 3: Run backend terminal verification**

Run:

```bash
pnpm --filter @ai-job-print/api verify:terminal-device-config
```

Expected: all terminal device profile and public Kiosk config assertions pass after Task 2.

### Task 3: Migrate Kiosk And Admin UI Adapters

**Files:**
- Modify: `apps/admin/src/layouts/AdminLayoutWrapper.tsx`
- Modify: `apps/admin/src/routes/index.tsx`
- Modify: `apps/admin/src/routes/terminals/index.tsx`
- Modify: `apps/admin/src/services/api/devices.ts`
- Modify: `apps/admin/src/services/api/types.ts`
- Modify: `apps/admin/src/services/api/adminHttpAdapter.ts`
- Modify: `apps/admin/src/services/api/adminMockAdapter.ts`
- Modify: `apps/kiosk/package.json`
- Modify: `apps/kiosk/src/hooks/useSmartCampusConfig.ts`
- Modify: `apps/kiosk/src/pages/home/HomePage.tsx`
- Modify: `apps/kiosk/src/services/api/terminalConfig.ts`

- [ ] **Step 1: Add Admin terminal profile UI**

Bring across terminal profile editing, terminal management actions, and mock/http adapter support.

- [ ] **Step 2: Add Kiosk public config consumption**

Bring across cached unified config and Kiosk public config type shape. Keep the mainline home toolbox placeholder as-is; do not add backend toolbox configuration.

- [ ] **Step 3: Run Kiosk typecheck**

Run:

```bash
pnpm --filter @ai-job-print/kiosk typecheck
```

Expected: Kiosk compiles with the unified terminal config adapter.

### Task 4: Preserve Mainline Features And Verify

**Files:**
- Modify: `services/api/package.json`
- Modify: `apps/kiosk/package.json`
- Modify: `apps/admin/package.json`
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`

- [ ] **Step 1: Preserve mainline scripts**

Confirm `verify:job-materials`, `verify:upload-sessions`, `verify:upload-sessions:http`, and job-materials UI verify scripts remain present after migration.

- [ ] **Step 2: Run required local verification**

Run:

```bash
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/admin typecheck
pnpm --filter @ai-job-print/api verify:terminal-device-config
pnpm --filter @ai-job-print/api verify:job-materials
pnpm --filter @ai-job-print/api verify:upload-sessions
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 3: Run dual-model review**

Ask both `antigravity` and `claude` reviewer roles to review `git diff`, write the combined Critical/Warning/Info report to `.ccg/tasks/windows-acceptance-candidate-integration/review.md`, and fix Critical issues before finalizing.

### Task 5: Closeout

**Files:**
- Modify: `.ccg/tasks/windows-acceptance-candidate-integration/task.json`
- Modify: `.ccg/tasks/windows-acceptance-candidate-integration/review.md`

- [ ] **Step 1: Update task state**

Set `currentPhase` to `completed` only after verification and review are complete.

- [ ] **Step 2: Report Windows acceptance boundary**

Final answer must distinguish candidate branch readiness from actual Windows true-device acceptance. Do not claim real printing until Windows Agent and Pantum hardware tests run.
