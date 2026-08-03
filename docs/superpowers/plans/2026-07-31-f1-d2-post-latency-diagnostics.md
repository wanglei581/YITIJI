# F1 D2 Prime Post-Latency Diagnostics Implementation Plan

**Goal:** Preserve a safe, actionable phase/error classification when the D2 prime drill fails, without exposing raw runtime data or rerunning the drill.

**Architecture:** Add one dependency-free pure module that owns a closed diagnostic vocabulary. `drill.mjs` records the current phase, classifies the primary exception at catch time, separately records failure-evidence write failure, and emits only the formatter's fixed tokens. The existing evidence schema stays unchanged and fail-closed.

**Tech stack:** Node.js ESM, `node:assert/strict`, existing offline contract runner.

---

### Task 1: RED — define the missing contract

**Files:**

- Modify: `services/api/scripts/d2-same-host/verify-contract.mjs`
- Test: `pnpm --filter @ai-job-print/api verify:d2-same-host-contract`

Add imports and assertions for closed phases/classes, named passthrough, unknown fallback, evidence-write marker, exact-record validation, and injected sensitive-value non-disclosure. Run once and retain the module-not-found RED result.

### Task 2: GREEN — implement pure diagnostics

**Files:**

- Create: `services/api/scripts/d2-same-host/diagnostics.mjs`
- Test: `services/api/scripts/d2-same-host/verify-contract.mjs`

Implement immutable enums and pure functions to classify, wrap and format diagnostics. Never concatenate or serialize the original exception, its message, stack, cause, code, syscall, path, environment, hostname, PID or nonce. Run the offline contract until the new unit assertions pass.

### Task 3: Wire the runtime safely

**Files:**

- Modify: `services/api/scripts/d2-same-host/drill.mjs`
- Modify: `services/api/scripts/d2-same-host/verify-contract.mjs`

Track phase boundaries and capture the primary diagnostic inside the inner catch. Attempt NO-GO evidence in a nested catch; on failure set only the fixed evidence-write marker. Top-level output must call the formatter. Add source-contract adversarial mutations so missing phase boundaries, raw error output, or removal of the evidence-write marker fails closed.

### Task 4: Verify and review

Run:

```bash
node --check services/api/scripts/d2-same-host/diagnostics.mjs
node --check services/api/scripts/d2-same-host/drill.mjs
node --check services/api/scripts/d2-same-host/verify-contract.mjs
pnpm --filter @ai-job-print/api verify:d2-same-host-contract
pnpm --filter @ai-job-print/api lint
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/api build
git diff --check
```

Then complete dual-model and Cursor reviews, progress updates, CCG archive, commit, push, and PR. This task never starts Colima or runs the full drill.
