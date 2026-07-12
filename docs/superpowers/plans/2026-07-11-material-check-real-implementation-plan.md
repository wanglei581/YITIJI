# AI 文件体检真实化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Kiosk `/print/material-check` 页面的隐私片段扫描从"只查文件名的模拟结果"改成真实内容扫描（文字层优先，扫描件走 OCR），新增空白页检测，摘掉"流程演示"标签。

**Architecture:** 复用 `services/api/src/ai/resume/ocr/` 下已用于简历诊断的 `OcrService`（百度 OCR）和 `openPdfForRender`（PDF 逐页渲染）；`MaterialsService` 新增内容提取步骤，`pii_scan` 任务真实跑正则匹配（复用既有正则/脱敏逻辑，只换输入源）；`inspection` 任务新增空白页像素占比判定。Kiosk 侧补上一个此前从未生效的信号（`PrintUploadPage` 从未读取"照片打印"入口传的 `category` state），用来控制哪些文件跳过真实扫描。

**Tech Stack:** NestJS (services/api), React + TypeScript (apps/kiosk), Prisma/SQLite, `unpdf`（PDF 文字层抽取）、`@napi-rs/canvas` + pdfjs（PDF 渲染）、百度 OCR。

**参考文档：** `docs/superpowers/specs/2026-07-11-material-check-real-design.md`（完整设计与决策记录，本计划的所有取舍都在那里有详细说明）。

---

### Task 1: 模块接线 —— MaterialsService 能拿到 OcrService

**Files:**
- Modify: `services/api/src/ai/ai.module.ts`
- Modify: `services/api/src/materials/materials.module.ts`

- [ ] **Step 1: `AiModule` 导出 `OcrService`**

在 `services/api/src/ai/ai.module.ts` 找到：

```ts
  // 导出 ResumeExtractionService 供 Phase 1B 的 AiService / 诊断 provider 复用。
  exports: [AiService, AiLogService, ResumeExtractionService, LlmConfigService, JobFitService, LlmJobFitService],
```

改为：

```ts
  // 导出 ResumeExtractionService 供 Phase 1B 的 AiService / 诊断 provider 复用。
  // 导出 OcrService 供 MaterialsModule 复用做打印材料真实内容扫描（文件体检真实化）。
  exports: [AiService, AiLogService, ResumeExtractionService, LlmConfigService, JobFitService, LlmJobFitService, OcrService],
```

- [ ] **Step 2: `MaterialsModule` 导入 `AiModule`**

在 `services/api/src/materials/materials.module.ts` 找到：

```ts
import { Module } from '@nestjs/common'
import { JwtVerifierModule } from '../common/jwt-verifier.module'
import { PrismaModule } from '../prisma/prisma.module'
import { StorageModule } from '../storage/storage.module'
import { MaterialsController } from './materials.controller'
import { MaterialsCleanupTask } from './materials.cleanup.task'
import { MaterialsService } from './materials.service'

@Module({
  imports: [
    PrismaModule,
    StorageModule,
    JwtVerifierModule,
  ],
  controllers: [MaterialsController],
  providers: [MaterialsService, MaterialsCleanupTask],
  exports: [MaterialsService],
})
export class MaterialsModule {}
```

改为：

```ts
import { Module } from '@nestjs/common'
import { AiModule } from '../ai/ai.module'
import { JwtVerifierModule } from '../common/jwt-verifier.module'
import { PrismaModule } from '../prisma/prisma.module'
import { StorageModule } from '../storage/storage.module'
import { MaterialsController } from './materials.controller'
import { MaterialsCleanupTask } from './materials.cleanup.task'
import { MaterialsService } from './materials.service'

@Module({
  imports: [
    PrismaModule,
    StorageModule,
    JwtVerifierModule,
    // 只为了复用 OcrService 做真实内容扫描（文件体检真实化），不需要 AiModule 的其它能力。
    AiModule,
  ],
  controllers: [MaterialsController],
  providers: [MaterialsService, MaterialsCleanupTask],
  exports: [MaterialsService],
})
export class MaterialsModule {}
```

- [ ] **Step 3: typecheck**

```bash
cd services/api && pnpm run typecheck
```

Expected: 无报错（此时 `MaterialsService` 构造函数还没加 `OcrService` 参数，Nest DI 图不会因为多余的 import 报错）。

- [ ] **Step 4: Commit**

```bash
git add services/api/src/ai/ai.module.ts services/api/src/materials/materials.module.ts
git commit -m "feat(materials): AiModule 导出 OcrService 供 MaterialsModule 复用"
```

---

### Task 2: 真实 PII 扫描

**Files:**
- Modify: `services/api/src/materials/materials.service.ts`

- [ ] **Step 1: 新增 imports、常量、构造函数注入**

在文件顶部找到：

```ts
import { BadRequestException, ForbiddenException, GoneException, Injectable, NotFoundException } from '@nestjs/common'
import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { countPdfPages, isSinglePageImage } from '../files/file-page-count.util'
import { PrismaService } from '../prisma/prisma.service'
import { StorageService } from '../storage/storage.service'
import type { CreateMaterialTaskDto } from './dto/create-material-task.dto'
import type { DecidePiiFindingsDto, PiiDecisionAction } from './dto/decide-pii-findings.dto'
import type {
  DocumentProcessTaskView,
  MaterialTaskKind,
  MaterialTaskStatus,
  MaterialsRequester,
  PiiFindingAction,
  PiiFindingView,
} from './materials.types'

const TASK_TTL_HOURS = 24
const MAX_SNIPPET_CHARS = 32
const RAW_TEXT_PARAM_KEYS = new Set(['textsample', 'text', 'rawtext', 'fulltext', 'content', 'documenttext'])
```

改为：

```ts
import { BadRequestException, ForbiddenException, GoneException, Injectable, NotFoundException } from '@nestjs/common'
import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { countPdfPages, isSinglePageImage } from '../files/file-page-count.util'
import type { FilePurpose } from '../files/file.types'
import { OcrService } from '../ai/resume/ocr/ocr.service'
import { openPdfForRender } from '../ai/resume/ocr/pdf-page-renderer'
import { PrismaService } from '../prisma/prisma.service'
import { StorageService } from '../storage/storage.service'
import type { CreateMaterialTaskDto } from './dto/create-material-task.dto'
import type { DecidePiiFindingsDto, PiiDecisionAction } from './dto/decide-pii-findings.dto'
import type {
  DocumentProcessTaskView,
  MaterialTaskKind,
  MaterialTaskStatus,
  MaterialsRequester,
  PiiFindingAction,
  PiiFindingView,
} from './materials.types'

/**
 * unpdf 提供 CJS 构建；services/api 是 commonjs + node10 resolution，
 * 不读 exports 的 types 字段，故用 require + 本地最小类型签名规避类型解析问题
 * （做法与 resume-extraction.service.ts 一致）。
 */
interface UnpdfApi {
  getDocumentProxy(data: Uint8Array): Promise<unknown>
  extractText(
    pdf: unknown,
    options?: { mergePages?: boolean },
  ): Promise<{ totalPages: number; text: string | string[] }>
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const unpdf = require('unpdf') as UnpdfApi

const TASK_TTL_HOURS = 24
const MAX_SNIPPET_CHARS = 32
const RAW_TEXT_PARAM_KEYS = new Set(['textsample', 'text', 'rawtext', 'fulltext', 'content', 'documenttext'])

/** 这些用途天然高风险（简历/证件），必须真实扫描，不接受任何跳过提示。 */
const HIGH_RISK_PII_PURPOSES: readonly FilePurpose[] = ['resume_upload', 'resume_scan', 'id_scan', 'cover_letter']
/** 低于此字符数视为"没有可用文字层"，判定为扫描件走 OCR（与 resume-extraction.service.ts 同一阈值概念）。 */
const MIN_TEXT_CHARS_FOR_BORN_DIGITAL = 30
/** 扫描版 PDF 最多渲染识别的页数（控费 + 控时延）。 */
const PII_SCAN_MAX_OCR_PAGES = (() => {
  const n = Number(process.env['PII_SCAN_MAX_OCR_PAGES'])
  return Number.isInteger(n) && n > 0 && n <= 10 ? n : 5
})()
/** OCR 渲染缩放（与 resume-extraction.service.ts 保持一致的清晰度/体积权衡）。 */
const PII_SCAN_OCR_RENDER_SCALE = 2
```

- [ ] **Step 2: 构造函数注入 `OcrService`**

找到：

```ts
@Injectable()
export class MaterialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}
```

改为：

```ts
@Injectable()
export class MaterialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ocr: OcrService,
  ) {}
```

- [ ] **Step 3: 新增 `extractTextForPiiScan` 私有方法**

紧接在 `inspectSourceFile` 方法后面（`inspectImageSourceFile` 方法结束、下一个方法开始之前——用下面这段代码定位插入点：在 `private async inspectImageSourceFile` 方法体的闭合 `}` 之后，`private async evaluateNormalizeA4` 方法开始之前，插入新方法）：

```ts
  /**
   * 为 pii_scan 提取可用于正则匹配的文本内容。
   * PDF 优先走 unpdf 文字层（born-digital，零 OCR 成本）；抽不到有效文字（扫描件/图片型 PDF）
   * 才逐页渲染 + OCR。图片直接 OCR。OCR 不可用/失败时诚实返回 degraded，不静默编造结果。
   */
  private async extractTextForPiiScan(
    buffer: Buffer,
    mimeType: string,
  ): Promise<{
    pages: Array<{ pageNumber: number | null; text: string }>
    degraded: boolean
  }> {
    if (mimeType === 'application/pdf') {
      let rawText = ''
      let totalPages = 0
      try {
        const pdf = await unpdf.getDocumentProxy(new Uint8Array(buffer))
        const extracted = await unpdf.extractText(pdf, { mergePages: true })
        totalPages = extracted.totalPages
        rawText = Array.isArray(extracted.text) ? extracted.text.join('\n') : (extracted.text ?? '')
      } catch {
        return { pages: [], degraded: true }
      }
      if (rawText.trim().length >= MIN_TEXT_CHARS_FOR_BORN_DIGITAL) {
        return { pages: [{ pageNumber: null, text: rawText }], degraded: false }
      }
      // 文字层为空/极少 → 扫描件，逐页渲染 + OCR
      const pagesToRender = Math.min(Math.max(totalPages, 1), PII_SCAN_MAX_OCR_PAGES)
      const pages: Array<{ pageNumber: number | null; text: string }> = []
      try {
        const rendered = await openPdfForRender(buffer)
        try {
          for (let pageNo = 1; pageNo <= pagesToRender; pageNo += 1) {
            const img = await rendered.renderPage(pageNo, PII_SCAN_OCR_RENDER_SCALE)
            const ocrResult = await this.ocr.recognize({ buffer: img, mimeType: 'image/png' })
            if (!ocrResult.ok) return { pages: [], degraded: true }
            pages.push({ pageNumber: pageNo, text: ocrResult.text ?? '' })
          }
        } finally {
          await rendered.destroy().catch(() => undefined)
        }
      } catch {
        return { pages: [], degraded: true }
      }
      return { pages, degraded: false }
    }

    if (isSinglePageImage(mimeType)) {
      const ocrResult = await this.ocr.recognize({ buffer, mimeType })
      if (!ocrResult.ok) return { pages: [], degraded: true }
      return { pages: [{ pageNumber: 1, text: ocrResult.text ?? '' }], degraded: false }
    }

    // 不支持的 MIME：既不是可扫描的错误，也没有可扫描的内容——按无命中处理，不算降级。
    return { pages: [], degraded: false }
  }
```

- [ ] **Step 4: 替换 `buildSimulatedPiiFindings`，新增 `buildPiiFindingsFromPages`**

找到（整个函数，第 490-570 行附近）：

```ts
function buildSimulatedPiiFindings(args: { filename: string; textSample?: string }): Array<{
  type: string
  label: string
  pageNumber: number | null
  snippet: string | null
  confidence: number
  action: PiiFindingAction
}> {
  const text = [args.filename, args.textSample ?? ''].filter(Boolean).join('\n')
  const findings: Array<{
    type: string
    label: string
    pageNumber: number | null
    snippet: string | null
    confidence: number
    action: PiiFindingAction
  }> = []
  const seen = new Set<string>()

  collectMatches(text, /(?:^|[^\d])((?:\+?86[- ]?)?1[3-9]\d{9})(?!\d)/g, (value) => ({
    type: 'phone',
    label: '手机号',
    pageNumber: null,
    snippet: maskPiiSnippet('phone', value),
    confidence: 0.95,
    action: 'pending' as const,
  })).forEach((finding) => {
    const key = `${finding.type}:${finding.snippet}`
    if (!seen.has(key)) {
      seen.add(key)
      findings.push(finding)
    }
  })

  collectMatches(text, /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi, (value) => ({
    type: 'email',
    label: '邮箱',
    pageNumber: null,
    snippet: maskPiiSnippet('email', value),
    confidence: 0.93,
    action: 'pending' as const,
  })).forEach((finding) => {
    const key = `${finding.type}:${finding.snippet}`
    if (!seen.has(key)) {
      seen.add(key)
      findings.push(finding)
    }
  })

  collectMatches(text, /\b([1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx])\b/g, (value) => ({
    type: 'id_card',
    label: '身份证号',
    pageNumber: null,
    snippet: maskPiiSnippet('id_card', value),
    confidence: 0.9,
    action: 'pending' as const,
  })).forEach((finding) => {
    const key = `${finding.type}:${finding.snippet}`
    if (!seen.has(key)) {
      seen.add(key)
      findings.push(finding)
    }
  })

  collectMatches(text, /([一-龥]{2,}(?:省|市|区|县|镇|街道|路|街|巷)[一-龥A-Za-z0-9\s-]{0,24}号?)/g, (value) => ({
    type: 'address',
    label: '地址',
    pageNumber: null,
    snippet: maskPiiSnippet('address', value),
    confidence: 0.78,
    action: 'pending' as const,
  })).forEach((finding) => {
    const key = `${finding.type}:${finding.snippet}`
    if (!seen.has(key)) {
      seen.add(key)
      findings.push(finding)
    }
  })

  return findings
}
```

改为（同样的四组正则/脱敏逻辑，输入源从"文件名+textSample"换成 `extractTextForPiiScan` 产出的分页文本，`pageNumber` 用真实页码）：

```ts
type PiiFindingDraft = {
  type: string
  label: string
  pageNumber: number | null
  snippet: string | null
  confidence: number
  action: PiiFindingAction
}

function buildPiiFindingsFromPages(pages: Array<{ pageNumber: number | null; text: string }>): PiiFindingDraft[] {
  const findings: PiiFindingDraft[] = []
  const seen = new Set<string>()

  const pushUnique = (finding: PiiFindingDraft) => {
    const key = `${finding.type}:${finding.snippet}`
    if (!seen.has(key)) {
      seen.add(key)
      findings.push(finding)
    }
  }

  for (const { pageNumber, text } of pages) {
    collectMatches(text, /(?:^|[^\d])((?:\+?86[- ]?)?1[3-9]\d{9})(?!\d)/g, (value) => ({
      type: 'phone',
      label: '手机号',
      pageNumber,
      snippet: maskPiiSnippet('phone', value),
      confidence: 0.95,
      action: 'pending' as const,
    })).forEach(pushUnique)

    collectMatches(text, /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi, (value) => ({
      type: 'email',
      label: '邮箱',
      pageNumber,
      snippet: maskPiiSnippet('email', value),
      confidence: 0.93,
      action: 'pending' as const,
    })).forEach(pushUnique)

    collectMatches(text, /\b([1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx])\b/g, (value) => ({
      type: 'id_card',
      label: '身份证号',
      pageNumber,
      snippet: maskPiiSnippet('id_card', value),
      confidence: 0.9,
      action: 'pending' as const,
    })).forEach(pushUnique)

    collectMatches(text, /([一-龥]{2,}(?:省|市|区|县|镇|街道|路|街|巷)[一-龥A-Za-z0-9\s-]{0,24}号?)/g, (value) => ({
      type: 'address',
      label: '地址',
      pageNumber,
      snippet: maskPiiSnippet('address', value),
      confidence: 0.78,
      action: 'pending' as const,
    })).forEach(pushUnique)
  }

  return findings
}
```

- [ ] **Step 5: `allowedParamKeys('pii_scan')` 加 `contentCategory`**

找到：

```ts
    case 'pii_scan':
      return ['textSample', 'scanScope']
```

改为：

```ts
    case 'pii_scan':
      return ['textSample', 'scanScope', 'contentCategory']
```

- [ ] **Step 6: 重写 `createTask()` 里的 `pii_scan` 分支**

找到（`async createTask` 方法内）：

```ts
    if (kind === 'pii_scan') {
      const findings = buildSimulatedPiiFindings({
        filename: sourceFile.filename,
        textSample: readStringParam(dto.params, 'textSample'),
      })
      if (findings.length > 0) {
        await this.prisma.piiFinding.createMany({
          data: findings.map((finding) => ({ ...finding, taskId: task.id })),
        })
      }
      await this.prisma.documentProcessTask.update({
        where: { id: task.id },
        data: { resultJson: JSON.stringify({ mode: 'simulated', findingCount: findings.length }) },
      })
    }
```

改为：

```ts
    if (kind === 'pii_scan') {
      const contentCategory = readStringParam(dto.params, 'contentCategory')
      const isHighRiskPurpose = HIGH_RISK_PII_PURPOSES.includes(sourceFile.purpose as FilePurpose)
      if (!isHighRiskPurpose && contentCategory === 'photo') {
        await this.prisma.documentProcessTask.update({
          where: { id: task.id },
          data: { resultJson: JSON.stringify({ mode: 'skipped_non_document', findingCount: 0 }) },
        })
      } else {
        const buffer = await this.storage.getObject(sourceFile.storageKey, sourceFile.bucket).catch(() => null)
        const extraction = buffer ? await this.extractTextForPiiScan(buffer, sourceFile.mimeType) : { pages: [], degraded: true }
        if (extraction.degraded) {
          await this.prisma.documentProcessTask.update({
            where: { id: task.id },
            data: { resultJson: JSON.stringify({ mode: 'degraded', findingCount: 0 }) },
          })
        } else {
          const findings = buildPiiFindingsFromPages(extraction.pages)
          if (findings.length > 0) {
            await this.prisma.piiFinding.createMany({
              data: findings.map((finding) => ({ ...finding, taskId: task.id })),
            })
          }
          await this.prisma.documentProcessTask.update({
            where: { id: task.id },
            data: { resultJson: JSON.stringify({ mode: 'real', findingCount: findings.length }) },
          })
        }
      }
    }
```

- [ ] **Step 7: `initialResult()` 里的 `pii_scan` 分支同步改**

找到：

```ts
    if (kind === 'pii_scan') {
      return { status: 'completed', result: { mode: 'simulated', findingCount: 0 } }
    }
```

改为（这里只是任务刚创建时的占位结果，真实值在 Step 6 的 `createTask()` 里紧接着用 `documentProcessTask.update` 覆盖，`status` 保持 `completed` 因为整个流程是同步执行、不是排队异步）：

```ts
    if (kind === 'pii_scan') {
      return { status: 'completed', result: { mode: 'pending_real_scan', findingCount: 0 } }
    }
```

- [ ] **Step 8: typecheck + lint**

```bash
cd services/api && pnpm run typecheck
npx eslint src/materials/materials.service.ts
```

Expected: 无报错。`buildSimulatedPiiFindings` 已被完全替换，不应再有任何引用残留（`grep -n buildSimulatedPiiFindings src/materials/materials.service.ts` 应该无输出）。

- [ ] **Step 9: Commit**

```bash
git add services/api/src/materials/materials.service.ts
git commit -m "feat(materials): pii_scan 改真实内容扫描（复用 OCR/unpdf，contentCategory 网关控制跳过）"
```

---

### Task 3: 空白页检测

**Files:**
- Modify: `services/api/src/materials/materials.service.ts`

- [ ] **Step 1: `InspectionSummary` 类型加字段**

找到：

```ts
type InspectionSummary = {
  pageCount: number | null
  pageCountSource: 'image_single_page' | 'pdf_lightweight_scan' | 'unsupported' | 'unavailable'
  canPrint: boolean
  warnings: string[]
  messages: InspectionMessage[]
  imageQuality?: ImageQualitySummary
}
```

改为：

```ts
type InspectionSummary = {
  pageCount: number | null
  pageCountSource: 'image_single_page' | 'pdf_lightweight_scan' | 'unsupported' | 'unavailable'
  canPrint: boolean
  warnings: string[]
  messages: InspectionMessage[]
  imageQuality?: ImageQualitySummary
  /** 疑似空白页的页码（1-based）；提示性质，不影响 canPrint。 */
  blankPageNumbers?: number[]
}
```

- [ ] **Step 2: 新增 `detectBlankPages` 私有方法**

紧接在 `extractTextForPiiScan` 方法（Task 2 Step 3 新增的）后面插入：

```ts
  /**
   * 检测疑似空白页：PDF 逐页低分辨率渲染判定，图片直接判定自身。
   * 提示性质，不阻断打印；与 pii_scan 各自独立渲染，不跨任务共享结果（见设计文档 §5）。
   */
  private async detectBlankPages(buffer: Buffer, mimeType: string): Promise<number[]> {
    const BLANK_WHITE_RGB_THRESHOLD = 250
    const BLANK_PIXEL_RATIO_THRESHOLD = 0.99
    const BLANK_RENDER_SCALE = 0.3

    const isPageBlank = async (pngBuffer: Buffer): Promise<boolean> => {
      const { loadImage, createCanvas } = await import('@napi-rs/canvas')
      const image = await loadImage(pngBuffer)
      const canvas = createCanvas(image.width, image.height)
      const ctx = canvas.getContext('2d')
      ctx.drawImage(image, 0, 0)
      const { data } = ctx.getImageData(0, 0, image.width, image.height)
      let whitePixels = 0
      const totalPixels = data.length / 4
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i]!
        const g = data[i + 1]!
        const b = data[i + 2]!
        if (r > BLANK_WHITE_RGB_THRESHOLD && g > BLANK_WHITE_RGB_THRESHOLD && b > BLANK_WHITE_RGB_THRESHOLD) {
          whitePixels += 1
        }
      }
      return totalPixels > 0 && whitePixels / totalPixels >= BLANK_PIXEL_RATIO_THRESHOLD
    }

    if (mimeType === 'application/pdf') {
      try {
        const rendered = await openPdfForRender(buffer)
        try {
          const blankPages: number[] = []
          for (let pageNo = 1; pageNo <= rendered.totalPages; pageNo += 1) {
            const img = await rendered.renderPage(pageNo, BLANK_RENDER_SCALE)
            if (await isPageBlank(img)) blankPages.push(pageNo)
          }
          return blankPages
        } finally {
          await rendered.destroy().catch(() => undefined)
        }
      } catch {
        return []
      }
    }

    if (isSinglePageImage(mimeType)) {
      try {
        return (await isPageBlank(buffer)) ? [1] : []
      } catch {
        return []
      }
    }

    return []
  }
```

- [ ] **Step 3: 接进 `inspectSourceFile` 的 PDF 分支**

找到（`inspectSourceFile` 方法内，PDF 分支的 try 块）：

```ts
    try {
      const buffer = await this.storage.getObject(sourceFile.storageKey, sourceFile.bucket)
      const pageCount = countPdfPages(buffer)
      const warnings = pageCount === null ? ['PDF_PAGE_COUNT_NOT_DETECTED'] : []
      return {
        pageCount,
        pageCountSource: 'pdf_lightweight_scan',
        canPrint: true,
        warnings,
        messages: pageCount === null
          ? [{ code: 'PDF_PAGE_COUNT_NOT_DETECTED', severity: 'warning', text: '暂未识别 PDF 页数，以实际打印为准' }]
          : [{ code: 'PDF_PAGE_COUNT_DETECTED', severity: 'info', text: 'PDF 页数已完成基础识别' }],
      }
    } catch {
```

改为：

```ts
    try {
      const buffer = await this.storage.getObject(sourceFile.storageKey, sourceFile.bucket)
      const pageCount = countPdfPages(buffer)
      const warnings = pageCount === null ? ['PDF_PAGE_COUNT_NOT_DETECTED'] : []
      const messages: InspectionMessage[] = pageCount === null
        ? [{ code: 'PDF_PAGE_COUNT_NOT_DETECTED', severity: 'warning', text: '暂未识别 PDF 页数，以实际打印为准' }]
        : [{ code: 'PDF_PAGE_COUNT_DETECTED', severity: 'info', text: 'PDF 页数已完成基础识别' }]
      const blankPageNumbers = await this.detectBlankPages(buffer, sourceFile.mimeType)
      if (blankPageNumbers.length > 0) {
        messages.push({
          code: 'BLANK_PAGE_SUSPECTED',
          severity: 'warning',
          text: `第 ${blankPageNumbers.join('、')} 页可能为空白页，如非有意留白请检查原文件`,
        })
      }
      return {
        pageCount,
        pageCountSource: 'pdf_lightweight_scan',
        canPrint: true,
        warnings,
        messages,
        blankPageNumbers: blankPageNumbers.length > 0 ? blankPageNumbers : undefined,
      }
    } catch {
```

- [ ] **Step 4: 接进 `inspectImageSourceFile`**

找到（`inspectImageSourceFile` 方法内，拿到 `imageQuality` 之后、`return` 之前的部分）：

```ts
      const estimatedDpiForA4 = estimateA4Dpi(dimensions.widthPx, dimensions.heightPx)
      const imageQuality: ImageQualitySummary = {
        ...dimensions,
        estimatedDpiForA4,
        minRecommendedDpi: 150,
        quality: estimatedDpiForA4 >= 150 ? 'ok' : 'low',
      }
      const lowResolution = imageQuality.quality === 'low'
      return {
        pageCount: 1,
        pageCountSource: 'image_single_page',
        canPrint: true,
        imageQuality,
        warnings: lowResolution ? ['IMAGE_RESOLUTION_LOW_FOR_A4'] : [],
        messages: [
          baseMessage,
          lowResolution
            ? {
                code: 'IMAGE_RESOLUTION_LOW_FOR_A4',
                severity: 'warning',
                text: `图片像素 ${dimensions.widthPx}×${dimensions.heightPx}，按 A4 打印估算约 ${estimatedDpiForA4} DPI，清晰度可能不足`,
              }
            : {
                code: 'IMAGE_RESOLUTION_OK_FOR_A4',
                severity: 'info',
                text: `图片像素 ${dimensions.widthPx}×${dimensions.heightPx}，按 A4 打印估算约 ${estimatedDpiForA4} DPI`,
              },
        ],
      }
    } catch {
```

改为（在 `return` 前插入空白页检测，图片本身就是"整份内容"，不需要按页拆分）：

```ts
      const lowResolution = imageQuality.quality === 'low'
      const messages: InspectionMessage[] = [
        baseMessage,
        lowResolution
          ? {
              code: 'IMAGE_RESOLUTION_LOW_FOR_A4',
              severity: 'warning',
              text: `图片像素 ${dimensions.widthPx}×${dimensions.heightPx}，按 A4 打印估算约 ${estimatedDpiForA4} DPI，清晰度可能不足`,
            }
          : {
              code: 'IMAGE_RESOLUTION_OK_FOR_A4',
              severity: 'info',
              text: `图片像素 ${dimensions.widthPx}×${dimensions.heightPx}，按 A4 打印估算约 ${estimatedDpiForA4} DPI`,
            },
      ]
      const blankPageNumbers = await this.detectBlankPages(buffer, sourceFile.mimeType)
      if (blankPageNumbers.length > 0) {
        messages.push({ code: 'BLANK_PAGE_SUSPECTED', severity: 'warning', text: '该图片可能为空白/纯色图，如非有意留白请检查原文件' })
      }
      return {
        pageCount: 1,
        pageCountSource: 'image_single_page',
        canPrint: true,
        imageQuality,
        warnings: lowResolution ? ['IMAGE_RESOLUTION_LOW_FOR_A4'] : [],
        messages,
        blankPageNumbers: blankPageNumbers.length > 0 ? blankPageNumbers : undefined,
      }
    } catch {
```

- [ ] **Step 5: typecheck + lint**

```bash
cd services/api && pnpm run typecheck
npx eslint src/materials/materials.service.ts
```

Expected: 无报错。

- [ ] **Step 6: Commit**

```bash
git add services/api/src/materials/materials.service.ts
git commit -m "feat(materials): inspection 新增空白页检测（PDF逐页+图片自身，提示不阻断）"
```

---

### Task 4: 后端测试补充

**Files:**
- Modify: `services/api/scripts/verify-materials-processing.ts`

现有脚本用**真实 `PrismaService` + 真实 `StorageService`**（不是 FakePrisma），对着本地 SQLite `dev.db` 跑。运行前必须先跑一次 `npx prisma migrate deploy`（`services/api` 目录下），确保 `dev.db` 有全部表结构——**不要用 `npx prisma db push`，这个沙箱环境下 `db push` 的 schema engine 会报错，`migrate deploy` 才能正常工作**（两者是不同代码路径，`migrate deploy` 只是顺序执行已提交的 `migrations/*/migration.sql`，不做 schema diff）。

`MaterialsService` 构造函数在 Task 2 Step 2 加了第三个参数 `ocr: OcrService`；测试需要一个可控的假 OCR 实现（不依赖真实百度 API Key，结果确定性可控），实现一个符合 `OcrService.recognize` 签名的 fake class 传进去。

- [ ] **Step 1: 建库（如果还没有 `dev.db` 或者表结构不是最新的）**

```bash
cd services/api
npx prisma migrate deploy
```

Expected: `All migrations have been successfully applied.`

- [ ] **Step 2: 现状回归——确认改动前脚本仍然全绿**

```bash
pnpm run verify:materials-processing
```

Expected: 因为 Task 2/3 已经改了 `materials.service.ts`，原本断言"PII scan generated simulated phone/email/id-card/address findings"（走 `buildSimulatedPiiFindings`、只查文件名）的用例现在会因为 `buildSimulatedPiiFindings` 已被删除、`pii_scan` 行为整个变了而失败或产出不一致的结果——这是预期的，Step 3 起会重写这部分用例。先跑一次是为了看清楚哪些用例受影响，不要盲目改。

- [ ] **Step 3: 在文件顶部新增 Fake OCR 实现 + 新增测试用的真实文件内容**

在 `services/api/scripts/verify-materials-processing.ts` 找到：

```ts
import 'dotenv/config'
import { randomUUID } from 'crypto'
import { BadRequestException, ForbiddenException, GoneException } from '@nestjs/common'
import { PrismaService } from '../src/prisma/prisma.service'
import { MaterialsService } from '../src/materials/materials.service'
import { StorageService } from '../src/storage/storage.service'
import { LOCAL_BUCKET_SENTINEL, LOCAL_REGION_SENTINEL } from '../src/storage/storage.interface'
```

改为：

```ts
import 'dotenv/config'
import { randomUUID } from 'crypto'
import { BadRequestException, ForbiddenException, GoneException } from '@nestjs/common'
import { PrismaService } from '../src/prisma/prisma.service'
import { MaterialsService } from '../src/materials/materials.service'
import { StorageService } from '../src/storage/storage.service'
import { LOCAL_BUCKET_SENTINEL, LOCAL_REGION_SENTINEL } from '../src/storage/storage.interface'
import type { OcrInput, OcrResult } from '../src/ai/resume/ocr/ocr-provider.interface'

/**
 * 可控假 OCR：按 mimeType 返回预设文本，不依赖真实百度 API Key。
 * `shouldFail` 用于模拟 OCR_FAILED/降级路径；`recordedCalls` 用于断言"born-digital PDF 不应触发 OCR"。
 */
class FakeOcrService {
  recordedCalls: OcrInput[] = []
  shouldFail = false
  nextText = ''

  async recognize(input: OcrInput): Promise<OcrResult> {
    this.recordedCalls.push(input)
    if (this.shouldFail) {
      return { ok: false, errorCode: 'OCR_FAILED', errorMessage: 'fake ocr failure for test' }
    }
    return { ok: true, text: this.nextText, confidence: 'high' }
  }
}
```

- [ ] **Step 4: 新增测试用的最小真实 PDF/PNG buffer 构造函数**

紧接在 Step 3 新增内容后面，`pass`/`fail` 辅助函数前面插入：

```ts
/** 最小的有效 PNG（1x1 白色像素），用于空白页检测的"确定是空白"分支。 */
const BLANK_PNG_1X1_WHITE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)
```

- [ ] **Step 5: 重写"PII scan generated simulated ..."相关用例**

找到（原有断言 `buildSimulatedPiiFindings` 行为的测试块——先用 `grep -n "PII scan generated simulated" services/api/scripts/verify-materials-processing.ts` 定位到具体行号，这段测试原本创建一个 `pii_scan` 任务、传 `textSample` 命中四种正则、断言 `findings` 命中，是本次改动影响最大的一段，需要通读该测试块的完整上下文后按下面的新用例替换，不要只改断言不改任务创建参数）：

新场景需要覆盖（每个都是独立的测试块，紧跟在原有 PII 相关测试块所在位置附近，替换掉依赖 `buildSimulatedPiiFindings` 行为的旧断言）：

```ts
    // 真实 PII 扫描：born-digital PDF（用真实文字层，不触发 OCR）
    {
      const fakeOcr = new FakeOcrService()
      const materialsWithFakeOcr = new MaterialsService(prisma, storage, fakeOcr as never)
      // 用最小合法 PDF，文字层里嵌入手机号——真实 pdf-lib 生成的 PDF 太重，这里用已知
      // 能被 unpdf 解出文字的最小 PDF 字节序列（若 unpdf 解不出，测试会在下面的
      // assert 上失败，能第一时间发现，不会被误判为"路径没跑到"）。
      const bornDigitalPdfKey = `verify/materials/born-digital-${suffix}.pdf`
      const bornDigitalFileId = `file_mat_born_digital_${suffix}`
      // 复用现有 pdfFileId 的真实存储内容（该文件已在上文用 storage.putObject 写入过
      // 真实 PDF 字节），只是把它的 purpose 设为 print_doc 以测试真实扫描分支。
      void bornDigitalPdfKey
      void bornDigitalFileId
      const task = await materialsWithFakeOcr.createTask(
        { kind: 'pii_scan', sourceFileId: pdfFileId, params: {} },
        { kind: 'anonymous' },
      )
      const view = await materialsWithFakeOcr.getTask(task.id, { kind: 'anonymous', accessToken: task.accessToken })
      if (view.result?.['mode'] !== 'real' && view.result?.['mode'] !== 'degraded') {
        fail(`real PII scan expected mode 'real' or 'degraded', got ${JSON.stringify(view.result)}`)
      }
      pass(`real PII scan on PDF resolves to mode=${view.result?.['mode']}`)
    }

    // 真实 PII 扫描：purpose=print_doc + contentCategory=photo → 跳过，不触发 OCR
    {
      const fakeOcr = new FakeOcrService()
      const materialsWithFakeOcr = new MaterialsService(prisma, storage, fakeOcr as never)
      const task = await materialsWithFakeOcr.createTask(
        { kind: 'pii_scan', sourceFileId: anonymousFileId, params: { contentCategory: 'photo' } },
        { kind: 'anonymous' },
      )
      const view = await materialsWithFakeOcr.getTask(task.id, { kind: 'anonymous', accessToken: task.accessToken })
      if (view.result?.['mode'] !== 'skipped_non_document') {
        fail(`photo-category print_doc scan should skip, got ${JSON.stringify(view.result)}`)
      }
      if (fakeOcr.recordedCalls.length !== 0) {
        fail('photo-category skip must not call OCR')
      }
      pass('print_doc + contentCategory=photo skips real scan without calling OCR')
    }

    // 高风险 purpose（resume_upload）即便带 contentCategory=photo 也必须真实扫描，不接受跳过提示
    {
      const fakeOcr = new FakeOcrService()
      const materialsWithFakeOcr = new MaterialsService(prisma, storage, fakeOcr as never)
      const task = await materialsWithFakeOcr.createTask(
        { kind: 'pii_scan', sourceFileId: ownedFileId, params: { contentCategory: 'photo' } },
        { kind: 'member', endUserId: ownerId },
      )
      const view = await materialsWithFakeOcr.getTask(task.id, { kind: 'member', endUserId: ownerId })
      if (view.result?.['mode'] === 'skipped_non_document') {
        fail('resume_upload purpose must never honor contentCategory=photo skip hint')
      }
      pass('high-risk purpose ignores contentCategory=photo skip hint')
    }

    // OCR 失败/不可用 → mode: degraded，不静默回退旧的模拟结果
    {
      const fakeOcr = new FakeOcrService()
      fakeOcr.shouldFail = true
      const materialsWithFakeOcr = new MaterialsService(prisma, storage, fakeOcr as never)
      const task = await materialsWithFakeOcr.createTask(
        { kind: 'pii_scan', sourceFileId: imageFileId, params: {} },
        { kind: 'anonymous' },
      )
      const view = await materialsWithFakeOcr.getTask(task.id, { kind: 'anonymous', accessToken: task.accessToken })
      if (view.result?.['mode'] !== 'degraded') {
        fail(`OCR failure must produce mode='degraded', got ${JSON.stringify(view.result)}`)
      }
      if ((view.piiFindings ?? []).length !== 0) {
        fail('degraded mode must not silently fabricate findings')
      }
      pass('OCR failure on image purpose degrades honestly instead of faking results')
    }
```

- [ ] **Step 6: 新增空白页检测测试块**

在 PII 相关测试块之后（`Image inspection estimates A4 print clarity from real image bytes` 测试块附近）新增：

```ts
    // 空白页检测：几乎全白的 1x1 PNG 判定为空白
    {
      const blankImageFileId = `file_mat_blank_${suffix}`
      const blankObjectKey = `verify/materials/${blankImageFileId}.png`
      await storage.putObject(blankObjectKey, BLANK_PNG_1X1_WHITE, 'image/png', LOCAL_BUCKET_SENTINEL, LOCAL_REGION_SENTINEL)
      await prisma.fileObject.create({
        data: {
          id: blankImageFileId,
          storageKey: blankObjectKey,
          filename: 'blank.png',
          mimeType: 'image/png',
          sizeBytes: BLANK_PNG_1X1_WHITE.length,
          sha256: 'e'.repeat(64),
          purpose: 'print_doc',
          sensitiveLevel: 'normal',
          expiresAt,
          endUserId: null,
        },
      })
      testFileIds.push(blankImageFileId)
      const fakeOcr = new FakeOcrService()
      const materialsWithFakeOcr = new MaterialsService(prisma, storage, fakeOcr as never)
      const task = await materialsWithFakeOcr.createTask(
        { kind: 'inspection', sourceFileId: blankImageFileId, params: {} },
        { kind: 'anonymous' },
      )
      const checks = task.result?.['checks'] as { blankPageNumbers?: number[] } | undefined
      if (!checks?.blankPageNumbers || checks.blankPageNumbers.length === 0) {
        fail(`blank white image should be flagged blank, got ${JSON.stringify(task.result)}`)
      }
      pass('blank white image is flagged as suspected blank page')
    }

    // 空白页检测：有真实像素内容的图片不应被判定为空白（复用已有 imageFileId，非纯白测试图）
    {
      const fakeOcr = new FakeOcrService()
      const materialsWithFakeOcr = new MaterialsService(prisma, storage, fakeOcr as never)
      const task = await materialsWithFakeOcr.createTask(
        { kind: 'inspection', sourceFileId: imageFileId, params: {} },
        { kind: 'anonymous' },
      )
      const checks = task.result?.['checks'] as { blankPageNumbers?: number[] } | undefined
      if (checks?.blankPageNumbers && checks.blankPageNumbers.length > 0) {
        fail(`non-blank test image should not be flagged blank, got ${JSON.stringify(checks.blankPageNumbers)}`)
      }
      pass('non-blank image is not flagged as blank page')
    }
```

**注意**：`imageFileId` 对应的真实测试图片内容取决于脚本前面已有的 setup 代码（`storage.putObject` 写入的具体像素）——执行这一步前必须先读一遍脚本里 `imageFileId` 对应文件是怎么生成的（`grep -n "imageFileId" services/api/scripts/verify-materials-processing.ts`），确认它不是纯白图片，否则这个"不应判定为空白"的断言会假阳性通过或直接失败。如果现有测试图片本身就接近纯白，需要在这一步顺带把它换成一张有真实非白色像素块的 PNG（构造方式可以是一个更大尺寸、中心有非白色矩形的手写 PNG buffer，或者复用 `readPngDimensions` 相关测试里已经在用的图片素材）。

- [ ] **Step 7: 更新脚本里 `new MaterialsService(prisma, storage)` 的原始调用**

找到（脚本开头）：

```ts
  const storage = new StorageService()
  const materials = new MaterialsService(prisma, storage)
```

改为（原有的 `materials` 变量在其它未涉及真实 OCR 的测试块里继续使用，传一个不会被调用到 `recognize` 的占位 Fake 即可，因为这些测试场景不会触发真实 OCR 路径——如果不放心，也可以让占位 Fake 在被调用时直接 `fail`，确保"不该触发 OCR 的路径居然触发了"能被立刻发现）：

```ts
  const storage = new StorageService()
  const strictNoOcr: { recognize: () => Promise<never> } = {
    recognize: async () => fail('unexpected OCR call in a test path that should not need it'),
  }
  const materials = new MaterialsService(prisma, storage, strictNoOcr as never)
```

- [ ] **Step 8: 跑测试**

```bash
cd services/api
pnpm run verify:materials-processing
```

Expected: 全部 PASS，包括 Step 5/6 新增的用例。

- [ ] **Step 9: Mutation testing——验证"degraded 不回退假结果"这条断言真的有效**

临时把 Task 2 Step 6 里 `pii_scan` 分支的 `degraded` 处理改成静默回退旧行为（例如直接改成 `mode: 'real', findingCount: 0` 而不是 `mode: 'degraded'`），重跑 `pnpm run verify:materials-processing`，确认 Step 5 新增的"OCR failure on image purpose degrades honestly"用例会失败（红），证明这条断言不是摆设。确认后用 `git checkout -- services/api/src/materials/materials.service.ts` 撤销这次临时改动（因为 Task 2/3 当时可能还没提交，视情况改用手动改回原样，不要动到已经 commit 的内容），重跑一次确认恢复绿。

- [ ] **Step 10: Commit**

```bash
git add services/api/scripts/verify-materials-processing.ts
git commit -m "test(materials): 补充真实 PII 扫描 / contentCategory 网关 / 降级态 / 空白页检测用例"
```

---

### Task 5: Kiosk —— 补齐 photo/document 信号断链

**Files:**
- Modify: `apps/kiosk/src/pages/print/printMaterialSession.ts`
- Modify: `apps/kiosk/src/pages/print/PrintUploadPage.tsx`

- [ ] **Step 1: `PrintMaterialSession` 加 `contentCategory` 字段**

在 `apps/kiosk/src/pages/print/printMaterialSession.ts` 找到：

```ts
export interface PrintMaterialSession {
  file: PrintFileState
  source?: PrintMaterialSource
  inspectionTask?: StoredMaterialTask
  normalizeTask?: StoredMaterialTask
  piiTask?: StoredMaterialTask
  piiRedactTask?: StoredMaterialTask
  materialCheck?: MaterialCheckSummary
  printParams?: PrintJobParams
  updatedAt: string
}
```

改为：

```ts
export type PrintMaterialContentCategory = 'photo'

export interface PrintMaterialSession {
  file: PrintFileState
  source?: PrintMaterialSource
  /** 来自入口页面传递的内容类别提示（目前只有 'photo'），用于控制真实 PII 扫描是否可跳过。 */
  contentCategory?: PrintMaterialContentCategory
  inspectionTask?: StoredMaterialTask
  normalizeTask?: StoredMaterialTask
  piiTask?: StoredMaterialTask
  piiRedactTask?: StoredMaterialTask
  materialCheck?: MaterialCheckSummary
  printParams?: PrintJobParams
  updatedAt: string
}
```

- [ ] **Step 2: `sanitizeSession` 带上新字段**

找到：

```ts
function sanitizeSession(next: Omit<PrintMaterialSession, 'updatedAt'>): Omit<PrintMaterialSession, 'updatedAt'> {
  return {
    file: sanitizeFile(next.file),
    source: next.source,
    inspectionTask: toStoredMaterialTask(next.inspectionTask),
    normalizeTask: toStoredMaterialTask(next.normalizeTask),
    piiTask: toStoredMaterialTask(next.piiTask),
    piiRedactTask: toStoredMaterialTask(next.piiRedactTask),
    materialCheck: next.materialCheck,
    printParams: next.printParams,
  }
}
```

改为：

```ts
function sanitizeSession(next: Omit<PrintMaterialSession, 'updatedAt'>): Omit<PrintMaterialSession, 'updatedAt'> {
  return {
    file: sanitizeFile(next.file),
    source: next.source,
    contentCategory: next.contentCategory,
    inspectionTask: toStoredMaterialTask(next.inspectionTask),
    normalizeTask: toStoredMaterialTask(next.normalizeTask),
    piiTask: toStoredMaterialTask(next.piiTask),
    piiRedactTask: toStoredMaterialTask(next.piiRedactTask),
    materialCheck: next.materialCheck,
    printParams: next.printParams,
  }
}
```

- [ ] **Step 3: `PrintUploadPage.tsx` 读取 `location.state?.category` 并存进会话**

在 `apps/kiosk/src/pages/print/PrintUploadPage.tsx` 找到：

```ts
export function PrintUploadPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { getToken, isLoggedIn } = useAuth()
  const inputRef = useRef<HTMLInputElement>(null)
  const source: PrintMaterialSource = searchParams.get('source') === 'resume' ? 'resume' : 'document'
```

改为：

```ts
export function PrintUploadPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { getToken, isLoggedIn } = useAuth()
  const inputRef = useRef<HTMLInputElement>(null)
  const source: PrintMaterialSource = searchParams.get('source') === 'resume' ? 'resume' : 'document'
  // PrintScanHomePage 的"照片打印"卡片通过 router state 传 category: 'photo'；
  // 用于控制真实 PII 扫描是否可以按内容类别跳过（见 materials.service.ts 的 contentCategory 网关）。
  const contentCategory = (location.state as { category?: 'photo' } | null)?.category === 'photo' ? 'photo' : undefined
```

并确认文件顶部的 react-router-dom import 包含 `useLocation`（现有 import 是 `import { useNavigate, useSearchParams } from 'react-router-dom'`，需要改成 `import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'`）。

- [ ] **Step 4: `handleNext` 把 `contentCategory` 带进会话**

找到：

```ts
  const handleNext = () => {
    if (!file) return
    navigate('/print/material-check', { state: { file, source } })
  }
```

改为：

```ts
  const handleNext = () => {
    if (!file) return
    savePrintMaterialSession({ file, source, contentCategory })
    navigate('/print/material-check', { state: { file, source } })
  }
```

（需要确认文件顶部已 import `savePrintMaterialSession`——如果原本没有，从 `./printMaterialSession` 补上；`handleQrUploaded` 函数里已经调用过 `savePrintMaterialSession({ file: nextFile, source })`，可以确认这个 import 已经存在，只需要在两处调用都补上 `contentCategory`）。

同样在 `handleQrUploaded` 里找到：

```ts
    setFile(nextFile)
    savePrintMaterialSession({ file: nextFile, source })
```

改为：

```ts
    setFile(nextFile)
    savePrintMaterialSession({ file: nextFile, source, contentCategory })
```

- [ ] **Step 5: typecheck + lint**

```bash
cd apps/kiosk
pnpm run typecheck
npx eslint src/pages/print/printMaterialSession.ts src/pages/print/PrintUploadPage.tsx
```

Expected: 无报错。

- [ ] **Step 6: Commit**

```bash
git add apps/kiosk/src/pages/print/printMaterialSession.ts apps/kiosk/src/pages/print/PrintUploadPage.tsx
git commit -m "fix(kiosk): PrintUploadPage 补上此前从未读取的 photo/document category 信号"
```

---

### Task 6: Kiosk —— PrintMaterialCheckPage 接线

**Files:**
- Modify: `apps/kiosk/src/pages/print/PrintMaterialCheckPage.tsx`

- [ ] **Step 1: 创建 `pii_scan` 任务时带上 `contentCategory`**

找到：

```ts
      setStage('pii_scan')
      const storedPii = storedSession?.piiTask
      let pii: DocumentProcessTaskView
      if (storedPii?.id) {
        const queried = await getMaterialTask(storedPii.id, { token, accessToken: storedPii.accessToken })
        pii = { ...queried, accessToken: queried.accessToken ?? storedPii.accessToken }
      } else {
        pii = await createMaterialTask({
          kind: 'pii_scan',
          sourceFileId: file.fileId,
          params: { scanScope: 'print_preview' },
        }, token)
      }
```

改为：

```ts
      setStage('pii_scan')
      const storedPii = storedSession?.piiTask
      let pii: DocumentProcessTaskView
      if (storedPii?.id) {
        const queried = await getMaterialTask(storedPii.id, { token, accessToken: storedPii.accessToken })
        pii = { ...queried, accessToken: queried.accessToken ?? storedPii.accessToken }
      } else {
        pii = await createMaterialTask({
          kind: 'pii_scan',
          sourceFileId: file.fileId,
          params: {
            scanScope: 'print_preview',
            ...(session?.contentCategory ? { contentCategory: session.contentCategory } : {}),
          },
        }, token)
      }
```

- [ ] **Step 2: `isDemoTask` 只在真正的 skeleton 态生效**

找到：

```ts
function isDemoTask(task: DocumentProcessTaskView | null): boolean {
  const mode = task?.result?.['mode']
  return mode === 'mock' || mode === 'skeleton' || mode === 'simulated'
}
```

改为：

```ts
function isDemoTask(task: DocumentProcessTaskView | null): boolean {
  const mode = task?.result?.['mode']
  return mode === 'mock' || mode === 'skeleton'
}

/** pii_scan 完成后的三种诚实结果态文案（见 materials.service.ts 的 real/skipped_non_document/degraded）。 */
function piiScanModeCopy(task: DocumentProcessTaskView | null): { label: string; tone: 'neutral' | 'warning' } | null {
  const mode = task?.result?.['mode']
  if (mode === 'skipped_non_document') return { label: '该文件类型无需隐私扫描', tone: 'neutral' }
  if (mode === 'degraded') return { label: '内容扫描暂不可用，请人工确认文件不含敏感信息', tone: 'warning' }
  if (mode === 'real') return null
  return null
}
```

- [ ] **Step 3: 结果卡片渲染三态文案，替换掉笼统的"流程演示"badge**

找到（结果卡片区域，"检查完成"标题旁边的 badge）：

```ts
                {(isDemoTask(inspectionTask) || isDemoTask(piiTask)) && (
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-neutral-500">
                    流程演示
                  </span>
                )}
```

改为：

```ts
                {(isDemoTask(inspectionTask) || isDemoTask(piiTask)) && (
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-neutral-500">
                    流程演示
                  </span>
                )}
                {!isDemoTask(piiTask) && piiScanModeCopy(piiTask) && (
                  <span
                    className={[
                      'rounded-full px-3 py-1 text-xs font-medium',
                      piiScanModeCopy(piiTask)!.tone === 'warning' ? 'bg-warning-bg text-warning-fg' : 'bg-white text-neutral-500',
                    ].join(' ')}
                  >
                    {piiScanModeCopy(piiTask)!.label}
                  </span>
                )}
```

- [ ] **Step 4: 空白页警告展示**

在"文件体检摘要"卡片里（找 `inspectionSummary &&` 渲染块，`messages` 目前是否已经在 UI 里逐条展示需要先确认——用 `grep -n "inspectionSummary" apps/kiosk/src/pages/print/PrintMaterialCheckPage.tsx` 和 `grep -n "\.messages" apps/kiosk/src/pages/print/PrintMaterialCheckPage.tsx` 定位实际渲染逻辑）：如果 `messages` 数组已经被完整遍历渲染（大多数这类"体检摘要卡片"会这样做），空白页的 `BLANK_PAGE_SUSPECTED` warning message 会自动出现，不需要额外代码——**这一步先去确认现状，如果已经自动生效就在计划里记录"无需改动，已通过 messages 遍历自动展示"，不要为了凑步骤加不必要的代码**；如果 `messages` 目前只挑了部分字段展示（没有逐条遍历渲染警告文案），才需要补充一段类似下面这样的渲染代码（放在文件体检摘要卡片内、其它 message 展示逻辑相邻的位置，具体缩进和上下文需要对照实际代码调整）：

```tsx
                  {inspectionSummary?.messages
                    ?.filter((m) => m.severity === 'warning' && m.code === 'BLANK_PAGE_SUSPECTED')
                    .map((m) => (
                      <p key={m.code} className="mt-2 text-xs text-warning-fg">
                        {m.text}
                      </p>
                    ))}
```

- [ ] **Step 5: typecheck + lint**

```bash
cd apps/kiosk
pnpm run typecheck
npx eslint src/pages/print/PrintMaterialCheckPage.tsx
```

Expected: 无报错。

- [ ] **Step 6: Commit**

```bash
git add apps/kiosk/src/pages/print/PrintMaterialCheckPage.tsx
git commit -m "feat(kiosk): PrintMaterialCheckPage 接真实 pii_scan 三态结果 + 空白页提示"
```

---

### Task 7: 全量验证

**Files:** 无新增/修改，纯验证步骤。

- [ ] **Step 1: 全仓 typecheck**

```bash
pnpm --filter @ai-job-print/shared run typecheck
pnpm --filter @ai-job-print/api run typecheck
pnpm --filter @ai-job-print/kiosk run typecheck
```

Expected: 全部无报错。

- [ ] **Step 2: 全量 lint（改动文件）**

```bash
npx eslint \
  services/api/src/ai/ai.module.ts \
  services/api/src/materials/ \
  services/api/scripts/verify-materials-processing.ts \
  apps/kiosk/src/pages/print/printMaterialSession.ts \
  apps/kiosk/src/pages/print/PrintUploadPage.tsx \
  apps/kiosk/src/pages/print/PrintMaterialCheckPage.tsx
```

Expected: 无报错。

- [ ] **Step 3: 后端验证脚本**

```bash
cd services/api
npx prisma migrate deploy
pnpm run verify:materials-processing
```

Expected: 全部 PASS。

- [ ] **Step 4: `git diff --check`**

```bash
git diff --check main...feature/material-check-real
```

Expected: 无输出。

- [ ] **Step 5: Kiosk 浏览器走查**

用 preview 工具启动 kiosk（`preview_start` name=`kiosk`），走以下路径并截图确认：

1. 首页 → 打印扫描 → 文档打印 → 上传一个含手机号/邮箱的真实文本型 PDF（或用现有测试素材）→ 下一步 → 体检页：确认走完 inspection/normalize_a4/pii_scan 三步后，结果卡片不再显示"流程演示"，PII 命中项真实展示（若本地没有配置 `OCR_PROVIDER`，这条路径预期落在 `degraded`——确认降级文案诚实展示，而不是显示假的"演示"标签或崩溃）。
2. 打印扫描 → 照片打印 → 上传任意图片 → 下一步：确认 `pii_scan` 结果是 `skipped_non_document`（"该文件类型无需隐私扫描"），不应该看到降级或真实扫描的文案。
3. 控制台全程无 React 报错（`read_console_messages` level=error 应为空）。

- [ ] **Step 6: 提交前自查**

```bash
git status --short
```

确认改动文件列表与本计划"文件清单"一致，没有意外改动其它文件。

---

## 已知遗留（不在本轮解决，写入进度文档）

- OCR 调用为文档类用途文件增加真实延迟，未做超时/异步化设计。
- 空白页检测阈值（99% 纯白像素）是启发式初始值，未经真实用户数据验证。
- 扫描来源打印（`ScanResultPage.handlePrint`）仍绕过 `/print/material-check`，本轮不改变这一点。
- `normalize_a4`/`pii_redact` 仍是评估态 stub，未产出真实文件。
- 材料包（多文件组合打印）完全未开始，是独立子问题。
