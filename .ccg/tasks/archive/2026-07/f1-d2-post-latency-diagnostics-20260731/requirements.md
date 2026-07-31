# Requirements

## Real blocker

The authorized D2 prime retake emitted latency metrics and then failed before success evidence. The top-level drill catch reduced an otherwise classifiable failure to `D2_PRIME_DRILL_FAILED`, while safe NO-GO evidence retained no phase or bounded error class. Existing evidence therefore cannot prove the runtime root cause.

## Scope and file budget

Allowed runtime/test files:

- `services/api/scripts/d2-same-host/drill.mjs`
- `services/api/scripts/d2-same-host/verify-contract.mjs`
- At most one small focused helper under `services/api/scripts/d2-same-host/` if review proves it is necessary.

Allowed task/progress documentation:

- `.ccg/tasks/f1-d2-post-latency-diagnostics-20260731/*`
- `docs/superpowers/plans/2026-07-31-f1-d2-post-latency-diagnostics.md`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`

## Required behavior

1. Preserve existing named `D2_PRIME_*` and `RELEASE_PROVENANCE_*` failure codes unchanged.
2. Classify otherwise-unhandled failures with a fixed phase enum and fixed safe error class; never serialize raw messages, stacks, paths, hostnames, PIDs, nonces, environment values, evidence contents, or arbitrary errno strings.
3. Make failure-evidence write failures distinguishable using a fixed safe code or class.
4. Add contract tests first and demonstrate RED before implementation.
5. Add adversarial leakage assertions using injected secret/path/32-hex nonce values.
6. Preserve fail-closed exit behavior and productionF1 `NO-GO` semantics.

## Explicit non-goals

- Do not rerun D2 prime or generate a new nonce/evidence file.
- Do not start Colima, PM2, systemd, Nginx, API processes, or connect to production.
- Do not claim to fix the unknown runtime root cause.
- Do not change product UI, API routes, database schema, dependencies, deployment state, or `legacy-miaoda`.

## Verification

- D2 same-host offline contract RED then GREEN.
- Node syntax checks for touched scripts.
- API lint, typecheck, and build.
- `git diff --check`, secret/leak-oriented diff review, and exact scope review.
- Claude + Antigravity parallel analysis and final review; Cursor analysis and final review through the desktop client when CLI is unavailable.
