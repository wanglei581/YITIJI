# AI 简历优化 Wave 2 排版编辑与 AI 一键排版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 AI 简历优化页补齐受控排版参数编辑、PDF 参数化导出和 AI 一键精简/排版，同时保持 Wave 1 的防编造、防承诺、FileObject、`printFileUrl` 打印契约。

**Architecture:** 先拆分 Kiosk 优化页，避免继续向 550 行页面堆功能；再在共享类型和 DTO 中添加 optional `ResumeLayoutSettings`；PDF 服务只消费受控 layout 参数；AI 一键排版走独立 endpoint，并复用服务端事实校验，拒绝新增事实。docx/txt/md 仍按 Wave 1 下载语义，不在本轮做排版高还原或直接打印。

**Tech Stack:** React + TypeScript + Vite(Kiosk)、NestJS(API)、pdfkit、Prisma、`packages/shared` 作为跨端类型 SSOT、既有 `verify:*` 脚本作为门禁。

---

## 0. 前置事实

- 基线：`origin/main=d922071d`，已含 PR #123 hotfix，PDF 打印使用 `printFileUrl`。
- Wave 1 RW1-G1~RW1-G3 已在预生产通过；Windows 真机出纸仍是后续独立验收。
- 当前 worktree：`.worktrees/resume-optimize-wave2-plan`，分支 `codex/resume-optimize-wave2-plan`。
- 本 plan 只写 Wave 2，不包含支付、语音、岗位 URL、模板填充、非 PDF 格式转换或真机出纸。

## 1. Allow-list

### 允许新增

- `apps/kiosk/src/pages/resume/components/ResumeLayoutControls.tsx`
- `apps/kiosk/src/pages/resume/components/OptimizedResumeEditor.tsx`
- `apps/kiosk/src/pages/resume/hooks/useResumeLayout.ts`
- `services/api/scripts/verify-resume-layout-export.ts`
- `services/api/scripts/verify-resume-layout-adjust.ts`

### 允许修改

- `packages/shared/src/types/ai.ts`
- `services/api/src/ai/interfaces/ai-provider.interface.ts`
- `services/api/src/ai/dto/resume-generate.dto.ts`
- `services/api/src/ai/ai.controller.ts`
- `services/api/src/ai/ai.service.ts`
- `services/api/src/ai/resume/resume-pdf.service.ts`
- `services/api/src/ai/resume/llm-resume-optimize.service.ts`
- `services/api/scripts/verify-resume-export-formats.ts`
- `services/api/package.json`
- `apps/kiosk/src/pages/resume/ResumeOptimizePage.tsx`
- `apps/kiosk/src/services/api/ai.ts`
- `apps/kiosk/src/services/api/aiHttpAdapter.ts`
- `apps/kiosk/src/services/api/aiMockAdapter.ts`
- `apps/kiosk/scripts/verify-resume-diagnosis-flow-ui.mjs`
- `apps/kiosk/package.json`
- `.github/workflows/ci.yml`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`

### 禁止修改

- `services/api/src/print-jobs/**`
- `services/api/src/files/file-validation.ts`
- `services/api/prisma/schema.prisma`
- `apps/kiosk/src/pages/home/**`
- `packages/ui/**`
- 支付 / 订单 / 权益 / 套餐模块
- `legacy-miaoda/**`

## 2. 任务拆分

### Task 1：共享类型与 DTO 加 `ResumeLayoutSettings`

**Files:**
- Modify: `packages/shared/src/types/ai.ts`
- Modify: `services/api/src/ai/interfaces/ai-provider.interface.ts`
- Modify: `services/api/src/ai/dto/resume-generate.dto.ts`

- [ ] **Step 1：先扩 `verify:resume-export-formats` 静态断言**

在 `services/api/scripts/verify-resume-export-formats.ts` 增加源码断言：

```ts
const sharedSrc = readFileSync(join(__dirname, '../../../packages/shared/src/types/ai.ts'), 'utf-8')
if (!sharedSrc.includes('export interface ResumeLayoutSettings')) fail('layout. 未定义 ResumeLayoutSettings')
if (!sharedSrc.includes("export type ResumeLayoutColumns = 1 | 2")) fail('layout. columns 类型必须只允许 1|2')
const dtoSrc = readFileSync(join(__dirname, '../src/ai/dto/resume-generate.dto.ts'), 'utf-8')
if (!dtoSrc.includes('class ResumeLayoutDto')) fail('layout. API DTO 未定义 ResumeLayoutDto')
if (!dtoSrc.includes('layout?: ResumeLayoutDto')) fail('layout. 导出请求 DTO 未接入 layout 可选字段')
```

Run: `pnpm --filter @ai-job-print/api verify:resume-export-formats`

Expected: FAIL，因为类型尚未添加。

- [ ] **Step 2：新增 shared 类型**

在 `packages/shared/src/types/ai.ts` 的 `ResumeExportFormat` 附近添加：

```ts
export type ResumeLayoutFontScale = 'compact' | 'standard' | 'large'
export type ResumeLayoutLineSpacing = 'compact' | 'standard' | 'relaxed'
export type ResumeLayoutMargin = 'narrow' | 'normal' | 'wide'
export type ResumeLayoutColumns = 1 | 2
export type ResumeLayoutAccent = 'blue' | 'green' | 'slate'

export interface ResumeLayoutSettings {
  fontScale?: ResumeLayoutFontScale
  lineSpacing?: ResumeLayoutLineSpacing
  margin?: ResumeLayoutMargin
  columns?: ResumeLayoutColumns
  accent?: ResumeLayoutAccent
}
```

在 `ResumeGenerateExportResponse` 不新增 layout 回显，除非前端确实需要。导出请求 layout 通过 DTO 接收，不需要在响应回显。

- [ ] **Step 3：同步 API 本地副本**

在 `services/api/src/ai/interfaces/ai-provider.interface.ts` 同步相同类型。保持注释说明：这是 CJS 本地副本，须与 shared 同步。

- [ ] **Step 4：DTO 校验**

在 `services/api/src/ai/dto/resume-generate.dto.ts` 新增并 `export`：

```ts
export class ResumeLayoutDto {
  @IsOptional() @IsIn(['compact', 'standard', 'large'])
  fontScale?: ResumeLayoutFontScale

  @IsOptional() @IsIn(['compact', 'standard', 'relaxed'])
  lineSpacing?: ResumeLayoutLineSpacing

  @IsOptional() @IsIn(['narrow', 'normal', 'wide'])
  margin?: ResumeLayoutMargin

  @IsOptional() @IsIn([1, 2])
  columns?: ResumeLayoutColumns

  @IsOptional() @IsIn(['blue', 'green', 'slate'])
  accent?: ResumeLayoutAccent
}
```

并在 `ResumeGenerateExportDto` 增加：

```ts
@IsOptional() @IsObject() @ValidateNested() @Type(() => ResumeLayoutDto)
layout?: ResumeLayoutDto
```

- [ ] **Step 5：验证**

Run:

```bash
pnpm --filter @ai-job-print/api verify:resume-export-formats
pnpm --filter @ai-job-print/api typecheck
```

Expected: PASS。

Commit:

```bash
git add packages/shared/src/types/ai.ts services/api/src/ai/interfaces/ai-provider.interface.ts services/api/src/ai/dto/resume-generate.dto.ts services/api/scripts/verify-resume-export-formats.ts
git commit -m "feat(resume): add layout settings contract"
```

### Task 2：PDF 渲染参数化

**Files:**
- Modify: `services/api/src/ai/resume/resume-pdf.service.ts`
- Modify: `services/api/src/ai/ai.service.ts`
- Modify: `services/api/src/ai/ai.controller.ts`
- Create: `services/api/scripts/verify-resume-layout-export.ts`
- Modify: `services/api/package.json`

- [ ] **Step 1：新建 failing verify**

`verify-resume-layout-export.ts` 必须覆盖：

1. 缺省 layout 导出仍返回 PDF、`printFileUrl`，且默认 `margin/lineGap/accent/fontScale/columns` 必须由 Wave 1 当前硬编码常量提取，重构前后默认值逐项相等。
2. `accent='green'` 以源码色表和 `resolveLayout` 分支覆盖为主判据；不得依赖 PDF raw buffer 中出现 `#047857` 字面量（PDFKit 可能压缩或转成 RGB 算子）。
3. `margin='narrow'` 与 `margin='wide'` 页数不小于 1 且 buffer 非空。
4. `columns=2 + fontScale='large'` 长文本不抛错，页数不为 0，源码中存在 `resolveHeaderBottomY` / `bodyStartY`，且不出现 `cfg.margin + 80`。
5. `ensureSpace` 存在防死循环保护：当 `minHeight` 大于单栏可用高度或当前已在 `bodyStartY` 仍放不下时，必须就地渲染/拆段，不得继续换栏换页。
6. docx/txt/md 传 layout 不报错，但不返回 `printFileUrl`。

Run: `pnpm --filter @ai-job-print/api verify:resume-layout-export`

Expected: FAIL，脚本未注册或实现未支持 layout。

- [ ] **Step 2：定义安全配置派生函数**

在 `resume-pdf.service.ts` 添加内部函数。默认值必须从 Wave 1 当前常量迁移而来；执行时先读取重构前 `MARGIN`、默认行距、默认主色、默认字号倍率，禁止为了“看起来更好”改变默认 PDF 外观：

```ts
type ResumePdfLayoutConfig = {
  margin: number
  contentWidth: number
  fontScale: number
  lineGap: number
  accent: string
  columns: 1 | 2
}

function resolveLayout(layout?: ResumeLayoutSettings): ResumePdfLayoutConfig {
  const margin = layout?.margin === 'narrow' ? 36 : layout?.margin === 'wide' ? 60 : 48
  const fontScale = layout?.fontScale === 'compact' ? 0.92 : layout?.fontScale === 'large' ? 1.08 : 1
  const lineGap = layout?.lineSpacing === 'compact' ? 1.5 : layout?.lineSpacing === 'relaxed' ? 4 : 2.5
  const accent = layout?.accent === 'green' ? '#047857' : layout?.accent === 'slate' ? '#475569' : '#2563eb'
  const columns = layout?.columns === 2 ? 2 : 1
  return { margin, contentWidth: PAGE.width - margin * 2, fontScale, lineGap, accent, columns }
}
```

- [ ] **Step 3：修改 `render` 签名**

```ts
async render(resume: GeneratedResume, layout?: ResumeLayoutSettings): Promise<RenderedResumePdf>
```

内部所有 `MARGIN` / `CONTENT_W` / `accent` / `lineGap` 改为 `cfg`。字号用 helper：

```ts
const fs = (n: number) => Number((n * cfg.fontScale).toFixed(2))
```

- [ ] **Step 4：双栏 MVP**

实现最小受控列流：

```ts
const columnGap = 22
const columnWidth = cfg.columns === 2 ? (cfg.contentWidth - columnGap) / 2 : cfg.contentWidth
const headerBottomY = resolveHeaderBottomY(cfg)
const bodyStartY = headerBottomY + 18
let column = 0
const xForColumn = () => cfg.margin + column * (columnWidth + columnGap)
const resetX = () => { doc.x = xForColumn() }
const ensureSpace = (minHeight = 80) => {
  if (doc.y + minHeight <= PAGE.height - cfg.margin) return
  const columnAvailableHeight = PAGE.height - cfg.margin - bodyStartY
  if (minHeight > columnAvailableHeight || doc.y === bodyStartY) return
  if (cfg.columns === 2 && column === 0) {
    column = 1
    doc.y = bodyStartY
    resetX()
    return
  }
  doc.addPage()
  column = 0
  doc.y = bodyStartY
  resetX()
}
```

页眉保持全宽，正文 section / entry / body 写入 `columnWidth`。`resolveHeaderBottomY(cfg)` 必须由真实页眉字号和行高派生，禁止硬编码 `80`；双栏左右列和分页后的正文起始 Y 必须使用同一个 `bodyStartY`。`ensureSpace` 必须有防死循环保护：如果某块内容高度超过单栏可用高度，或位于列起点仍放不下，必须就地渲染或交给文本流拆段，不能无限换栏/加页。先做稳定渲染，不做自动视觉最优。

- [ ] **Step 5：导出链路透传**

`AiService.exportGeneratedResume(..., format, layout?)`：

```ts
const rendered = await this.resumePdf.render(resume, layout)
```

`AiController.exportGeneratedResume`：

```ts
const { taskId, format, layout, ...resume } = dto
const result = await this.aiService.exportGeneratedResume(resume, requester.endUserId, sourceFileId, format ?? 'pdf', layout)
```

审计 payload 增加非敏感摘要：

```ts
layout: layout ? { columns: layout.columns ?? 1, margin: layout.margin ?? 'normal' } : null
```

- [ ] **Step 6：验证**

Run:

```bash
pnpm --filter @ai-job-print/api verify:resume-layout-export
pnpm --filter @ai-job-print/api verify:resume-export-formats
pnpm --filter @ai-job-print/api typecheck
```

Commit:

```bash
git add services/api/src/ai/resume/resume-pdf.service.ts services/api/src/ai/ai.service.ts services/api/src/ai/ai.controller.ts services/api/scripts/verify-resume-layout-export.ts services/api/package.json
git commit -m "feat(resume): render PDF with layout settings"
```

### Task 3：Kiosk 优化页拆分与排版控制 UI

**Files:**
- Modify: `apps/kiosk/src/pages/resume/ResumeOptimizePage.tsx`
- Create: `apps/kiosk/src/pages/resume/components/ResumeLayoutControls.tsx`
- Create: `apps/kiosk/src/pages/resume/components/OptimizedResumeEditor.tsx`
- Create: `apps/kiosk/src/pages/resume/hooks/useResumeLayout.ts`
- Modify: `apps/kiosk/src/services/api/ai.ts`
- Modify: `apps/kiosk/src/services/api/aiHttpAdapter.ts`
- Modify: `apps/kiosk/src/services/api/aiMockAdapter.ts`
- Modify: `apps/kiosk/scripts/verify-resume-diagnosis-flow-ui.mjs`

- [ ] **Step 1：先扩前端 verify**

在 `verify-resume-diagnosis-flow-ui.mjs` 新增断言：

- 页面源码不再直接包含所有 textarea 编辑循环；编辑区已抽 `OptimizedResumeEditor`。
- 页面含 `ResumeLayoutControls`。
- 四类控制文案或值存在：字号、行距、页边距、主色、单栏/双栏。
- `exportGeneratedResume` 调用带 `layout` 参数。
- PDF 打印仍使用 `printFileUrl`，不得回退 `signedUrl`。
- 不出现价格/付费/扣费文案。

Run: `pnpm --filter @ai-job-print/kiosk verify:resume-diagnosis-flow-ui`

Expected: FAIL。

- [ ] **Step 2：`useResumeLayout`**

```ts
export const DEFAULT_RESUME_LAYOUT: Required<ResumeLayoutSettings> = {
  fontScale: 'standard',
  lineSpacing: 'standard',
  margin: 'normal',
  columns: 1,
  accent: 'blue',
}
```

Hook 返回：

```ts
return { layout, setLayout, resetLayout, previewClassName, previewStyle }
```

`previewStyle` 只输出受控 CSS 变量，不拼用户输入。

- [ ] **Step 3：`ResumeLayoutControls`**

使用按钮 / segmented control，不用自由输入：

- 字号：紧凑 / 标准 / 放大。
- 行距：紧凑 / 标准 / 舒展。
- 页边距：窄 / 标准 / 宽。
- 主色：蓝 / 绿 / 灰。
- 栏数：单栏 / 双栏。

每次变更调用 `onChange(next)`，由页面 `markEdited()` 清空旧导出。

- [ ] **Step 4：`OptimizedResumeEditor`**

搬运现有结构化编辑 JSX，不改字段语义。props：

```ts
type OptimizedResumeEditorProps = {
  resume: GeneratedResume
  onChange: (next: GeneratedResume) => void
  layout: ResumeLayoutSettings
}
```

保持每个字段的 slice 限制，不能扩大输入上限。

- [ ] **Step 5：页面接线**

`ResumeOptimizePage`：

- 引入 hook 和组件。
- `handleExport` 调用：

```ts
const result = await exportGeneratedResume(optimizedResume, taskId, getToken(), exportFormat, layout)
```

- 仅 PDF 导出提示排版会生效。
- 切 layout 后 `setExported(null)`。
- `handlePrint` 仍用 `exported.printFileUrl`。

- [ ] **Step 6：adapter 签名**

`exportGeneratedResume(resume, taskId?, token?, format?, layout?)`，HTTP body 包含 `layout`。mock 忽略 layout，但类型一致。

- [ ] **Step 7：验证**

Run:

```bash
pnpm --filter @ai-job-print/kiosk verify:resume-diagnosis-flow-ui
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/api verify:resume-layout-export
```

Commit:

```bash
git add apps/kiosk/src/pages/resume/ResumeOptimizePage.tsx apps/kiosk/src/pages/resume/components/ResumeLayoutControls.tsx apps/kiosk/src/pages/resume/components/OptimizedResumeEditor.tsx apps/kiosk/src/pages/resume/hooks/useResumeLayout.ts apps/kiosk/src/services/api/ai.ts apps/kiosk/src/services/api/aiHttpAdapter.ts apps/kiosk/src/services/api/aiMockAdapter.ts apps/kiosk/scripts/verify-resume-diagnosis-flow-ui.mjs
git commit -m "feat(kiosk): add resume layout controls"
```

### Task 4：AI 一键排版 / 精简 endpoint

**Files:**
- Modify: `services/api/src/ai/resume/llm-resume-optimize.service.ts`
- Modify: `services/api/src/ai/ai.service.ts`
- Modify: `services/api/src/ai/ai.controller.ts`
- Modify: `services/api/src/ai/dto/resume-generate.dto.ts`
- Create: `services/api/scripts/verify-resume-layout-adjust.ts`
- Modify: `services/api/package.json`

- [ ] **Step 1：新 verify 先红**

`verify-resume-layout-adjust.ts` 覆盖：

1. DTO `action` 只允许 `reformat` / `condense`。
2. 未配置 LLM 不 fallback mock。
3. LLM 返回新增学校 / 公司 / 证书 / 数字时被拒。
4. LLM 返回承诺类词时被拒。
5. 合法 condense 只缩短描述，不改事实字段。
6. 事实基线提取函数只拼接当前编辑稿字段值，不把 `basic/school/company/degree` 等 JSON key 当事实。
7. source file 不存在或 extraction 失败时硬拒，不 fallback 到仅 currentResume。
8. 成功响应为 `{ resume, warnings }`，不得返回原文、token、签名 URL 或密钥。

- [ ] **Step 2：DTO**

新增：

```ts
export class ResumeLayoutAdjustDto {
  @IsObject() @ValidateNested() @Type(() => ResumeLayoutAdjustResumeDto)
  resume!: ResumeLayoutAdjustResumeDto

  @IsIn(['reformat', 'condense'])
  action!: 'reformat' | 'condense'

  @IsOptional() @IsObject() @ValidateNested() @Type(() => ResumeLayoutDto)
  layout?: ResumeLayoutDto
}
```

其中 `ResumeLayoutAdjustResumeDto` 只包含 `GeneratedResume` 字段（`basic/intention/summary/education/experience/projects/skills/certificates`），不得复用 `ResumeGenerateExportDto`，避免 `format/taskId/layout` 这类导出元字段混入 AI 调整输入。

- [ ] **Step 3：service action**

在 `LlmResumeOptimizeService` 新增：

```ts
async adjustLayoutDraft(input: {
  currentResume: GeneratedResume
  originalText: string
  action: 'reformat' | 'condense'
  layout?: ResumeLayoutSettings
}): Promise<{ resume: GeneratedResume; warnings: string[] }>
```

Prompt 要求：

- 只输出 JSON `GeneratedResume`。
- `condense`：缩短 summary / description，删除重复词，不新增经历。
- `reformat`：按当前 layout 提示调整表达密度。
- 所有事实仍须来自原文或当前编辑稿。

校验方式：

- 构造 `factBase = originalText + extractResumeValueText(currentResume)`，其中 `extractResumeValueText` 只能递归拼接 string / number 字段值，必须剔除 JSON key、结构字段名和语法字符，避免 `school/company/basic` 这类键名污染事实基线。
- 对输出中的学校、公司、证书、电话、邮箱、时间段、项目名、关键数字做归一化包含校验。
- 输出数组长度不得超过当前编辑稿对应数组长度；不允许新增 education/experience/project/certificate 条目。
- 命中承诺词拒绝。
- 使用 taskId 复用既有优化链路的 source file 解析路径重新提取原始文本；如果 source file 不存在或 extraction 失败，endpoint 必须硬拒绝，不得降级为仅用 currentResume 事实基线。
- 返回 `{ resume, warnings }`，warnings 只放非敏感提示，例如“已保留原字段数量”“部分表达未采纳”；不得返回原文、token、签名 URL 或密钥。

- [ ] **Step 4：controller endpoint**

新增：

```ts
@Post('resume/records/:taskId/layout-adjust')
@Throttle({ default: { ttl: 60_000, limit: 6 } })
async adjustResumeLayoutDraft(...)
```

复用 `resolveAiResultRequester(req)`，用 taskId 校验归属 / accessToken。

- [ ] **Step 5：验证**

Run:

```bash
pnpm --filter @ai-job-print/api verify:resume-layout-adjust
pnpm --filter @ai-job-print/api verify:resume-optimize
pnpm --filter @ai-job-print/api typecheck
```

Commit:

```bash
git add services/api/src/ai/resume/llm-resume-optimize.service.ts services/api/src/ai/ai.service.ts services/api/src/ai/ai.controller.ts services/api/src/ai/dto/resume-generate.dto.ts services/api/scripts/verify-resume-layout-adjust.ts services/api/package.json
git commit -m "feat(resume): add AI layout adjustment action"
```

### Task 5：Kiosk 接 AI 一键排版 / 精简

**Files:**
- Modify: `apps/kiosk/src/pages/resume/ResumeOptimizePage.tsx`
- Modify: `apps/kiosk/src/services/api/ai.ts`
- Modify: `apps/kiosk/src/services/api/aiHttpAdapter.ts`
- Modify: `apps/kiosk/src/services/api/aiMockAdapter.ts`
- Modify: `apps/kiosk/scripts/verify-resume-diagnosis-flow-ui.mjs`

- [ ] **Step 1：前端 verify 先红**

新增断言：

- 页面有 “AI 精简” 和 “AI 调整排版” 按钮。
- 调用统一 wrapper，不直连 adapter。
- 按钮 disabled 条件包含 loading / exporting / !optimizedResume。
- 失败文案不承诺提分/录用。
- 页面有 “撤销 AI 调整” 能力，AI 成功后不能不可逆覆盖用户编辑稿。
- wrapper 返回并处理 `{ resume, warnings }`，warnings 只作为提示展示，不进入简历正文。

- [ ] **Step 2：API wrapper**

新增：

```ts
export async function adjustResumeLayoutDraft(taskId: string, resume: GeneratedResume, action: ResumeLayoutAdjustAction, layout: ResumeLayoutSettings, opts?: { token?: string | null; accessToken?: string }): Promise<{ resume: GeneratedResume; warnings: string[] }>
```

HTTP endpoint：`POST /resume/records/${taskId}/layout-adjust`。

- [ ] **Step 3：页面动作**

添加 state：

```ts
const [adjusting, setAdjusting] = useState<ResumeLayoutAdjustAction | null>(null)
const [lastResumeBeforeAiAdjust, setLastResumeBeforeAiAdjust] = useState<GeneratedResume | null>(null)
const [adjustWarnings, setAdjustWarnings] = useState<string[]>([])
```

按钮：

- `AI 精简内容` -> action `condense`
- `AI 调整排版` -> action `reformat`

成功后：

- `setLastResumeBeforeAiAdjust(optimizedResume)`
- `setOptimizedResume(result.resume)`
- `setAdjustWarnings(result.warnings ?? [])`
- `setExported(null)`
- `setIsDirty(true)`

页面必须提供“撤销 AI 调整”按钮；点击后恢复 `lastResumeBeforeAiAdjust`、清空旧导出并隐藏该按钮。AI 结果不得在无撤销能力的情况下不可逆覆盖用户手动编辑稿。

失败后：展示 `exportError` 或独立 `adjustError`，不覆盖当前编辑稿。

- [ ] **Step 4：验证**

Run:

```bash
pnpm --filter @ai-job-print/kiosk verify:resume-diagnosis-flow-ui
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/api verify:resume-layout-adjust
```

Commit:

```bash
git add apps/kiosk/src/pages/resume/ResumeOptimizePage.tsx apps/kiosk/src/services/api/ai.ts apps/kiosk/src/services/api/aiHttpAdapter.ts apps/kiosk/src/services/api/aiMockAdapter.ts apps/kiosk/scripts/verify-resume-diagnosis-flow-ui.mjs
git commit -m "feat(kiosk): wire AI resume layout adjustment"
```

### Task 6：CI、文档和最终审查

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`

- [ ] **Step 1：CI verify 串接**

`verify:resume-layout-export` 和 `verify:resume-layout-adjust` 的 `package.json` 脚本条目分别在 Task 2 / Task 4 新建脚本时登记；本步骤只负责把它们接入 CI 的 resume verify 段：

```json
"verify:resume-layout-export": "node -r @swc-node/register scripts/verify-resume-layout-export.ts",
"verify:resume-layout-adjust": "node -r @swc-node/register scripts/verify-resume-layout-adjust.ts"
```

CI 中与 resume 相关 verify 段加入这两项。

- [ ] **Step 2：完整验证**

Run:

```bash
pnpm --filter @ai-job-print/shared typecheck
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/api verify:resume-optimize
pnpm --filter @ai-job-print/api verify:resume-export-formats
pnpm --filter @ai-job-print/api verify:resume-layout-export
pnpm --filter @ai-job-print/api verify:resume-layout-adjust
pnpm --filter @ai-job-print/kiosk verify:resume-diagnosis-flow-ui
git diff --check
```

- [ ] **Step 3：双模型审查**

调用 Claude + Antigravity review，重点：

- PDF layout 参数是否越界。
- AI 一键精简是否弱化防编造。
- 前端是否仍用 `printFileUrl`。
- 是否有价格/收费文案。
- 是否触碰禁止文件。

- [ ] **Step 4：文档收口**

`current-progress.md` 记录：

- Wave 2 代码侧完成项。
- 本地 verify 通过项。
- 未预生产 / 未真机 / 未支付 / 未模板 / 未格式转换边界。

`next-tasks.md`：

- Wave 2 标代码侧完成。
- 保留预生产 live、真机出纸、Wave 3~6 后续。

Commit:

```bash
git add .github/workflows/ci.yml docs/progress/current-progress.md docs/progress/next-tasks.md
git commit -m "docs: record resume layout wave2 closure"
```

## 3. 最终验收命令

```bash
pnpm --filter @ai-job-print/shared typecheck
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/api verify:resume-optimize
pnpm --filter @ai-job-print/api verify:resume-export-formats
pnpm --filter @ai-job-print/api verify:resume-layout-export
pnpm --filter @ai-job-print/api verify:resume-layout-adjust
pnpm --filter @ai-job-print/kiosk verify:resume-diagnosis-flow-ui
git diff --check
```

## 4. 执行后仍待外部验收

- 预生产真实 LLM live 复跑：会员登录 -> 诊断 -> 优化 -> 调排版 -> AI 精简 -> PDF 导出 -> 我的文档。
- Windows 真机出纸：使用带 layout 的 PDF 创建真实打印任务，验收 Agent claim / 下载 / 出纸 / 状态回传。
- COS 生命周期策略持续确认。
- Wave 3 模板自动填充、Wave 5 计费、Wave 6 格式转换仍独立立项。
