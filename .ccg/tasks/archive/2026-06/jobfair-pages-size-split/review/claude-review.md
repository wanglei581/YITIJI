[codeagent-wrapper]
  Backend: claude
  Command: claude -p --dangerously-skip-permissions --setting-sources  --output-format stream-json --verbose -
  PID: 44470
  Log: /var/folders/wv/tfvgh3xd5g775gnqq5wpfbkm0000gn/T/codeagent-wrapper-44470.log
  Web UI: http://localhost:58204
  Session-ID: dd359414-56f3-45f1-939c-c87c92ab9a8d
I now have a complete picture. The diffs confirm verbatim extraction, and I've confirmed the size guard's wiring. Here is my review.

## Review: Branch 3 — Job Fair / Campus Page Size Split

**No Critical issues.** This is a faithful zero-behavior extraction. Every moved component, helper, constant, compliance string, button label, route, and `recordExternalJump`/`recordBrowse` call is preserved byte-for-byte against the removed code in the patch. Typecheck/build/lint passing is consistent with what I verified by hand.

### Critical 🔴
None.

### Warning 🟡

- **`apps/kiosk/scripts/verify-jobfair-page-size.mjs` — guard is not wired into anything.** The script's own header calls it a “防回退验证” (anti-regression check), but it is only runnable manually (`node …/verify-jobfair-page-size.mjs`). It is **not** referenced in `apps/kiosk/package.json` scripts, not chained into the existing `verify:jobfair-ui`, and not in any CI/lint-staged config (grep found zero references outside the file itself).
  - Why: An anti-regression guard that nobody runs automatically provides no protection — the three main files can silently re-bloat past 500 lines and no check will fail.
  - Fix: Add a `"verify:jobfair-size": "node scripts/verify-jobfair-page-size.mjs"` entry and either call it from `verify:jobfair-ui` or add it to the CI/pre-push step that already runs the other kiosk verifications. (Behavior-neutral; safe to add on this branch.)

### Info 🟢

- **Extracted component files already exceed the 500-line governance threshold.** `campus/components/CampusTabs.tsx` (575) and `job-fairs/components/JobFairDetailTabs.tsx` (576) are both over the same 500-line limit the project treats as a bloat boundary, but the guard deliberately checks only the three main pages (per its comment). This is consistent with the stated goal (keep *pages* lean), but the split effectively traded one oversized page for a near-oversized sibling. Not a behavior issue — flagging so it’s a conscious choice, not an oversight. If desired, `CompaniesTab` + helpers could be split out further later.

- **`MapBlock` duplication is preserved, not introduced.** `JobFairDetailTabs.tsx` carries its own local `MapBlock` (the one that lived inline in `JobFairDetailPage`), while `CampusTabs.tsx` imports the standalone `job-fairs/components/MapBlock.tsx`. This duplication predates the refactor (the old `JobFairDetailPage` had its own copy; the old `CampusPage` used the shared file), so behavior is unchanged. The new relative import path `'../../job-fairs/components/MapBlock'` from the deeper `campus/components/` location resolves correctly. No action needed for this branch; a future consolidation onto the shared `MapBlock` would remove the redundancy.

- **`TabKey` retyped, behavior identical.** `CampusTabs.tsx` declares `type TabKey = 'overview' | 'companies' | 'map' | 'ai' | 'print'` instead of the page’s `(typeof TABS)[number]['key']`. The unions are identical, so `onGoTab={setTab}` type-checks and runtime behavior is unchanged. Minor maintenance note: if a tab is ever added/renamed in `CampusPage.TABS`, this hand-written union must be updated in lockstep (they are no longer derived from a single source).

- **`pad` is now duplicated** across `CampusPage.tsx` (for `fmtDateBadge`) and `CampusTabs.tsx` (for `fmtTime`). Trivial, intentional given the split, and lint-clean. No change required.

### Summary
**Approve.** Correctness and zero-behavior preservation are intact — moved code matches the originals exactly, all routes/compliance copy/QR/external-jump behavior is unchanged, and import paths/types are sound (corroborated by the passing checks). The only actionable item is the **Warning**: the size guard must be wired into package scripts/CI to actually serve its anti-regression purpose; as committed it’s dormant. The two new ~575-line component files exceeding the project’s own 500-line threshold are worth a conscious acknowledgment but don’t block this branch.

---
SESSION_ID: dd359414-56f3-45f1-939c-c87c92ab9a8d
