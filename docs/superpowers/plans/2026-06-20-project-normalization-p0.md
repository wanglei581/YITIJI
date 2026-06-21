# Project Normalization P0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a clean governance baseline for project normalization without creating a new repository, moving source directories, or touching runtime code.

**Architecture:** Keep the existing monorepo. Execute governance from an isolated worktree based on `origin/main`, then classify and land changes in small task branches with explicit file budgets and verification gates.

**Tech Stack:** Git worktree, Markdown project docs, CCG task records, pnpm monorepo verification.

---

## File Structure

- Create `.ccg/tasks/project-normalization-p0/task.json`: CCG task state for this governance branch.
- Create `.ccg/tasks/project-normalization-p0/requirements.md`: scope, non-goals, allowed files, acceptance criteria.
- Create `docs/project-structure.md`: authoritative directory responsibility index.
- Create `.ccg/spec/guides/index.md`: engineering scale control and anti-bloat rules.
- Create `docs/reviews/project-normalization-p0-worktree-inventory.md`: local worktree classification rules.
- Create `docs/superpowers/plans/2026-06-20-project-normalization-p0.md`: this execution plan.
- Modify `AGENTS.md` and `CLAUDE.md`: point future agents to the directory index and engineering spec.

## Task 1: Establish Governance Baseline

**Files:**
- Create: `.ccg/tasks/project-normalization-p0/task.json`
- Create: `.ccg/tasks/project-normalization-p0/requirements.md`
- Create: `docs/project-structure.md`
- Create: `.ccg/spec/guides/index.md`
- Create: `docs/reviews/project-normalization-p0-worktree-inventory.md`
- Create: `docs/superpowers/plans/2026-06-20-project-normalization-p0.md`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Confirm isolated worktree**

Run:

```bash
git status -sb
git log --oneline -3
```

Expected:

```text
## codex/project-normalization-p0...origin/main
dc32472f docs: record P0-0617 closure merge (#54)
```

- [ ] **Step 2: Create governance docs**

Create the files listed above. Do not modify runtime files under `apps/`, `services/`, or `packages/`.

- [ ] **Step 3: Verify no runtime code changed**

Run:

```bash
git diff --name-only | rg '^(apps|services|packages)/' || true
```

Expected: no output.

- [ ] **Step 4: Verify markdown and whitespace**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 5: Review file budget**

Run:

```bash
git diff --name-only
```

Expected files:

```text
.ccg/spec/guides/index.md
.ccg/tasks/project-normalization-p0/requirements.md
.ccg/tasks/project-normalization-p0/task.json
AGENTS.md
CLAUDE.md
docs/project-structure.md
docs/reviews/project-normalization-p0-worktree-inventory.md
docs/superpowers/plans/2026-06-20-project-normalization-p0.md
```

## Task 2: Prepare Main Worktree Cleanup Decision

**Files:**
- Modify: `docs/reviews/project-normalization-p0-worktree-inventory.md`

- [ ] **Step 1: Inventory current main worktree**

Run this from `/Users/wanglei/AI求职打印服务终端`:

```bash
git status -sb
git ls-files --others --exclude-standard | awk 'BEGIN{FS="/"} {count[$1]++} END{for (k in count) print count[k], k}' | sort -nr
```

Expected: categorized untracked groups are visible.

- [ ] **Step 2: Map each group to a category**

Use the classification rules in `docs/reviews/project-normalization-p0-worktree-inventory.md`:

```text
A: formal runtime source
B: formal project truth
C: task and review evidence
D: external materials
E: local tool/cache
```

- [ ] **Step 3: Stop before destructive action**

Do not delete, move, or ignore anything until the user confirms the category handling.

## Task 3: Review Gate

**Files:**
- No new files unless review feedback requires a docs correction.

- [ ] **Step 1: Run local checks**

Run:

```bash
git diff --check
git diff --name-only | rg '^(apps|services|packages)/' || true
```

Expected: whitespace check passes and runtime-code search has no output.

- [ ] **Step 2: Request dual-model review**

Call Claude and Antigravity on the governance diff before commit because this is a cross-process project governance change.

- [ ] **Step 3: Stage only explicit files**

Run only after review passes:

```bash
git add .ccg/spec/guides/index.md \
  .ccg/tasks/project-normalization-p0/task.json \
  .ccg/tasks/project-normalization-p0/requirements.md \
  AGENTS.md \
  CLAUDE.md \
  docs/project-structure.md \
  docs/reviews/project-normalization-p0-worktree-inventory.md \
  docs/superpowers/plans/2026-06-20-project-normalization-p0.md
```

Do not run `git add .`.
