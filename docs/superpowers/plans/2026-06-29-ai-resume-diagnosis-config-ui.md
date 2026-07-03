# AI Resume Diagnosis Config UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a low-fidelity diagnosis settings UI inside the existing resume upload page so users can choose diagnosis focus dimensions and target context before starting AI diagnosis.

**Architecture:** Keep the current route flow. `ResumeSourcePage` owns low-friction form state and sends `selectedDimensions` plus `targetContext` through existing `navigate('/resume/parse', { state })`; `ResumeParsePage` already forwards those fields to the API. Verification is a static Kiosk script that guards the expected UI state and data handoff without adding browser-only dependencies.

**Tech Stack:** React + TypeScript + Tailwind CSS + existing `@ai-job-print/shared` types and existing Kiosk verify script pattern.

---

## File Scope

- Modify: `apps/kiosk/src/pages/resume/ResumeSourcePage.tsx`
- Modify: `apps/kiosk/package.json`
- Create: `apps/kiosk/scripts/verify-resume-diagnosis-config-ui.mjs`
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`

Do not modify backend DTO, LLM service, database schema, routes, homepage entries, Terminal Agent, scan upload, or export flow in this task.

## Task 1: Static Red Test

**Files:**
- Create: `apps/kiosk/scripts/verify-resume-diagnosis-config-ui.mjs`
- Modify: `apps/kiosk/package.json`

- [ ] **Step 1: Add failing static verification script**

Create `apps/kiosk/scripts/verify-resume-diagnosis-config-ui.mjs` with checks for:

```js
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourcePage = readFileSync(resolve(root, 'src/pages/resume/ResumeSourcePage.tsx'), 'utf8')
const parsePage = readFileSync(resolve(root, 'src/pages/resume/ResumeParsePage.tsx'), 'utf8')

function pass(message) {
  console.log(`  PASS ${message}`)
}

function fail(message) {
  console.error(`  FAIL ${message}`)
  process.exit(1)
}

function assert(condition, message) {
  if (condition) pass(message)
  else fail(message)
}

console.log('\n=== AI resume diagnosis config UI verification ===')

assert(sourcePage.includes('selectedDimensions') && sourcePage.includes('toggleDimension'), 'source page owns selectable diagnosis dimensions')
assert(sourcePage.includes('selectedDimensions.length <= 1'), 'source page prevents clearing the final selected dimension')
assert(sourcePage.includes('targetMode') && sourcePage.includes('focused'), 'source page supports general and focused target modes')
assert(sourcePage.includes('targetJob') && sourcePage.includes('maxLength={40}'), 'source page limits target job input length')
assert(sourcePage.includes('目标方向') && sourcePage.includes('重点维度'), 'source page renders diagnosis settings labels')
assert(sourcePage.includes('targetContext: buildTargetContext()'), 'source page sends built target context through route state')
assert(sourcePage.includes('selectedDimensions: selectedDimensions.length > 0 ? selectedDimensions : DEFAULT_SELECTED_DIMENSIONS'), 'source page sends selected dimensions through route state')
assert(parsePage.includes('request.selectedDimensions = selectedDimensions'), 'parse page forwards selected dimensions to API request')
assert(parsePage.includes('request.targetContext = targetContext'), 'parse page forwards target context to API request')

console.log('\n=== ALL PASS ===\n')
```

- [ ] **Step 2: Register script**

Add this line in `apps/kiosk/package.json` scripts:

```json
"verify:resume-diagnosis-config-ui": "node scripts/verify-resume-diagnosis-config-ui.mjs"
```

- [ ] **Step 3: Run red test**

Run:

```bash
pnpm --filter @ai-job-print/kiosk verify:resume-diagnosis-config-ui
```

Expected: FAIL because `ResumeSourcePage` does not yet have `toggleDimension`, `targetMode`, target job input, or route state generated from user choices.

## Task 2: ResumeSourcePage Settings UI

**Files:**
- Modify: `apps/kiosk/src/pages/resume/ResumeSourcePage.tsx`

- [ ] **Step 1: Add state and helpers**

Add state for:

```ts
const [selectedDimensions, setSelectedDimensions] = useState<ResumeScoringDimensionKey[]>(DEFAULT_SELECTED_DIMENSIONS)
const [targetMode, setTargetMode] = useState<'general' | 'focused'>('general')
const [targetIndustry, setTargetIndustry] = useState('通用')
const [targetExperience, setTargetExperience] = useState('应届')
const [targetScene, setTargetScene] = useState('校招')
const [targetJob, setTargetJob] = useState('')
```

Add helpers:

```ts
const toggleDimension = (key: ResumeScoringDimensionKey) => {
  setSelectedDimensions((current) => {
    if (current.includes(key)) {
      if (current.length <= 1) return current
      return current.filter((item) => item !== key)
    }
    return [...current, key]
  })
}

const buildTargetContext = (): ResumeTargetContext => {
  if (targetMode === 'general') return { skipped: true }
  const job = targetJob.trim().slice(0, 40)
  return {
    skipped: false,
    industry: targetIndustry,
    experience: targetExperience,
    scene: targetScene,
    ...(job ? { targetJob: job } : {}),
  }
}
```

- [ ] **Step 2: Render low-fidelity settings UI**

Add one existing `Card` inside the upload page content:

- Title: `诊断设置`
- Dimension section label: `重点维度`
- Six touch-friendly toggle buttons from `RESUME_SCORING_DIMENSIONS`
- Target mode segmented buttons: `通用诊断` and `指定方向`
- Focused fields shown only when `targetMode === 'focused'`
- Target job input with `maxLength={40}`

- [ ] **Step 3: Wire route state**

Change `handleStartDiagnosis` state to send:

```ts
selectedDimensions: selectedDimensions.length > 0 ? selectedDimensions : DEFAULT_SELECTED_DIMENSIONS,
targetContext: buildTargetContext(),
```

Keep existing `uploadSource`, `consent`, and `reportSchemaVersion`.

- [ ] **Step 4: Run green checks**

Run:

```bash
pnpm --filter @ai-job-print/kiosk verify:resume-diagnosis-config-ui
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/kiosk lint
```

Expected: verify and typecheck pass; lint may keep existing Fast Refresh warnings unrelated to this task.

## Task 3: Documentation And Review

**Files:**
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`

- [ ] **Step 1: Update progress docs**

Record that Kiosk now has low-fidelity diagnosis settings for dimensions and target context. Keep non-goals explicit: no QR upload, no U disk Agent, no scanner true hardware, no Word/image export.

- [ ] **Step 2: Run final verification**

Run:

```bash
pnpm --filter @ai-job-print/kiosk verify:resume-diagnosis-config-ui
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/kiosk lint
git diff --check
```

- [ ] **Step 3: Dual-model review**

Run Claude and Antigravity review on the latest `git diff`. Critical issues must be fixed before reporting completion.

## Self-Review

- Spec coverage: user-selectable dimensions, target mode, target job, route state, and non-goals are covered.
- Placeholder scan: no TBD/TODO/placeholders.
- Type consistency: uses existing `ResumeScoringDimensionKey`, `ResumeTargetContext`, `RESUME_SCORING_DIMENSIONS`, and the existing `ResumeParsePage` forwarding code.
