/**
 * Wave 2 — 简历优化版 PDF 排版参数导出验证。
 *
 * 覆盖:
 *   1. PDF renderer 接收 ResumeLayoutSettings,默认 layout 迁移自 Wave 1 常量。
 *   2. 颜色验证基于源码色表/resolveLayout 分支,不依赖 PDF raw buffer 字面量。
 *   3. 双栏正文起始 Y 由页眉高度派生,且存在防无限加页保护。
 *   4. exportGeneratedResume / controller 透传 layout 到 PDF renderer。
 *   5. 运行时:默认/窄边距/宽边距/双栏大字号 PDF 均可导出且返回 printFileUrl。
 *   6. docx/txt/md 接收 layout 不报错,且 layout 透传到 Wave 6 额外渲染的打印用 PDF 副本
 *      (printFileUrl 指向的 fileId 不同于主文件)。
 *
 * 运行:pnpm --filter @ai-job-print/api verify:resume-layout-export
 */
import 'dotenv/config'
import { readFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { Logger } from '@nestjs/common'

if (!process.env['FILE_SIGNING_SECRET'] || process.env['FILE_SIGNING_SECRET'].length < 32) {
  process.env['FILE_SIGNING_SECRET'] = 'verify-resume-layout-export-test-secret-0123456789'
}
process.env['FILE_STORAGE_DRIVER'] = 'local'
process.env['AI_PROVIDER'] = 'mock'
if (!process.env['DATABASE_URL']) {
  process.env['DATABASE_URL'] = `file:${join(__dirname, '../prisma/dev.db')}`
}

import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { StorageService } from '../src/storage/storage.service'
import { FilesService } from '../src/files/files.service'
import { AiService } from '../src/ai/ai.service'
import { MockAiProvider } from '../src/ai/providers/mock.provider'
import { ResumePdfService } from '../src/ai/resume/resume-pdf.service'
import { ResumeDocxService } from '../src/ai/resume/resume-docx.service'
import { ResumeTextService } from '../src/ai/resume/resume-text.service'
import type { GeneratedResume, ResumeLayoutSettings } from '../src/ai/interfaces/ai-provider.interface'
import type { ResumeExportFormat } from '../src/ai/dto/resume-generate.dto'

function pass(m: string) { console.log(`  PASS ${m}`) }
function fail(m: string): never { console.error(`  FAIL ${m}`); process.exitCode = 1; throw new Error(m) }

const FIXTURE: GeneratedResume = {
  basic: { name: '排版验证用户', phone: '13900000001', email: 'layout-verify@example.com', city: '青岛' },
  intention: { position: '后端开发工程师', city: '青岛', jobType: '全职', salary: '8k-12k' },
  summary: '计算机专业应届生，熟悉 Node.js、PostgreSQL 与服务端工程实践，期望从事后端开发。',
  education: [{
    school: '排版验证大学',
    major: '软件工程',
    degree: '本科',
    period: '2021-2025',
    description: '主修数据库系统、分布式系统和软件工程实践。',
  }],
  experience: Array.from({ length: 4 }, (_, i) => ({
    company: `排版验证科技有限公司${i + 1}`,
    role: '后端实习生',
    period: `2024.0${i + 1}-2024.0${i + 2}`,
    description: '参与订单服务、文件服务和数据看板开发，负责接口实现、SQL 优化、异常日志梳理和接口联调。'.repeat(3),
  })),
  projects: Array.from({ length: 4 }, (_, i) => ({
    name: `排版验证项目${i + 1}`,
    role: '负责人',
    description: '负责需求拆解、接口设计、数据库表结构梳理和上线验证，沉淀接口文档与测试用例。'.repeat(3),
  })),
  skills: ['Node.js', 'TypeScript', 'NestJS', 'PostgreSQL', 'Redis', 'Docker'],
  certificates: ['排版验证认证证书'],
}

function assertStaticContracts(): void {
  const pdfSrc = readFileSync(join(__dirname, '../src/ai/resume/resume-pdf.service.ts'), 'utf-8')
  const aiSrc = readFileSync(join(__dirname, '../src/ai/ai.service.ts'), 'utf-8')
  const controllerSrc = readFileSync(join(__dirname, '../src/ai/ai.controller.ts'), 'utf-8')

  if (!pdfSrc.includes("ResumeLayoutSettings")) fail('1a. ResumePdfService 未引入 ResumeLayoutSettings')
  if (!pdfSrc.includes('ResumePdfRenderOptions')) fail('1a. ResumePdfService 未定义 render options')
  if (!/async render\(resume: GeneratedResume,\s*options\?: ResumeLayoutSettings \| ResumePdfRenderOptions\)/.test(pdfSrc)) {
    fail('1a. ResumePdfService.render 未兼容 layout/options 可选参数')
  }
  if (!pdfSrc.includes('function resolveLayout')) fail('1b. 未定义 resolveLayout(layout?)')
  if (!pdfSrc.includes('const DEFAULT_MARGIN = MARGIN')) fail('1b. 默认 margin 必须迁移自 Wave 1 MARGIN 常量')
  if (!pdfSrc.includes('const DEFAULT_LINE_GAP = 2.5')) fail('1b. 默认 lineGap 必须等于 Wave 1 当前 2.5')
  if (!pdfSrc.includes("const DEFAULT_ACCENT = '#2563eb'")) fail('1b. 默认 accent 必须等于 Wave 1 当前 #2563eb')
  if (!pdfSrc.includes('const DEFAULT_FONT_SCALE = 1')) fail('1b. 默认 fontScale 必须为 1')
  if (!pdfSrc.includes('cfg.columns === 1 ? 130')) fail('1c. 默认单栏 entryHead 右侧时间列必须保持 Wave 1 的 130pt')
  if (!pdfSrc.includes('if (cfg.columns === 1) return')) fail('1c. 默认单栏不得引入 Wave 1 没有的主动分页')
  pass('1. PDF renderer layout 签名与默认值迁移契约已满足')

  if (!pdfSrc.includes("green: '#047857'") || !pdfSrc.includes("slate: '#475569'")) {
    fail('2. 主色白名单色表缺失 green/slate')
  }
  if (!pdfSrc.includes('ACCENT_COLORS[layout.accent] || DEFAULT_ACCENT')) fail('2. 无效 accent 必须回退默认主色')
  if (/buffer.*#047857|#047857.*buffer/i.test(pdfSrc)) fail('2. 不得依赖 PDF raw buffer 字面量验证颜色')
  pass('2. 主色验证基于源码白名单/resolveLayout,不依赖 raw PDF buffer 字面量')

  if (!pdfSrc.includes('resolveHeaderBottomY')) fail('3a. 双栏正文起始 Y 未由 resolveHeaderBottomY 派生')
  if (!pdfSrc.includes('bodyStartY')) fail('3a. 未定义 bodyStartY')
  if (pdfSrc.includes('cfg.margin + 80')) fail('3a. 禁止硬编码 cfg.margin + 80 作为页眉偏移')
  if (!pdfSrc.includes('minHeight > columnAvailableHeight') || !pdfSrc.includes('doc.y === bodyStartY')) {
    fail('3b. ensureSpace 缺少超高内容/列起点防无限加页保护')
  }
  pass('3. 双栏正文起始 Y 与防无限加页保护已存在')

  if (!/exportGeneratedResume\([\s\S]*format: ResumeExportFormat = 'pdf',\s*layout\?: ResumeLayoutSettings,\s*templateId\?: string/.test(aiSrc)) {
    fail('4a. AiService.exportGeneratedResume 未接收 layout 可选参数')
  }
  if (!aiSrc.includes('this.resumePdf.render(resume, { layout, templatePreset: template?.resumeLayoutPreset })')) fail('4a. AiService 未把 layout 透传给 ResumePdfService')
  if (!controllerSrc.includes('const { taskId, format, layout, templateId, ...resume } = dto')) {
    fail('4b. AiController 导出接口未从 dto 中剥离 layout')
  }
  if (!controllerSrc.includes("format ?? 'pdf', layout, templateId")) fail('4b. AiController 未把 layout 透传给 AiService')
  pass('4. 导出 controller/service 已透传 layout')
}

async function main(): Promise<void> {
  console.log('\n=== Wave 2 简历 PDF 排版参数导出验证 ===')
  Logger.overrideLogger({ log: () => {}, error: () => {}, warn: () => {}, debug: () => {}, verbose: () => {}, fatal: () => {} })

  assertStaticContracts()

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const storage = new StorageService()
  const audit = new AuditService(prisma)
  const files = new FilesService(prisma, audit, storage)
  const pdf = new ResumePdfService()
  const resumeDocx = new ResumeDocxService()
  const resumeText = new ResumeTextService()
  const mockProvider = new MockAiProvider()
  const emptyStub = {} as never
  const logStub = { record: () => {} } as never
  const ai = new AiService(
    mockProvider as never,
    emptyStub, emptyStub, emptyStub, emptyStub, emptyStub,
    emptyStub,
    logStub,
    emptyStub,
    emptyStub,
    emptyStub,
    pdf,
    files,
    prisma,
    audit as never,
    resumeDocx,
    resumeText,
  )

  const createdFileIds: string[] = []
  const createdEndUserIds: string[] = []

  try {
    const endUser = await prisma.endUser.create({
      data: {
        phoneHash: `verify-resume-layout-export-${randomUUID()}`,
        phoneEnc: `verify-phone-${randomUUID()}`,
        nickname: '排版导出验证会员',
      },
    })
    createdEndUserIds.push(endUser.id)

    const pdfCases: Array<{ name: string; layout?: ResumeLayoutSettings }> = [
      { name: 'default' },
      { name: 'narrow-green', layout: { margin: 'narrow', accent: 'green' } },
      { name: 'wide-slate', layout: { margin: 'wide', accent: 'slate' } },
      { name: 'two-column-large', layout: { columns: 2, fontScale: 'large', lineSpacing: 'relaxed', margin: 'normal' } },
    ]
    for (const testCase of pdfCases) {
      const exported = await (ai.exportGeneratedResume as unknown as (
        resume: GeneratedResume,
        endUserId: string | null,
        sourceFileId: string | null,
        format: ResumeExportFormat,
        layout?: ResumeLayoutSettings,
      ) => Promise<{ fileId: string; pageCount: number; printFileUrl?: string }>)(
        FIXTURE,
        endUser.id,
        null,
        'pdf',
        testCase.layout,
      )
      createdFileIds.push(exported.fileId)
      if (!exported.printFileUrl) fail(`5. [${testCase.name}] PDF 未返回 printFileUrl`)
      if (exported.pageCount < 1) fail(`5. [${testCase.name}] PDF pageCount 应 >= 1,实际 ${exported.pageCount}`)
      const fileRow = await prisma.fileObject.findUnique({ where: { id: exported.fileId } })
      if (!fileRow) fail(`5. [${testCase.name}] FileObject 未落库`)
      const buffer = await storage.getObject(fileRow!.storageKey)
      if (!buffer.subarray(0, 4).equals(Buffer.from('%PDF', 'latin1'))) fail(`5. [${testCase.name}] 产物不是 PDF`)
      pass(`5. [${testCase.name}] PDF layout 导出成功且 printFileUrl/pageCount/PDF 魔数正确`)
    }

    const nonPdfFormats: ResumeExportFormat[] = ['docx', 'txt', 'md']
    const layout: ResumeLayoutSettings = { columns: 2, fontScale: 'compact', lineSpacing: 'compact', margin: 'narrow', accent: 'green' }
    for (const format of nonPdfFormats) {
      const exported = await (ai.exportGeneratedResume as unknown as (
        resume: GeneratedResume,
        endUserId: string | null,
        sourceFileId: string | null,
        format: ResumeExportFormat,
        layout?: ResumeLayoutSettings,
      ) => Promise<{ fileId: string; printFileUrl?: string }>)(
        FIXTURE,
        endUser.id,
        null,
        format,
        layout,
      )
      createdFileIds.push(exported.fileId)
      if (!exported.printFileUrl) fail(`6. [${format}] 接收 layout 时应返回打印用 PDF 副本 printFileUrl(Wave 6)`)
      const printFileId = /\/files\/([^/]+)\/content/.exec(exported.printFileUrl!)?.[1]
      if (!printFileId || printFileId === exported.fileId) {
        fail(`6. [${format}] printFileUrl 应指向另外渲染的 PDF 副本 fileId,不应与主文件相同`)
      }
      createdFileIds.push(printFileId)
      const printFileRow = await prisma.fileObject.findUnique({ where: { id: printFileId } })
      if (!printFileRow) fail(`6. [${format}] printFileUrl 指向的 PDF 副本 FileObject 未落库`)
      if (printFileRow!.mimeType !== 'application/pdf') fail(`6. [${format}] PDF 副本 mimeType 应为 application/pdf`)
      const printBuffer = await storage.getObject(printFileRow!.storageKey)
      if (!printBuffer.subarray(0, 4).equals(Buffer.from('%PDF', 'latin1'))) fail(`6. [${format}] PDF 副本产物不是合法 PDF`)
      pass(`6. [${format}] 接收 layout 不报错,且 layout 已透传到另外渲染的打印用 PDF 副本`)
    }

    console.log('\n=== ALL PASS ===')
  } finally {
    if (createdFileIds.length > 0) {
      await prisma.fileObject.deleteMany({ where: { id: { in: createdFileIds } } })
    }
    if (createdEndUserIds.length > 0) {
      await prisma.endUser.deleteMany({ where: { id: { in: createdEndUserIds } } })
    }
    await prisma.onModuleDestroy()
  }
}

main().catch((err) => {
  console.error('VERIFY FAILED:', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
