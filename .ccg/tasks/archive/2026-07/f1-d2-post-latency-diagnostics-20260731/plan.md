# Plan

## Decision

Implement a closed, pure diagnostic contract and wire it into the drill. Preserve the existing generic NO-GO evidence schema; the durable safe diagnostic is the captured stderr contract emitted by `run.sh`. Do not expand into release-provenance internals or the unknown runtime cause.

## File ownership

1. `services/api/scripts/d2-same-host/diagnostics.mjs` — fixed enums, pure classification/wrapping/formatting.
2. `services/api/scripts/d2-same-host/verify-contract.mjs` — RED/GREEN unit and source-wiring contract tests.
3. `services/api/scripts/d2-same-host/drill.mjs` — phase boundaries, catch-time classification, failure-evidence status, safe top-level output.
4. Task/progress/plan documents only.

No changes to `contract.mjs`, release provenance, `run.sh`, dependencies, production config, database, UI, terminal agent, or `legacy-miaoda`.

## TDD sequence

1. Add imports and tests for a non-existent diagnostics module. Run the offline contract and capture the expected RED module-not-found failure.
2. Implement the smallest pure contract:
   - phases: `SETUP`, `CUTOVER`, `ROLLBACK`, `MEASURE`, `EVIDENCE`, `CLEANUP`;
   - classes: `NAMED`, `ASSERTION`, `SYSTEM`, `SYNTAX`, `TYPE`, `ERROR`, `UNKNOWN`;
   - named `D2_PRIME_*` and `RELEASE_PROVENANCE_*` codes pass through;
   - all other codes become `D2_PRIME_DRILL_FAILED`;
   - optional fixed `D2_PRIME_FAILURE_EVIDENCE_WRITE_FAILED` marker;
   - formatter accepts only exact closed records and emits one bounded ASCII line.
3. Prove GREEN for pure tests, including injected secret, absolute path, hostname-like text, PID-like text, arbitrary errno and 32-hex nonce not appearing in formatted output or generic NO-GO evidence.
4. Wire the contract into `drill.mjs`:
   - update the phase immediately before each post-latency boundary;
   - classify the primary error inside the inner catch before `finally` can run;
   - attempt generic NO-GO evidence independently and mark a fixed evidence-write failure without exposing its exception;
   - format the stored diagnostic at the top level;
   - classify a cleanup exception at `CLEANUP` if it supersedes the primary error.
5. Add source-contract assertions proving phase assignments, catch-time wrapping, evidence-write marker, and absence of raw error serialization.
6. Run syntax, offline contract, API lint/typecheck/build, `git diff --check`, exact scope and leak review.
7. Run Claude + Antigravity parallel final review and Cursor client final review; fix Critical/Warning findings, re-run gates, update progress, archive the CCG task, commit, push, and open a PR. Do not merge without separate authorization.
