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
import { PDFDocument as PdfLibDocument } from 'pdf-lib'
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
import { openUnpdfDocument } from '../src/common/pdf/pdfjs-document'
import { StorageService } from '../src/storage/storage.service'
import { PrintPageCountService } from '../src/print-jobs/print-page-count.service'

interface UnpdfApi {
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
  const proxy = await openUnpdfDocument(new Uint8Array(buffer))
  const extracted = await unpdf.extractText(proxy, { mergePages: true })
  return Array.isArray(extracted.text) ? extracted.text.join('\n') : extracted.text
}

async function pdfPages(buffer: Buffer): Promise<string[]> {
  const proxy = await openUnpdfDocument(new Uint8Array(buffer))
  const extracted = await unpdf.extractText(proxy, { mergePages: false })
  return Array.isArray(extracted.text) ? extracted.text : [extracted.text]
}

async function assertRenderedExport(
  label: string,
  result: { fileId: string; pageCount: number; printFileUrl: string },
  buffer: Buffer,
  storedPageCount: number | null | undefined,
  pageCounter: PrintPageCountService,
): Promise<void> {
  const finalPdf = await PdfLibDocument.load(buffer)
  const actualPageCount = finalPdf.getPageCount()
  const pages = await pdfPages(buffer)
  const bodyPages = pages.map((page) => page
    .replace(/AI 生成，仅供参考，请自行核对/gu, '')
    .replace(/第\s*\d+\s*\/\s*\d+\s*页/gu, '')
    .replace(/\s+/gu, ''))
  const footerParts = pages.map((page) => {
    const match = page.match(/第\s*(\d+)\s*\/\s*(\d+)\s*页/u)
    return match ? { current: Number(match[1]), total: Number(match[2]) } : null
  })

  assert(result.pageCount === actualPageCount, `${label}：导出回传 pageCount=${result.pageCount} 等于 pdf-lib 最终页数 ${actualPageCount}`)
  assert(actualPageCount >= 3 && pages.length === actualPageCount, `${label}：夹具确实生成至少 3 页内容（${actualPageCount} 页）`)
  assert(bodyPages.every((page) => page.length > 0), `${label}：每页都有正文内容，没有只有页眉页脚的空白页`)
  assert(
    footerParts.length === actualPageCount && footerParts.every((part, index) => part?.current === index + 1 && part.total === actualPageCount),
    `${label}：每页页脚序号与最终页数一致（${actualPageCount}）`,
  )
  assert(storedPageCount === actualPageCount, `${label}：FileObject.pageCount=${String(storedPageCount)} 与 pdf-lib 页数一致`)
  const counted = await pageCounter.resolveBillablePages(result.printFileUrl)
  assert(counted.billablePages === actualPageCount, `${label}：报价/计费 PrintPageCountService=${counted.billablePages} 与 pdf-lib 页数一致`)
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
  const pageCounter = new PrintPageCountService(prisma, storage)
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
    priorities: [
      { focus: '先补成果', reason: '工作经历缺少可核对的结果和业务影响' },
      { focus: '收窄目标', reason: '把运营方向落到目标行业和岗位名称' },
      { focus: '补齐项目证据', reason: '让技能关键词能在项目或经历中找到对应依据' },
      { focus: '统一版式', reason: '统一日期、标题和项目符号，降低阅读成本' },
    ],
    issues: [
      {
        id: 'issue-objective-broad', dim: 'objective', title: '目标岗位范围过宽',
        evidence: [{ blockKey: 'objective', lineIndex: 0, quote: '求职意向：运营相关岗位' }],
        impact: '读的人无法判断你优先考虑用户运营、活动运营还是门店运营。',
        fixIt: '结合真实经历写出一个主目标岗位，并把可接受的相邻方向放在补充说明里。',
      },
      {
        id: 'issue-experience-duty', dim: 'experience', title: '经历写了职责但没有结果',
        evidence: [{ blockKey: 'experience', lineIndex: 0, quote: '负责门店日常运营，协助完成排班、陈列和活动执行。' }],
        impact: '职责覆盖面很大，但缺少规模、周期和结果，难以判断你的实际贡献。',
        fixIt: '按本人能核对的事实补充服务人数、活动场次、转化变化或流程改进结果。',
      },
      {
        id: 'issue-quantification-project', dim: 'quantification', title: '项目成果缺少量化依据',
        evidence: [{ blockKey: 'projects', lineIndex: 1, quote: '优化活动流程，提高执行效率。' }],
        impact: '“提高效率”没有说明基准和变化幅度，成果可信度不足。',
        fixIt: '如果本人有记录，写清处理时长、参与人数、完成场次或返工率变化；没有记录就保留可核对的过程事实。',
      },
      {
        id: 'issue-keyword-evidence', dim: 'keyword', title: '技能关键词缺少经历证据',
        evidence: [{ blockKey: 'skills', lineIndex: 0, quote: '熟悉 Excel、SQL、Python' }],
        impact: '技能区列出多个工具，但经历段落没有对应的使用场景，阅读者难以判断熟练程度。',
        fixIt: '只保留本人实际使用过的工具，并在项目或工作经历中补一条真实使用场景。',
      },
      {
        id: 'issue-readability-long', dim: 'readability', title: '经历段落过长，重点不突出',
        evidence: [{ blockKey: 'experience', lineIndex: 1, quote: '负责门店日常运营并协助多个活动，跟进供应商、整理数据、处理顾客反馈和培训新员工。' }],
        impact: '一段文字包含多个动作，关键信息被埋在并列事项中。',
        fixIt: '拆成两到三条要点，每条只表达一个动作和一个可核对结果。',
      },
      {
        id: 'issue-basic-contact', dim: 'basic', title: '联系方式需要统一核对',
        evidence: [{ blockKey: 'basic', lineIndex: 1, quote: '邮箱：chen.yuanan@example.com；电话：138 0013 8000' }],
        impact: '空格、分隔符和其他材料不一致时，容易在复制或打印后产生误读。',
        fixIt: '以本人当前使用的联系方式为准，统一电话分组和邮箱大小写后再导出。',
      },
      {
        id: 'issue-objective-summary', dim: 'objective', title: '开头概述没有落到目标方向',
        evidence: [{ blockKey: 'summary', lineIndex: 0, quote: '学习能力强，沟通能力好，愿意接受挑战。' }],
        impact: '这些表述适用于多数求职者，不能帮助阅读者快速理解你的目标岗位。',
        fixIt: '用真实经历说明你希望解决什么问题，再补一项与目标岗位相关的能力证据。',
      },
      {
        id: 'issue-experience-timeline', dim: 'experience', title: '经历时间线缺少解释',
        evidence: [{ blockKey: 'experience', lineIndex: 2, quote: '2023.07—2024.02 运营助理；2024.09—至今 门店运营' }],
        impact: '两段经历之间存在较长间隔，读者无法判断是否为学习、项目或其他安排。',
        fixIt: '如与求职相关，可用一行补充学习或项目经历；不相关时保持简洁并核对日期前后一致。',
      },
      {
        id: 'issue-quantification-vague', dim: 'quantification', title: '成果使用了无法核对的模糊词',
        evidence: [{ blockKey: 'experience', lineIndex: 3, quote: '显著提升顾客满意度，获得良好反馈。' }],
        impact: '“显著”和“良好”没有可复核的边界，容易让成果看起来像泛化宣传。',
        fixIt: '替换为本人能提供来源的事实，例如问卷数量、处理时长、复购记录或具体表扬事项。',
      },
      {
        id: 'issue-keyword-version', dim: 'keyword', title: '工具和方法的写法不一致',
        evidence: [{ blockKey: 'skills', lineIndex: 1, quote: 'Excel（函数、透视表）；Microsoft Office；数据分析' }],
        impact: '同一类能力分散在多个写法中，关键词检索和人工阅读都不够集中。',
        fixIt: '按工具、方法、应用场景三类整理，并删掉没有真实使用依据的泛化词。',
      },
      {
        id: 'issue-readability-heading', dim: 'readability', title: '标题层级和日期格式不统一',
        evidence: [{ blockKey: 'education', lineIndex: 0, quote: '教育经历 / 2020年9月-2024年6月 / 青岛理工大学' }],
        impact: '斜杠、短横线和中文日期混用，会让扫描式阅读变慢。',
        fixIt: '统一各段标题、日期和地点的顺序，导出前逐页检查换行和对齐。',
      },
      {
        id: 'issue-experience-role', dim: 'experience', title: '项目中的个人角色边界不清',
        evidence: [{ blockKey: 'projects', lineIndex: 2, quote: '参与校园就业服务小程序建设，负责需求沟通和测试。' }],
        impact: '“参与”无法区分你独立完成、协作完成和仅旁观的部分。',
        fixIt: '分别写明本人负责的环节、交付物和协作对象，不扩大团队成果为个人成果。',
      },
    ],
    contentBlocks: [
      { key: 'basic', label: '基础信息', lines: ['姓名 陈予安', '电话 138 0013 8000', '邮箱 chen.yuanan@example.com'] },
      { key: 'objective', label: '求职目标', lines: ['目标方向：用户运营 / 活动运营', '期望城市：青岛、济南'] },
      { key: 'summary', label: '个人概述', lines: ['有门店运营与校园项目协作经历，能够整理服务数据并跟进活动执行。'] },
      { key: 'experience', label: '工作经历', lines: ['2023.07—2024.02 运营助理', '负责门店日常运营并协助多个活动，跟进供应商、整理数据、处理顾客反馈和培训新员工。', '2024.09—至今 门店运营', '显著提升顾客满意度，获得良好反馈。'] },
      { key: 'projects', label: '项目经历', lines: ['校园就业服务小程序（课程项目）', '参与校园就业服务小程序建设，负责需求沟通和测试。', '优化活动流程，提高执行效率。'] },
      { key: 'skills', label: '技能', lines: ['熟悉 Excel、SQL、Python', 'Excel（函数、透视表）；Microsoft Office；数据分析'] },
      { key: 'education', label: '教育经历', lines: ['教育经历 / 2020年9月-2024年6月 / 青岛理工大学'] },
    ],
    riskNotes: [
      '避免把团队成果写成个人独立成果，尤其是项目和活动的参与人数、转化结果与收入数据。',
      '涉及顾客、学校或合作方的信息时，只保留求职材料确实需要且本人有权使用的内容。',
      '所有日期、数量和工具熟练度都应能回到本人经历或材料来源核对。',
    ],
    suggestions: [
      '修改后先用一页纸快速检查目标岗位、最近经历和联系方式，再逐页检查换行。',
      '请找一位了解你经历的人核对成果数字和个人角色，确认后再打印或发送。',
      '如果目标岗位变化较大，保留同一份事实底稿，分别调整开头概述和关键词顺序。',
    ],
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
          { title: '工作经历成果', before: '负责门店日常运营并协助多个活动', after: '负责门店日常运营，整理活动数据并补充本人可核实的执行结果' },
          { title: '目标方向', before: '求职意向：运营相关岗位', after: '目标方向：用户运营 / 活动运营，优先考虑零售与公共服务场景' },
          { title: '技能证据', before: '熟悉 Excel、SQL、Python', after: '使用 Excel 整理活动数据，并在校园项目中用 SQL 完成基础统计' },
          { title: '活动协作', before: '协助完成校园活动，获得良好反馈', after: '根据本人记录写清活动场次、负责环节、参与人数和反馈来源，不把团队结果写成个人独立成果' },
          { title: '项目角色', before: '参与校园就业服务小程序建设', after: '写明本人负责需求沟通和测试，列出提交的测试清单与跟进的问题，不扩大团队交付范围' },
          { title: '时间线说明', before: '2023.07—2024.02；2024.09—至今', after: '核对两段经历的起止月份，必要时用一行补充中间阶段的学习或项目安排' },
          { title: '版式整理', before: '教育经历 / 2020年9月-2024年6月 / 青岛理工大学', after: '统一标题、日期和地点顺序，导出后逐页检查换行、对齐与联系方式可读性' },
        ], optimizedResume: { basic: { name: '陈予安' }, intention: { position: '运营' }, summary: '', education: [], experience: [], projects: [], skills: [], certificates: [] } }),
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
    await assertRenderedExport('诊断报告', memberResult, memberBuffer, memberFile?.pageCount, pageCounter)
    const documents = await new MemberAssetsService(prisma).listDocuments(userA, { cursor: null, pageSize: 50 })
    const memberPathOk = Boolean(
      memberResult.savedToDocuments && memberResult.aiGenerated && memberResult.mimeType === 'application/pdf' &&
      memberResult.filename === 'AI诊断报告_陈予安.pdf' && memberResult.pageCount > 0 &&
      memberResult.printFileUrl.includes(`/files/${memberResult.fileId}/content`) &&
      memberFile?.purpose === 'print_doc' && memberFile.assetCategory === 'derived' &&
      memberFile.sourceFileId === memberSource.fileId && memberFile.createdBy === 'ai_resume_diagnosis_export' &&
      memberFile.endUserId === userA && documents.items.some((item) => item.id === memberResult.fileId) &&
      diagnosisText.includes('AI 生成，仅供参考，请自行核对') &&
      diagnosisText.includes('严重度：高') && diagnosisText.includes('严重度：中') && diagnosisText.includes('严重度：低') &&
      diagnosisText.includes('扫描文字置信度有限，请人工核对') && diagnosisText.includes('本次诊断只处理了简历前部内容')
    )
    assert(memberPathOk, '会员路径：真实 PDF + 派生血缘 + 我的文档 + 文件名/页眉/严重度/OCR/截断说明')
    // 来源与置信度印成中文；内部键（pdf_ocr / low）不许上纸。
    assert(
      diagnosisText.includes('文字来源：扫描识别') && diagnosisText.includes('识别置信度：低') &&
        !diagnosisText.includes('pdf_ocr') && !diagnosisText.includes('识别置信度：low'),
      '诊断 PDF：文字来源与识别置信度印成中文，不印内部键',
    )

    const changeResult = await controller.export(memberTask, { kind: 'change_list' }, {
      headers: { authorization: 'Bearer member-a' },
    })
    fileIds.push(changeResult.fileId)
    const changeFile = await prisma.fileObject.findUnique({ where: { id: changeResult.fileId } })
    const changeBuffer = await readFile(join(storageDir, changeFile!.storageKey))
    const changeText = await pdfText(changeBuffer)
    await assertRenderedExport('修改清单', changeResult, changeBuffer, changeFile?.pageCount, pageCounter)
    assert(
      changeResult.filename === '修改清单_陈予安.pdf' && changeText.includes('请回自己的 Word 里改') &&
      changeText.includes('修改前：负责门店日常运营并协助多个活动') && changeText.includes('建议后：负责门店日常运营，整理活动数据并补充本人可核实的执行结果'),
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
