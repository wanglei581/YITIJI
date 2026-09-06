/**
 * 包 A：诊断报告 / 修改清单导出闭环验证。
 *
 * 真实覆盖：Prisma 归属行、AiService 既有读取门禁、PDFKit 渲染、FilesService 落库、
 * 我的文档查询与本地对象存储。无 HTTP 监听、无外部模型、无生产写入。
 */
import 'dotenv/config'
import { createHash, randomUUID } from 'crypto'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { AuditService } from '../src/audit/audit.service'
import { AiService } from '../src/ai/ai.service'
import { ForbiddenException } from '@nestjs/common'
import type { MemberPrivacyService } from '../src/member-privacy/member-privacy.service'
import { ResumeReportExportController } from '../src/ai/resume-report-export.controller'
import { DiagnosisReportPdfService } from '../src/ai/resume/diagnosis-report-pdf.service'
import type { ResumeReport } from '../src/ai/interfaces/ai-provider.interface'
import { FilesService } from '../src/files/files.service'
import { MemberAssetsService } from '../src/member-assets/member-assets.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { StorageService } from '../src/storage/storage.service'

interface UnpdfApi {
  getDocumentProxy(data: Uint8Array): Promise<unknown>
  extractText(pdf: unknown, options: { mergePages: boolean }): Promise<{ text: string | string[] }>
}
// services/api 是 CommonJS；unpdf 的可用运行时入口由 require 导出。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const unpdf = require('unpdf') as UnpdfApi

let failed = 0
function pass(message: string) { console.log(`  PASS ${message}`) }
function fail(message: string) { failed += 1; console.error(`  FAIL ${message}`) }
function assert(condition: unknown, message: string) {
  if (condition) pass(message)
  else fail(message)
}

function errorCode(error: unknown): string | undefined {
  const candidate = error as { getResponse?: () => unknown; response?: unknown }
  const response = (typeof candidate.getResponse === 'function' ? candidate.getResponse() : candidate.response) as
    | { error?: { code?: string } }
    | undefined
  return response?.error?.code
}

async function expectCode(action: () => Promise<unknown>, code: string): Promise<boolean> {
  try {
    await action()
    return false
  } catch (error) {
    return errorCode(error) === code
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

async function pdfText(buffer: Buffer): Promise<string> {
  const proxy = await unpdf.getDocumentProxy(new Uint8Array(buffer))
  const extracted = await unpdf.extractText(proxy, { mergePages: true })
  return Array.isArray(extracted.text) ? extracted.text.join('\n') : extracted.text
}

async function main(): Promise<void> {
  console.log('\n=== 包 A：诊断报告与修改清单导出验证 ===')
  const storageDir = await mkdtemp(join(tmpdir(), 'resume-report-export-'))
  process.env['FILE_STORAGE_DRIVER'] = 'local'
  process.env['FILE_STORAGE_DIR'] = storageDir
  process.env['AI_PROVIDER'] = 'mock'

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const storage = new StorageService()
  const files = new FilesService(prisma, audit, storage)
  const pdf = new DiagnosisReportPdfService()
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const userA = `eu_export_a_${suffix}`
  const userB = `eu_export_b_${suffix}`
  const memberTask = `diag_member_${suffix}`
  const anonymousTask = `diag_anon_${suffix}`
  const expiredTask = `diag_expired_${suffix}`
  const pendingTask = `diag_pending_${suffix}`
  const anonymousToken = `anon-${suffix}`
  const taskIds = [memberTask, anonymousTask, expiredTask, pendingTask]
  const fileIds: string[] = []

  const report: ResumeReport = {
    sections: [
      { key: 'basic', label: '基础信息完整度', score: 9, maxScore: 10 },
      { key: 'objective', label: '求职目标清晰度', score: 7, maxScore: 10 },
      { key: 'experience', label: '经历表达清晰度', score: 4, maxScore: 10 },
      { key: 'quantification', label: '成果量化程度', score: 3, maxScore: 10 },
      { key: 'keyword', label: '岗位关键词覆盖', score: 6, maxScore: 10 },
      { key: 'readability', label: '版式与可读性', score: 8, maxScore: 10 },
    ],
    priorities: [{ focus: '先补成果', reason: '工作经历缺少可核对的结果' }],
    issues: [
      {
        id: 'I1', dim: 'experience', title: '经历没有交代结果',
        evidence: [{ blockKey: 'experience', lineIndex: 0, quote: '负责门店日常运营' }],
        impact: '读的人看不到具体做成了什么。', fixIt: '补充本人可以核实的结果。',
      },
      {
        id: 'I2', dim: 'objective', title: '目标方向较宽',
        evidence: [{ blockKey: 'objective', lineIndex: 0, quote: '求职意向 运营相关岗位' }],
        impact: '读的人不容易快速理解目标方向。', fixIt: '按本人意愿写清目标岗位。',
      },
      {
        id: 'I3', dim: 'basic', title: '基础信息可再核对',
        evidence: [{ blockKey: 'basic', lineIndex: 0, quote: '姓名 测试用户' }],
        impact: '遗漏会影响材料完整性。', fixIt: '逐项核对本人信息。',
      },
    ],
    contentBlocks: [
      { key: 'basic', label: '基础信息', lines: ['姓名 测试用户'] },
      { key: 'objective', label: '求职目标', lines: ['求职意向 运营相关岗位'] },
      { key: 'experience', label: '工作经历', lines: ['负责门店日常运营'] },
    ],
    riskNotes: ['避免把团队成果写成个人独立成果。'],
    suggestions: ['修改后重新检查分页和可读性。'],
    truncatedInput: true,
  }

  const otherProvider = { name: 'mock' } as never
  const mockProvider = { name: 'mock' } as never
  const empty = {} as never
  const ai = new AiService(
    mockProvider, otherProvider, otherProvider, otherProvider, otherProvider, otherProvider, otherProvider,
    { record: () => undefined } as never, empty, empty, empty, empty, files, prisma, audit, empty, empty,
  )
  const jwt = {
    verify: (token: string) => {
      if (token === 'member-a') return { sub: userA, jti: `session-a-${suffix}` }
      if (token === 'member-b') return { sub: userB, jti: `session-b-${suffix}` }
      throw new Error('invalid token')
    },
  }
  const redis = {
    get: async (key: string) => key.includes(`session-a-${suffix}`) ? userA : key.includes(`session-b-${suffix}`) ? userB : null,
    unregisterMemberSession: async () => undefined,
  }
  // 契约 2：会员导出前必须有 resume_ai 授权。用假 privacy 记录调用次数，并在一条用例里让它拒绝。
  const consentCalls: string[] = []
  let consentReject = false
  const privacy = {
    requireActiveConsent: async (endUserId: string, scope: string) => {
      consentCalls.push(`${endUserId}:${scope}`)
      if (consentReject) throw new ForbiddenException({ error: { code: 'AI_CONSENT_REQUIRED', message: '需先授权' } })
    },
  } as unknown as MemberPrivacyService
  const controller = new ResumeReportExportController(ai, pdf, files, jwt as never, redis as never, prisma, audit, privacy)

  try {
    await prisma.aiResumeResult.deleteMany({ where: { taskId: { in: taskIds } } })
    await prisma.endUser.deleteMany({ where: { id: { in: [userA, userB] } } })
    await prisma.endUser.create({
      data: { id: userA, phoneHash: `export-a-${suffix}`, phoneEnc: `enc-a-${suffix}`, nickname: '会员A' },
    })
    await prisma.endUser.create({
      data: { id: userB, phoneHash: `export-b-${suffix}`, phoneEnc: `enc-b-${suffix}`, nickname: '会员B' },
    })

    const sourcePdf = await pdf.render({ taskId: `source-${suffix}`, kind: 'change_list', report, generatedAt: new Date() })
    const memberSource = await files.upload({
      buffer: sourcePdf.buffer, filename: 'source-member.pdf', mimeType: 'application/pdf', purpose: 'resume_upload',
      sensitiveLevel: 'highly_sensitive', uploaderId: null, endUserId: userA, createdBy: 'verify_resume_report_export',
    })
    const anonymousSource = await files.upload({
      buffer: sourcePdf.buffer, filename: 'source-anonymous.pdf', mimeType: 'application/pdf', purpose: 'resume_upload',
      sensitiveLevel: 'highly_sensitive', uploaderId: null, endUserId: null, createdBy: 'verify_resume_report_export',
    })
    fileIds.push(memberSource.fileId, anonymousSource.fileId)

    const future = new Date(Date.now() + 60 * 60 * 1000)
    const past = new Date(Date.now() - 60 * 1000)
    await prisma.aiResumeResult.createMany({ data: [
      {
        taskId: memberTask, kind: 'parse', status: 'completed', provider: 'llm', endUserId: userA,
        accessTokenHash: null, expiresAt: future,
        payloadJson: JSON.stringify({ taskId: memberTask, status: 'completed', fileId: memberSource.fileId, report,
          extractionNotice: { textSource: 'pdf_ocr', confidence: 'low', warnings: ['扫描文字置信度有限，请人工核对。'] } }),
      },
      {
        taskId: memberTask, kind: 'optimize', status: 'completed', provider: 'llm', endUserId: userA,
        accessTokenHash: null, expiresAt: future,
        payloadJson: JSON.stringify({ taskId: memberTask, status: 'completed', modules: [
          { title: '工作经历', before: '负责门店日常运营', after: '负责门店日常运营，并补充本人可核实的结果' },
        ], optimizedResume: { basic: { name: '测试 用户' }, intention: { position: '运营' }, summary: '', education: [], experience: [], projects: [], skills: [], certificates: [] } }),
      },
      {
        taskId: anonymousTask, kind: 'parse', status: 'completed', provider: 'llm', endUserId: null,
        accessTokenHash: hash(anonymousToken), expiresAt: future,
        payloadJson: JSON.stringify({ taskId: anonymousTask, status: 'completed', fileId: anonymousSource.fileId, report }),
      },
      {
        taskId: expiredTask, kind: 'parse', status: 'completed', provider: 'llm', endUserId: userA,
        accessTokenHash: null, expiresAt: past,
        payloadJson: JSON.stringify({ taskId: expiredTask, status: 'completed', report }),
      },
      {
        taskId: pendingTask, kind: 'parse', status: 'processing', provider: 'llm', endUserId: userA,
        accessTokenHash: null, expiresAt: future,
        payloadJson: JSON.stringify({ taskId: pendingTask, status: 'processing' }),
      },
    ] })

    const memberResult = await controller.export(memberTask, { kind: 'diagnosis_report' }, {
      headers: { authorization: 'Bearer member-a' },
    })
    fileIds.push(memberResult.fileId)
    const memberFile = await prisma.fileObject.findUnique({ where: { id: memberResult.fileId } })
    const memberBuffer = await readFile(join(storageDir, memberFile!.storageKey))
    const diagnosisText = await pdfText(memberBuffer)
    const documents = await new MemberAssetsService(prisma).listDocuments(userA, { cursor: null, pageSize: 50 })
    const memberPathOk = Boolean(
      memberResult.savedToDocuments && memberResult.aiGenerated && memberResult.mimeType === 'application/pdf' &&
      memberResult.filename === 'AI诊断报告_测试用户.pdf' && memberResult.pageCount > 0 &&
      memberResult.printFileUrl.includes(`/files/${memberResult.fileId}/content`) &&
      memberFile?.purpose === 'print_doc' && memberFile.assetCategory === 'derived' &&
      memberFile.sourceFileId === memberSource.fileId && memberFile.createdBy === 'ai_resume_diagnosis_export' &&
      memberFile.endUserId === userA && documents.items.some((item) => item.id === memberResult.fileId) &&
      diagnosisText.includes('AI 生成，仅供参考，请自行核对') &&
      diagnosisText.includes('严重度：高') && diagnosisText.includes('严重度：中') && diagnosisText.includes('严重度：低') &&
      diagnosisText.includes('扫描文字置信度有限，请人工核对') && diagnosisText.includes('本次诊断只处理了简历前部内容')
    )
    assert(memberPathOk, '会员路径：真实 PDF + 派生血缘 + 我的文档 + 文件名/页眉/严重度/OCR/截断说明')

    const changeResult = await controller.export(memberTask, { kind: 'change_list' }, {
      headers: { authorization: 'Bearer member-a' },
    })
    fileIds.push(changeResult.fileId)
    const changeFile = await prisma.fileObject.findUnique({ where: { id: changeResult.fileId } })
    const changeText = await pdfText(await readFile(join(storageDir, changeFile!.storageKey)))
    assert(
      changeResult.filename === '修改清单_测试用户.pdf' && changeText.includes('请回自己的 Word 里改') &&
      changeText.includes('修改前：负责门店日常运营') && changeText.includes('建议后：负责门店日常运营，并补充本人可核实的结果'),
      '修改清单：复用已存在 optimize before/after，不触发临时生成',
    )

    const anonymousResult = await controller.export(anonymousTask, { kind: 'diagnosis_report' }, {
      headers: { 'x-resume-access-token': anonymousToken },
    })
    fileIds.push(anonymousResult.fileId)
    const anonymousFile = await prisma.fileObject.findUnique({ where: { id: anonymousResult.fileId } })
    const anonymousPathOk = Boolean(
      !anonymousResult.savedToDocuments && anonymousFile?.endUserId === null && anonymousFile.ownerType === 'system' &&
      anonymousFile.sourceFileId === anonymousSource.fileId && !documents.items.some((item) => item.id === anonymousResult.fileId)
    )
    assert(anonymousPathOk, '匿名路径：正确 accessToken 可导出，savedToDocuments=false 且不进入会员文档')

    const expiredOk = await expectCode(
      () => controller.export(expiredTask, { kind: 'diagnosis_report' }, { headers: { authorization: 'Bearer member-a' } }),
      'AI_TASK_NOT_FOUND',
    )
    assert(expiredOk, '过期路径：统一 AI_TASK_NOT_FOUND，不生成文件')

    const unauthorizedOk = await expectCode(
      () => controller.export(memberTask, { kind: 'diagnosis_report' }, { headers: { authorization: 'Bearer member-b' } }),
      'AI_TASK_NOT_FOUND',
    )
    assert(unauthorizedOk, '越权路径：跨会员统一 AI_TASK_NOT_FOUND，不泄露任务存在性')

    // 契约 2：会员路径必须过 requireActiveConsent；被拒时 403 且不落文件
    assert(consentCalls.some((c) => c.endsWith(':resume_ai')), '会员导出调用了 requireActiveConsent(resume_ai)')
    const uploadsBeforeConsentReject = await prisma.fileObject.count({ where: { createdBy: 'ai_resume_diagnosis_export' } })
    consentReject = true
    const consentBlocked = await expectCode(
      () => controller.export(memberTask, { kind: 'diagnosis_report' }, { headers: { authorization: 'Bearer member-a' } }),
      'AI_CONSENT_REQUIRED',
    )
    consentReject = false
    const uploadsAfterConsentReject = await prisma.fileObject.count({ where: { createdBy: 'ai_resume_diagnosis_export' } })
    assert(consentBlocked && uploadsAfterConsentReject === uploadsBeforeConsentReject, '无授权：403 AI_CONSENT_REQUIRED 且不落文件')

    const uploadsBeforeFontFailure = await prisma.fileObject.count({ where: { createdBy: 'ai_resume_diagnosis_export' } })
    const missingFontPdf = {
      render: (input: Parameters<DiagnosisReportPdfService['render']>[0]) =>
        pdf.render(input, { fontCandidates: [{ path: join(storageDir, 'missing-font.ttf') }] }),
    }
    const missingFontController = new ResumeReportExportController(
      ai, missingFontPdf as DiagnosisReportPdfService, files, jwt as never, redis as never, prisma, audit, privacy,
    )
    const fontOk = await expectCode(
      () => missingFontController.export(memberTask, { kind: 'diagnosis_report' }, { headers: { authorization: 'Bearer member-a' } }),
      'RESUME_PDF_FONT_NOT_FOUND',
    )
    const uploadsAfterFontFailure = await prisma.fileObject.count({ where: { createdBy: 'ai_resume_diagnosis_export' } })
    assert(fontOk && uploadsAfterFontFailure === uploadsBeforeFontFailure, '缺字体路径：503 业务码且上传前失败，不落空文件')

    const pendingOk = await expectCode(
      () => controller.export(pendingTask, { kind: 'diagnosis_report' }, { headers: { authorization: 'Bearer member-a' } }),
      'AI_RESULT_NOT_READY',
    )
    assert(pendingOk, '未就绪路径：返回 AI_RESULT_NOT_READY')

    const source = await import('fs').then(({ readFileSync }) => readFileSync(join(__dirname, '../src/ai/resume-report-export.controller.ts'), 'utf8'))
    assert(
      source.includes("@Controller('resume/records')") && source.includes("@Post(':taskId/export')") &&
      /body\??\.kind !== 'diagnosis_report'/.test(source) && /body\??\.kind !== 'change_list'/.test(source),
      '静态契约：POST /resume/records/:taskId/export 仅接受两种 kind',
    )
  } finally {
    for (const fileId of [...fileIds].reverse()) {
      try { await files.systemDelete(fileId, 'verify_cleanup') } catch { /* best effort */ }
    }
    await prisma.aiResumeResult.deleteMany({ where: { taskId: { in: taskIds } } })
    await prisma.fileObject.deleteMany({ where: { id: { in: fileIds } } })
    await prisma.endUser.deleteMany({ where: { id: { in: [userA, userB] } } })
    await prisma.onModuleDestroy()
    await rm(storageDir, { recursive: true, force: true })
  }

  if (failed > 0) {
    console.error(`\n=== FAILED (${failed} 项) ===`)
    process.exit(1)
  }
  console.log('\n=== ALL PASS ===')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
