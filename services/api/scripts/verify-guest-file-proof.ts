/**
 * verify:guest-file-proof
 *
 * 没有会员主人的文件，简历诊断、模拟面试、材料检查只认持有本次签名地址的调用方。
 * 有会员主人的文件只认本人。对不上时与「文件不存在」同一回应。
 * 材料检查不再接受已过期的文件。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:guest-file-proof
 */
require('dotenv').config()

process.env['FILE_STORAGE_DRIVER'] = 'local'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-guest-file-proof-secret-32chars-min'

import { createHmac, randomBytes } from 'crypto'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { Logger } from '@nestjs/common'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { StorageService } from '../src/storage/storage.service'
import { FilesService } from '../src/files/files.service'
import { AiController } from '../src/ai/ai.controller'
import { ResumeParseIntentRunner } from '../src/ai/resume-parse-intent-runner.service'
import { ResumeParseSubmissionService } from '../src/ai/resume-parse-submission.service'
import { MockInterviewService } from '../src/mock-interview/mock-interview.service'
import { MaterialsService } from '../src/materials/materials.service'
import { ResumeExtractionService } from '../src/ai/resume/resume-extraction.service'
import { assertGuestFileProof, parseSignedContentUrl } from '../src/files/file-access-proof'
import { signFileUrl } from '../src/files/signing'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import type { FilePurpose } from '../src/files/file.types'

const repoRoot = resolve(__dirname, '../../..')

let passCount = 0
function pass(msg: string): void {
  passCount += 1
  console.log(`  PASS ${msg}`)
}
function fail(msg: string): never {
  console.error(`  FAIL ${msg}`)
  throw new Error(`VERIFY_FAILED ${msg}`)
}

class QuietLogger {
  log(): void {}
  error(): void {}
  warn(): void {}
  debug(): void {}
  verbose(): void {}
}
Logger.overrideLogger(new QuietLogger())

function expiredGrant(fileId: string): string {
  const secret = process.env['FILE_SIGNING_SECRET']
  if (!secret) fail('签名密钥未设置')
  const expires = Date.now() - 60_000
  const sig = createHmac('sha256', secret).update(`${fileId}.${expires}`).digest('hex')
  return `/api/v1/files/${fileId}/content?expires=${expires}&sig=${sig}`
}

function flippedGrant(fileId: string): string {
  const parsed = new URL(signFileUrl(fileId).url, 'http://local')
  const sig = parsed.searchParams.get('sig') ?? ''
  const last = sig.slice(-1)
  const flipped = ((Number.parseInt(last, 16) + 1) % 16).toString(16)
  parsed.searchParams.set('sig', `${sig.slice(0, -1)}${flipped}`)
  return `${parsed.pathname}?${parsed.searchParams.toString()}`
}

function rejectionShape(error: unknown): string {
  const http = error as { getStatus?: () => number; getResponse?: () => unknown }
  if (typeof http?.getStatus !== 'function' || typeof http.getResponse !== 'function') {
    return `non-http:${error instanceof Error ? error.message : String(error)}`
  }
  return JSON.stringify({ status: http.getStatus(), body: http.getResponse() })
}

function assertKioskSources(): void {
  const resumePage = readFileSync(resolve(repoRoot, 'apps/kiosk/src/pages/resume/ResumeParsePage.tsx'), 'utf8')
  const resumeApi = readFileSync(resolve(repoRoot, 'apps/kiosk/src/services/api/ai.ts'), 'utf8')
  const interviewPage = readFileSync(resolve(repoRoot, 'apps/kiosk/src/pages/interview/InterviewSetupPage.tsx'), 'utf8')
  const interviewApi = readFileSync(resolve(repoRoot, 'apps/kiosk/src/services/api/interview.ts'), 'utf8')
  const materialPage = readFileSync(resolve(repoRoot, 'apps/kiosk/src/pages/print/PrintMaterialCheckPage.tsx'), 'utf8')
  const materialApi = readFileSync(resolve(repoRoot, 'apps/kiosk/src/services/api/materials.ts'), 'utf8')
  if (!/fileAccessUrl:\s*file\?\.fileUrl/.test(resumePage)) fail('一体机简历诊断请求带 file.fileUrl')
  if (!/fileAccessUrl\?: string/.test(resumeApi)) fail('一体机简历诊断函数接受 fileAccessUrl')
  pass('一体机简历诊断请求带签名地址')
  if (!/fileAccessUrl:\s*resumeFile\.fileUrl/.test(interviewPage)) fail('一体机模拟面试请求带 resumeFile.fileUrl')
  if (!/fileAccessUrl\?: string/.test(interviewApi)) fail('一体机模拟面试函数接受 fileAccessUrl')
  pass('一体机模拟面试请求带签名地址')
  const materialCalls = materialPage.match(/fileAccessUrl:\s*file\.fileUrl/g) ?? []
  if (materialCalls.length < 4) fail('一体机材料检查四处请求带 file.fileUrl')
  if (!/fileAccessUrl\?: string/.test(materialApi)) fail('一体机材料检查函数接受 fileAccessUrl')
  pass('一体机材料检查请求带签名地址')
}

function assertParser(): void {
  const cases: Array<{ label: string; id: string; url: string; firstExpires?: string }> = []
  {
    const id = 'dup-1'
    const signed = signFileUrl(id)
    const firstExpires = new URL(signed.url, 'http://local').searchParams.get('expires') ?? ''
    cases.push({ label: '重复查询参数', id, url: `${signed.url}&expires=1&sig=00`, firstExpires })
  }
  {
    const id = 'a b'
    const signed = signFileUrl(id)
    const query = signed.url.slice(signed.url.indexOf('?'))
    cases.push({ label: '编码路径', id, url: `/api/v1/files/${encodeURIComponent(id)}/content${query}` })
  }
  {
    const id = 'slash-1'
    cases.push({ label: '尾部斜杠', id, url: signFileUrl(id).url.replace('/content?', '/content/?') })
  }
  {
    const id = 'hash-1'
    cases.push({ label: '片段', id, url: `${signFileUrl(id).url}#piece` })
  }
  {
    const id = 'host-1'
    cases.push({ label: '带协议域名', id, url: `https://kiosk.example${signFileUrl(id).url}` })
  }
  for (const sample of cases) {
    const parsed = parseSignedContentUrl(sample.url)
    if (!parsed || parsed.fileId !== sample.id || !assertGuestFileProof(sample.id, sample.url)) {
      fail(`公用函数 ${sample.label}`)
    }
    if (sample.firstExpires && parsed.expires !== sample.firstExpires) fail('公用函数重复查询参数应取第一组')
    pass(`公用函数 ${sample.label}`)
  }
}

async function resumePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([612, 792])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  page.drawText(
    'Resume for interview practice. Experience includes writing reliable services and clear documents for print.',
    { x: 48, y: 720, size: 12, font },
  )
  return Buffer.from(await doc.save())
}

async function main(): Promise<void> {
  assertKioskSources()
  assertParser()
  assertIsolatedVerificationDatabase()

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const storage = new StorageService()
  const files = new FilesService(prisma, audit, storage)
  const suffix = randomBytes(4).toString('hex')
  const memberA = `eu_gfp_${suffix}_a`
  const memberB = `eu_gfp_${suffix}_b`
  const quota = { once: 0, consume: 0 }
  const models = { n: 0 }
  const quotaStub = {
    consume: async () => {
      quota.consume += 1
      return { keys: ['legacy'] }
    },
    consumeOnce: async () => {
      quota.once += 1
    },
    releaseResumeParseCharge: async () => undefined,
    rollback: async () => undefined,
  }
  const ai = {
    getProviderName: () => 'stub',
    submitResumeParse: async () => {
      models.n += 1
      return { taskId: 'stub-task', status: 'completed' }
    },
    getResumeRecord: async (taskId: string) => ({ taskId, status: 'completed' as const }),
  }
  const runner = new ResumeParseIntentRunner(
    new ResumeParseSubmissionService(prisma),
    quotaStub as never,
    ai as never,
    files,
  )
  const members = new Map<string, string>([[memberA, memberA], [memberB, memberB]])
  const controller = new AiController(
    ai as never,
    {} as never,
    { write: async () => undefined } as never,
    { verify: (token: string) => {
      const sub = members.get(token)
      if (!sub) throw new Error('bad token')
      return { sub, jti: `jti-${sub}` }
    } } as never,
    { get: async (key: string) => {
      const prefix = 'member:session:jti-'
      return key.startsWith(prefix) ? key.slice(prefix.length) : null
    } } as never,
    prisma,
    {} as never,
    {} as never,
    quotaStub as never,
    { requireActiveConsent: async () => undefined } as never,
    {} as never,
    {} as never,
    runner,
  )

  const extracts = { n: 0 }
  const llm = { n: 0 }
  const extraction = new ResumeExtractionService(files, {
    get activeProviderName() { return 'disabled' as const },
    recognize: async () => { throw new Error('ocr') },
  } as never)
  const interview = new MockInterviewService(
    prisma,
    { nextQuestion: async () => { llm.n += 1; throw new Error('model') } } as never,
    {} as never,
    {} as never,
    files,
    { extractResumeText: async (input: { fileId: string; endUserId?: string | null }) => {
      extracts.n += 1
      return extraction.extractResumeText(input)
    } } as never,
    { write: async () => undefined } as never,
    { record: () => undefined } as never,
  )
  const ocrCalls = { n: 0 }
  const materials = new MaterialsService(
    prisma,
    storage,
    { recognize: async () => { ocrCalls.n += 1; throw new Error('ocr') } } as never,
    {} as never,
  )

  const interviewBase = {
    interviewerType: 'hr',
    industry: '软件',
    position: '后端开发',
    experience: 'y1_3',
    difficulty: 'standard',
    durationMin: 5,
  }

  async function upload(purpose: FilePurpose, endUserId: string | null): Promise<string> {
    const uploaded = await files.upload({
      buffer: await resumePdf(),
      filename: 'resume.pdf',
      mimeType: 'application/pdf',
      purpose,
      uploaderId: null,
      endUserId,
      createdBy: 'verify_guest_file_proof',
      expiresAtOverride: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    return uploaded.fileId
  }

  function intentHeaders(): Record<string, string> {
    return {
      'x-resume-parse-intent': randomBytes(32).toString('base64url'),
      'x-resume-parse-proof': randomBytes(32).toString('base64url'),
    }
  }
  function req(headers: Record<string, string>) {
    return {
      headers,
      ip: '203.0.113.9',
      socket: { remoteAddress: '203.0.113.9' },
      requestId: 'verify-guest-file-proof',
    }
  }
  function parseBody(fileId: string, fileAccessUrl?: string) {
    return {
      fileId,
      fileName: 'resume.pdf',
      fileFormat: 'pdf',
      source: 'upload' as const,
      ...(fileAccessUrl ? { fileAccessUrl } : {}),
    }
  }

  try {
    await prisma.endUser.create({ data: { id: memberA, phoneHash: `hash_${memberA}`, phoneEnc: 'enc-a' } })
    await prisma.endUser.create({ data: { id: memberB, phoneHash: `hash_${memberB}`, phoneEnc: 'enc-b' } })

    const memberResume = await upload('resume_upload', memberA)
    const guestResume = await upload('resume_upload', null)
    const otherResume = await upload('resume_upload', null)
    const memberMaterial = await upload('print_doc', memberA)
    const guestMaterial = await upload('print_doc', null)
    const otherMaterial = await upload('print_doc', null)
    const expiredMaterial = await upload('print_doc', null)
    await prisma.fileObject.update({
      where: { id: expiredMaterial },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    })

    const countIntents = () => prisma.aiResumeResult.count({ where: { kind: 'parse_intent' } })
    let resumeMissingShape = ''
    {
      try {
        await controller.submitResumeParse(parseBody(`missing-${suffix}`), req(intentHeaders()))
        fail('简历诊断文件不存在应当拒绝')
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('VERIFY_FAILED')) throw error
        resumeMissingShape = rejectionShape(error)
      }
      if (!resumeMissingShape.includes('FILE_NOT_FOUND') || !resumeMissingShape.includes('文件不存在或已被清理')) {
        fail(`简历诊断文件不存在的回应不可用 ${resumeMissingShape}`)
      }
      pass('简历诊断文件不存在的回应已记录')
    }

    async function expectResumeReject(
      label: string,
      run: () => Promise<unknown>,
      opts: { task: boolean },
    ): Promise<void> {
      const beforeIntent = await countIntents()
      const beforeOnce = quota.once
      const beforeConsume = quota.consume
      const beforeModel = models.n
      let caught: unknown
      try {
        const result = await run()
        fail(`${label}：应当拒绝，实际 ${JSON.stringify(result).slice(0, 160)}`)
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('VERIFY_FAILED')) throw error
        caught = error
      }
      if (rejectionShape(caught) !== resumeMissingShape) {
        fail(`${label}：回应与文件不存在不一致 ${rejectionShape(caught)}`)
      }
      if (quota.once !== beforeOnce || quota.consume !== beforeConsume) fail(`${label}：拒时扣了次数`)
      if (models.n !== beforeModel) fail(`${label}：拒时调了模型`)
      if (!opts.task && await countIntents() !== beforeIntent) fail(`${label}：拒时建了任务`)
      pass(label)
    }

    const ownerResume = await controller.submitResumeParse(parseBody(memberResume), req({
      authorization: `Bearer ${memberA}`,
      ...intentHeaders(),
    }))
    if (ownerResume.status !== 'completed') fail('简历诊断会员本人应当成功')
    pass('简历诊断会员本人成功')

    await expectResumeReject('简历诊断别的会员', () => controller.submitResumeParse(
      parseBody(memberResume),
      req({ authorization: `Bearer ${memberB}`, ...intentHeaders() }),
    ), { task: true })
    await expectResumeReject('简历诊断未登录访问会员文件', () => controller.submitResumeParse(
      parseBody(memberResume),
      req(intentHeaders()),
    ), { task: true })

    const guestResumeOk = await controller.submitResumeParse(
      parseBody(guestResume, signFileUrl(guestResume).url),
      req(intentHeaders()),
    )
    if (guestResumeOk.status !== 'completed') fail('简历诊断没有主人且持有签名地址应当成功')
    pass('简历诊断没有主人且持有签名地址成功')

    await expectResumeReject('简历诊断不带签名地址', () => controller.submitResumeParse(
      parseBody(guestResume),
      req(intentHeaders()),
    ), { task: false })
    await expectResumeReject('简历诊断别的文件的签名', () => controller.submitResumeParse(
      parseBody(guestResume, signFileUrl(otherResume).url),
      req(intentHeaders()),
    ), { task: false })
    await expectResumeReject('简历诊断签名过期', () => controller.submitResumeParse(
      parseBody(guestResume, expiredGrant(guestResume)),
      req(intentHeaders()),
    ), { task: false })
    await expectResumeReject('简历诊断签名改一位', () => controller.submitResumeParse(
      parseBody(guestResume, flippedGrant(guestResume)),
      req(intentHeaders()),
    ), { task: false })
    await expectResumeReject('简历诊断拒时不扣次数', () => controller.submitResumeParse(
      parseBody(guestResume),
      req({}),
    ), { task: false })

    let interviewMissingShape = ''
    {
      try {
        await interview.createSession(
          { ...interviewBase, resumeFileId: `missing-${suffix}` },
          { endUserId: null, accessToken: null },
        )
        fail('模拟面试文件不存在应当拒绝')
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('VERIFY_FAILED')) throw error
        interviewMissingShape = rejectionShape(error)
      }
      if (!interviewMissingShape.includes('INTERVIEW_RESUME_EXTRACT_FAILED') || !interviewMissingShape.includes('文件已失效或无法读取，请重新上传')) {
        fail(`模拟面试文件不存在的回应不可用 ${interviewMissingShape}`)
      }
      pass('模拟面试文件不存在的回应已记录')
    }

    async function expectInterviewReject(label: string, run: () => Promise<unknown>, readFile: boolean): Promise<void> {
      const sessions = await prisma.mockInterviewSession.count()
      const beforeExtract = extracts.n
      const beforeLlm = llm.n
      let caught: unknown
      try {
        const result = await run()
        fail(`${label}：应当拒绝，实际 ${JSON.stringify(result).slice(0, 160)}`)
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('VERIFY_FAILED')) throw error
        caught = error
      }
      if (rejectionShape(caught) !== interviewMissingShape) {
        fail(`${label}：回应与文件不存在不一致 ${rejectionShape(caught)}`)
      }
      if (await prisma.mockInterviewSession.count() !== sessions) fail(`${label}：拒时建了任务`)
      if (llm.n !== beforeLlm) fail(`${label}：拒时调了模型`)
      if (!readFile && extracts.n !== beforeExtract) fail(`${label}：拒时读取了文件`)
      pass(label)
    }

    const ownerInterview = await interview.createSession(
      { ...interviewBase, resumeFileId: memberResume },
      { endUserId: memberA, accessToken: null },
    )
    if (!ownerInterview.sessionId) fail('模拟面试会员本人应当成功')
    pass('模拟面试会员本人成功')
    await expectInterviewReject('模拟面试别的会员', () => interview.createSession(
      { ...interviewBase, resumeFileId: memberResume },
      { endUserId: memberB, accessToken: null },
    ), true)
    await expectInterviewReject('模拟面试未登录访问会员文件', () => interview.createSession(
      { ...interviewBase, resumeFileId: memberResume },
      { endUserId: null, accessToken: null },
    ), true)

    const guestInterview = await interview.createSession(
      { ...interviewBase, resumeFileId: guestResume, fileAccessUrl: signFileUrl(guestResume).url },
      { endUserId: null, accessToken: null },
    )
    if (!guestInterview.sessionId) fail('模拟面试没有主人且持有签名地址应当成功')
    if (llm.n !== 0) fail('模拟面试创建时调了模型')
    pass('模拟面试没有主人且持有签名地址成功')
    await expectInterviewReject('模拟面试不带签名地址', () => interview.createSession(
      { ...interviewBase, resumeFileId: guestResume },
      { endUserId: null, accessToken: null },
    ), false)
    await expectInterviewReject('模拟面试别的文件的签名', () => interview.createSession(
      { ...interviewBase, resumeFileId: guestResume, fileAccessUrl: signFileUrl(otherResume).url },
      { endUserId: null, accessToken: null },
    ), false)
    await expectInterviewReject('模拟面试签名过期', () => interview.createSession(
      { ...interviewBase, resumeFileId: guestResume, fileAccessUrl: expiredGrant(guestResume) },
      { endUserId: null, accessToken: null },
    ), false)
    await expectInterviewReject('模拟面试签名改一位', () => interview.createSession(
      { ...interviewBase, resumeFileId: guestResume, fileAccessUrl: flippedGrant(guestResume) },
      { endUserId: null, accessToken: null },
    ), false)

    let materialMissingShape = ''
    {
      try {
        await materials.createTask(
          { kind: 'inspection', sourceFileId: `missing-${suffix}` },
          { kind: 'anonymous' },
        )
        fail('材料检查文件不存在应当拒绝')
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('VERIFY_FAILED')) throw error
        materialMissingShape = rejectionShape(error)
      }
      if (!materialMissingShape.includes('SOURCE_FILE_NOT_FOUND') || !materialMissingShape.includes('源文件不存在或不可用')) {
        fail(`材料检查文件不存在的回应不可用 ${materialMissingShape}`)
      }
      pass('材料检查文件不存在的回应已记录')
    }

    async function expectMaterialReject(label: string, run: () => Promise<unknown>): Promise<void> {
      const tasks = await prisma.documentProcessTask.count()
      const beforeOcr = ocrCalls.n
      let caught: unknown
      try {
        const result = await run()
        fail(`${label}：应当拒绝，实际 ${JSON.stringify(result).slice(0, 160)}`)
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('VERIFY_FAILED')) throw error
        caught = error
      }
      if (rejectionShape(caught) !== materialMissingShape) {
        fail(`${label}：回应与文件不存在不一致 ${rejectionShape(caught)}`)
      }
      if (await prisma.documentProcessTask.count() !== tasks) fail(`${label}：拒时建了任务`)
      if (ocrCalls.n !== beforeOcr) fail(`${label}：拒时调了识别`)
      pass(label)
    }

    const ownerMaterial = await materials.createTask(
      { kind: 'inspection', sourceFileId: memberMaterial },
      { kind: 'member', endUserId: memberA },
    )
    if (!ownerMaterial.id) fail('材料检查会员本人应当成功')
    pass('材料检查会员本人成功')
    for (const [label, requester] of [
      ['材料检查别的会员', { kind: 'member' as const, endUserId: memberB }],
      ['材料检查未登录访问会员文件', { kind: 'anonymous' as const }],
    ]) {
      const tasks = await prisma.documentProcessTask.count()
      const beforeOcr = ocrCalls.n
      let caught: unknown
      try {
        await materials.createTask({ kind: 'inspection', sourceFileId: memberMaterial }, requester)
        fail(`${label}：应当拒绝`)
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('VERIFY_FAILED')) throw error
        caught = error
      }
      const shape = rejectionShape(caught)
      if (!shape.includes('"status":403') || !shape.includes('SOURCE_FILE_ACCESS_DENIED')) {
        fail(`${label}：应当拒绝 ${shape}`)
      }
      if (await prisma.documentProcessTask.count() !== tasks) fail(`${label}：拒时建了任务`)
      if (ocrCalls.n !== beforeOcr) fail(`${label}：拒时调了识别`)
      pass(label)
    }

    const guestMaterialOk = await materials.createTask(
      { kind: 'inspection', sourceFileId: guestMaterial, fileAccessUrl: signFileUrl(guestMaterial).url },
      { kind: 'anonymous' },
    )
    if (!guestMaterialOk.id) fail('材料检查没有主人且持有签名地址应当成功')
    pass('材料检查没有主人且持有签名地址成功')
    await expectMaterialReject('材料检查不带签名地址', () => materials.createTask(
      { kind: 'inspection', sourceFileId: guestMaterial },
      { kind: 'anonymous' },
    ))
    await expectMaterialReject('材料检查别的文件的签名', () => materials.createTask(
      { kind: 'inspection', sourceFileId: guestMaterial, fileAccessUrl: signFileUrl(otherMaterial).url },
      { kind: 'anonymous' },
    ))
    await expectMaterialReject('材料检查签名过期', () => materials.createTask(
      { kind: 'inspection', sourceFileId: guestMaterial, fileAccessUrl: expiredGrant(guestMaterial) },
      { kind: 'anonymous' },
    ))
    await expectMaterialReject('材料检查签名改一位', () => materials.createTask(
      { kind: 'inspection', sourceFileId: guestMaterial, fileAccessUrl: flippedGrant(guestMaterial) },
      { kind: 'anonymous' },
    ))
    await expectMaterialReject('材料检查文件已过期', () => materials.createTask(
      { kind: 'inspection', sourceFileId: expiredMaterial, fileAccessUrl: signFileUrl(expiredMaterial).url },
      { kind: 'anonymous' },
    ))

    console.log(`PASS verify:guest-file-proof ${passCount}`)
  } finally {
    await prisma.onModuleDestroy()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exit(1)
})
