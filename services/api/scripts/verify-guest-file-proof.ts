/**
 * verify:guest-file-proof
 *
 * 没有会员主人的文件，简历诊断、模拟面试、材料检查只认持有本次签名地址的调用方。
 * 有会员主人的文件只认本人。对不上时与「文件不存在」同一回应。
 * 材料检查不再接受已过期的文件。
 * 材料检查对别人的会员文件仍回原有的 403；只有没有会员主人的文件才和「源文件不存在」同一回应。
 * 结束时只清掉本次写入的记录，并确认这些文件编号已经不在。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:guest-file-proof
 */
require('dotenv').config()

process.env['FILE_STORAGE_DRIVER'] = 'local'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-guest-file-proof-secret-32chars-min'

import 'reflect-metadata'
import { createHmac, randomBytes } from 'crypto'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { BadRequestException, Logger, ValidationPipe, type ValidationError } from '@nestjs/common'
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
import { assertGuestFileProof, fileNeedsHolderProof, parseSignedContentUrl } from '../src/files/file-access-proof'
import { signFileUrl } from '../src/files/signing'
import { resumeParseIntentId } from '../src/ai/resume-parse-intent'
import { ResumeParseRequestDto } from '../src/ai/dto/resume-parse.dto'
import { CreateMaterialTaskDto } from '../src/materials/dto/create-material-task.dto'
import { CreateInterviewDto } from '../src/mock-interview/mock-interview.controller'
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

function flattenValidationErrors(errors: ValidationError[], parent = ''): string[] {
  const out: string[] = []
  for (const item of errors) {
    const path = parent ? `${parent}.${item.property}` : item.property
    if (item.constraints) {
      for (const msg of Object.values(item.constraints)) out.push(`${path}: ${msg}`)
    }
    if (item.children && item.children.length) {
      const childPath = Array.isArray(item.target) ? `${parent}[${item.property}]` : path
      out.push(...flattenValidationErrors(item.children, childPath))
    }
  }
  return out
}

async function assertDto(label: string, metatype: new () => object, body: object, ok: boolean): Promise<void> {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) => {
      const details = flattenValidationErrors(errors)
      const message = details.length > 0 ? details[0]! : '请求参数校验失败'
      return new BadRequestException({ error: { code: 'VALIDATION_FAILED', message, details } })
    },
  })
  try {
    await pipe.transform(body, { type: 'body', metatype })
    if (!ok) fail(`${label}：应当拒绝`)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('VERIFY_FAILED')) throw error
    if (ok) fail(`${label}：不应当拒绝 ${rejectionShape(error)}`)
    const status = (error as { getStatus?: () => number }).getStatus?.() ?? 0
    if (status !== 400) fail(`${label}：应当拒绝，实际 ${status}`)
  }
  pass(label)
}

async function assertValidation(): Promise<void> {
  const url = 'u'.repeat(1024)
  const tooLong = 'u'.repeat(1025)
  const resumeOk = { fileId: 'f', fileName: 'a.pdf', fileFormat: 'pdf', source: 'upload', fileAccessUrl: url }
  const materialOk = { kind: 'inspection', sourceFileId: 'f', fileAccessUrl: url }
  const interviewOk = {
    interviewerType: 'hr', industry: '软件', position: '后端', experience: 'y1_3',
    difficulty: 'standard', durationMin: 5, fileAccessUrl: url,
  }
  await assertDto('简历诊断入参签名地址不超过 1024', ResumeParseRequestDto, resumeOk, true)
  await assertDto('简历诊断入参签名地址超过 1024', ResumeParseRequestDto, { ...resumeOk, fileAccessUrl: tooLong }, false)
  await assertDto('简历诊断入参多一个未声明字段', ResumeParseRequestDto, { ...resumeOk, unlisted: 1 }, false)
  await assertDto('材料检查入参签名地址不超过 1024', CreateMaterialTaskDto, materialOk, true)
  await assertDto('材料检查入参签名地址超过 1024', CreateMaterialTaskDto, { ...materialOk, fileAccessUrl: tooLong }, false)
  await assertDto('材料检查入参多一个未声明字段', CreateMaterialTaskDto, { ...materialOk, unlisted: 1 }, false)
  await assertDto('模拟面试入参签名地址不超过 1024', CreateInterviewDto, interviewOk, true)
  await assertDto('模拟面试入参签名地址超过 1024', CreateInterviewDto, { ...interviewOk, fileAccessUrl: tooLong }, false)
  await assertDto('模拟面试入参多一个未声明字段', CreateInterviewDto, { ...interviewOk, unlisted: 1 }, false)
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
  await assertValidation()
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
    files,
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

  const uploadedIds: string[] = []
  const intentIds: string[] = []
  let uploaderUserId: string | null = null
  const createdBy = 'verify_guest_file_proof'
  const memberIds = [memberA, memberB]

  async function upload(purpose: FilePurpose, endUserId: string | null): Promise<string> {
    const uploaded = await files.upload({
      buffer: await resumePdf(),
      filename: 'resume.pdf',
      mimeType: 'application/pdf',
      purpose,
      uploaderId: null,
      endUserId,
      createdBy,
      expiresAtOverride: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    uploadedIds.push(uploaded.fileId)
    return uploaded.fileId
  }

  function intentHeaders(): Record<string, string> {
    const intentKey = randomBytes(32).toString('base64url')
    intentIds.push(resumeParseIntentId(intentKey))
    return {
      'x-resume-parse-intent': intentKey,
      'x-resume-parse-proof': randomBytes(32).toString('base64url'),
    }
  }

  function fileIdFilter(): string[] {
    return uploadedIds.length ? [...uploadedIds] : ['__none__']
  }

  const countIntents = () => prisma.aiResumeResult.count({
    where: {
      kind: 'parse_intent',
      OR: [
        ...(intentIds.length ? [{ taskId: { in: [...intentIds] } }] : []),
        { endUserId: { in: memberIds } },
      ],
    },
  })
  const countSessions = () => prisma.mockInterviewSession.count({
    where: {
      OR: [
        { endUserId: { in: memberIds } },
        { resumeFileId: { in: fileIdFilter() } },
      ],
    },
  })
  const countTasks = () => prisma.documentProcessTask.count({
    where: {
      OR: [
        { endUserId: { in: memberIds } },
        { sourceFileId: { in: fileIdFilter() } },
      ],
    },
  })

  async function collectFileIds(): Promise<string[]> {
    const seen = new Set<string>(uploadedIds)
    let grew = true
    while (grew) {
      grew = false
      const ids = [...seen]
      const or: Array<Record<string, unknown>> = [
        { endUserId: { in: memberIds } },
        { createdBy },
      ]
      if (ids.length) {
        or.push({ id: { in: ids } })
        or.push({ sourceFileId: { in: ids } })
      }
      const rows = await prisma.fileObject.findMany({ where: { OR: or }, select: { id: true } })
      const taskOr: Array<Record<string, unknown>> = [{ endUserId: { in: memberIds } }]
      if (ids.length) taskOr.push({ sourceFileId: { in: ids } })
      const tasks = await prisma.documentProcessTask.findMany({
        where: { OR: taskOr },
        select: { sourceFileId: true, resultFileId: true },
      })
      for (const row of rows) {
        if (!seen.has(row.id)) {
          seen.add(row.id)
          grew = true
        }
      }
      for (const task of tasks) {
        for (const id of [task.sourceFileId, task.resultFileId]) {
          if (id && !seen.has(id)) {
            seen.add(id)
            grew = true
          }
        }
      }
    }
    return [...seen]
  }

  async function cleanup(): Promise<void> {
    const fileIds = await collectFileIds()
    const pendingBefore = new Set(
      (await prisma.fileObject.findMany({
        where: { storageDeletePendingAt: { not: null } },
        select: { id: true },
      })).map((row) => row.id),
    )
    const stored = fileIds.length
      ? await prisma.fileObject.findMany({
        where: { id: { in: fileIds } },
        select: { id: true, storageKey: true, bucket: true },
      })
      : []
    for (const row of stored) {
      try {
        await storage.deleteObject(row.storageKey, row.bucket)
      } catch (error) {
        const code = (error as { code?: string }).code
        if (code !== 'ENOENT') throw error
      }
    }
    const taskOr: Array<Record<string, unknown>> = [{ endUserId: { in: memberIds } }]
    if (fileIds.length) taskOr.push({ sourceFileId: { in: fileIds } })
    const taskRows = await prisma.documentProcessTask.findMany({
      where: { OR: taskOr },
      select: { id: true },
    })
    const taskIds = taskRows.map((row) => row.id)
    if (taskIds.length) {
      await prisma.piiFinding.deleteMany({ where: { taskId: { in: taskIds } } })
      await prisma.documentProcessTask.updateMany({
        where: { id: { in: taskIds } },
        data: { resultFileId: null },
      })
      await prisma.documentProcessTask.deleteMany({ where: { id: { in: taskIds } } })
    }
    if (fileIds.length) {
      await prisma.fileObject.updateMany({ where: { id: { in: fileIds } }, data: { sourceFileId: null } })
      await prisma.fileObject.deleteMany({ where: { id: { in: fileIds } } })
    }
    const sessionRows = await prisma.mockInterviewSession.findMany({
      where: {
        OR: [
          { endUserId: { in: memberIds } },
          { resumeFileId: { in: fileIds.length ? fileIds : ['__none__'] } },
        ],
      },
      select: { id: true },
    })
    const sessionIds = sessionRows.map((row) => row.id)
    if (sessionIds.length) {
      await prisma.mockInterviewTurn.deleteMany({ where: { sessionId: { in: sessionIds } } })
      await prisma.mockInterviewReport.deleteMany({ where: { sessionId: { in: sessionIds } } })
      await prisma.mockInterviewSession.deleteMany({ where: { id: { in: sessionIds } } })
    }
    await prisma.aiResumeResult.deleteMany({
      where: {
        OR: [
          { endUserId: { in: memberIds } },
          ...(intentIds.length ? [{ taskId: { in: [...intentIds] } }] : []),
        ],
      },
    })
    await prisma.aiUsageRecord.deleteMany({ where: { endUserId: { in: memberIds } } })
    await prisma.aiServiceLog.deleteMany({ where: { endUserId: { in: memberIds } } })
    const auditTargets = [...fileIds, ...taskIds, ...sessionIds, ...intentIds]
    if (auditTargets.length) {
      await prisma.auditLog.deleteMany({ where: { targetId: { in: auditTargets } } })
    }
    await prisma.auditLog.deleteMany({ where: { requestId: 'verify-guest-file-proof' } })
    if (uploaderUserId) await prisma.user.delete({ where: { id: uploaderUserId } })
    await prisma.endUser.deleteMany({ where: { id: { in: memberIds } } })

    if (fileIds.length) {
      const left = await prisma.fileObject.count({ where: { id: { in: fileIds } } })
      if (left !== 0) throw new Error('本次文件编号清理后仍在')
    }
    const pendingAfter = await prisma.fileObject.findMany({
      where: { storageDeletePendingAt: { not: null } },
      select: { id: true },
    })
    if (pendingAfter.some((row) => !pendingBefore.has(row.id))) {
      throw new Error('清理后多出待删除记录')
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

  let scenarioError: unknown
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
    const deletedMaterial = await upload('print_doc', null)
    await prisma.fileObject.update({
      where: { id: deletedMaterial },
      data: { deletedAt: new Date(), status: 'deleted' },
    })
    const uploader = await prisma.user.create({
      data: {
        username: `gfp_uploader_${suffix}`,
        passwordHash: 'verify-only',
        name: '验证上传账号',
        role: 'admin',
      },
    })
    uploaderUserId = uploader.id
    const platformFile = await prisma.fileObject.create({
      data: {
        storageKey: `verify/guest-file-proof/${suffix}/platform`,
        filename: 'platform.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 32,
        sha256: 'b'.repeat(64),
        purpose: 'resume_upload',
        uploaderId: uploader.id,
        endUserId: null,
        ownerType: 'admin',
        ownerId: uploader.id,
        createdBy,
        status: 'active',
      },
    })
    uploadedIds.push(platformFile.id)

    if (await fileNeedsHolderProof(prisma, `missing-${suffix}`) !== true) fail('编号不存在仍要证明')
    if (await fileNeedsHolderProof(prisma, deletedMaterial) !== true) fail('已删除仍要证明')
    if (await fileNeedsHolderProof(prisma, expiredMaterial) !== true) fail('已过期仍要证明')
    if (await fileNeedsHolderProof(prisma, guestResume) !== true) fail('没有会员主人仍要证明')
    if (await fileNeedsHolderProof(prisma, memberResume) !== false) fail('有会员主人不要证明')
    pass('判定只看有没有会员主人')
    let missingReader = false
    try {
      await fileNeedsHolderProof({} as never, guestResume)
    } catch (error) {
      missingReader = error instanceof Error && error.message === '文件记录读取不可用'
    }
    if (!missingReader) fail('拿不到文件记录读取时应报错')
    missingReader = false
    try {
      await fileNeedsHolderProof({ fileObject: {} } as never, guestResume)
    } catch (error) {
      missingReader = error instanceof Error && error.message === '文件记录读取不可用'
    }
    if (!missingReader) fail('文件记录上没有读取方法时应报错')
    pass('拿不到文件记录读取时报错')

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
    await expectResumeReject('简历诊断已登录会员用不带签名地址的无主文件', () => controller.submitResumeParse(
      parseBody(guestResume),
      req({ authorization: `Bearer ${memberA}`, ...intentHeaders() }),
    ), { task: false })
    await expectResumeReject('简历诊断平台上传的文件不带签名地址', () => controller.submitResumeParse(
      parseBody(platformFile.id),
      req({ authorization: `Bearer ${memberA}`, ...intentHeaders() }),
    ), { task: false })
    {
      const beforeIntent = await countIntents()
      const beforeOnce = quota.once
      const beforeConsume = quota.consume
      const beforeModel = models.n
      let caught: unknown
      try {
        await controller.submitResumeParse(
          parseBody(expiredMaterial, signFileUrl(expiredMaterial).url),
          req(intentHeaders()),
        )
        fail('简历诊断已过期但签名地址仍有效应当拒绝')
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('VERIFY_FAILED')) throw error
        caught = error
      }
      if (rejectionShape(caught) !== resumeMissingShape) fail(`简历诊断已过期但签名地址仍有效：回应不一致 ${rejectionShape(caught)}`)
      if (quota.once !== beforeOnce || quota.consume !== beforeConsume) fail('简历诊断已过期但签名地址仍有效：拒时扣了次数')
      if (models.n !== beforeModel) fail('简历诊断已过期但签名地址仍有效：拒时调了模型')
      if (await countIntents() === beforeIntent) fail('简历诊断已过期但签名地址仍有效：证明未通过就没有后续校验')
      pass('简历诊断已过期但签名地址仍有效，后面的校验仍拒绝')
    }

    let legacyMissingShape = ''
    {
      try {
        await controller.submitResumeParse(parseBody(`missing-${suffix}`), req({}))
        fail('旧路径文件不存在应当拒绝')
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('VERIFY_FAILED')) throw error
        legacyMissingShape = rejectionShape(error)
      }
      if (!legacyMissingShape.includes('FILE_NOT_FOUND') || !legacyMissingShape.includes('文件不存在或已被清理')) {
        fail(`旧路径文件不存在的回应不可用 ${legacyMissingShape}`)
      }
      pass('旧路径文件不存在的回应已记录')
    }
    async function expectLegacyReject(label: string, run: () => Promise<unknown>): Promise<void> {
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
      if (rejectionShape(caught) !== legacyMissingShape) fail(`${label}：回应与旧路径文件不存在不一致 ${rejectionShape(caught)}`)
      if (quota.once !== beforeOnce || quota.consume !== beforeConsume) fail(`${label}：拒时扣了次数`)
      if (models.n !== beforeModel) fail(`${label}：拒时调了模型`)
      if (await countIntents() !== beforeIntent) fail(`${label}：拒时建了任务`)
      pass(label)
    }
    await expectLegacyReject('旧路径不带签名地址', () => controller.submitResumeParse(parseBody(guestResume), req({})))
    await expectLegacyReject('旧路径带错签名地址', () => controller.submitResumeParse(
      parseBody(guestResume, signFileUrl(otherResume).url),
      req({}),
    ))
    const legacyOwner = await controller.submitResumeParse(parseBody(memberResume), req({ authorization: `Bearer ${memberA}` }))
    if (legacyOwner.status !== 'completed' || quota.consume < 1) fail('旧路径会员本人应当成功')
    pass('旧路径会员本人成功')
    const consumeAfterOwner = quota.consume
    const legacyGuest = await controller.submitResumeParse(
      parseBody(guestResume, signFileUrl(guestResume).url),
      req({}),
    )
    if (legacyGuest.status !== 'completed' || quota.consume !== consumeAfterOwner + 1) fail('旧路径持有签名地址应当成功')
    pass('旧路径持有签名地址成功')

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
      const sessions = await countSessions()
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
      if (await countSessions() !== sessions) fail(`${label}：拒时建了任务`)
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
    await expectInterviewReject('模拟面试已登录会员用不带签名地址的无主文件', () => interview.createSession(
      { ...interviewBase, resumeFileId: guestResume },
      { endUserId: memberA, accessToken: null },
    ), false)
    await expectInterviewReject('模拟面试平台上传的文件不带签名地址', () => interview.createSession(
      { ...interviewBase, resumeFileId: platformFile.id },
      { endUserId: memberA, accessToken: null },
    ), false)
    await expectInterviewReject('模拟面试已过期但签名地址仍有效', () => interview.createSession(
      { ...interviewBase, resumeFileId: expiredMaterial, fileAccessUrl: signFileUrl(expiredMaterial).url },
      { endUserId: null, accessToken: null },
    ), true)

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
      const tasks = await countTasks()
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
      if (await countTasks() !== tasks) fail(`${label}：拒时建了任务`)
      if (ocrCalls.n !== beforeOcr) fail(`${label}：拒时调了识别`)
      pass(label)
    }

    const ownerMaterial = await materials.createTask(
      { kind: 'inspection', sourceFileId: memberMaterial },
      { kind: 'member', endUserId: memberA },
    )
    if (!ownerMaterial.id) fail('材料检查会员本人应当成功')
    pass('材料检查会员本人成功')
    // 别人的会员文件仍回原有的 403。这是改动前就有的行为，这里只钉住它。
    for (const [label, requester] of [
      ['材料检查别的会员', { kind: 'member' as const, endUserId: memberB }],
      ['材料检查未登录访问会员文件', { kind: 'anonymous' as const }],
    ]) {
      const tasks = await countTasks()
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
      if (await countTasks() !== tasks) fail(`${label}：拒时建了任务`)
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
    await expectMaterialReject('材料检查已删除但签名地址仍有效', () => materials.createTask(
      { kind: 'inspection', sourceFileId: deletedMaterial, fileAccessUrl: signFileUrl(deletedMaterial).url },
      { kind: 'anonymous' },
    ))
    await expectMaterialReject('材料检查已登录会员用不带签名地址的无主文件', () => materials.createTask(
      { kind: 'inspection', sourceFileId: guestMaterial },
      { kind: 'member', endUserId: memberA },
    ))
    await expectMaterialReject('材料检查平台上传的文件不带签名地址', () => materials.createTask(
      { kind: 'inspection', sourceFileId: platformFile.id },
      { kind: 'member', endUserId: memberA },
    ))
    const scanParams = {}
    const firstScan = await materials.createTask(
      { kind: 'pii_scan', sourceFileId: guestMaterial, params: scanParams, fileAccessUrl: signFileUrl(guestMaterial).url },
      { kind: 'anonymous' },
    )
    if (!firstScan.id || !firstScan.accessToken) fail('去重顺序的第一次隐私检查应当成功')
    const tasksAfterScan = await countTasks()
    const ocrAfterScan = ocrCalls.n
    let dedupeCaught: unknown
    try {
      const second = await materials.createTask(
        { kind: 'pii_scan', sourceFileId: guestMaterial, params: scanParams },
        { kind: 'anonymous' },
      )
      fail(`去重窗口内不带签名地址应当拒绝，实际 ${JSON.stringify(second).slice(0, 160)}`)
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('VERIFY_FAILED')) throw error
      dedupeCaught = error
    }
    const dedupeShape = rejectionShape(dedupeCaught)
    if (dedupeShape !== materialMissingShape) fail(`去重窗口内不带签名地址：回应与源文件不存在不一致 ${dedupeShape}`)
    if (dedupeShape.includes(firstScan.id) || dedupeShape.includes(firstScan.accessToken)) {
      fail('去重窗口内不带签名地址拿到了已有任务')
    }
    if (await countTasks() !== tasksAfterScan) fail('去重窗口内不带签名地址多建了任务')
    if (ocrCalls.n !== ocrAfterScan) fail('去重窗口内不带签名地址调了识别')
    pass('去重窗口内不带签名地址与源文件不存在一致')
  } catch (error) {
    scenarioError = error
  } finally {
    try {
      await cleanup()
    } catch (cleanupError) {
      if (scenarioError) console.error(cleanupError instanceof Error ? cleanupError.stack ?? cleanupError.message : cleanupError)
      else scenarioError = cleanupError
    }
    try {
      await prisma.onModuleDestroy()
    } catch (disconnectError) {
      if (scenarioError) console.error(disconnectError instanceof Error ? disconnectError.stack ?? disconnectError.message : disconnectError)
      else scenarioError = disconnectError
    }
  }
  if (scenarioError) throw scenarioError
  console.log(`PASS verify:guest-file-proof ${passCount}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exit(1)
})
