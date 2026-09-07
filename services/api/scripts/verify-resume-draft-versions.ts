/**
 * 包 H — 简历草稿 / 版本 / 事实核对墙。
 *
 * 覆盖：
 *   1. 草稿读写归属（本人可写可读，他人 404）
 *   2. 匿名 PUT/GET draft、GET versions → AI_TASK_NOT_FOUND
 *   3. 重新生成 optimize 不覆盖 optimize_confirmed
 *   4. 导出确认版本号递增
 *   5. fact-check 对编造项报假
 *   6. listResumes / listAiRecords 不把 draft/confirmed 单独成行，合并 hasDraft/latestVersion
 *   7. 删除 parse 级联草稿；DOCX 含 AIGenerated 自定义属性
 *   8. 登录用户导出优化稿缺 factsConfirmedAt → RESUME_FACTS_NOT_CONFIRMED
 *
 * 运行：pnpm --filter @ai-job-print/api verify:resume-draft-versions
 */
import 'dotenv/config'
import { readFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { Logger, BadRequestException, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { StorageService } from '../src/storage/storage.service'
import { FilesService } from '../src/files/files.service'
import { AiService } from '../src/ai/ai.service'
import type { AiResultRequester } from '../src/ai/ai.service'
import { MockAiProvider } from '../src/ai/providers/mock.provider'
import { ResumePdfService } from '../src/ai/resume/resume-pdf.service'
import { ResumeDocxService } from '../src/ai/resume/resume-docx.service'
import { ResumeTextService } from '../src/ai/resume/resume-text.service'
import { MemberAssetsService } from '../src/member-assets/member-assets.service'
import { matchResumeFacts } from '../src/ai/resume/resume-fact-match'
import { KIND_OPTIMIZE_CONFIRMED, KIND_OPTIMIZE_DRAFT } from '../src/ai/resume/resume-draft.store'
import type { GeneratedResume } from '../src/ai/interfaces/ai-provider.interface'
import { ResumeExportGateService } from '../src/benefit-redemption/resume-export-gate.service'
import { BenefitRedemptionService } from '../src/benefit-redemption/benefit-redemption.service'
import { RESUME_EXPORT_SERVICE_KEY } from '../src/payment/price-config.seed'

if (!process.env['FILE_SIGNING_SECRET'] || process.env['FILE_SIGNING_SECRET'].length < 32) {
  process.env['FILE_SIGNING_SECRET'] = 'verify-resume-draft-versions-secret-0123456789'
}
process.env['FILE_STORAGE_DRIVER'] = 'local'
process.env['AI_PROVIDER'] = 'mock'
if (!process.env['DATABASE_URL']) {
  process.env['DATABASE_URL'] = `file:${join(__dirname, '../prisma/dev.db')}`
}

function pass(m: string) { console.log(`  PASS ${m}`) }
function fail(m: string): never { console.error(`  FAIL ${m}`); process.exitCode = 1; throw new Error(m) }

function errorCodeOf(err: unknown): string | undefined {
  if (err instanceof BadRequestException || err instanceof NotFoundException) {
    const response = err.getResponse()
    if (response && typeof response === 'object') {
      return (response as { error?: { code?: string } }).error?.code
    }
  }
  return undefined
}

async function expectCode(label: string, code: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    const actual = errorCodeOf(err)
    if (actual === code) {
      pass(label)
      return
    }
    fail(`${label} — expected ${code}, got ${actual ?? (err as Error).message}`)
  }
  fail(`${label} — expected ${code}, but succeeded`)
}

const member = (endUserId: string): AiResultRequester => ({ endUserId, accessToken: null })
const anon = (accessToken: string | null = null): AiResultRequester => ({ endUserId: null, accessToken })

const ORIGINAL_TEXT = [
  '张三 13900001111 zhangsan@example.com',
  '青岛理工学院 软件工程 本科 2020-2024',
  '青序科技 前端实习生 2023.07-2023.12',
  '大学英语四级',
].join('\n')

const ORIGINAL_RESUME: GeneratedResume = {
  basic: { name: '张三', phone: '13900001111', email: 'zhangsan@example.com' },
  intention: { position: '前端开发' },
  summary: '应届生。',
  education: [{ school: '青岛理工学院', major: '软件工程', degree: '本科', period: '2020-2024' }],
  experience: [{ company: '青序科技', role: '前端实习生', period: '2023.07-2023.12', description: '参与页面开发。' }],
  projects: [],
  skills: ['React'],
  certificates: ['大学英语四级'],
}

const FABRICATED_RESUME: GeneratedResume = {
  ...ORIGINAL_RESUME,
  education: [
    ...ORIGINAL_RESUME.education,
    { school: '虚构名校', major: '软件工程', degree: '硕士', period: '1999-2003' },
  ],
  experience: [
    ...ORIGINAL_RESUME.experience,
    { company: '不存在的公司', role: 'CTO', period: '2010-2012', description: '编造经历。' },
  ],
  certificates: [...ORIGINAL_RESUME.certificates, '编造证书XYZ'],
  basic: { ...ORIGINAL_RESUME.basic, phone: '13900009999' },
}

async function main(): Promise<void> {
  console.log('\n=== 包 H 简历草稿 / 版本 / 事实核对 ===')
  Logger.overrideLogger({ log: () => {}, error: () => {}, warn: () => {}, debug: () => {}, verbose: () => {}, fatal: () => {} })

  const svcSrc = readFileSync(join(__dirname, '../src/ai/ai.service.ts'), 'utf-8')
  const ctrlSrc = readFileSync(join(__dirname, '../src/ai/ai.controller.ts'), 'utf-8')
  const storeSrc = readFileSync(join(__dirname, '../src/ai/resume/resume-draft.store.ts'), 'utf-8')
  const assetsSrc = readFileSync(join(__dirname, '../src/member-assets/member-assets.service.ts'), 'utf-8')
  const dtoSrc = readFileSync(join(__dirname, '../src/ai/dto/resume-generate.dto.ts'), 'utf-8')
  const docxSrc = readFileSync(join(__dirname, '../src/ai/resume/resume-docx.service.ts'), 'utf-8')

  if (!ctrlSrc.includes("Put('resume/records/:taskId/draft')")) fail('0a. 缺少 PUT /resume/records/:taskId/draft')
  if (!ctrlSrc.includes("Get('resume/records/:taskId/draft')")) fail('0a. 缺少 GET /resume/records/:taskId/draft')
  if (!ctrlSrc.includes("Get('resume/records/:taskId/versions')")) fail('0a. 缺少 GET /resume/records/:taskId/versions')
  if (!ctrlSrc.includes("Post('resume/records/:taskId/fact-check')")) fail('0a. 缺少 POST /resume/records/:taskId/fact-check')
  if (!ctrlSrc.includes('NotFoundException') || !ctrlSrc.includes("!requester.endUserId")) {
    fail('0a. draft/versions 匿名路径必须 404')
  }
  pass('0a. 草稿 / 版本 / fact-check 端点已注册，匿名走 404')

  if (!/kind: 'parse' \| 'optimize' \| 'generate'/.test(svcSrc)) {
    fail('0b. persistResult 必须仍只接受 parse|optimize|generate，不得把 confirmed 写进重新生成路径')
  }
  if (!storeSrc.includes("KIND_OPTIMIZE_CONFIRMED = 'optimize_confirmed'")) fail('0b. 缺少 optimize_confirmed kind')
  if (!storeSrc.includes("KIND_OPTIMIZE_DRAFT = 'optimize_draft'")) fail('0b. 缺少 optimize_draft kind')
  pass('0b. persistResult 不覆盖 confirmed；draft/confirmed 走独立 kind')

  if (!assetsSrc.includes("kind: { notIn: [...HIDDEN_RESUME_RESULT_KINDS] }") && !assetsSrc.includes("notIn: [...HIDDEN_RESUME_RESULT_KINDS]")) {
    fail('0c. listAiRecords 必须排除 optimize_draft / optimize_confirmed')
  }
  if (!assetsSrc.includes('hasDraft') || !assetsSrc.includes('latestVersion')) fail('0c. 列表未合并 hasDraft / latestVersion')
  pass('0c. 列表隐藏草稿行并合并字段')

  if (!dtoSrc.includes('factsConfirmedAt')) fail('0d. 导出 DTO 缺少 factsConfirmedAt')
  if (!svcSrc.includes('assertFactsConfirmed') || !storeSrc.includes('RESUME_FACTS_NOT_CONFIRMED')) {
    fail('0d. 导出未校验 factsConfirmedAt')
  }
  pass('0d. 导出端点接入 factsConfirmedAt')

  if (!docxSrc.includes("name: 'AIGenerated'") || !docxSrc.includes('customProperties')) {
    fail('0e. DOCX 未写 AIGenerated 自定义属性')
  }
  pass('0e. DOCX AIGC 自定义属性已写入 Document')

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
  const extractionStub = {
    extractResumeText: async () => ({ ok: true, text: ORIGINAL_TEXT, pageCount: 1 }),
  }
  const redemption = new BenefitRedemptionService(prisma, audit as never, undefined as never)
  const exportGate = new ResumeExportGateService(prisma, redemption)
  const ai = new AiService(
    mockProvider as never,
    emptyStub, emptyStub, emptyStub, emptyStub, emptyStub,
    emptyStub,
    logStub,
    emptyStub,
    emptyStub,
    extractionStub as never,
    pdf,
    files,
    prisma,
    audit as never,
    resumeDocx,
    resumeText,
    undefined,
    exportGate,
  )
  const assets = new MemberAssetsService(prisma)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const userA = `eu_draft_a_${suffix}`
  const userB = `eu_draft_b_${suffix}`
  const taskA = `draft_task_${suffix}`
  const taskB = `draft_task_b_${suffix}`
  const future = new Date(Date.now() + 60 * 60 * 1000)
  const createdFileIds: string[] = []
  const originalExportPrice = await prisma.priceConfig.findUnique({ where: { serviceKey: RESUME_EXPORT_SERVICE_KEY } })

  async function cleanup(): Promise<void> {
    await prisma.aiResumeResult.deleteMany({ where: { taskId: { in: [taskA, taskB] } } })
    if (createdFileIds.length > 0) {
      await prisma.fileObject.deleteMany({ where: { id: { in: createdFileIds } } })
    }
    await prisma.endUser.deleteMany({ where: { id: { in: [userA, userB] } } })
  }

  try {
    await cleanup()
    await prisma.endUser.create({ data: { id: userA, phoneHash: `draft-a-${suffix}`, phoneEnc: `enc-a-${suffix}`, nickname: '草稿A' } })
    await prisma.endUser.create({ data: { id: userB, phoneHash: `draft-b-${suffix}`, phoneEnc: `enc-b-${suffix}`, nickname: '草稿B' } })
    await prisma.aiResumeResult.create({
      data: {
        taskId: taskA, kind: 'parse', status: 'completed', provider: 'mock', expiresAt: future, endUserId: userA,
        payloadJson: JSON.stringify({ taskId: taskA, status: 'completed', fileId: `file_${suffix}`, report: { sections: [], suggestions: [] } }),
      },
    })
    await prisma.aiResumeResult.create({
      data: {
        taskId: taskB, kind: 'parse', status: 'completed', provider: 'mock', expiresAt: future, endUserId: userB,
        payloadJson: JSON.stringify({ taskId: taskB, status: 'completed', report: { sections: [], suggestions: [] } }),
      },
    })
    await prisma.priceConfig.upsert({
      where: { serviceKey: RESUME_EXPORT_SERVICE_KEY },
      create: { serviceKey: RESUME_EXPORT_SERVICE_KEY, unitCents: 0, unit: 'item', active: true, description: 'verify-draft' },
      update: { unitCents: 0, active: true },
    })

    const saved = await ai.saveResumeDraft(taskA, { resume: ORIGINAL_RESUME, decisions: { '个人简介': 'accept' } }, member(userA))
    if (!saved.saved || !saved.updatedAt) fail('1. 本人保存草稿未返回 saved/updatedAt')
    const loaded = await ai.getResumeDraft(taskA, member(userA))
    if (loaded.draft?.resume.basic.name !== '张三') fail('1. 本人读回草稿姓名丢失')
    if (loaded.draft?.decisions?.['个人简介'] !== 'accept') fail('1. 本人读回草稿 decisions 丢失')
    pass('1. 本人可读写草稿')

    await expectCode('2a. 他人读草稿 → AI_TASK_NOT_FOUND', 'AI_TASK_NOT_FOUND', () => ai.getResumeDraft(taskA, member(userB)))
    await expectCode('2b. 他人写草稿 → AI_TASK_NOT_FOUND', 'AI_TASK_NOT_FOUND', () => ai.saveResumeDraft(taskA, { resume: ORIGINAL_RESUME }, member(userB)))
    await expectCode('2c. 匿名 PUT draft → AI_TASK_NOT_FOUND', 'AI_TASK_NOT_FOUND', () => ai.saveResumeDraft(taskA, { resume: ORIGINAL_RESUME }, anon('token')))
    await expectCode('2d. 匿名 GET draft → AI_TASK_NOT_FOUND', 'AI_TASK_NOT_FOUND', () => ai.getResumeDraft(taskA, anon('token')))
    await expectCode('2e. 匿名 GET versions → AI_TASK_NOT_FOUND', 'AI_TASK_NOT_FOUND', () => ai.listResumeVersions(taskA, anon(null)))

    const confirmedPayload = { version: 3, confirmedAt: new Date().toISOString(), fileId: 'file-keep' }
    await prisma.aiResumeResult.create({
      data: {
        taskId: taskA, kind: KIND_OPTIMIZE_CONFIRMED, status: 'completed', provider: 'mock',
        expiresAt: future, endUserId: userA, payloadJson: JSON.stringify(confirmedPayload),
      },
    })
    const before = await prisma.aiResumeResult.findUnique({
      where: { taskId_kind: { taskId: taskA, kind: KIND_OPTIMIZE_CONFIRMED } },
      select: { payloadJson: true },
    })
    await ai.getResumeOptimize(taskA, member(userA))
    const after = await prisma.aiResumeResult.findUnique({
      where: { taskId_kind: { taskId: taskA, kind: KIND_OPTIMIZE_CONFIRMED } },
      select: { payloadJson: true },
    })
    if (!before || before.payloadJson !== after?.payloadJson) fail('3. 重新生成 optimize 覆盖了 optimize_confirmed')
    const optimizeRow = await prisma.aiResumeResult.findUnique({
      where: { taskId_kind: { taskId: taskA, kind: 'optimize' } },
      select: { id: true },
    })
    if (!optimizeRow) fail('3. 重新生成后应存在 optimize 行')
    pass('3. 重新生成 optimize 不覆盖 optimize_confirmed')

    await expectCode(
      '4a. 登录用户导出优化稿未确认事实 → RESUME_FACTS_NOT_CONFIRMED',
      'RESUME_FACTS_NOT_CONFIRMED',
      () => ai.exportGeneratedResume(ORIGINAL_RESUME, userA, null, 'txt', undefined, undefined, false, { taskId: taskA }),
    )
    const first = await ai.exportGeneratedResume(
      ORIGINAL_RESUME, userA, null, 'txt', undefined, undefined, false,
      { taskId: taskA, factsConfirmedAt: new Date().toISOString() },
    )
    createdFileIds.push(first.fileId)
    const v1 = await ai.listResumeVersions(taskA, member(userA))
    if (v1.latestVersion !== 4) fail(`4b. 第一次导出后 version 应为 4（原 3+1），实际 ${v1.latestVersion}`)
    const second = await ai.exportGeneratedResume(
      ORIGINAL_RESUME, userA, null, 'txt', undefined, undefined, false,
      { taskId: taskA, factsConfirmedAt: new Date().toISOString() },
    )
    createdFileIds.push(second.fileId)
    const v2 = await ai.listResumeVersions(taskA, member(userA))
    if (v2.latestVersion !== 5) fail(`4c. 第二次导出后 version 应为 5，实际 ${v2.latestVersion}`)
    if (v2.items[0]?.fileId !== second.fileId) fail('4c. 确认快照 fileId 应指向最新导出文件')
    pass('4. 版本号递增；未确认导出被拒绝')

    const matches = matchResumeFacts(FABRICATED_RESUME, ORIGINAL_TEXT)
    const fakeSchool = matches.find((item) => item.value === '虚构名校')
    const fakeCompany = matches.find((item) => item.value === '不存在的公司')
    const fakeCert = matches.find((item) => item.value === '编造证书XYZ')
    const fakePhone = matches.find((item) => item.kind === 'phone' && item.value === '13900009999')
    const realSchool = matches.find((item) => item.value === '青岛理工学院')
    if (!fakeSchool || fakeSchool.foundInOriginal) fail('5a. 编造学校必须 foundInOriginal=false')
    if (!fakeCompany || fakeCompany.foundInOriginal) fail('5a. 编造公司必须 foundInOriginal=false')
    if (!fakeCert || fakeCert.foundInOriginal) fail('5a. 编造证书必须 foundInOriginal=false')
    if (!fakePhone || fakePhone.foundInOriginal) fail('5a. 被改过的电话必须 foundInOriginal=false')
    if (!realSchool || !realSchool.foundInOriginal) fail('5a. 原文学校必须 foundInOriginal=true')
    pass('5a. 纯函数：编造项报假，原文项报真')

    await prisma.aiResumeResult.update({
      where: { taskId_kind: { taskId: taskA, kind: 'optimize' } },
      data: { payloadJson: JSON.stringify({ taskId: taskA, status: 'completed', optimizedResume: FABRICATED_RESUME }) },
    })
    await ai.saveResumeDraft(taskA, { resume: FABRICATED_RESUME }, member(userA))
    const checked = await ai.factCheckResume(taskA, member(userA))
    if (checked.items.some((item) => item.value === '虚构名校' && item.foundInOriginal)) {
      fail('5b. 端点应对编造学校报假')
    }
    if (!checked.items.some((item) => item.value === '青岛理工学院' && item.foundInOriginal)) {
      fail('5b. 端点应对原文学校报真')
    }
    pass('5b. fact-check 端点对编造项报假')

    const resumes = await assets.listResumes(userA, { cursor: null, pageSize: 20 })
    const parseRow = resumes.items.find((row) => row.taskId === taskA)
    if (!parseRow) fail('6a. 我的简历缺少 parse 行')
    if (resumes.items.some((row) => row.kind !== 'parse' && row.kind !== 'generate')) fail('6a. 我的简历出现了非 parse/generate 行')
    if (!parseRow.hasDraft) fail('6a. parse 行 hasDraft 应为 true')
    if (parseRow.latestVersion !== 5) fail(`6a. parse 行 latestVersion 应为 5，实际 ${parseRow.latestVersion}`)
    if (!parseRow.optimized) fail('6a. parse 行 optimized 应为 true')
    const records = await assets.listAiRecords(userA, { cursor: null, pageSize: 50 })
    if (records.items.some((row) => row.kind === KIND_OPTIMIZE_DRAFT || row.kind === KIND_OPTIMIZE_CONFIRMED)) {
      fail('6b. AI 记录把 draft/confirmed 单独成行了')
    }
    const parseRecord = records.items.find((row) => row.kind === 'parse' && row.taskId === taskA)
    if (!parseRecord?.hasDraft || parseRecord.latestVersion !== 5) fail('6b. AI 记录 parse 行未合并 hasDraft/latestVersion')
    pass('6. 列表不单独展示草稿，字段合并进 parse 行')

    const parseId = (await prisma.aiResumeResult.findUnique({
      where: { taskId_kind: { taskId: taskA, kind: 'parse' } },
      select: { id: true },
    }))!.id
    const deleted = await assets.deleteAiRecord(userA, parseId)
    if (deleted.deletedCount < 3) fail(`7a. 删除 parse 应级联草稿/确认/optimize，实际 ${deleted.deletedCount}`)
    const left = await prisma.aiResumeResult.count({ where: { taskId: taskA } })
    if (left !== 0) fail(`7a. taskA 应被清空，剩 ${left}`)
    pass('7a. 删除 parse 级联草稿与确认快照')

    const docx = await resumeDocx.render(ORIGINAL_RESUME)
    const { createRequire } = require('module') as { createRequire: (filename: string) => NodeRequire }
    const docxRequire = createRequire(require.resolve('docx'))
    const JSZip = docxRequire('jszip') as { loadAsync: (buf: Buffer) => Promise<{ file: (name: string) => { async: (type: 'string') => Promise<string> } | null }> }
    const zip = await JSZip.loadAsync(docx.buffer)
    const custom = await zip.file('docProps/custom.xml')?.async('string')
    const core = await zip.file('docProps/core.xml')?.async('string')
    if (!custom || !custom.includes('AIGenerated') || !custom.includes('true')) {
      fail('7b. DOCX custom.xml 缺少 AIGenerated=true')
    }
    if (!core || (!core.includes('AI 优化稿') && !core.includes('仅供参考'))) {
      fail('7b. DOCX core 属性缺少 AIGC 说明')
    }
    pass('7b. DOCX 含 AIGenerated 自定义属性与 core 说明')
  } finally {
    try {
      if (originalExportPrice) {
        await prisma.priceConfig.update({
          where: { serviceKey: RESUME_EXPORT_SERVICE_KEY },
          data: { unitCents: originalExportPrice.unitCents, active: originalExportPrice.active },
        })
      }
      await cleanup()
    } catch (err) {
      console.error('cleanup failed', err)
    }
    await prisma.onModuleDestroy?.()
  }

  console.log('\nALL PASS')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
