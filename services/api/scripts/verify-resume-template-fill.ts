/**
 * Wave 3 — 简历模板库自动填充验证。
 *
 * 覆盖:
 *   1. shared/API 内置 resume_template 均携带 resumeLayoutPreset,并且模板契约一致。
 *   2. 导出 DTO / Controller / Service 已接入 templateId,但只允许 PDF 使用简历模板。
 *   3. PDF + resume_template 可真实导出,返回 FileObject + printFileUrl。
 *   4. 非简历模板 / 不存在模板用于 PDF 时明确 400,不静默 fallback。
 *   5. docx/txt/md 忽略 templateId,保持下载链路,不返回 printFileUrl。
 *
 * 运行: pnpm --filter @ai-job-print/api verify:resume-template-fill
 */
import 'dotenv/config'
import { readFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { BadRequestException, Logger } from '@nestjs/common'
import {
  JOB_MATERIAL_TEMPLATES as SHARED_JOB_MATERIAL_TEMPLATES,
  RESUME_TEMPLATE_SECTION_KEYS,
  type ResumeTemplate,
} from '../../../packages/shared/src/types/jobMaterials'
import {
  JOB_MATERIAL_TEMPLATES as API_JOB_MATERIAL_TEMPLATES,
  findJobMaterialTemplate,
} from '../src/job-materials/job-material-templates'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { StorageService } from '../src/storage/storage.service'
import { FilesService } from '../src/files/files.service'
import { AiService } from '../src/ai/ai.service'
import { MockAiProvider } from '../src/ai/providers/mock.provider'
import { ResumePdfService } from '../src/ai/resume/resume-pdf.service'
import { ResumeDocxService } from '../src/ai/resume/resume-docx.service'
import { ResumeTextService } from '../src/ai/resume/resume-text.service'
import type { GeneratedResume } from '../src/ai/interfaces/ai-provider.interface'
import type { ResumeExportFormat } from '../src/ai/dto/resume-generate.dto'

if (!process.env['FILE_SIGNING_SECRET'] || process.env['FILE_SIGNING_SECRET'].length < 32) {
  process.env['FILE_SIGNING_SECRET'] = 'verify-resume-template-fill-secret-0123456789'
}
process.env['FILE_STORAGE_DRIVER'] = 'local'
process.env['AI_PROVIDER'] = 'mock'
if (!process.env['DATABASE_URL']) {
  process.env['DATABASE_URL'] = `file:${join(__dirname, '../prisma/dev.db')}`
}

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function fail(message: string): never {
  console.error(`  FAIL ${message}`)
  process.exitCode = 1
  throw new Error(message)
}

function readApi(relativePath: string): string {
  return readFileSync(join(__dirname, '..', relativePath), 'utf-8')
}

function expectUnsupportedTemplate(err: unknown, label: string): void {
  if (!(err instanceof BadRequestException)) fail(`${label}: 期望 BadRequestException`)
  const response = err.getResponse()
  const code = typeof response === 'object' && response !== null
    ? (response as { error?: { code?: string } }).error?.code
    : null
  if (code !== 'AI_RESUME_TEMPLATE_UNSUPPORTED') {
    fail(`${label}: 错误码应为 AI_RESUME_TEMPLATE_UNSUPPORTED,实际 ${String(code)}`)
  }
  pass(`${label}: 非法 PDF 模板明确 400,不静默 fallback`)
}

const FIXTURE: GeneratedResume = {
  basic: { name: '模板填充验证用户', phone: '13900000000', email: 'template-verify@example.com', city: '青岛' },
  intention: { position: '后端开发工程师', city: '青岛', jobType: '全职', salary: '8k-12k' },
  summary: '计算机专业应届生，目标岗位为后端开发工程师，具备扎实的工程基础。',
  education: [{
    school: '模板验证大学',
    major: '软件工程',
    degree: '本科',
    period: '2021-2025',
    description: '主修分布式系统与数据库原理。',
  }],
  experience: [{
    company: '模板验证科技有限公司',
    role: '后端实习生',
    period: '2024.07-2024.12',
    description: '参与订单服务开发，负责接口性能优化。',
  }],
  projects: [{
    name: '模板验证订单系统',
    role: '负责人',
    description: '主导订单系统微服务化改造，覆盖下单与库存扣减链路。',
  }],
  skills: ['Node.js', 'PostgreSQL'],
  certificates: ['模板验证认证证书'],
}

async function main(): Promise<void> {
  console.log('\n=== Wave 3 简历模板库自动填充验证 ===')
  Logger.overrideLogger({ log: () => {}, error: () => {}, warn: () => {}, debug: () => {}, verbose: () => {}, fatal: () => {} })

  const sharedResumeTemplates = SHARED_JOB_MATERIAL_TEMPLATES.filter((template): template is ResumeTemplate => template.type === 'resume_template')
  if (sharedResumeTemplates.length < 1) fail('shared 至少应有一个 resume_template')
  const apiResumeTemplates = API_JOB_MATERIAL_TEMPLATES.filter((template) => template.type === 'resume_template')
  if (apiResumeTemplates.length !== sharedResumeTemplates.length) {
    fail(`API/shared resume_template 数量不一致: api=${apiResumeTemplates.length}, shared=${sharedResumeTemplates.length}`)
  }

  for (const sharedTemplate of sharedResumeTemplates) {
    const apiTemplate = findJobMaterialTemplate(sharedTemplate.id)
    if (!apiTemplate) fail(`API 缺少 shared 模板 ${sharedTemplate.id}`)
    if (apiTemplate.type !== 'resume_template') fail(`${sharedTemplate.id} API 类型应为 resume_template`)
    if (!apiTemplate.resumeLayoutPreset) fail(`${sharedTemplate.id} API 缺少 resumeLayoutPreset`)
    if (JSON.stringify(apiTemplate.resumeLayoutPreset) !== JSON.stringify(sharedTemplate.resumeLayoutPreset)) {
      fail(`${sharedTemplate.id} API/shared resumeLayoutPreset 不一致`)
    }
    const invalidSection = apiTemplate.resumeLayoutPreset.sectionOrder.find((key) => !RESUME_TEMPLATE_SECTION_KEYS.includes(key))
    if (invalidSection) fail(`${sharedTemplate.id} sectionOrder 含非法 section: ${invalidSection}`)
    if (!apiTemplate.resumeLayoutPreset.sectionOrder.includes('header')) fail(`${sharedTemplate.id} sectionOrder 必须包含 header`)
    if (!apiTemplate.resumeLayoutPreset.sectionOrder.includes('experience')) fail(`${sharedTemplate.id} sectionOrder 必须包含 experience`)
    if (new Set(apiTemplate.resumeLayoutPreset.sectionOrder).size !== apiTemplate.resumeLayoutPreset.sectionOrder.length) {
      fail(`${sharedTemplate.id} sectionOrder 不得重复`)
    }
  }
  pass('1. shared/API resume_template 均携带一致的 resumeLayoutPreset')

  const dtoSrc = readApi('src/ai/dto/resume-generate.dto.ts')
  if (!/@MaxLength\(80\)\s*\n\s*templateId\?: string/.test(dtoSrc)) fail('2a. ResumeGenerateExportDto 未接入 templateId 长度限制')
  pass('2a. ResumeGenerateExportDto 接入 templateId 可选字段')

  const controllerSrc = readApi('src/ai/ai.controller.ts')
  if (!controllerSrc.includes('templateId') || !/exportGeneratedResume\([\s\S]*templateId/.test(controllerSrc)) {
    fail('2b. AiController 未把 templateId 透传到 exportGeneratedResume')
  }
  pass('2b. AiController 透传 templateId')

  const serviceSrc = readApi('src/ai/ai.service.ts')
  if (!serviceSrc.includes("format === 'pdf' && templateId")) fail('2c. AiService 未限制 templateId 仅 PDF 生效')
  if (!serviceSrc.includes('AI_RESUME_TEMPLATE_UNSUPPORTED')) fail('2c. AiService 缺少非法模板错误码')
  if (!serviceSrc.includes('template?.resumeLayoutPreset')) fail('2c. AiService 未把模板 preset 传给 PDF renderer')
  pass('2c. AiService 模板门禁和 PDF preset 传递已接线')

  const pdfSrc = readApi('src/ai/resume/resume-pdf.service.ts')
  if (!pdfSrc.includes('templatePreset?: ResumeTemplateLayoutPreset')) fail('2d. ResumePdfService 未定义 templatePreset 选项')
  if (!pdfSrc.includes('templatePreset?.sectionOrder')) fail('2d. ResumePdfService 未读取模板 sectionOrder')
  if (!pdfSrc.includes('for (const sectionKey of order)')) fail('2d. ResumePdfService 未按 sectionKey 顺序渲染模板区域')
  if (!pdfSrc.includes('all.indexOf(sectionKey) === index')) fail('2d. ResumePdfService 未对模板 sectionOrder 去重')
  pass('2d. ResumePdfService 使用模板 preset 控制布局默认值与区域顺序')

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
    emptyStub,
    emptyStub,
    emptyStub,
    emptyStub,
    emptyStub,
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
  const createdStorageObjects: Array<{ storageKey: string; bucket: string | null }> = []

  try {
    const endUser = await prisma.endUser.create({
      data: {
        phoneHash: `verify-resume-template-fill-${randomUUID()}`,
        phoneEnc: `verify-phone-${randomUUID()}`,
        nickname: '模板填充验证会员',
      },
    })
    createdEndUserIds.push(endUser.id)

    const pdfExport = await ai.exportGeneratedResume(
      FIXTURE,
      endUser.id,
      null,
      'pdf',
      { columns: 2, accent: 'green', margin: 'narrow', fontScale: 'compact', lineSpacing: 'standard' },
      'resume-template-clean',
    )
    createdFileIds.push(pdfExport.fileId)
    if (!pdfExport.printFileUrl) fail('3a. PDF 模板导出应返回 printFileUrl')
    if (!/^\/api\/v1\/files\/[^/]+\/content\?expires=\d+&sig=[0-9a-f]+$/.test(pdfExport.printFileUrl)) {
      fail(`3a. PDF printFileUrl 格式不正确: ${pdfExport.printFileUrl}`)
    }
    const pdfFile = await prisma.fileObject.findUnique({ where: { id: pdfExport.fileId } })
    if (!pdfFile) fail('3b. PDF 模板导出未创建 FileObject')
    createdStorageObjects.push({ storageKey: pdfFile.storageKey, bucket: pdfFile.bucket })
    if (pdfFile.assetCategory !== 'optimized') fail(`3b. assetCategory 应为 optimized,实际 ${pdfFile.assetCategory}`)
    if (pdfFile.createdBy !== 'ai_resume_generate') fail(`3b. createdBy 应为 ai_resume_generate,实际 ${pdfFile.createdBy}`)
    if (pdfFile.mimeType !== 'application/pdf') fail(`3b. mimeType 应为 application/pdf,实际 ${pdfFile.mimeType}`)
    if (pdfExport.pageCount < 1 || pdfExport.sizeBytes < 1024) fail('3b. PDF 模板导出页数/大小异常')
    pass('3. PDF + resume_template 可真实导出 FileObject,并返回系统 printFileUrl')

    await ai.exportGeneratedResume(FIXTURE, endUser.id, null, 'pdf', undefined, 'missing-template')
      .then(() => fail('4a. 不存在模板用于 PDF 应失败'))
      .catch((err) => expectUnsupportedTemplate(err, '4a. 不存在模板用于 PDF'))
    await ai.exportGeneratedResume(FIXTURE, endUser.id, null, 'pdf', undefined, 'campus-cover-letter')
      .then(() => fail('4b. 非简历模板用于 PDF 应失败'))
      .catch((err) => expectUnsupportedTemplate(err, '4b. 非简历模板用于 PDF'))

    const nonPdfFormats: ResumeExportFormat[] = ['docx', 'txt', 'md']
    for (const format of nonPdfFormats) {
      const exported = await ai.exportGeneratedResume(FIXTURE, endUser.id, null, format, undefined, 'campus-cover-letter')
      createdFileIds.push(exported.fileId)
      if (exported.printFileUrl !== undefined) fail(`5. ${format} 不应返回 printFileUrl`)
      const row = await prisma.fileObject.findUnique({ where: { id: exported.fileId } })
      if (!row) fail(`5. ${format} 未创建 FileObject`)
      createdStorageObjects.push({ storageKey: row.storageKey, bucket: row.bucket })
      if (row.assetCategory !== 'optimized') fail(`5. ${format} assetCategory 应为 optimized`)
      if (row.createdBy !== 'ai_resume_generate') fail(`5. ${format} createdBy 应为 ai_resume_generate`)
    }
    pass('5. docx/txt/md 带 templateId 仍走下载链路,不返回 printFileUrl')
  } finally {
    for (const object of createdStorageObjects) {
      await storage.deleteObject(object.storageKey, object.bucket).catch(() => undefined)
    }
    if (createdFileIds.length > 0) {
      await prisma.fileObject.deleteMany({ where: { id: { in: createdFileIds } } })
    }
    if (createdEndUserIds.length > 0) {
      await prisma.endUser.deleteMany({ where: { id: { in: createdEndUserIds } } })
    }
    await prisma.onModuleDestroy()
  }

  console.log('=== ALL PASS ===')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
