# Kiosk 8177 / 5299 Fusion Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve every current Kiosk business capability while replacing all user-visible Kiosk presentation with the approved 5299-led, 8177-state-complete fusion design.

**Architecture:** Freeze one versioned fusion prototype and route/state contract before runtime edits. Build one Kiosk-only presentation foundation, then migrate four non-overlapping business domains, and finish with full-route browser, compliance, security, and real-service regression gates. Existing page containers, hooks, services, route semantics, payment, files, printing, scanning, AI, and hardware behavior remain the source of truth.

**Tech Stack:** React 18, React Router 7, TypeScript 5.7, Vite 6, Tailwind CSS 4, `@ai-job-print/ui`, Node 22 test runner, Playwright Chromium, existing `verify:*.mjs` contracts.

---

## 1. Authoritative inputs

- Approved design: `docs/superpowers/specs/2026-07-23-kiosk-8177-5299-fusion-design.md`
- Existing prototype: `docs/design/kiosk-proto-2026-07/`
- Existing route matrix: `docs/design/kiosk-proto-2026-07-migration-matrix.md`
- Product entry rules: `docs/product/user-data-flow-matrix.md`
- Compliance boundary: `docs/compliance/compliance-boundary.md`
- Engineering scale rules: `.ccg/spec/guides/index.md`
- Runtime route source: `apps/kiosk/src/routes/index.tsx`

The existing migration matrix is extended in place. Do not create a second competing route matrix.

## 2. Global invariants

- Do not add, remove, or rename production routes.
- Do not change `apps/kiosk/src/services/**`, `packages/shared/**`, `services/**`, or `apps/terminal-agent/**` in this task.
- Do not change API payloads, DTOs, database schemas, payment states, task IDs, file references, storage semantics, or hardware commands.
- Do not add production demo flags or fixed mock data. Browser states come from Playwright network fixtures.
- Do not create a fourth upload tab for scanning. The fourth 2×2 tile navigates to `/scan/start`.
- Do not add in-platform job application, resume collection, candidate management, interview invitation, or offer management.
- Do not weaken or delete existing verify scripts. When code moves, update assertions to the new presentation component.
- Do not commit browser screenshots containing tokens, phone numbers, names, pickup codes, signed URLs, prompt bodies, or user documents.
- Runtime page changes begin only after W0 passes and is committed.
- Domain workers begin only after W1 passes and its shared files are frozen.

## 3. Wave dependency graph

```text
W0 fusion source + route/state + browser harness
                      ↓
W1 tokens + Kiosk-only primitives + shell + home
          ┌───────────┼───────────┬───────────┐
          ↓           ↓           ↓           ↓
 W2 print/scan   W3 resume/AI  W4 jobs/fairs  W5 profile/system
          └───────────┼───────────┴───────────┘
                      ↓
W6 full-route integration, cleanup, dual review, acceptance
```

## 4. Required plan sequence

- [ ] Execute `docs/superpowers/plans/2026-07-23-kiosk-8177-5299-fusion-w0.md`.
- [ ] After W0 is committed, write and dual-review the W1 detailed TDD plan against the committed fusion directory.
- [ ] After W1 is committed, write and dual-review the W2–W5 domain plans using the frozen primitives.
- [ ] After W2–W5 pass independently, write and dual-review the W6 integration plan.

This sequencing is mandatory because the exact React markup cannot be specified honestly until the fusion baseline is versioned, and domain code cannot be planned without the final shared primitive API. Each detailed wave plan must repeat the RED → GREEN → refactor → verify → commit cycle and contain exact code for its own file changes.

## 5. W0 ownership: fusion baseline and test infrastructure

Single owner only. No `apps/kiosk/src/**` or `packages/ui/src/**` edits.

**Create:**

- `docs/design/kiosk-proto-2026-07-fusion/**`
- `docs/acceptance/kiosk-8177-5299-fusion-visual-runbook.md`
- `apps/kiosk/scripts/lib/fusion-baseline-contract.mjs`
- `apps/kiosk/scripts/tests/fusion-baseline-contract.test.mjs`
- `apps/kiosk/scripts/verify-fusion-baseline.mjs`
- `apps/kiosk/playwright.config.ts`
- `apps/kiosk/tests/fixtures/api-router.ts`
- `apps/kiosk/tests/fixtures/kiosk-test.ts`
- `apps/kiosk/tests/visual/route-manifest.ts`
- `apps/kiosk/tests/visual/assert-layout.ts`
- `apps/kiosk/tests/visual/fusion-smoke.spec.ts`

**Modify:**

- `docs/design/kiosk-proto-2026-07-migration-matrix.md`
- `apps/kiosk/package.json`
- `pnpm-lock.yaml`
- `.github/workflows/ci.yml`
- `.gitignore`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`

**Required commits:**

1. `docs: preserve 8177 5299 prototype sources`
2. `test(kiosk): add fusion baseline contract`
3. `docs: freeze 8177 5299 fusion prototype baseline`
4. `test(kiosk): add fusion browser harness`
5. `docs: record kiosk fusion w0 acceptance`

## 6. W1 ownership: shared foundation and representative pages

W1 is serial. It owns and freezes the shared API consumed by W2–W5.

**Create:**

- `packages/ui/src/components/KioskPageFrame.tsx`
- `packages/ui/src/components/KioskPageHeader.tsx`
- `packages/ui/src/components/KioskActionBar.tsx`
- `packages/ui/src/components/KioskStatePanel.tsx`
- `packages/ui/src/components/KioskModal.tsx`
- `packages/ui/scripts/verify-fusion-youth-foundation.mjs`
- `apps/kiosk/scripts/verify-fusion-shell.mjs`
- `apps/kiosk/scripts/verify-fusion-home.mjs`

**Modify:**

- `packages/ui/src/styles/fusion-youth.css`
- `packages/ui/src/theme/visualTheme.ts`
- `packages/ui/src/layouts/KioskLayout.tsx`
- `packages/ui/src/index.ts`
- `packages/ui/package.json`
- `apps/kiosk/src/index.css`
- `apps/kiosk/src/layouts/KioskRoot.tsx`
- `apps/kiosk/src/pages/auth/MobileQrLoginPage.tsx`
- `apps/kiosk/src/pages/upload/PhoneUploadPage.tsx`
- `apps/kiosk/src/pages/home/HomePage.tsx`
- `apps/kiosk/src/styles/prototype-v1.css`
- `apps/kiosk/package.json`

**W1 test-only acceptance scope (planning reconciliation, 2026-07-24):**

- Create `apps/kiosk/playwright.w1.config.ts` and the isolated `apps/kiosk/tests/visual/fixtures/fusion-w1/**` component preview, including a fixture-local Vite config with React and Tailwind v4 plugins. The preview is served only by the W1 Playwright command and is never added to production routes or the Vite production build.
- Create `apps/kiosk/tests/visual/fusion-w1.spec.ts` so `KioskStatePanel` and `KioskModal` can be exercised in a real browser before W2–W5 consume them. The W1 Playwright config must use a file-level `testMatch` so it cannot collect W0 specs.
- Modify `.github/workflows/ci.yml` to run the W1 static contracts and isolated browser acceptance in the existing `kiosk-browser-smoke` job.
- Modify `docs/progress/current-progress.md` and `docs/progress/next-tasks.md` with truthful W1 status.

This test-only expansion closes the original W1 acceptance/file-budget mismatch. It does not authorize a test-only production route, production demo flag, static mock page in `public/`, or business-state changes.

`/member/qr-login` and `/upload/phone` remain top-level full-screen routes outside `KioskRoot`; W1 may add only the fusion presentation/mobile viewport data attributes to their existing root elements. The W1 shell verifier must structurally prove that both route objects remain direct `createBrowserRouter` entries rather than `KioskRoot.children`, and must require each existing root `<main>` to retain its service-desk class/attributes and real helper service contract. They must not be moved under the Kiosk shell or have their service-desk/mobile business behavior rewritten.

**Modify only if the fusion prototype proves a missing icon/input state:**

- `apps/kiosk/src/components/kiosk-icon/index.tsx`
- `apps/kiosk/src/components/kiosk-keyboard/KioskKeyboard.tsx`
- `apps/kiosk/src/components/kiosk-keyboard/kiosk-keyboard.css`

Do not restyle the default `Button`, `Card`, or `PageHeader` globally. Admin and Partner also consume them. New primitives are Kiosk-specific presentation components with no service calls or business state ownership.

W1 passes only when home, shell, state panel, modal, 1080×1920 viewport, 390×844 isolation, touch targets, and production build gates all pass. W2–W5 may not edit these files after W1 freezes them.

## 7. W2 ownership: print and scan

**Exclusive files:**

- `apps/kiosk/src/pages/print-scan/**`
- `apps/kiosk/src/pages/scan/**`
- `apps/kiosk/src/pages/print/PrintPrototypeLayout.tsx`
- `apps/kiosk/src/pages/print/CashierPaymentPanel.tsx`
- `apps/kiosk/src/pages/print/PrintUploadPage.tsx`
- `apps/kiosk/src/pages/print/PrintMaterialCheckPage.tsx`
- `apps/kiosk/src/pages/print/PrintPreviewPage.tsx`
- `apps/kiosk/src/pages/print/PrintParamsPage.tsx`
- `apps/kiosk/src/pages/print/PrintConfirmPage.tsx`
- `apps/kiosk/src/pages/print/PrintCashierPage.tsx`
- `apps/kiosk/src/pages/print/PrintProgressPage.tsx`
- `apps/kiosk/src/pages/print/PrintDonePage.tsx`
- `apps/kiosk/src/pages/print/print-prototype.css`
- New presentation-only files under `pages/print/{components,styles}/**`, `pages/scan/{components,styles}/**`, and `pages/print-scan/{components,styles}/**`

**Excluded logic:**

- `DevSandboxControls.tsx`
- `cashierStatus.ts`
- `printMaterialSession.ts`
- `apps/kiosk/src/pages/upload/components/UploadSessionQrPanel.tsx`
- Payment, file, printing, scanning, and Terminal Agent services

**Required behavior cases:**

- 5299 2×2 upload layout with `file | qr | usb` tabs plus an independent scan CTA.
- 8177 cashier failure states mapped only to existing `failed`, `closed`, failed/expired attempt, and refunded contracts.
- Scanner offline state driven only by real device error categories.
- Polling, payment reconciliation, task recovery, sessionStorage, and navigation state unchanged.

**Mandatory commands:**

```bash
pnpm --filter @ai-job-print/kiosk verify:print-entry-source-split
pnpm --filter @ai-job-print/kiosk verify:print-confirm-honest
pnpm --filter @ai-job-print/kiosk verify:ai-artifact-print-url-contract
pnpm --filter @ai-job-print/kiosk verify:price-single-source
pnpm --filter @ai-job-print/kiosk verify:file-retention-ui
pnpm --filter @ai-job-print/api verify:scan-tasks
pnpm --filter @ai-job-print/api verify:print-jobs
pnpm --filter @ai-job-print/api verify:kiosk-upload-print-contract
pnpm --filter @ai-job-print/api verify:payment-flow
pnpm --filter @ai-job-print/api verify:print-scan-first-release
```

`PrintMaterialCheckPage.tsx` is 886 lines and `print-prototype.css` is 2114 lines. The W2 plan must first extract presentation sections and split CSS by upload, material check, preview/params, cashier, and progress/result. Business logic stays in the current page container.

## 8. W3 ownership: resume, AI advisor, and mock interview

**Exclusive files:**

- `apps/kiosk/src/pages/resume/*.tsx`
- `apps/kiosk/src/pages/resume/*.css`
- `apps/kiosk/src/pages/resume/jobFit/**`
- `apps/kiosk/src/pages/assistant/**`
- `apps/kiosk/src/pages/interview/**`
- New presentation-only files under their local `components/` and `styles/` directories

**Excluded logic:**

- `apps/kiosk/src/pages/resume/aiResumeSession.ts`
- `apps/kiosk/src/pages/resume/jobMaterialDraft.ts`
- `apps/kiosk/src/pages/resume/hooks/useResumeLayout.ts`
- `apps/kiosk/src/pages/interview/session/types.ts`
- `apps/kiosk/src/hooks/useAiAdvisorCallSession.ts`
- AI, OCR, TRTC, resume, and interview services

**Required behavior cases:**

- Preserve `/resume` and `/resume/upload` redirects to `/resume/source`.
- Keep actual upload/scan separation, OCR, generation, diagnosis, optimization, export, job-fit, and career-plan state.
- Treat prototype 73 as an `/assistant` call sub-state, not a route.
- Keep interview timer, recording, transcription, question progression, and report contracts unchanged.

**Mandatory commands:**

```bash
pnpm --filter @ai-job-print/kiosk verify:lightflow-k2b-ai-resume
pnpm --filter @ai-job-print/kiosk verify:resume-diagnosis-flow-ui
pnpm --filter @ai-job-print/kiosk verify:job-material-library-ui
pnpm --filter @ai-job-print/kiosk verify:lightflow-k2a-career
pnpm --filter @ai-job-print/kiosk verify:lightflow-k2a-ai-career
pnpm --filter @ai-job-print/kiosk verify:lightflow-k2c-interview
pnpm --filter @ai-job-print/kiosk verify:job-fit-m1-5-ui
pnpm --filter @ai-job-print/kiosk verify:assistant-trtc-guard
```

`resume-fusion-youth.css` is 1485 lines with extensive `!important` use. The W3 plan must split common, diagnosis, authoring, library, and job-fit scopes before page migration.

## 9. W4 ownership: jobs, companies, fairs, campus, and policy

**Exclusive files:**

- `apps/kiosk/src/pages/jobs/**`
- `apps/kiosk/src/pages/companies/**`
- `apps/kiosk/src/pages/offline-agencies/**`
- `apps/kiosk/src/pages/job-fairs/**`
- `apps/kiosk/src/pages/campus/**`
- `apps/kiosk/src/pages/smart-campus/**`
- `apps/kiosk/src/pages/renshi/**`
- `apps/kiosk/src/pages/jobs-fairs-prototype.css`
- `apps/kiosk/src/pages/prototype/kiosk-prototype.css`
- `apps/kiosk/src/pages/placeholders/CampusWelcomePage.tsx`
- `apps/kiosk/src/pages/placeholders/FreshmanInsightsPage.tsx`
- `apps/kiosk/src/components/SourceUrlQr.tsx`
- `apps/kiosk/src/components/ComingSoonNotice.tsx`

**Excluded logic:**

- `apps/kiosk/src/pages/jobs/utils/jobDisplay.ts`
- `apps/kiosk/src/pages/renshi/builtinData.ts`
- `apps/kiosk/src/pages/renshi/shared.ts`
- Favorites, browse history, external-jump recording, job AI, fairs, companies, campus, and policy services

**Required behavior cases:**

- Preserve online source and offline-agency dual track.
- Preserve source attribution, browsing records, and external jump records.
- Preserve allowed CTA language only.
- Keep `/campus/*` and `/smart-campus/*` as distinct current route semantics; share presentation primitives without copying service logic.
- Keep unauthorized campus statistics locked without fake data.

**Mandatory commands:**

```bash
pnpm --filter @ai-job-print/kiosk verify:job-info-ui
pnpm --filter @ai-job-print/kiosk verify:job-ai-ui
pnpm --filter @ai-job-print/kiosk verify:job-ai-history-privacy-ui
pnpm --filter @ai-job-print/kiosk verify:jobfair-ui
pnpm --filter @ai-job-print/kiosk verify:jobfair-commercial-closure
pnpm --filter @ai-job-print/kiosk verify:jobfair-checkin
node apps/kiosk/scripts/verify-jobfairs-terminal-priority.mjs
pnpm --filter @ai-job-print/kiosk verify:smart-campus-ui
pnpm --filter @ai-job-print/kiosk verify:renshi-policy-ui
```

`jobs-fairs-prototype.css` is 1640 lines and globally imported. The W4 plan must inventory class consumers and split scoped jobs, companies, fairs, campus, and policy CSS without deleting the import until W6 proves zero consumers.

## 10. W5 ownership: profile, activity, toolbox, auth, system, and mobile helper pages

**Exclusive files:**

- `apps/kiosk/src/pages/profile/**`
- `apps/kiosk/src/pages/activities/**`
- `apps/kiosk/src/pages/auth/**`
- `apps/kiosk/src/pages/help/**`
- `apps/kiosk/src/pages/legal/**`
- `apps/kiosk/src/pages/screensaver/**`
- `apps/kiosk/src/pages/toolbox/**`
- `apps/kiosk/src/pages/upload/PhoneUploadPage.tsx`
- `apps/kiosk/src/pages/upload/phone-upload-service-desk.css`
- `apps/kiosk/src/pages/home/components/ToolboxLaunchModals.tsx`
- `apps/kiosk/src/pages/placeholders/ErrorOfflinePage.tsx`
- `apps/kiosk/src/pages/placeholders/SessionTimeoutPage.tsx`
- `apps/kiosk/src/pages/placeholders/MeActivityDetailPage.tsx`
- `apps/kiosk/src/pages/placeholders/NotificationsPage.tsx`
- `apps/kiosk/src/pages/placeholders/system-pages-batch8.css`

W1 has a narrow prerequisite exception for `MobileQrLoginPage.tsx` and `PhoneUploadPage.tsx`: it may add only `data-kiosk-presentation="fusion-youth"` and `data-kiosk-viewport="mobile"` to their existing root elements because both routes live outside `KioskRoot`. W5 retains exclusive ownership of every later visual, state, and behavior migration in these files and must preserve those attributes.

**Excluded logic:**

- `apps/kiosk/src/pages/auth/hooks/useMemberPhoneLogin.ts`
- `apps/kiosk/src/pages/profile/assets/useMemberProfileOverview.ts`
- `apps/kiosk/src/pages/profile/profileEntries.ts`
- `apps/kiosk/src/pages/profile/profileTypes.ts`
- `apps/kiosk/src/pages/profile/assets/format.ts`
- `apps/kiosk/src/pages/profile/me/feedback/types.ts`
- `apps/kiosk/src/pages/profile/me/printOrders/paymentCopy.ts`
- `apps/kiosk/src/pages/profile/me/printOrders/statusRefresh.ts`
- `apps/kiosk/src/pages/home/components/ContinuePanel.tsx`
- `apps/kiosk/src/pages/home/components/kioskAppLaunch.ts`
- `apps/kiosk/src/pages/home/hooks/useHomeDeviceStatus.ts`
- `apps/kiosk/src/pages/home/serviceGroups.ts`
- `apps/kiosk/src/pages/upload/components/UploadSessionQrPanel.tsx`

**Required behavior cases:**

- Profile uses the approved 5299 “我的资产” information architecture.
- 8177 login error, feedback, toolbox empty, session timeout, and offline states are state branches of existing pages.
- `/me/activity/:id` is browse/jump record detail, not benefit activity detail.
- `/notifications` and `/me/notifications` share the existing notification capability without creating a second data source.
- `/member/qr-login` and `/upload/phone` use the isolated 390×844 root and preserve real authentication/upload behavior.

**Mandatory commands:**

```bash
pnpm --filter @ai-job-print/kiosk verify:member-login-dialog
pnpm --filter @ai-job-print/kiosk verify:qr-login-ui
pnpm --filter @ai-job-print/kiosk verify:member-session-closure
pnpm --filter @ai-job-print/kiosk verify:lightflow-k1-public-entry
pnpm --filter @ai-job-print/kiosk verify:user-center-wave0
pnpm --filter @ai-job-print/kiosk verify:lightflow-profile-entry
pnpm --filter @ai-job-print/kiosk verify:profile-commercial-first-batch
pnpm --filter @ai-job-print/kiosk verify:legal-retention-copy
pnpm --filter @ai-job-print/kiosk verify:resume-phone-upload-ui
pnpm --filter @ai-job-print/kiosk verify:home-toolbox-ui
```

`me-detail-inkpaper.css` is 907 lines. The W5 plan must split resumes/documents/orders/records/settings-feedback presentation scopes before page migration.

## 11. W6 integration ownership

W6 is the only wave allowed to remove obsolete shared imports or old CSS after proving zero route, import, test, and documentation dependency.

**Potential integration files:**

- `apps/kiosk/src/index.css`
- `apps/kiosk/package.json`
- `.github/workflows/ci.yml`
- Browser route and state manifests under `apps/kiosk/tests/**`
- Existing verify scripts whose source paths moved
- `docs/design/kiosk-proto-2026-07-migration-matrix.md`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`

**Required full gates:**

```bash
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/kiosk lint
VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 VITE_USE_TRTC_CALL=true VITE_TERMINAL_ID=KSK-001 pnpm build:kiosk:production
VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 VITE_ALLOW_TEXT_ONLY_ASSISTANT=true VITE_TERMINAL_ID=KSK-001 pnpm build:kiosk:production
pnpm --filter @ai-job-print/kiosk verify:fusion-baseline
pnpm --filter @ai-job-print/kiosk test:browser:smoke
pnpm --filter @ai-job-print/kiosk test:browser
```

Also run every existing Kiosk `verify:*` script, the affected API/Terminal Agent suites listed by W2–W5, `git diff --check`, full-route compliance text scan, and full-route visual capture.

## 12. Browser state policy

- Playwright intercepts `**/api/v1/**` while the production build remains `VITE_API_MODE=http`.
- Unregistered API requests fail the test.
- Loading tests hold a deferred response and explicitly release it; do not use arbitrary sleeps.
- Empty states use valid empty API envelopes.
- Network errors use `route.abort('internetdisconnected')`.
- Login state is established through the real login UI with intercepted responses; do not write auth tokens to storage.
- Payment tests use only existing status contracts.
- Scanner offline tests use the real device status shape.
- Print and resume flow fixtures may seed only their existing sessionStorage schemas.
- Real hardware truth remains covered by API, Terminal Agent, pre-production, and Windows acceptance—not browser mocks.

## 13. Review policy

For every detailed wave plan and implementation task:

1. Implementer follows RED → GREEN → refactor and self-reviews.
2. A fresh spec reviewer checks the approved design and the exact task scope.
3. A fresh code-quality reviewer checks maintainability, accessibility, security, and file size.
4. Antigravity and Claude both review each completed wave diff.
5. Critical findings are fixed and re-reviewed before the next dependency layer.

No wave is complete because screenshots “look good.” It is complete only when its behavior, static contracts, browser states, build, compliance, and source diff all pass.
