# F1 D2′ Integration Reconciliation Plan

**Goal:** 先合入 D2′ 调用治理真值，再消除旧开放 PR 与执行合同候选的集成歧义，最终形成基于最新 `main` 的单一可审 PR。

## Task 1: Merge truth baseline

- Confirm PR #454 is open, CLEAN, mergeable, and all three required checks pass.
- Merge with the repository's merge-commit convention.
- Confirm remote `main` contains the PR head.

## Task 2: Audit overlapping PR #449

- Compare PR #449 functional files and commits against latest `main` and PR #453/#454 history.
- Run Antigravity and Claude read-only reviews in parallel.
- Close only if evidence shows it is superseded; otherwise stop and extract the exact unique value.

## Task 3: Rebase and reconcile SSOT

- Fetch `origin/main` and rebase the current unpushed branch.
- Resolve progress documents by preserving PR #454 event A/B, invocation uniqueness, stale-PID/cleanup tasks, and this branch's completed execution-entry contract.
- Do not touch the dirty main worktree.

## Task 4: Verify and publish candidate

- Run Shell/Node syntax, offline contract, API lint/typecheck/build, line-count and diff gates sequentially.
- Run Antigravity + Claude final review; Critical/Warning must be zero.
- Archive the CCG task, commit reconciliation, push the branch, and create a PR without merging it.
