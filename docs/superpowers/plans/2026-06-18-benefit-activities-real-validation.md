# 权益活动真实环境验收 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the P2 benefit activities MVP works beyond service-level scripts by running PostgreSQL migration, real HTTP API flow, and Kiosk/Admin GUI smoke checks.

**Architecture:** Use the existing isolated branch `codex/profile-benefit-activities-p2`. Create a local throwaway PostgreSQL database for migration and API validation, use Redis for real member/admin auth where needed, and capture browser-visible evidence for Kiosk/Admin routes. Do not add payment, packages, fair credentials, check-in, or print consumption in this validation task.

**Tech Stack:** PostgreSQL 16, Redis, NestJS API, Vite Kiosk/Admin, curl/Node HTTP smoke, browser/Playwright or equivalent screenshots.

---

## Scope Lock

This validation covers:

- PostgreSQL `prisma migrate deploy` against a throwaway database.
- API boot against PostgreSQL + Redis.
- Real HTTP flow: Admin login/create/publish, member login/list/detail/claim, `/me/benefits`, duplicate claim rejection, Admin claim list.
- Kiosk/Admin route rendering and screenshots.
- Documentation update with exact evidence and remaining gaps.

This validation excludes:

- Cloud production deployment, unless explicitly requested after local staging passes.
- Windows printer/Terminal Agent validation.
- Payment, package purchase, fair credential, activity check-in, and benefit consumption/rollback.

## Task 1: PostgreSQL Migration Validation

**Files:**
- Modify: `docs/progress/current-progress.md`
- Modify: `.ccg/tasks/benefit-activities-real-validation/task.json`

- [x] **Step 1: Create a throwaway database**

Run:

```bash
dropdb -h 127.0.0.1 --if-exists yitiji_benefit_validation
createdb -h 127.0.0.1 yitiji_benefit_validation
```

Expected: database is created without affecting development or production databases.

- [x] **Step 2: Deploy PostgreSQL migrations**

Run:

```bash
POSTGRES_URL="postgresql://wanglei@127.0.0.1:5432/yitiji_benefit_validation" pnpm --filter ./services/api db:pg:deploy
```

Expected: migration `20260618190000_add_benefit_activities` is applied and `postgres/migrations/0_init` is not modified.

- [x] **Step 3: Verify tables and constraints**

Run:

```bash
psql -h 127.0.0.1 -d yitiji_benefit_validation -c "\\d \"BenefitActivity\""
psql -h 127.0.0.1 -d yitiji_benefit_validation -c "\\d \"BenefitClaim\""
```

Expected: `BenefitClaim_activityId_endUserId_key`, `BenefitClaim_benefitGrantId_key`, and FK constraints to `BenefitActivity`, `EndUser`, and `BenefitGrant` exist.

## Task 2: Real HTTP Flow Validation

**Files:**
- Create or modify: validation scratch script only if manual curl becomes too error-prone.
- Modify: `docs/progress/current-progress.md`

- [x] **Step 1: Start Redis and API against PostgreSQL**

Run API with:

```bash
DATABASE_URL="postgresql://wanglei@127.0.0.1:5432/yitiji_benefit_validation" \
POSTGRES_URL="postgresql://wanglei@127.0.0.1:5432/yitiji_benefit_validation" \
REDIS_URL="redis://127.0.0.1:6379/0" \
SMS_PROVIDER=log \
JWT_SECRET="benefit-validation-jwt-secret-2026" \
PORT=3010 \
pnpm --filter ./services/api dev
```

Expected: API starts and logs PostgreSQL connection, not SQLite.

- [x] **Step 2: Seed or create required Admin/member data**

Create only the minimal data needed for Admin login and member login. Do not seed fake production claims.

- [x] **Step 3: Exercise the real HTTP flow**

Expected flow:

```text
Admin login
POST /api/v1/admin/benefit-activities
PATCH /api/v1/admin/benefit-activities/:id/publish
Member SMS login using SMS_PROVIDER=log
GET /api/v1/activities
GET /api/v1/activities/:id
POST /api/v1/activities/:id/claim
GET /api/v1/me/benefits
POST /api/v1/activities/:id/claim again -> rejected
GET /api/v1/admin/benefit-activities/:id/claims -> masked phone
```

Expected: all success/rejection states match P2 rules and no plaintext phone appears in API responses except where member login necessarily submits a phone.

## Task 3: GUI Route Validation

**Files:**
- Modify: `docs/progress/current-progress.md`

- [x] **Step 1: Start Kiosk/Admin in HTTP mode**

Run:

```bash
VITE_API_MODE=http VITE_API_BASE_URL=http://localhost:3010/api/v1 pnpm --filter @ai-job-print/kiosk dev -- --host 127.0.0.1 --port 5173
VITE_API_MODE=http VITE_API_BASE_URL=http://localhost:3010/api/v1 pnpm --filter @ai-job-print/admin dev -- --host 127.0.0.1 --port 5174
```

Expected: both apps serve their routes with no console-crashing errors.

- [x] **Step 2: Capture browser evidence**

Check:

```text
Kiosk /profile shows 权益活动 without 建设中
Kiosk /activities renders published activity
Kiosk /activities/:id renders detail and claim state
Admin /benefit-activities renders list/create/detail/claim record affordances
```

Expected: page layout is usable on desktop and 9:16 portrait viewport.

## Task 4: Closeout

**Files:**
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`
- Modify: `.ccg/tasks/benefit-activities-real-validation/task.json`

- [x] **Step 1: Record evidence**

Add exact commands, pass/fail status, screenshots if available, and unresolved gaps.

- [x] **Step 2: Review**

Because this touches auth/database validation and may add scripts/docs, run Claude + Antigravity review before final delivery if any code changes are made.

- [x] **Step 3: Commit**

Use explicit staging only; do not use `git add .`.
