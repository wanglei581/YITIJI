/**
 * verify:self-assessment-append-file-scope
 *
 * 自我探索附录只取本人或本次会话持有的简历文件。
 * 有会员主人的文件只认本人；没有会员主人的文件只认持有这份文件有效签名地址的调用方。
 * 对不上时按「简历文件不存在」拒绝，不合并、不落新文件、不写成功审计、不回地址。
 *
 * 场景1 会员文件；场景2 没有会员主人的文件；场景3 先认人、再看状态和用途（确认之前的各种不对回同一句话，
 * 只收简历类和普通打印文档）；场景4 一体机与接口的静态接线。成功的合并在审计里记下凭什么取的文件。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:self-assessment-append-file-scope
 */
require('dotenv').config()

process.env['FILE_STORAGE_DRIVER'] = 'local'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-self-assessment-append-file-scope-secret-32'

import { createHash, createHmac, randomBytes } from 'crypto'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { BadRequestException, Logger, NotFoundException } from '@nestjs/common'
import { PDFDocument } from 'pdf-lib'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { StorageService } from '../src/storage/storage.service'
import { FilesService } from '../src/files/files.service'
import { AppendedSelfAssessmentService } from '../src/ai/resume/appended-self-assessment.service'
import { signFileUrl } from '../src/files/signing'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

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

async function onePagePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create()
  doc.addPage([300, 400])
  return Buffer.from(await doc.save())
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

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

const PRINT_URL = /^\/api\/v1\/files\/.+\/content\?expires=\d+&sig=[0-9a-f]{64}$/
const ADDRESS_MARKERS = ['/api/v1/files', 'http', 'printFileUrl', 'signedUrl', 'sig=']

function assertKioskSources(): void {
  const api = readFileSync(resolve(repoRoot, 'apps/kiosk/src/services/api/selfAssessment.ts'), 'utf8')
  const confirm = readFileSync(resolve(repoRoot, 'apps/kiosk/src/pages/print/PrintConfirmPage.tsx'), 'utf8')
  const controller = readFileSync(resolve(repoRoot, 'services/api/src/ai/self-assessment.controller.ts'), 'utf8')
  if (!/body:\s*\{\s*resumeFileId,\s*resumeFileUrl\s*\}/.test(api)) {
    fail('场景4 一体机请求体带 resumeFileUrl')
  }
  pass('场景4 一体机请求体带 resumeFileUrl')
  if (!/appendSelfAssessmentToResume\(\s*selfAssessmentSnapshot\.taskId,\s*file\.fileId,\s*file\.fileUrl,/.test(confirm)) {
    fail('场景4 确认页传的是 file.fileUrl')
  }
  pass('场景4 确认页传的是 file.fileUrl')
  if (!/resumeFileUrl:\s*body\.resumeFileUrl/.test(controller)) {
    fail('场景4 接口把签名地址交给合并服务')
  }
  pass('场景4 接口把签名地址交给合并服务')
}

async function main(): Promise<void> {
  assertKioskSources()
  assertIsolatedVerificationDatabase()

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const storage = new StorageService()
  const files = new FilesService(prisma, audit, storage)
  const appendix = await onePagePdf()
  const service = new AppendedSelfAssessmentService(
    prisma,
    { renderReportForAppend: async () => ({ buffer: appendix, pageCount: 1 }) } as never,
    files,
    audit,
  )

  const suffix = randomBytes(4).toString('hex')
  const memberA = `eu_vascope_${suffix}_a`
  const memberB = `eu_vascope_${suffix}_b`
  const taskId = `vascope_${suffix}`
  const accessToken = randomBytes(24).toString('hex')
  const createdFileIds: string[] = []

  async function uploadPdf(endUserId: string | null, purpose: 'print_doc' | 'resume_upload' | 'resume_scan' = 'print_doc'): Promise<string> {
    const uploaded = await files.upload({
      buffer: await onePagePdf(),
      filename: 'resume.pdf',
      mimeType: 'application/pdf',
      purpose,
      uploaderId: null,
      endUserId,
      createdBy: 'verify_append_file_scope',
      expiresAtOverride: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    createdFileIds.push(uploaded.fileId)
    return uploaded.fileId
  }

  async function appendAuditCount(access?: 'owner' | 'signed_url'): Promise<number> {
    return prisma.auditLog.count({
      where: {
        action: 'resume.self_assessment_print',
        targetId: taskId,
        AND: [
          { payloadJson: { contains: '"mode":"append"' } },
          ...(access ? [{ payloadJson: { contains: `"resumeAccess":"${access}"` } }] : []),
        ],
      },
    })
  }

  async function expectRejected(label: string, run: () => Promise<unknown>): Promise<void> {
    const filesBefore = await prisma.fileObject.count()
    const auditsBefore = await appendAuditCount()
    let caught: unknown
    try {
      const result = await run()
      fail(`${label}：应当拒绝，实际返回了结果 ${JSON.stringify(result).slice(0, 180)}`)
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('VERIFY_FAILED')) throw error
      caught = error
    }
    const status = caught instanceof NotFoundException ? caught.getStatus() : 0
    const body = caught instanceof NotFoundException ? caught.getResponse() : caught
    const payload = body as { error?: { code?: string; message?: string } }
    if (status !== 404 || payload.error?.code !== 'RESUME_FILE_NOT_FOUND' || payload.error?.message !== '简历文件不存在') {
      fail(`${label}：应当是简历文件不存在，实际 status=${status} code=${payload.error?.code ?? ''} message=${payload.error?.message ?? ''}`)
    }
    const serialized = JSON.stringify(body)
    for (const marker of ADDRESS_MARKERS) {
      if (serialized.includes(marker)) fail(`${label}：响应里有地址`)
    }
    const filesAfter = await prisma.fileObject.count()
    const auditsAfter = await appendAuditCount()
    if (filesAfter !== filesBefore) fail(`${label}：FileObject 条数从 ${filesBefore} 变成 ${filesAfter}`)
    if (auditsAfter !== auditsBefore) fail(`${label}：写了成功审计`)
    pass(label)
  }

  async function expectAppended(
    label: string,
    requester: { endUserId: string | null; accessToken: string | null },
    resumeFileId: string,
    resumeFileUrl: string | undefined,
    access: 'owner' | 'signed_url',
  ): Promise<void> {
    const filesBefore = await prisma.fileObject.count()
    const auditsBefore = await appendAuditCount(access)
    const out = await service.appendToResume({ taskId, requester, resumeFileId, resumeFileUrl })
    if (!out.printFileUrl || !PRINT_URL.test(out.printFileUrl)) {
      fail(`${label}：没有返回本次合并文件的签名地址`)
    }
    createdFileIds.push(out.fileId)
    const filesAfter = await prisma.fileObject.count()
    const auditsAfter = await appendAuditCount(access)
    if (filesAfter !== filesBefore + 1) fail(`${label}：合并文件没有多出一条，${filesBefore} -> ${filesAfter}`)
    if (auditsAfter !== auditsBefore + 1) fail(`${label}：审计里没有记下按 ${access} 取的文件`)
    pass(label)
  }

  /** 认人通过之后才轮到格式：持有有效签名地址的调用方会被告知不是 PDF。 */
  async function expectNotPdf(label: string, run: () => Promise<unknown>): Promise<void> {
    const filesBefore = await prisma.fileObject.count()
    let caught: unknown
    try {
      const result = await run()
      fail(`${label}：应当拒绝，实际返回了结果 ${JSON.stringify(result).slice(0, 180)}`)
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('VERIFY_FAILED')) throw error
      caught = error
    }
    const status = caught instanceof BadRequestException ? caught.getStatus() : 0
    const payload = (caught instanceof BadRequestException ? caught.getResponse() : caught) as { error?: { code?: string } }
    if (status !== 400 || payload.error?.code !== 'RESUME_FILE_NOT_PDF') {
      fail(`${label}：应当是不是 PDF，实际 status=${status} code=${payload.error?.code ?? ''}`)
    }
    if ((await prisma.fileObject.count()) !== filesBefore) fail(`${label}：多出了文件`)
    pass(label)
  }

  async function cleanup(): Promise<void> {
    const rows = createdFileIds.length
      ? await prisma.fileObject.findMany({
          where: { id: { in: createdFileIds } },
          select: { id: true, storageKey: true, bucket: true },
        })
      : []
    for (const row of rows) {
      try {
        await storage.deleteObject(row.storageKey, row.bucket)
      } catch {
        // 对象已经不在时继续清库。
      }
    }
    if (createdFileIds.length) {
      await prisma.fileObject.deleteMany({ where: { id: { in: createdFileIds } } })
      await prisma.auditLog.deleteMany({ where: { targetId: { in: [...createdFileIds, taskId] } } })
    } else {
      await prisma.auditLog.deleteMany({ where: { targetId: taskId } })
    }
    await prisma.aiResumeResult.deleteMany({ where: { taskId } })
    await prisma.endUser.deleteMany({ where: { id: { in: [memberA, memberB] } } })
    await prisma.onModuleDestroy()
  }

  try {
    await prisma.endUser.create({ data: { id: memberA, phoneHash: tokenHash(memberA), phoneEnc: 'enc-a' } })
    await prisma.endUser.create({ data: { id: memberB, phoneHash: tokenHash(memberB), phoneEnc: 'enc-b' } })
    await prisma.aiResumeResult.create({
      data: {
        taskId,
        kind: 'self_assessment',
        status: 'completed',
        provider: 'rules',
        endUserId: null,
        accessTokenHash: tokenHash(accessToken),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        payloadJson: JSON.stringify({
          dimensions: [{ key: 'interest', label: '兴趣偏好', strength: 3, note: null, evidenceQuestionIdx: [] }],
          summary: null,
          completedAt: new Date().toISOString(),
        }),
      },
    })

    const memberFileId = await uploadPdf(memberA)
    const ownerlessFileId = await uploadPdf(null)
    const otherFileId = await uploadPdf(null)
    const owner = { endUserId: memberA, accessToken }
    const other = { endUserId: memberB, accessToken }
    const anon = { endUserId: null, accessToken }

    await expectAppended('场景1 会员文件本人', owner, memberFileId, undefined, 'owner')
    await expectRejected('场景1 另一个会员', () => service.appendToResume({
      taskId, requester: other, resumeFileId: memberFileId,
    }))
    await expectRejected('场景1 未登录', () => service.appendToResume({
      taskId, requester: anon, resumeFileId: memberFileId,
    }))
    await expectRejected('场景1 另一个会员带着这份文件的有效签名地址', () => service.appendToResume({
      taskId, requester: other, resumeFileId: memberFileId, resumeFileUrl: signFileUrl(memberFileId).url,
    }))
    await expectRejected('场景1 未登录带着这份文件的有效签名地址', () => service.appendToResume({
      taskId, requester: anon, resumeFileId: memberFileId, resumeFileUrl: signFileUrl(memberFileId).url,
    }))

    await expectAppended('场景2 有效签名地址', anon, ownerlessFileId, signFileUrl(ownerlessFileId).url, 'signed_url')
    await expectRejected('场景2 已登录会员不带签名地址', () => service.appendToResume({
      taskId, requester: other, resumeFileId: ownerlessFileId,
    }))
    await expectAppended('场景2 已登录会员带有效签名地址', other, ownerlessFileId, signFileUrl(ownerlessFileId).url, 'signed_url')
    await expectRejected('场景2 不带', () => service.appendToResume({
      taskId, requester: anon, resumeFileId: ownerlessFileId,
    }))
    await expectRejected('场景2 另一份文件的签名', () => service.appendToResume({
      taskId, requester: anon, resumeFileId: ownerlessFileId, resumeFileUrl: signFileUrl(otherFileId).url,
    }))
    await expectRejected('场景2 签名过期', () => service.appendToResume({
      taskId, requester: anon, resumeFileId: ownerlessFileId, resumeFileUrl: expiredGrant(ownerlessFileId),
    }))
    await expectRejected('场景2 签名改一位', () => service.appendToResume({
      taskId, requester: anon, resumeFileId: ownerlessFileId, resumeFileUrl: flippedGrant(ownerlessFileId),
    }))
    await expectAppended(
      '场景2 带协议和域名的完整地址',
      anon,
      ownerlessFileId,
      `https://kiosk.example${signFileUrl(ownerlessFileId).url}`,
      'signed_url',
    )

    // 场景3：先认人，再看状态和用途。认人之前的各种不对与「编号不存在」同一句话。
    const missingFileId = `vascope_missing_${suffix}`
    await expectRejected('场景3 编号不存在', () => service.appendToResume({
      taskId, requester: anon, resumeFileId: missingFileId, resumeFileUrl: signFileUrl(missingFileId).url,
    }))
    const notPdfFileId = await uploadPdf(null)
    await prisma.fileObject.update({ where: { id: notPdfFileId }, data: { mimeType: 'image/png' } })
    await expectRejected('场景3 不是 PDF 且不带签名地址', () => service.appendToResume({
      taskId, requester: anon, resumeFileId: notPdfFileId,
    }))
    await expectNotPdf('场景3 不是 PDF 但带有效签名地址（对照：认人之后才说格式）', () => service.appendToResume({
      taskId, requester: anon, resumeFileId: notPdfFileId, resumeFileUrl: signFileUrl(notPdfFileId).url,
    }))
    const deletedFileId = await uploadPdf(null)
    await prisma.fileObject.update({ where: { id: deletedFileId }, data: { deletedAt: new Date(), status: 'deleted' } })
    await expectRejected('场景3 已删除且不带签名地址', () => service.appendToResume({
      taskId, requester: anon, resumeFileId: deletedFileId,
    }))
    await expectRejected('场景3 已删除但带有效签名地址', () => service.appendToResume({
      taskId, requester: anon, resumeFileId: deletedFileId, resumeFileUrl: signFileUrl(deletedFileId).url,
    }))
    for (const purpose of ['contract_upload', 'contract_review_report', 'id_scan', 'fair_material'] as const) {
      const fileId = await uploadPdf(null)
      await prisma.fileObject.update({ where: { id: fileId }, data: { purpose } })
      await expectRejected(`场景3 用途 ${purpose} 带有效签名地址也不合并`, () => service.appendToResume({
        taskId, requester: anon, resumeFileId: fileId, resumeFileUrl: signFileUrl(fileId).url,
      }))
    }
    for (const purpose of ['resume_upload', 'resume_scan'] as const) {
      const fileId = await uploadPdf(null, purpose)
      await expectAppended(`场景3 用途 ${purpose} 照常合并（对照）`, anon, fileId, signFileUrl(fileId).url, 'signed_url')
    }
  } finally {
    await cleanup()
  }
  console.log(`verify:self-assessment-append-file-scope：${passCount} PASS`)
}

main().catch((error: unknown) => {
  if (!(error instanceof Error) || !error.message.startsWith('VERIFY_FAILED')) {
    console.error(error)
  }
  process.exit(1)
})
