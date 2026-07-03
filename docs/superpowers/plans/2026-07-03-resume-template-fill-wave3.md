# Resume Template Fill Wave 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users choose a published resume template from the optimized resume page and export a PDF that maps the structured resume into the template's section order and style preset.

**Architecture:** Add static resume template layout presets to shared and API template definitions, pass `templateId` through the existing resume export endpoint, and teach `ResumePdfService` to merge template presets with Wave 2 layout settings. Keep ordinary job-material generation separate and continue blocking `resume_template` in `/job-materials/generate`.

**Tech Stack:** TypeScript, React, NestJS, pdfkit, Prisma/FileObject, existing verify scripts.

---

## Scope

Implement only:

- Static `resume_template` layout presets.
- PDF export with `templateId`.
- Kiosk optimized resume page template selection.
- Verify coverage for template fill and UI wiring.

Do not implement:

- Admin template CRUD.
- Drag/drop template editor.
- Word high-fidelity template rendering.
- Non-PDF direct printing.
- Payment or coupons.
- Job URL parsing.

## Files

Modify:

- `packages/shared/src/types/jobMaterials.ts`
- `services/api/src/job-materials/job-materials.types.ts`
- `services/api/src/job-materials/job-material-templates.ts`
- `services/api/src/ai/dto/resume-generate.dto.ts`
- `services/api/src/ai/ai.service.ts`
- `services/api/src/ai/resume/resume-pdf.service.ts`
- `apps/kiosk/src/services/api/jobMaterials.ts`
- `apps/kiosk/src/pages/resume/ResumeOptimizePage.tsx`
- `apps/kiosk/scripts/verify-resume-diagnosis-flow-ui.mjs`
- `services/api/package.json`
- `.github/workflows/ci.yml`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`

Create:

- `services/api/scripts/verify-resume-template-fill.ts`

Do not modify:

- `services/api/src/job-materials/job-materials.service.ts` except if a verify requires comments only; the current runtime block for `resume_template` must remain.
- Payment / order / auth / crypto files.
- Terminal Agent or Windows hardware code.
- Admin template CRUD pages.

## Task 1: Shared Template Preset Contract

**Files:**
- Modify: `packages/shared/src/types/jobMaterials.ts`

- [ ] **Step 1: Add template section and preset types**

Add these exports near the existing template types:

```ts
export const RESUME_TEMPLATE_SECTION_KEYS = [
  'header',
  'summary',
  'education',
  'experience',
  'projects',
  'skills',
  'certificates',
] as const

export type ResumeTemplateSectionKey = typeof RESUME_TEMPLATE_SECTION_KEYS[number]

export interface ResumeTemplateLayoutPreset {
  style: 'clean' | 'compact' | 'formal'
  defaultLayout: {
    fontScale?: 'compact' | 'standard' | 'large'
    lineSpacing?: 'compact' | 'standard' | 'relaxed'
    margin?: 'narrow' | 'normal' | 'wide'
    columns?: 1 | 2
    accent?: 'blue' | 'green' | 'slate'
  }
  sectionOrder: ResumeTemplateSectionKey[]
}
```

- [ ] **Step 2: Tighten ResumeTemplate**

Change:

```ts
export type ResumeTemplate = JobMaterialTemplate & { type: ResumeTemplateType }
```

to:

```ts
export type ResumeTemplate = JobMaterialTemplate & {
  type: ResumeTemplateType
  resumeLayoutPreset: ResumeTemplateLayoutPreset
}
```

- [ ] **Step 3: Add preset to `resume-template-clean`**

Add:

```ts
resumeLayoutPreset: {
  style: 'clean',
  defaultLayout: {
    fontScale: 'standard',
    lineSpacing: 'standard',
    margin: 'normal',
    columns: 1,
    accent: 'blue',
  },
  sectionOrder: ['header', 'summary', 'education', 'experience', 'projects', 'skills', 'certificates'],
},
```

- [ ] **Step 4: Run shared typecheck**

Run:

```bash
pnpm --filter @ai-job-print/shared typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types/jobMaterials.ts
git commit -m "feat(shared): add resume template layout preset contract"
```

## Task 2: API Template Definitions and DTO

**Files:**
- Modify: `services/api/src/job-materials/job-materials.types.ts`
- Modify: `services/api/src/job-materials/job-material-templates.ts`
- Modify: `services/api/src/ai/dto/resume-generate.dto.ts`

- [ ] **Step 1: Mirror shared preset types in API template types**

Add to `job-materials.types.ts`:

```ts
export type ResumeTemplateSectionKey =
  | 'header'
  | 'summary'
  | 'education'
  | 'experience'
  | 'projects'
  | 'skills'
  | 'certificates'

export interface ResumeTemplateLayoutPreset {
  style: 'clean' | 'compact' | 'formal'
  defaultLayout: {
    fontScale?: 'compact' | 'standard' | 'large'
    lineSpacing?: 'compact' | 'standard' | 'relaxed'
    margin?: 'narrow' | 'normal' | 'wide'
    columns?: 1 | 2
    accent?: 'blue' | 'green' | 'slate'
  }
  sectionOrder: ResumeTemplateSectionKey[]
}
```

Change `JobMaterialTemplateView` to include optional preset for backwards-compatible documents:

```ts
resumeLayoutPreset?: ResumeTemplateLayoutPreset
```

- [ ] **Step 2: Add preset to API `resume-template-clean`**

Add the same preset used in shared:

```ts
resumeLayoutPreset: {
  style: 'clean',
  defaultLayout: {
    fontScale: 'standard',
    lineSpacing: 'standard',
    margin: 'normal',
    columns: 1,
    accent: 'blue',
  },
  sectionOrder: ['header', 'summary', 'education', 'experience', 'projects', 'skills', 'certificates'],
},
```

- [ ] **Step 3: Add export DTO field**

In `ResumeGenerateExportDto`, add after `format?: ResumeExportFormat`:

```ts
/** Resume template id(Wave 3): only PDF applies template layout; other formats ignore it. */
@IsOptional() @IsString() @MaxLength(80)
templateId?: string
```

- [ ] **Step 4: Run API typecheck**

```bash
pnpm --filter @ai-job-print/api typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/api/src/job-materials/job-materials.types.ts services/api/src/job-materials/job-material-templates.ts services/api/src/ai/dto/resume-generate.dto.ts
git commit -m "feat(api): define resume template export contract"
```

## Task 3: PDF Renderer Template Support

**Files:**
- Modify: `services/api/src/ai/resume/resume-pdf.service.ts`
- Modify: `services/api/src/ai/ai.service.ts`

- [ ] **Step 1: Import template preset type**

In `resume-pdf.service.ts`, add:

```ts
import type { ResumeTemplateLayoutPreset } from '../../job-materials/job-materials.types'
```

- [ ] **Step 2: Add render options type**

Add:

```ts
export interface ResumePdfRenderOptions {
  layout?: ResumeLayoutSettings
  templatePreset?: ResumeTemplateLayoutPreset
}
```

- [ ] **Step 3: Merge template default layout with user layout**

Change `render(resume, layout?)` to:

```ts
async render(resume: GeneratedResume, options?: ResumeLayoutSettings | ResumePdfRenderOptions): Promise<RenderedResumePdf> {
  const renderOptions = isRenderOptions(options) ? options : { layout: options }
  const cfg = resolveLayout({ ...renderOptions.templatePreset?.defaultLayout, ...renderOptions.layout })
```

Add helper:

```ts
function isRenderOptions(value: ResumeLayoutSettings | ResumePdfRenderOptions | undefined): value is ResumePdfRenderOptions {
  return Boolean(value && ('layout' in value || 'templatePreset' in value))
}
```

- [ ] **Step 4: Render sections by template order**

Extract the section drawing blocks that are already inside `render` into small local functions inside the same `render` method. The extracted helpers must contain the exact drawing logic that currently renders each block; do not change copy or field selection while extracting. Use these function boundaries:

```ts
const drawSummary = () => {
  if (!resume.summary?.trim()) return
  section('个人优势')
  body(resume.summary.trim())
}

const drawEducation = () => {
  if (resume.education.length === 0) return
  section('教育经历')
  for (const item of resume.education) {
    entryHead([item.school, item.degree, item.major].filter(Boolean).join(' · '), item.period)
    if (item.description?.trim()) body(item.description.trim())
  }
}

const drawExperience = () => {
  if (resume.experience.length === 0) return
  section('工作 / 实习经历')
  for (const item of resume.experience) {
    entryHead([item.company, item.role].filter(Boolean).join(' · '), item.period)
    if (item.description?.trim()) body(item.description.trim())
  }
}

const drawProjects = () => {
  if (resume.projects.length === 0) return
  section('项目经历')
  for (const item of resume.projects) {
    entryHead([item.name, item.role].filter(Boolean).join(' · '), item.period)
    if (item.description?.trim()) body(item.description.trim())
  }
}

const drawSkillsAndCertificates = () => {
  if (resume.skills.length === 0 && resume.certificates.length === 0) return
  section('技能与证书')
  if (resume.skills.length > 0) body(resume.skills.join('、'))
  if (resume.certificates.length > 0) body(resume.certificates.join('、'))
}
```

Then replace fixed order with:

```ts
const defaultOrder: ResumeTemplateSectionKey[] = ['summary', 'education', 'experience', 'projects', 'skills', 'certificates']
const order = renderOptions.templatePreset?.sectionOrder.filter((key) => key !== 'header') ?? defaultOrder
for (const sectionKey of order) {
  if (sectionKey === 'summary') drawSummary()
  if (sectionKey === 'education') drawEducation()
  if (sectionKey === 'experience') drawExperience()
  if (sectionKey === 'projects') drawProjects()
  if (sectionKey === 'skills' && !drewSkillBlock) {
    drawSkillsAndCertificates()
    drewSkillBlock = true
  }
  if (sectionKey === 'certificates' && !drewSkillBlock) {
    drawSkillsAndCertificates()
    drewSkillBlock = true
  }
}
```

Do not duplicate skills and certificates if both keys appear. Use a boolean guard:

```ts
let drewSkillBlock = false
```

- [ ] **Step 5: Resolve template in AI export service**

In `ai.service.ts`, import:

```ts
import { findJobMaterialTemplate } from '../job-materials/job-material-templates'
```

Before rendering PDF in export service:

```ts
const template = dto.templateId ? findJobMaterialTemplate(dto.templateId) : null
if (dto.templateId && (!template || template.status !== 'published' || template.type !== 'resume_template' || !template.resumeLayoutPreset)) {
  throw new BadRequestException({
    error: {
      code: 'AI_RESUME_TEMPLATE_UNSUPPORTED',
      message: '简历模板不存在、未发布或不支持自动填充',
    },
  })
}
```

Pass:

```ts
await this.resumePdf.render(resume, { layout: dto.layout, templatePreset: template?.resumeLayoutPreset })
```

Only apply this for PDF export. Keep docx/txt/md using existing renderers.

- [ ] **Step 6: Run focused API verifies**

```bash
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/api verify:resume-export-formats
pnpm --filter @ai-job-print/api verify:resume-layout-export
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add services/api/src/ai/resume/resume-pdf.service.ts services/api/src/ai/ai.service.ts
git commit -m "feat(api): render optimized resumes with template presets"
```

## Task 4: Backend Verify for Template Fill

**Files:**
- Create: `services/api/scripts/verify-resume-template-fill.ts`
- Modify: `services/api/package.json`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Create verify script**

Create `services/api/scripts/verify-resume-template-fill.ts` with assertions:

```ts
import assert from 'node:assert/strict'
import { JOB_MATERIAL_TEMPLATES as SHARED_TEMPLATES, isResumeTemplate } from '@ai-job-print/shared'
import { JOB_MATERIAL_TEMPLATES as API_TEMPLATES, findJobMaterialTemplate } from '../src/job-materials/job-material-templates'
import { ResumePdfService } from '../src/ai/resume/resume-pdf.service'

async function main() {
  const sharedResumeTemplates = SHARED_TEMPLATES.filter(isResumeTemplate)
  assert.ok(sharedResumeTemplates.length >= 1, 'shared exposes at least one resume template')

  for (const sharedTemplate of sharedResumeTemplates) {
    const apiTemplate = findJobMaterialTemplate(sharedTemplate.id)
    assert.ok(apiTemplate, `api template exists for ${sharedTemplate.id}`)
    assert.equal(apiTemplate?.type, 'resume_template')
    assert.equal(apiTemplate?.status, 'published')
    assert.deepEqual(apiTemplate?.resumeLayoutPreset, sharedTemplate.resumeLayoutPreset)
    assert.ok(apiTemplate?.resumeLayoutPreset?.sectionOrder.includes('header'))
    assert.ok(apiTemplate?.resumeLayoutPreset?.sectionOrder.includes('experience'))
  }

  const pdf = new ResumePdfService()
  const rendered = await pdf.render({
    basic: { name: '模板测试用户', phone: '13800000000', email: 'test@example.com', city: '青岛' },
    intention: { position: '前端开发工程师', city: '青岛' },
    summary: '具备 React 项目经验，重视代码质量和协作效率。',
    education: [{ school: '示例大学', major: '计算机科学与技术', degree: '本科', period: '2022-2026', description: '主修前端工程、数据库和软件工程。' }],
    experience: [{ company: '示例科技', role: '前端实习生', period: '2025.01-2025.06', description: '参与组件库维护和页面性能优化。' }],
    projects: [{ name: '校园招聘系统', role: '前端开发', period: '2025', description: '完成职位列表、简历上传和打印确认流程。' }],
    skills: ['React', 'TypeScript', 'CSS'],
    certificates: ['大学英语四级'],
  }, {
    templatePreset: findJobMaterialTemplate('resume-template-clean')?.resumeLayoutPreset,
    layout: { columns: 2, accent: 'green', margin: 'narrow' },
  })

  assert.ok(rendered.buffer.subarray(0, 4).toString('latin1') === '%PDF', 'template render returns PDF')
  assert.ok(rendered.pageCount >= 1, 'template render has page count')
  console.log('verify:resume-template-fill PASS')
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
```

- [ ] **Step 2: Add npm script**

In `services/api/package.json` scripts add:

```json
"verify:resume-template-fill": "node -r @swc-node/register scripts/verify-resume-template-fill.ts"
```

- [ ] **Step 3: Wire CI**

In `.github/workflows/ci.yml`, add `pnpm --filter @ai-job-print/api verify:resume-template-fill` near the other resume verify commands in both SQLite and PostgreSQL readiness sections.

- [ ] **Step 4: Run script**

```bash
pnpm --filter @ai-job-print/api verify:resume-template-fill
```

Expected: `verify:resume-template-fill PASS`.

- [ ] **Step 5: Commit**

```bash
git add services/api/scripts/verify-resume-template-fill.ts services/api/package.json .github/workflows/ci.yml
git commit -m "test(api): verify resume template auto fill contract"
```

## Task 5: Kiosk Template Selection

**Files:**
- Modify: `apps/kiosk/src/services/api/jobMaterials.ts`
- Modify: `apps/kiosk/src/pages/resume/ResumeOptimizePage.tsx`
- Modify: `apps/kiosk/scripts/verify-resume-diagnosis-flow-ui.mjs`

- [ ] **Step 1: Reuse `getResumeTemplates`**

Confirm `apps/kiosk/src/services/api/jobMaterials.ts` already exports:

```ts
export async function getResumeTemplates(): Promise<ResumeTemplate[]>
```

Do not add a second template fetcher.

- [ ] **Step 2: Load templates in optimize page**

In `ResumeOptimizePage.tsx`, import:

```ts
import { getResumeTemplates } from '../../services/api/jobMaterials'
import type { ResumeTemplate } from '@ai-job-print/shared'
```

Add state:

```ts
const [resumeTemplates, setResumeTemplates] = useState<ResumeTemplate[]>([])
const [selectedTemplateId, setSelectedTemplateId] = useState<string>('resume-template-clean')
```

Add effect:

```ts
useEffect(() => {
  let cancelled = false
  getResumeTemplates()
    .then((items) => {
      if (cancelled) return
      setResumeTemplates(items)
      if (items.length > 0 && !items.some((item) => item.id === selectedTemplateId)) {
        setSelectedTemplateId(items[0].id)
      }
    })
    .catch(() => {
      if (!cancelled) setResumeTemplates([])
    })
  return () => { cancelled = true }
}, [selectedTemplateId])
```

- [ ] **Step 3: Clear stale export on template change**

When selecting a template:

```ts
const selectResumeTemplate = (templateId: string) => {
  setSelectedTemplateId(templateId)
  setExportResult(null)
  setExportError(null)
}
```

Use the actual Wave 2 state names in the page:

```ts
const selectResumeTemplate = (templateId: string) => {
  setSelectedTemplateId(templateId)
  setExported(null)
  setExportError(null)
}
```

- [ ] **Step 4: Render compact template selector**

Place near layout controls:

```tsx
{resumeTemplates.length > 0 && (
  <section aria-label="简历模板" className="rounded-lg border border-gray-200 bg-white p-4">
    <h3 className="text-sm font-semibold text-gray-900">简历模板</h3>
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {resumeTemplates.map((template) => {
        const active = selectedTemplateId === template.id
        return (
          <button
            key={template.id}
            type="button"
            aria-pressed={active}
            onClick={() => selectResumeTemplate(template.id)}
            className={active ? 'border-primary-600 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-700'}
          >
            <span>{template.title}</span>
            <span>{template.recommendedFor}</span>
          </button>
        )
      })}
    </div>
  </section>
)}
```

Match the actual page styling conventions; keep text compact and touch-safe.

- [ ] **Step 5: Pass templateId on export**

Where `exportGeneratedResume` is called, pass:

```ts
templateId: selectedTemplateId || undefined
```

If the wrapper currently accepts positional args only, update the wrapper in `apps/kiosk/src/services/api/ai.ts`, `aiHttpAdapter.ts`, and `aiMockAdapter.ts` to include an optional `templateId?: string` after `layout`.

HTTP adapter body must include:

```ts
...(templateId ? { templateId } : {})
```

Mock adapter may ignore `templateId` but must accept it and use `void templateId`.

- [ ] **Step 6: Extend UI verify**

In `verify-resume-diagnosis-flow-ui.mjs`, add assertions:

```js
assertIncludes(optimizePage, 'getResumeTemplates', 'optimize page loads resume templates')
assertIncludes(optimizePage, 'selectedTemplateId', 'optimize page tracks selected resume template')
assertIncludes(optimizePage, 'templateId', 'optimize page passes templateId during export')
assertNotIncludes(optimizePage, '立即投递', 'optimize page has no platform delivery copy')
assertNotIncludes(optimizePage, '录用保证', 'optimize page has no hiring guarantee copy')
```

- [ ] **Step 7: Run Kiosk checks**

```bash
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/kiosk verify:resume-diagnosis-flow-ui
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/kiosk/src/services/api/jobMaterials.ts apps/kiosk/src/services/api/ai.ts apps/kiosk/src/services/api/aiHttpAdapter.ts apps/kiosk/src/services/api/aiMockAdapter.ts apps/kiosk/src/pages/resume/ResumeOptimizePage.tsx apps/kiosk/scripts/verify-resume-diagnosis-flow-ui.mjs
git commit -m "feat(kiosk): apply resume templates during optimized export"
```

## Task 6: Final Verification and Docs

**Files:**
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`

- [ ] **Step 1: Run full local gate**

```bash
pnpm --filter @ai-job-print/shared typecheck
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/admin typecheck
pnpm --filter @ai-job-print/api verify:resume-export-formats
pnpm --filter @ai-job-print/api verify:resume-layout-export
pnpm --filter @ai-job-print/api verify:resume-layout-adjust
pnpm --filter @ai-job-print/api verify:resume-template-fill
pnpm --filter @ai-job-print/kiosk verify:resume-diagnosis-flow-ui
git diff --check
```

Expected: all PASS.

- [ ] **Step 2: Update progress docs**

In `docs/progress/current-progress.md`, add a dated note:

```md
2026-07-03 补充：完成 AI 简历优化闭环 Wave 3 代码侧候选。优化页可选择已发布简历模板，PDF 导出按模板 preset 和用户 layout 自动填充结构化简历字段；新增 verify:resume-template-fill 并扩展 Kiosk UI verify。边界：本项尚未合并 main、未预生产部署、未真机出纸，docx/txt/md 不承诺模板排版或直接打印。
```

In `docs/progress/next-tasks.md`, change Wave 3 item to code-side pending PR / preprod if applicable, preserving remaining Wave 4-6.

- [ ] **Step 3: Review diff scope**

Run:

```bash
git diff --stat
git diff --name-only
```

Expected changed files are only the files listed in this plan.

- [ ] **Step 4: Commit docs**

```bash
git add docs/progress/current-progress.md docs/progress/next-tasks.md
git commit -m "docs: record resume template fill wave3 status"
```

- [ ] **Step 5: Double-model review**

Run Antigravity + Claude reviewer on `git diff origin/main...HEAD`, focusing on:

- PDF rendering regressions.
- Template validation.
- FileObject / printFileUrl contract.
- Privacy and compliance copy.
- Kiosk stale export state.
- CI wiring.

Critical findings must be fixed and re-reviewed.

- [ ] **Step 6: Push and open PR**

```bash
git push -u origin codex/resume-template-fill-wave3
gh pr create --base main --head codex/resume-template-fill-wave3 --title "feat: add resume template auto fill" --body-file /tmp/resume-template-fill-wave3-pr.md
```

PR body must state:

- Summary.
- Safety / compliance.
- Test plan.
- Not included.
- Preproduction follow-up.

## Acceptance Criteria

- Optimized resume page can choose a resume template.
- PDF export sends `templateId`, `layout`, and current structured resume.
- API validates template id and type.
- PDF renderer applies template default layout and section order.
- User layout overrides template defaults.
- Existing Wave 1 / Wave 2 behavior remains intact without `templateId`.
- docx / txt / md export behavior remains honest: no direct print and no template layout promise.
- `printFileUrl` remains the only print path for PDF.
- New verify scripts run in CI.
