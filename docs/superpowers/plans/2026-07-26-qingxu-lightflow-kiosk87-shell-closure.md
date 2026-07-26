# 青序 LightFlow Kiosk 87 路径统一壳层收口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Every production change starts from a failing static or browser contract.

**Goal:** 以最新主线已合入的 87 条 Kiosk URL pattern 为唯一生产基线，修复活动详情、法务文档、百宝箱三页未使用共享页壳/页头的遗漏，保留真实数据、加载、错误、空态、重试、权限、返回与合规语义。

**Architecture:** 不 cherry-pick Cursor PR #371 / `7da74dfb`，只手工提取 `KioskPageFrame` / `KioskPageHeader` 语义。三页仍由现有 service/hook 和 CSS 驱动；每页只保留一个水平 padding owner，页面稳定 marker 不得丢失。`/legal/:doc` 为 `KioskRoot` 外顶级全屏路由，必须继续在实际 render 根保留 presentation/theme/density 属性。

**Tech Stack:** React 18 + TypeScript + Vite + `@ai-job-print/ui` + Playwright + Node static verify

**Baseline:** `origin/main=9651b109`; 82 page destinations + 5 compatibility redirects = 87 URL patterns. Historical prototype portal says 86/86 because it predates `/me/privacy-requests`.

**Out of scope:** Admin/Partner theme; routes; API/DTO/Prisma; auth/session semantics; payment; print/scan; AI/TRTC; Terminal Agent; fake prototype data; `/me/*` production code.

## Exact file budget

Production (6):

- `apps/kiosk/src/pages/activities/BenefitActivityDetailPage.tsx`
- `apps/kiosk/src/pages/activities/activities-detail-inkpaper.css`
- `apps/kiosk/src/pages/legal/LegalDocPage.tsx`
- `apps/kiosk/src/pages/legal/legal-service-desk.css`
- `apps/kiosk/src/pages/toolbox/ToolboxZonePage.tsx`
- `apps/kiosk/src/pages/toolbox/toolbox-zone.css`

Guards (3):

- `apps/kiosk/scripts/verify-fusion-w5.mjs`
- `apps/kiosk/scripts/verify-lightflow-k1-public-entry.mjs`
- `apps/kiosk/tests/visual/fusion-w5.spec.ts`

Docs/task state (4, only lead agent):

- `docs/design/kiosk-proto-2026-07-migration-matrix.md`
- `docs/progress/current-progress.md`
- `.ccg/tasks/qingxu-lightflow-86-prototype-audit-20260726/task.json`
- `.ccg/tasks/qingxu-lightflow-86-prototype-audit-20260726/{requirements.md,review.md}`

No package script or CI change is needed: all relevant verify and browser commands already run in CI.

### Task 1: W5/K1 contracts RED

**Owner:** one test-only subagent. Do not modify production or docs.

- [ ] In `verify-fusion-w5.mjs`, require all three pages to use `KioskPageFrame` and `KioskPageHeader` while retaining their stable screen/domain markers and real branch/modal identifiers.
- [ ] Add `MyPrivacyRequestsPage.tsx` to W5 concrete pages so the 87th route remains explicitly inside fusion scope; this assertion is expected to pass and is not the RED trigger.
- [ ] Require the three CSS files to declare exactly one shared-content padding neutralizer so legacy page inset and `ui-kiosk-page-content` do not stack.
- [ ] In `verify-lightflow-k1-public-entry.mjs`, preserve Legal actual-root presentation/theme/density/screen checks and require shared Frame/Header, long-body scrolling, `navigate(-1)` and 48px+ touch controls.
- [ ] In `fusion-w5.spec.ts`, extend existing toolbox scenarios with Frame/Header/return assertions, add benefit-detail shared-shell/real-content/return coverage, and assert Legal root theme plus long-content scrolling.
- [ ] Run static contracts before any production change and capture RED caused only by the new three-page shell/padding assertions.

RED commands:

```bash
pnpm --filter @ai-job-print/kiosk verify:fusion-w5
pnpm --filter @ai-job-print/kiosk verify:lightflow-k1-public-entry
```

Stop if the new assertions do not fail or if an unrelated baseline assertion fails.

### Task 2: Three-page GREEN

**Owner:** one implementation subagent after Task 1 RED. No overlap with Task 1 while it is writing.

- [ ] Benefit detail: replace generic `PageHeader` with shared Frame/Header; keep all API/claim/login/error/retry/disabled/compliance logic byte-for-byte outside the wrapper; retain `data-kiosk-domain="profile"` and `data-kiosk-screen="activity-detail"` on the scroll section.
- [ ] Legal: keep the existing standalone themed root and place shared Frame/Header inside it; keep API content + audited fallback, tabs, font controls, long-body scroll, `navigate(-1)` and legal notice; neutralize the shared content inset so `.legal-doc-shell` remains the single owner.
- [ ] Toolbox: replace the hand-built pagehead/back SVG with shared Frame/Header; restore `data-kiosk-screen="toolbox"` on the real content section; keep config sorting, disabled state, internal/external/QR launch and both modals; neutralize duplicate inset and remove only CSS selectors made dead by the removed custom pagehead.
- [ ] Self-review `git diff` and confirm no business service/hook/copy change.

GREEN commands:

```bash
pnpm --filter @ai-job-print/kiosk verify:fusion-w5
pnpm --filter @ai-job-print/kiosk verify:lightflow-k1-public-entry
pnpm --filter @ai-job-print/kiosk verify:home-toolbox-ui
pnpm --filter @ai-job-print/kiosk verify:smart-campus-ui
pnpm --filter @ai-job-print/kiosk verify:legal-retention-copy
pnpm --filter @ai-job-print/kiosk typecheck
```

### Task 3: Browser evidence and visual correction

**Owner:** lead agent; modify only the three production CSS files if browser evidence proves a scoped correction is necessary.

- [ ] Build production Kiosk and serve a real preview.
- [ ] Run targeted W5 tests for toolbox, benefit detail and Legal.
- [ ] Run all W6 route surfaces to prove all 87 patterns retain stable markers, one `main`, no horizontal overflow, 48px touch targets and no runtime/resource errors.
- [ ] Inspect representative pages at 1080×1920, 390×844 and 390×700; inspect stage-fit at 1440×1024, 1280×800 and 1024×768 without changing the Kiosk canonical viewport.
- [ ] Respect `prefers-reduced-motion`; do not add decorative motion.

```bash
pnpm --filter @ai-job-print/kiosk build
pnpm --filter @ai-job-print/kiosk exec playwright test --config=playwright.w5.config.ts --grep 'toolbox|activity detail|legal'
pnpm --filter @ai-job-print/kiosk test:browser:w6
```

### Task 4: Full local candidate verification

- [ ] Run shared/ui/kiosk typecheck and Kiosk lint/build.
- [ ] Run UI fusion foundation plus Kiosk fusion shell/home/W2–W6/baseline/visual-unity and domain guards.
- [ ] Run the fusion baseline contract with 80% line/function/branch thresholds.
- [ ] Run full `test:browser:fusion`.
- [ ] Run `git diff --check`; verify only file-budget paths changed.
- [ ] Ask an independent code-review subagent to classify Critical/Warning/Info and fix Critical before re-review.
- [ ] Run Antigravity + Claude review in parallel because the diff exceeds 30 lines. A provider failure is not an approval and must be recorded honestly.

### Task 5: Documentation and CCG closure

- [ ] Append, do not rewrite, migration matrix/current-progress evidence: historical 86/86 remains historical; current production inventory is 87 routes because `/me/privacy-requests` was later added.
- [ ] Do not claim 87 pages are pixel-perfect, deployed, preproduction-approved or hardware-accepted; report only local static/build/browser evidence.
- [ ] Update `review.md`, mark task completed, archive under `.ccg/tasks/archive/2026-07/`.
- [ ] Stage exact paths only; never run `git add .`. Do not push, merge or deploy without fresh authorization.

## Stop conditions

- Any change requires routes, API, service, hook, auth, payment, print/scan, AI/TRTC, Admin/Partner or `/me/*` production code.
- New RED does not fail for the expected shared-shell/padding reason.
- A page loses real loading/error/empty/retry/permission/disabled/return behavior.
- Legal actual root loses standalone theme attributes, Toolbox loses its screen marker, or any page gains double horizontal padding.
- Full route inventory differs from 87 or compatibility redirects differ from 5.
- Browser evidence shows nested `main`, horizontal overflow, sub-48px direct touch control or runtime/resource error.
