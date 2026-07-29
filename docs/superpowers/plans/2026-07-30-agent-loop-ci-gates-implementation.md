# Agent Loop CI Offline Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把五个已在干净主线和临时环境通过、但未直接进入 CI 的高价值离线守卫纳入常规回归，并修正文档中的过时 CI 覆盖口径。

**Architecture:** 不修改业务源码或数据模型，只扩展现有 `.github/workflows/ci.yml` 的串行 verify 清单。SQLite 主 job 执行全部五项；PostgreSQL readiness 仅重复执行真正依赖数据库行为的退款和求职材料两项，避免把纯静态/Redis 守卫无意义重复到双栈。进度文档只记录实际完成证据，不宣称生产、外部服务或真机通过。

**Tech Stack:** GitHub Actions YAML、pnpm 11.2.2、Node.js 22、NestJS verify 脚本、SQLite、PostgreSQL 16、Redis 7。

---

## File map and budget

- Modify: `.github/workflows/ci.yml` — SQLite/PG 两个既有串行 verify 清单，预计新增 7 行。
- Modify: `docs/progress/current-progress.md` — 顶部新增一条真实执行记录，预计 1 段。
- Modify: `docs/progress/next-tasks.md` — 更新“未纳入 CI 的相关守卫”过时口径，预计 1 段。
- Create/Archive: `.ccg/tasks/multi-model-loop-audit-and-remediation/*` — CCG 任务记录。
- Do not modify: `apps/**`、`services/**`、`packages/**`、Prisma schema/migrations、生产/硬件配置。

### Task 1: Lock the clean baseline and close the local dependency false alarm

**Files:**
- No tracked source changes.

- [x] **Step 1: Install from the frozen lockfile in the isolated worktree**

Run:

```bash
pnpm install --frozen-lockfile
```

Expected: exit 0, pnpm 11.2.2, 805 packages materialized.

- [x] **Step 2: Verify the dependency-security failure is local-install-only**

Run:

```bash
pnpm verify:dependency-security
```

Expected: `ALL PASS: dependency security gate`; therefore do not edit patches, lockfile, or security assertions.

- [x] **Step 3: Record baseline quality**

Run:

```bash
pnpm typecheck
pnpm lint
```

Expected: typecheck exit 0; lint exit 0 with only the six existing Fast Refresh warnings.

### Task 2: Prove the selected offline gates before changing CI

**Files:**
- Temporary only: `services/api/prisma/loop-ci.db` and `/tmp/ai-job-print-loop-ci-storage`.

- [x] **Step 1: Create an isolated SQLite fixture using the CI schema**

Run from repository root with CI-only test environment values:

```bash
sqlite3 services/api/prisma/loop-ci.db 'PRAGMA user_version=0;'
DATABASE_URL='file:./prisma/loop-ci.db' pnpm --filter @ai-job-print/api exec prisma db push --accept-data-loss
```

Expected: `Your database is now in sync with your Prisma schema`.

- [x] **Step 2: Run the five candidates serially**

Run with `FILE_STORAGE_DRIVER=local`, a temporary storage directory, `AI_PROVIDER=mock`, `SMS_PROVIDER=log`, CI-only JWT/encryption/signing secrets, and local Redis:

```bash
pnpm --filter @ai-job-print/api verify:admin-orders-refund
pnpm --filter @ai-job-print/api verify:member-data-retention
pnpm --filter @ai-job-print/api verify:trtc-ownership
pnpm --filter @ai-job-print/api verify:file-retention
pnpm --filter @ai-job-print/api verify:job-materials
```

Expected: all five exit 0; no Tencent/COS/production calls.

### Task 3: Add the offline gates to CI with a RED/GREEN coverage assertion

**Files:**
- Modify: `.github/workflows/ci.yml`

- [x] **Step 1: Run the static RED assertion**

Run:

```bash
node - <<'NODE'
const fs = require('fs')
const assert = require('assert/strict')
const ci = fs.readFileSync('.github/workflows/ci.yml', 'utf8')
for (const gate of [
  'verify:admin-orders-refund',
  'verify:member-data-retention',
  'verify:trtc-ownership',
  'verify:file-retention',
  'verify:job-materials',
]) assert.ok(ci.includes(gate), `CI missing ${gate}`)
NODE
```

Expected before edit: FAIL on `verify:admin-orders-refund`.

- [x] **Step 2: Extend the SQLite serial suite**

Add these exact commands to the existing `build-and-verify` serial API block, adjacent to their domains:

```yaml
pnpm --filter @ai-job-print/api verify:trtc-ownership
pnpm --filter @ai-job-print/api verify:admin-orders-refund
pnpm --filter @ai-job-print/api verify:file-retention
pnpm --filter @ai-job-print/api verify:job-materials
pnpm --filter @ai-job-print/api verify:member-data-retention
```

- [x] **Step 3: Extend PostgreSQL readiness only for DB-sensitive gates**

Add these exact commands to `Core verify suites on PG`:

```yaml
pnpm --filter @ai-job-print/api verify:admin-orders-refund
pnpm --filter @ai-job-print/api verify:job-materials
```

Do not duplicate `verify:member-data-retention`, `verify:file-retention`, or `verify:trtc-ownership` in PG because the first two validate static retention contracts and the last validates Redis ownership, not provider-specific DB behavior.

- [x] **Step 4: Run the GREEN coverage assertion**

Re-run Task 3 Step 1.

Expected: exit 0.

### Task 4: Correct the project SSOT without overstating completion

**Files:**
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`

- [x] **Step 1: Add the current-progress fact**

Insert a 2026-07-30 top entry stating:

```text
完成多模型 Agent Loop 第一批 CI 离线守卫收口：在干净 origin/main 隔离 worktree 中确认依赖安全失败仅为原工作区陈旧 node_modules，仓库无需修改；五项离线守卫在临时 SQLite/Redis/local storage 全绿；SQLite CI 纳入全部五项，PG readiness 仅纳入退款与求职材料两项 DB-sensitive 守卫。未连接生产、外部服务或真机。
```

- [x] **Step 2: Replace the stale next-tasks statement**

Replace the sentence claiming all four guards are absent from CI with a dated status that distinguishes:

```text
`verify:terminal-device-config` 与 `verify:legal-retention-copy` 已进入 CI；`verify:home-toolbox-ui` 与 `verify:print-entry-source-split` 仍未进入 CI，改动对应文件时必须本地手跑。本轮新增五项离线 API 守卫；live/真实服务/真机脚本继续不进入自主 CI Loop。
```

### Task 5: Verify the integrated change

**Files:**
- Verify only.

- [x] **Step 1: Re-run the five SQLite gates serially**

Run the exact commands from Task 2 Step 2.

Expected: all pass.

- [x] **Step 2: Run repository gates**

Run:

```bash
pnpm verify:dependency-security
pnpm typecheck
pnpm lint
pnpm --filter @ai-job-print/api db:pg:sync:check
git diff --check
```

Expected: all exit 0; lint only the six pre-existing Fast Refresh warnings.

- [x] **Step 3: Inspect scope**

Run:

```bash
git status --short
git diff -- .github/workflows/ci.yml docs/progress/current-progress.md docs/progress/next-tasks.md
```

Expected: no business source, schema, migration, lockfile, patch, production, or hardware files changed.

### Task 6: Multi-model review, repair loop, and archive

**Files:**
- Create: `.ccg/tasks/multi-model-loop-audit-and-remediation/review.md`
- Move to: `.ccg/tasks/archive/2026-07/multi-model-loop-audit-and-remediation/`

- [x] **Step 1: Ask Claude, Antigravity, and Cursor for independent final review**

Review the exact `git diff` for correctness, CI ordering, false external-service risk, SQLite/PG placement, security, and documentation honesty. Require `Critical/Warning/Info` output.

- [x] **Step 2: Repair only validated Critical/Warning findings**

Maximum three repair rounds. Each round must change one hypothesis, re-run the affected gate, and request focused re-review. Three failed rounds stop for architectural/user review.

- [x] **Step 3: Archive and commit**

After all required gates pass and Critical/High are zero:

```bash
test -z "$(git ls-files .ccg/tasks | grep -v '^.ccg/tasks/archive/' || true)"
git status --short
git add .github/workflows/ci.yml docs/progress/current-progress.md docs/progress/next-tasks.md docs/superpowers/plans/2026-07-30-agent-loop-ci-gates-implementation.md .ccg/tasks/archive/2026-07/multi-model-loop-audit-and-remediation/
git diff --cached --name-only | grep -Ev '\.(db|db-journal|db-shm|db-wal)$'
git commit -m "ci: add high-value offline API gates"
```

Do not push, deploy, open a PR, touch production, or claim Windows/printing/scanning/live-service acceptance.

---

## Self-review

- Spec coverage: files, exclusions, SQLite serialization, PG dual-stack placement, live-service boundary, documentation sync, multi-model review, and stop conditions are all mapped to tasks.
- Placeholder scan: no TBD/TODO or unspecified implementation steps remain.
- Type consistency: all five command names match `services/api/package.json`; all commands were executed successfully on the clean baseline before CI editing.
