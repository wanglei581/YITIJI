# Smart Campus Cross-Branch Integration Plan

> **Goal:** 在不丢失 `feature/interview-setup-redesign` 当前招聘会/面试/terminal-agent 改动的前提下，把 `main` 中已合入的智慧校园完整功能安全集成到当前业务分支，并建立防复发验收。

## Non-Negotiable Constraints

- 不直接在 `main` 上开发或提交。
- 不使用 `git reset --hard`、`git checkout -- .`、`git clean`。
- 不使用 `git add .`。
- 不覆盖当前工作区未提交改动。
- 冲突处理必须取并集：招聘会/面试/terminal-agent 保留，智慧校园也保留。
- 任何成功结论必须有新鲜命令输出作为证据。

## Root Cause

当前运行的 API `3010` 与 Kiosk `5173` 都来自 `/Users/wanglei/AI求职打印服务终端` 的 `feature/interview-setup-redesign` 分支。该分支从 `bdccfb8f` 分叉，未包含 `main` 后续 PR #47 智慧校园提交链，因此代码树中不存在智慧校园页面、路由、API、schema、verify 脚本。

## Execution Steps

### Task 1: Snapshot and Inventory

- [ ] Confirm current branch and HEAD.
- [ ] Create a backup branch pointing at current HEAD, e.g. `backup/interview-setup-before-smart-campus-<shortsha>`.
- [ ] Record current `git status --short`.
- [ ] Classify dirty files into groups:
  - Kiosk 招聘会/校园招聘/companies/scan/profile/front-end changes.
  - Admin/Partner 招聘会 changes.
  - API 招聘会/schema/seed/verify changes.
  - terminal-agent changes.
  - docs/product changes.
  - CCG task files.
  - unrelated/untracked business docs that must not be staged.

### Task 2: Make Working Tree Mergeable

- [ ] Stage only intentional files by explicit path.
- [ ] Commit grouped changes with conventional commit messages.
- [ ] Leave unrelated untracked files unstaged.
- [ ] Verify `git status --short` has no tracked modified files that would block merge.

### Task 3: Merge Smart Campus from Main

- [ ] Run `git merge main`.
- [ ] Resolve conflicts manually.
- [ ] Preserve both sides in likely conflict files:
  - `apps/kiosk/src/routes/index.tsx`
  - `apps/kiosk/src/pages/home/HomePage.tsx`
  - `services/api/prisma/schema.prisma`
  - `services/api/prisma/postgres/schema.prisma`
  - `services/api/package.json`
  - `apps/kiosk/package.json`
  - `docs/progress/current-progress.md`
- [ ] Verify smart-campus files exist in the merged tree.
- [ ] Complete merge commit.

### Task 4: Data and Dependency Consistency

- [ ] Run dependency install only if package manifests changed and lockfile requires it.
- [ ] Generate Prisma client if schema changed.
- [ ] Apply local dev migration/schema sync safely.
- [ ] Do not reset production or dev data.

### Task 5: Verification Matrix

Run and capture results:

- [ ] `pnpm --filter @ai-job-print/shared typecheck`
- [ ] `pnpm --filter @ai-job-print/api typecheck`
- [ ] `pnpm --filter @ai-job-print/kiosk typecheck`
- [ ] `pnpm --filter @ai-job-print/admin typecheck`
- [ ] `pnpm --filter @ai-job-print/partner typecheck`
- [ ] `pnpm --filter @ai-job-print/api verify:partner-smart-campus`
- [ ] `pnpm --filter @ai-job-print/kiosk verify:smart-campus-ui`
- [ ] `pnpm --filter @ai-job-print/kiosk verify:jobfair-ui`
- [ ] 招聘会相关 API verify scripts already present in package.json, at minimum:
  - `pnpm --filter @ai-job-print/api verify:admin-fairs`
  - `pnpm --filter @ai-job-print/api verify:fair-info-fields`
  - `pnpm --filter @ai-job-print/api verify:fair-company-positions`
  - `pnpm --filter @ai-job-print/api verify:jobfair-venue-guide`
- [ ] Build API, Kiosk, Admin, Partner with required HTTP mode where applicable.

### Task 6: Runtime Smoke

- [ ] Start API + Kiosk/Admin/Partner on non-conflicting local ports.
- [ ] Confirm Kiosk shows both 招聘会 and 智慧校园 when terminal is configured.
- [ ] Confirm Admin has both 招聘会管理 and 智慧校园.
- [ ] Confirm Partner has both 招聘会信息管理 and 智慧校园.
- [ ] Confirm Partner smart-campus save toggles Kiosk config.
- [ ] Confirm `bigdata` remains frozen and fake stats are absent.

### Task 7: Review and Report

- [ ] Run dual-model review: Antigravity + Claude.
- [ ] Fix any Critical findings.
- [ ] Produce final report with:
  - Root cause.
  - Commits created.
  - Merge details.
  - Conflicts resolved.
  - Verification matrix.
  - Remaining risks.
  - Exact local run instructions.

## Acceptance Criteria

- `git ls-tree -r HEAD | grep smart-campus` returns smart-campus source files.
- Current feature branch contains both interview/job-fair changes and smart-campus changes.
- No unrelated untracked docs or stale CCG archives are accidentally committed.
- Verification matrix passes or any failure is explicitly reported with root cause.
- Kiosk/Admin/Partner all show expected menus/pages.
- Smart Campus remains school/terminal-gated and does not display mock bigdata.
