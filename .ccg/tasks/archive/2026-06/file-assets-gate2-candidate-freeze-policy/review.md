# Review: file-assets-gate2-candidate-freeze-policy

## Scope

- Task: Gate 2 deployment candidate freeze policy for user file/resume assets.
- Branch: `codex/file-assets-gate2-candidate-freeze-policy`.
- Frozen deployment candidate: `2187f6a7`.
- This task did not connect to preproduction or production, did not upload archives, did not migrate databases, did not restart PM2, and did not touch COS or business data.

## Verification

- TDD RED: `pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance` failed before docs were updated, first missing marker: `部署候选冻结`.
- GREEN: `pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance` passed.
- Typecheck: `pnpm --filter @ai-job-print/api typecheck` passed.
- Whitespace: `git diff --check` passed.
- Sensitive/compliance scan over changed files and task files found no hits for secrets or forbidden recruiting-platform wording.

## Claude Review

- First review: no Critical. Claude identified that raw `execSync(git diff ...)` errors would be hard to diagnose if the frozen candidate is unreachable in shallow history.
- Follow-up review: no Critical. Claude identified an untracked-file blind spot in `git diff --name-only`.
- Fixes applied:
  - Added `git cat-file -e 2187f6a7^{commit}` with clear fail-closed message.
  - Wrapped read-only Git calls in `readRequiredGitOutput`.
  - Added `git ls-files --others --exclude-standard` and applied the same governance whitelist to untracked files.

## Antigravity Review

- Initial focused review: APPROVE, no Critical.
- After Claude's hardening fix, Antigravity requested changes for strict TypeScript compatibility around `error.stderr`.
- Fix applied:
  - Replaced direct `error.stderr` access with object narrowing and `{ stderr?: unknown }` casting.
- Final Antigravity review: APPROVE, no Critical, no Warning. Info only: the governance whitelist is intentionally hardcoded and must be updated if future governance folders or script locations change.

## Result

- Gate 2 deployment candidate remains frozen at `2187f6a7`.
- Governance-only commits do not refresh the deployment candidate.
- A candidate refresh is required if runtime code, database schema, build inputs, archive scope, production build variables, or Gate 2 execution commands change.
- The static gate now blocks both tracked and untracked runtime-impacting files after the frozen candidate unless the deployment candidate is refreshed.
