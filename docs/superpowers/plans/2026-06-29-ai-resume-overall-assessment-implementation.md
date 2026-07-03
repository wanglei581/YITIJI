# AI Resume Overall Assessment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a commercial-grade, end-to-end AI 综合评估 module for resume diagnosis, with real shared/API/LLM/Kiosk data flow and no change to the fixed 6-dimension scoring schema.

**Architecture:** Add `overallAssessment` as an additive optional field on `ResumeReport`, and add `assessmentOptions.includeOverallAssessment` as an optional request flag. The backend DTO validates the flag, the LLM prompt/parser generates and sanitizes the module, audit logs only metadata, and Kiosk upload/parse/report pages pass and render the data. Existing 6 `sections` remain strictly fixed; a 7th section is still invalid.

**Tech Stack:** TypeScript, React + Vite, NestJS, class-validator, OpenAI-compatible LLM calls through existing `LlmResumeService`, existing static verify scripts.

---

## File Budget And Boundaries

Allowed runtime files:

- Modify: `packages/shared/src/types/ai.ts`
- Modify: `services/api/src/ai/interfaces/ai-provider.interface.ts`
- Modify: `services/api/src/ai/dto/resume-parse.dto.ts`
- Modify: `services/api/src/ai/resume/llm-resume.service.ts`
- Modify: `services/api/src/ai/ai.controller.ts`
- Modify: `services/api/scripts/verify-real-resume-diagnosis.ts`
- Modify: `apps/kiosk/src/pages/resume/ResumeSourcePage.tsx`
- Modify: `apps/kiosk/src/pages/resume/ResumeParsePage.tsx`
- Modify: `apps/kiosk/src/pages/resume/ResumeReportPage.tsx`
- Modify: `apps/kiosk/src/pages/resume/components/ResumeDiagnosisSettings.tsx`
- Modify: `apps/kiosk/scripts/verify-resume-diagnosis-config-ui.mjs`
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`

Explicit non-goals:

- Do not add a 7th `sections` scoring dimension.
- Do not add扫码上传, U盘 Agent, scanner hardware, Word export, image export, or PDF export changes.
- Do not add a new route or duplicate homepage entry.
- Do not log resume text, `overallAssessment` prose, target job text, industry, experience, or scene to audit logs.
- Do not change AI result ownership / access-token rules.

## Commercial Acceptance Criteria

- Upload page can request AI 综合评估 through a default-on option.
- `/resume/parse` request carries `assessmentOptions.includeOverallAssessment`.
- Backend DTO accepts old requests and validates new optional options.
- LLM prompt requests `overallAssessment` without changing fixed 6 `sections`.
- Parser sanitizes `overallAssessment`; invalid or missing assessment does not break the main report.
- Report page displays `AI综合评估` when present and hides it for old reports.
- Audit payload records only `overallAssessmentRequested: boolean`.
- Existing member/anonymous result ownership still passes.
- Verification proves real provider flow with a stub LLM, not just mock UI.

---

### Task 1: Add Shared Contract And DTO Guard

**Files:**
- Modify: `packages/shared/src/types/ai.ts`
- Modify: `services/api/src/ai/interfaces/ai-provider.interface.ts`
- Modify: `services/api/src/ai/dto/resume-parse.dto.ts`

- [ ] **Step 1: Add shared types in `packages/shared/src/types/ai.ts`**

Add these interfaces after `ResumePriority`:

```ts
/** AI 综合评估（additive）：基于 6 维评分、目标方向和风险/优先项生成，不代表招聘结果。 */
export interface ResumeOverallAssessment {
  headline: string
  summary: string
  strengths: string[]
  weaknesses: string[]
  nextActions: string[]
}

/** 诊断附加输出选项；缺省视为请求综合评估。 */
export interface ResumeAssessmentOptions {
  includeOverallAssessment?: boolean
}
```

Add `overallAssessment?: ResumeOverallAssessment` to `ResumeReport` after `priorities`.

Add `assessmentOptions?: ResumeAssessmentOptions` to `ResumeDiagnosisRequestContext`:

```ts
export interface ResumeDiagnosisRequestContext {
  selectedDimensions?: ResumeScoringDimensionKey[]
  targetContext?: ResumeTargetContext
  assessmentOptions?: ResumeAssessmentOptions
}
```

Add `assessmentOptions?: ResumeAssessmentOptions` to `ResumeParseRequest` immediately after `targetContext?: ResumeTargetContext`:

```ts
  /** AI 诊断附加输出选项；默认请求综合评估，不改变固定 6 维评分。 */
  assessmentOptions?: ResumeAssessmentOptions
```

- [ ] **Step 2: Mirror types in `services/api/src/ai/interfaces/ai-provider.interface.ts`**

Apply the same additions in the API-local provider interface file:

```ts
export interface ResumeOverallAssessment {
  headline: string
  summary: string
  strengths: string[]
  weaknesses: string[]
  nextActions: string[]
}

export interface ResumeAssessmentOptions {
  includeOverallAssessment?: boolean
}
```

Add `overallAssessment?: ResumeOverallAssessment` to `ResumeReport`, `assessmentOptions?: ResumeAssessmentOptions` to `ResumeDiagnosisRequestContext`, and `assessmentOptions?: ResumeAssessmentOptions` to `ParseResumeInput`.

- [ ] **Step 3: Add backend DTO for `assessmentOptions`**

In `services/api/src/ai/dto/resume-parse.dto.ts`, add this DTO class before `ResumeParseRequestDto`:

```ts
class ResumeAssessmentOptionsDto {
  @IsOptional()
  @IsBoolean()
  includeOverallAssessment?: boolean
}
```

Then add to `ResumeParseRequestDto` after `targetContext`:

```ts
  @IsOptional()
  @ValidateNested()
  @Type(() => ResumeAssessmentOptionsDto)
  assessmentOptions?: ResumeAssessmentOptionsDto
```

- [ ] **Step 4: Run type checks**

Run:

```bash
pnpm --filter @ai-job-print/shared typecheck
DATABASE_URL="file:./prisma/dev.db" pnpm --filter @ai-job-print/api typecheck
```

Expected:

- Both commands exit 0.
- Prisma generate may run during API typecheck.

---

### Task 2: Extend LLM Prompt, Parser, Sanitization, And Audit Metadata

**Files:**
- Modify: `services/api/src/ai/resume/llm-resume.service.ts`
- Modify: `services/api/src/ai/ai.controller.ts`
- Modify: `services/api/scripts/verify-real-resume-diagnosis.ts`

- [ ] **Step 1: Extend `ResumeDiagnosisOptions` and request context normalization**

In `llm-resume.service.ts`, add imported types:

```ts
  type ResumeAssessmentOptions,
  type ResumeOverallAssessment,
```

Extend:

```ts
interface ResumeDiagnosisOptions {
  selectedDimensions?: ResumeScoringDimensionKey[]
  targetContext?: ResumeTargetContext
  assessmentOptions?: ResumeAssessmentOptions
}
```

Add:

```ts
function normalizeAssessmentOptions(value: unknown): ResumeAssessmentOptions | undefined {
  if (!value || typeof value !== 'object') return undefined
  const obj = value as ResumeAssessmentOptions
  if (typeof obj.includeOverallAssessment !== 'boolean') return undefined
  return { includeOverallAssessment: obj.includeOverallAssessment }
}
```

Then update `normalizeDiagnosisRequestContext`:

```ts
  const assessmentOptions = normalizeAssessmentOptions(options?.assessmentOptions)
```

Add this before the `return` in `normalizeDiagnosisRequestContext`:

```ts
  if (assessmentOptions) context.assessmentOptions = assessmentOptions
```

Also change `normalizeTargetContext` so target job length is consistent with the DTO and Kiosk input:

```ts
  const targetJob = cleanContextText(obj.targetJob, 40)
```

- [ ] **Step 2: Add parser limits and prompt instruction**

Add constants near existing limits:

```ts
const MAX_OVERALL_HEADLINE_CHARS = 40
const MAX_OVERALL_SUMMARY_CHARS = 180
const MAX_OVERALL_LIST_ITEMS = 4
```

Update `DIAGNOSIS_SYSTEM_PROMPT` JSON shape line to include:

```ts
{"sections":[{"key":"basic","label":"基础信息完整度","score":8,"maxScore":10}],"suggestions":["补充项目成果数据"],"riskNotes":["成果缺少量化描述"],"priorities":[{"focus":"补充成果量化","reason":"职责描述缺少可衡量结果"}],"overallAssessment":{"headline":"表达基础完整，量化表达需要加强","summary":"简历已有基础经历框架，但项目成果和岗位关键词表达不够集中。","strengths":["基础信息完整"],"weaknesses":["项目成果缺少量化"],"nextActions":["补充项目结果数据","优化岗位关键词"]}}
```

Add a strict prompt line:

```ts
'11. 当用户请求 AI 综合评估时，overallAssessment 必须包含 headline、summary、strengths、weaknesses、nextActions；该内容只能总结简历材料优化方向，不得输出录用概率、企业匹配度、面试通过率或任何招聘结果暗示。',
```

- [ ] **Step 3: Add prompt preamble for assessment flag**

In `buildContextPreamble`, after target context handling, add:

```ts
  if (requestContext.assessmentOptions?.includeOverallAssessment !== false) {
    lines.push('本次请求需要生成 AI 综合评估 overallAssessment：请基于固定 6 维评分、风险提醒、修改优先级和目标方向输出综合结论；不得新增第 7 个 sections 评分维度。')
  }
```

- [ ] **Step 4: Add sanitizer for `overallAssessment`**

Add a private method:

```ts
  private sanitizeOverallAssessment(value: unknown, blocked: string[]): ResumeOverallAssessment | undefined {
    if (!value || typeof value !== 'object') return undefined
    const obj = value as Record<string, unknown>
    const headline = this.sanitizeSingleText(obj['headline'], blocked, MAX_OVERALL_HEADLINE_CHARS)
    const summary = this.sanitizeSingleText(obj['summary'], blocked, MAX_OVERALL_SUMMARY_CHARS)
    if (!headline || !summary) return undefined
    const strengths = this.sanitizeStringList(obj['strengths'], blocked, 3, MAX_ITEM_CHARS)
    const weaknesses = this.sanitizeStringList(obj['weaknesses'], blocked, 3, MAX_ITEM_CHARS)
    const nextActions = this.sanitizeStringList(obj['nextActions'], blocked, MAX_OVERALL_LIST_ITEMS, MAX_ITEM_CHARS)
    if (strengths.length === 0 || weaknesses.length === 0 || nextActions.length < 2) return undefined
    return { headline, summary, strengths, weaknesses, nextActions }
  }

  private sanitizeSingleText(value: unknown, blocked: string[], maxLen: number): string | undefined {
    if (typeof value !== 'string') return undefined
    const text = value.trim()
    if (!text || containsForbiddenWord(text, blocked)) return undefined
    return text.length > maxLen ? text.slice(0, maxLen) : text
  }
```

- [ ] **Step 5: Attach sanitized assessment as additive field**

In `parseReport`, after priorities:

```ts
    const overallAssessment =
      requestContext?.assessmentOptions?.includeOverallAssessment === false
        ? undefined
        : this.sanitizeOverallAssessment(obj['overallAssessment'], blocked)
```

Then before `requestContext`:

```ts
    if (overallAssessment) report.overallAssessment = overallAssessment
```

Important: do not return `null` when `overallAssessment` is missing or invalid. The main report should still complete.

- [ ] **Step 6: Add audit metadata only**

In `services/api/src/ai/ai.controller.ts`, add to `payload`:

```ts
        overallAssessmentRequested: dto.assessmentOptions?.includeOverallAssessment !== false,
```

Do not log `headline`, `summary`, `strengths`, `weaknesses`, or `nextActions`.

- [ ] **Step 7: Extend API verification red/green coverage**

In `services/api/scripts/verify-real-resume-diagnosis.ts`, update `validReportJson()` to include:

```ts
    overallAssessment: {
      headline: '表达基础完整，量化和岗位关键词需要加强',
      summary: '这份简历已有基本经历框架，但项目成果和岗位关键词表达不够集中，建议先补充量化结果并收紧目标方向。',
      strengths: ['基础信息完整', '技术栈表达清楚'],
      weaknesses: ['项目成果缺少量化', '岗位关键词覆盖不足'],
      nextActions: ['先补充项目结果数据', '重写求职目标', '优化技能关键词'],
    },
```

Add DTO checks in the 2b section:

```ts
    const assessmentDtoErrors = validateParseDto({
      fileId: 'assessment-file',
      fileName: 'r.docx',
      fileFormat: 'docx',
      source: 'upload',
      assessmentOptions: { includeOverallAssessment: true },
    })
    assert(assessmentDtoErrors.length === 0, '2b-8. DTO 接受合法 assessmentOptions')
```

Add assertions after successful report generation:

```ts
        !!r2.report.overallAssessment &&
        r2.report.overallAssessment.nextActions.length >= 2 &&
```

Add an audit assertion:

```ts
        auditPayload['overallAssessmentRequested'] === true &&
```

Add forbidden content check:

```ts
    setResponses([{ status: 200, content: JSON.stringify({
      sections: sixSections(),
      suggestions: ['补充项目量化成果'],
      riskNotes: [],
      priorities: [
        { focus: '补充成果量化', reason: '职责描述缺少结果' },
        { focus: '明确目标岗位', reason: '求职方向不够集中' },
      ],
      overallAssessment: {
        headline: GUARD_TERM_MATCH,
        summary: '简历可以优化',
        strengths: ['基础信息完整'],
        weaknesses: ['项目成果不足'],
        nextActions: ['补充量化成果', '优化关键词'],
      },
    }) }])
    const rAssessmentGuard = await submit('docx-assessment-guard', null)
    assert(
      rAssessmentGuard.status === 'completed' && !rAssessmentGuard.report?.overallAssessment,
      '2b-9. overallAssessment 命中合规词时被整体丢弃且不影响主报告完成',
    )
```

- [ ] **Step 8: Run backend verification**

Run:

```bash
DATABASE_URL="file:./prisma/dev.db" pnpm --filter @ai-job-print/api verify-real-resume-diagnosis
DATABASE_URL="file:./prisma/dev.db" pnpm --filter @ai-job-print/api verify:ai-result-ownership
DATABASE_URL="file:./prisma/dev.db" pnpm --filter @ai-job-print/api typecheck
```

Expected:

- All commands exit 0.
- `verify-real-resume-diagnosis` includes PASS lines for DTO `assessmentOptions`, report `overallAssessment`, guard filtering, and unchanged 7th-section rejection.

---

### Task 3: Wire Kiosk Upload And Parse Request

**Files:**
- Modify: `apps/kiosk/src/pages/resume/components/ResumeDiagnosisSettings.tsx`
- Modify: `apps/kiosk/src/pages/resume/ResumeSourcePage.tsx`
- Modify: `apps/kiosk/src/pages/resume/ResumeParsePage.tsx`
- Modify: `apps/kiosk/scripts/verify-resume-diagnosis-config-ui.mjs`

- [ ] **Step 1: Add state and prop to settings component**

Add to `ResumeDiagnosisSettingsProps`:

```ts
  includeOverallAssessment: boolean
  onIncludeOverallAssessmentChange: (value: boolean) => void
```

Add to function params:

```ts
  includeOverallAssessment,
  onIncludeOverallAssessmentChange,
```

Add a default-on touch control below target direction:

```tsx
      <div className="mt-5 rounded-2xl border border-primary-100 bg-primary-50/50 p-4">
        <label className="flex min-h-[56px] cursor-pointer items-center justify-between gap-4">
          <span>
            <span className="block text-sm font-bold text-gray-900">生成 AI 综合评估</span>
            <span className="mt-1 block text-xs leading-relaxed text-gray-500">
              基于 6 维评分和目标方向生成综合结论，不改变评分维度
            </span>
          </span>
          <input
            type="checkbox"
            checked={includeOverallAssessment}
            onChange={(e) => onIncludeOverallAssessmentChange(e.target.checked)}
            className="h-6 w-6 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          />
        </label>
      </div>
```

- [ ] **Step 2: Add state and route state in source page**

In `ResumeSourcePage.tsx`, add:

```ts
  const [includeOverallAssessment, setIncludeOverallAssessment] = useState(true)
```

Inside the existing route state object passed to the `/resume/parse` navigation call, add:

```ts
        assessmentOptions: {
          includeOverallAssessment,
        },
```

Pass props to `ResumeDiagnosisSettings`:

```tsx
          includeOverallAssessment={includeOverallAssessment}
          onIncludeOverallAssessmentChange={setIncludeOverallAssessment}
```

- [ ] **Step 3: Forward options in parse page**

In `ResumeParsePage.tsx`, import `ResumeAssessmentOptions` from shared.

After target context handling:

```ts
      const assessmentOptions = objectOf<ResumeAssessmentOptions>(state?.assessmentOptions)
      if (assessmentOptions) request.assessmentOptions = assessmentOptions
```

- [ ] **Step 4: Extend Kiosk static verification**

In `apps/kiosk/scripts/verify-resume-diagnosis-config-ui.mjs`, add assertions:

```js
assert(
  settingsComponent.includes('生成 AI 综合评估') && settingsComponent.includes('includeOverallAssessment'),
  'settings component renders overall assessment toggle',
)
assert(
  sourcePage.includes('assessmentOptions:') && sourcePage.includes('includeOverallAssessment'),
  'source page sends assessment options through route state',
)
assert(
  parsePage.includes('request.assessmentOptions = assessmentOptions'),
  'parse page forwards assessment options to API request',
)
```

- [ ] **Step 5: Run Kiosk verification**

Run:

```bash
pnpm --filter @ai-job-print/kiosk verify:resume-diagnosis-config-ui
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/kiosk lint
```

Expected:

- Verification and typecheck exit 0.
- Lint exits 0 with only the existing `KioskBusyContext` Fast Refresh warnings.

---

### Task 4: Render AI 综合评估 On Report Page

**Files:**
- Modify: `apps/kiosk/src/pages/resume/ResumeReportPage.tsx`
- Modify: `apps/kiosk/scripts/verify-resume-diagnosis-config-ui.mjs`

- [ ] **Step 1: Add report module after total score and before radar chart**

In `ResumeReportPage.tsx`, set:

```ts
  const overallAssessment = report.overallAssessment
```

After the total score `<Card>`, add:

```tsx
        {overallAssessment && (
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2">
              <SparklesIcon className="h-4 w-4 text-primary-600" aria-hidden="true" />
              <p className="text-sm font-bold text-gray-900">AI综合评估</p>
            </div>
            <p className="text-lg font-bold text-gray-900">{overallAssessment.headline}</p>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">{overallAssessment.summary}</p>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <AssessmentList title="已有优势" items={overallAssessment.strengths} tone="success" />
              <AssessmentList title="主要短板" items={overallAssessment.weaknesses} tone="warning" />
              <AssessmentList title="下一步动作" items={overallAssessment.nextActions} tone="primary" />
            </div>
            <p className="mt-4 rounded-2xl bg-gray-50 px-4 py-3 text-xs leading-relaxed text-gray-500">
              AI综合评估仅用于简历材料优化参考，不代表岗位匹配、录用概率或面试结果。
            </p>
          </Card>
        )}
```

Add helper component above `ResumeReportPage`:

```tsx
function AssessmentList({
  title,
  items,
  tone,
}: {
  title: string
  items: string[]
  tone: 'success' | 'warning' | 'primary'
}) {
  const dotClass = tone === 'success' ? 'bg-emerald-500' : tone === 'warning' ? 'bg-amber-500' : 'bg-primary-500'
  return (
    <div className="rounded-2xl border border-gray-100 bg-white px-3 py-3">
      <p className="text-xs font-bold text-gray-500">{title}</p>
      <ul className="mt-2 space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2 text-xs leading-relaxed text-gray-600">
            <span className={['mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', dotClass].join(' ')} aria-hidden="true" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 2: Extend static verification**

Add to `verify-resume-diagnosis-config-ui.mjs`:

```js
const reportPage = readFileSync(resolve(root, 'src/pages/resume/ResumeReportPage.tsx'), 'utf8')

assert(
  reportPage.includes('AI综合评估') && reportPage.includes('overallAssessment'),
  'report page renders overall assessment module',
)
assert(
  reportPage.includes('不代表岗位匹配、录用概率或面试结果'),
  'report page renders overall assessment compliance disclaimer',
)
```

- [ ] **Step 3: Run Kiosk verification again**

Run:

```bash
pnpm --filter @ai-job-print/kiosk verify:resume-diagnosis-config-ui
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/kiosk lint
```

Expected:

- Verification and typecheck exit 0.
- No new lint errors.

---

### Task 5: Final Full Verification And Documentation

**Files:**
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`
- Add or update: `.ccg/tasks/ai-resume-overall-assessment-design/review.md`

- [ ] **Step 1: Update progress docs**

In `docs/progress/current-progress.md`, append to the existing 2026-06-29 AI diagnosis row:

```md
AI综合评估已作为 additive 报告模块接入：上传页默认请求，后端 LLM 输出 `overallAssessment`，报告页展示综合结论/优势/短板/下一步动作；固定 6 维 `sections` schema 保持不变，审计仅记录 `overallAssessmentRequested` 元数据。
```

In `docs/progress/next-tasks.md`, update the AI diagnosis checklist item to say AI 综合评估 is completed, while扫码/U盘/扫描/Word/图片导出 remain separate tasks.

- [ ] **Step 2: Run full relevant verification**

Run:

```bash
pnpm --filter @ai-job-print/shared typecheck
pnpm --filter @ai-job-print/shared lint
DATABASE_URL="file:./prisma/dev.db" pnpm --filter @ai-job-print/api typecheck
DATABASE_URL="file:./prisma/dev.db" pnpm --filter @ai-job-print/api verify-real-resume-diagnosis
DATABASE_URL="file:./prisma/dev.db" pnpm --filter @ai-job-print/api verify:ai-result-ownership
pnpm --filter @ai-job-print/kiosk verify:resume-diagnosis-config-ui
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/kiosk lint
git diff --check
```

Expected:

- All commands exit 0.
- Kiosk lint may report only the pre-existing `KioskBusyContext` Fast Refresh warnings.

- [ ] **Step 3: Run browser smoke check**

If the dev server is running at `http://localhost:5173`, check:

```bash
curl -I -s http://localhost:5173/resume/source | head -n 1
```

Expected:

```text
HTTP/1.1 200 OK
```

Open `/resume/source` and visually confirm the setting card contains `生成 AI 综合评估`.

- [ ] **Step 4: Dual-model review**

Because this changes >30 lines across frontend/backend/contracts, run both:

```bash
~/.claude/bin/codeagent-wrapper --progress --backend antigravity - "$(pwd)" <<'EOF'
ROLE_FILE: ~/.claude/.ccg/prompts/antigravity/reviewer.md
<TASK>
Review AI 简历诊断 AI综合评估 end-to-end implementation. Scope:
- shared/API resume report and parse request types
- ResumeParseRequestDto assessmentOptions validation
- LlmResumeService prompt/parser/sanitization
- AiController audit metadata
- Kiosk upload settings, parse request forwarding, report rendering
- verify-real-resume-diagnosis and verify-resume-diagnosis-config-ui
Check correctness, privacy, compliance, fixed 6-section invariant, old-report compatibility, and UI usability.
Output Critical/Warning/Info/Verdict.
</TASK>
EOF
```

```bash
~/.claude/bin/codeagent-wrapper --progress --backend claude - "$(pwd)" <<'EOF'
ROLE_FILE: ~/.claude/.ccg/prompts/claude/reviewer.md
<TASK>
Review AI 简历诊断 AI综合评估 end-to-end implementation. Scope:
- shared/API resume report and parse request types
- ResumeParseRequestDto assessmentOptions validation
- LlmResumeService prompt/parser/sanitization
- AiController audit metadata
- Kiosk upload settings, parse request forwarding, report rendering
- verify-real-resume-diagnosis and verify-resume-diagnosis-config-ui
Check correctness, privacy, compliance, fixed 6-section invariant, old-report compatibility, and UI usability.
Output Critical/Warning/Info/Verdict.
</TASK>
EOF
```

Expected:

- Critical: none.
- Any Warning must be fixed and re-reviewed.

- [ ] **Step 5: Record review**

Create `.ccg/tasks/ai-resume-overall-assessment-design/review.md` with:

```md
# AI Resume Overall Assessment Review

## Verification

- shared typecheck/lint: pass
- api typecheck: pass
- verify-real-resume-diagnosis: pass
- verify:ai-result-ownership: pass
- kiosk verify:resume-diagnosis-config-ui: pass
- kiosk typecheck/lint: pass
- git diff --check: pass

## Dual-Model Review

- Antigravity: pass
- Claude: pass

## Notes

- `overallAssessment` is additive and optional.
- Fixed 6 `sections` schema remains enforced.
- Audit records only `overallAssessmentRequested`; no assessment prose or target-direction text is logged.
```

---

## Implementation Order

1. Task 1: contracts and DTO.
2. Task 2: LLM output and backend verification.
3. Task 3: Kiosk upload/parse data flow.
4. Task 4: report rendering.
5. Task 5: full verification, docs, and dual-model review.

Do not start扫码/U盘/扫描/导出 work until this plan passes and the AI 综合评估 branch is stable.
