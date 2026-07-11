/**
 * COS 文件服务 E2E 验证(打 dev.db,用本地后端,自清理)。
 *
 * 用本地存储后端跑通 FilesService 全链路 + 归属鉴权,验证 COS 接入后:
 *   - 上传落库带 bucket/region/ownerType/ownerId/status,objectKey 前缀正确
 *   - 服务端读回字节一致(StorageService 后端 round-trip)
 *   - 用户/机构隔离:跨用户、跨机构、机构访问用户文件 全部拒绝
 *   - 管理员访问用户文件 → needsAdminAudit=true(controller 据此落审计)
 *   - upload-intent → raw 写入 → complete 直传闭环
 *   - 软删除:记录软删 + 物理对象回收
 *
 * Run: pnpm --filter @ai-job-print/api verify:cos:files
 */
import 'dotenv/config'
import { randomUUID } from 'crypto'
import * as os from 'os'
import * as path from 'path'
import { promises as fs } from 'fs'

// 强制本地后端 + 隔离的临时存储目录(跑完删除)。
const TMP_STORAGE = path.join(os.tmpdir(), `cos-verify-${randomUUID().slice(0, 8)}`)
process.env['FILE_STORAGE_DRIVER'] = 'local'
process.env['FILE_STORAGE_DIR'] = TMP_STORAGE

import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { StorageService } from '../src/storage/storage.service'
import { FilesService, canAccessFile, type FileRequester } from '../src/files/files.service'

let passed = 0
function pass(msg: string) {
  passed++
  console.log(`  PASS ${msg}`)
}
function fail(msg: string): never {
  console.error(`  FAIL ${msg}`)
  process.exit(1)
}
function ok(cond: boolean, msg: string) {
  cond ? pass(msg) : fail(msg)
}
async function expectThrow(fn: () => Promise<unknown>, msg: string) {
  try {
    await fn()
    fail(`${msg}(预期抛错但未抛)`)
  } catch {
    pass(msg)
  }
}
async function expectThrowCode(fn: () => Promise<unknown>, code: string, msg: string) {
  try {
    await fn()
    fail(`${msg}(预期抛错但未抛)`)
  } catch (err) {
    const body = (err as { getResponse?: () => unknown }).getResponse?.() as { error?: { code?: string } } | undefined
    if (body?.error?.code === code) pass(msg)
    else fail(`${msg}(错误码 ${body?.error?.code ?? '(无)'} ≠ ${code})`)
  }
}

async function main() {
  console.log('\n=== COS 文件服务 E2E(本地后端)===')
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const storage = new StorageService()
  const files = new FilesService(prisma, audit, storage)

  const sfx = randomUUID().replace(/-/g, '').slice(0, 10)
  const eu1 = `eu1_${sfx}`
  const eu2 = `eu2_${sfx}`
  const org1 = `org1_${sfx}`
  const org2 = `org2_${sfx}`
  const p1 = `p1_${sfx}`
  const admin1 = `admin1_${sfx}`
  const createdFileIds: string[] = []

  const memberEu1: FileRequester = { kind: 'member', endUserId: eu1 }
  const memberEu2: FileRequester = { kind: 'member', endUserId: eu2 }
  const partner1: FileRequester = { kind: 'user', userId: p1, role: 'partner', orgId: org1 }
  const partner2: FileRequester = { kind: 'user', userId: 'pX', role: 'partner', orgId: org2 }
  const adminReq: FileRequester = { kind: 'user', userId: admin1, role: 'admin', orgId: null }

  try {
    await prisma.endUser.create({ data: { id: eu1, phoneHash: `h1${sfx}`, phoneEnc: `e1${sfx}` } })
    await prisma.endUser.create({ data: { id: eu2, phoneHash: `h2${sfx}`, phoneEnc: `e2${sfx}` } })
    await prisma.organization.create({ data: { id: org1, name: '机构1', type: 'school_employment_center' } })
    await prisma.organization.create({ data: { id: org2, name: '机构2', type: 'school_employment_center' } })
    await prisma.user.create({ data: { id: p1, username: `pu${sfx}`, passwordHash: 'x', name: 'P1', role: 'partner', orgId: org1 } })
    await prisma.user.create({ data: { id: admin1, username: `au${sfx}`, passwordHash: 'x', name: 'A1', role: 'admin' } })

    // ── A. 用户简历上传(代理上传 → 本地后端)─────────────────────────────
    console.log('\n[A] 用户简历上传 + round-trip')
    const bytes = Buffer.from('%PDF-1.4 resume content ' + sfx)
    const up = await files.upload({
      buffer: bytes,
      filename: 'resume.pdf',
      mimeType: 'application/pdf',
      purpose: 'resume_upload',
      uploaderId: null,
      endUserId: eu1,
    })
    createdFileIds.push(up.fileId)
    const rec = await prisma.fileObject.findUnique({ where: { id: up.fileId } })
    ok(rec?.bucket === 'local-fs' && rec?.region === 'local', '落库 bucket/region 为本地哨兵')
    ok(rec?.ownerType === 'user' && rec?.ownerId === eu1, 'ownerType=user / ownerId=endUserId')
    ok(rec?.status === 'active' && rec?.visibility === 'private', 'status=active / visibility=private')
    ok(rec?.storageKey === `users/${eu1}/resumes/${up.fileId}.pdf`, `objectKey 前缀正确: ${rec?.storageKey}`)
    ok(rec?.sensitiveLevel === 'highly_sensitive', '简历默认 highly_sensitive')
    const read = await files.readContent(up.fileId)
    ok(read.buffer.equals(bytes), 'readContent round-trip 字节一致')
    const scopedRead = await files.readContentForEndUser(up.fileId, eu1)
    ok(scopedRead.buffer.equals(bytes), 'readContentForEndUser 本人会员 round-trip 字节一致')
    await expectThrow(() => files.readContentForEndUser(up.fileId, eu2), 'readContentForEndUser 拒绝其他会员读取本人外简历')
    await expectThrow(() => files.readContentForEndUser(up.fileId, null), 'readContentForEndUser 拒绝匿名读取会员简历')

    const anon = await files.upload({
      buffer: Buffer.from('%PDF-1.4 anonymous resume ' + sfx),
      filename: 'anon-resume.pdf',
      mimeType: 'application/pdf',
      purpose: 'resume_upload',
      uploaderId: null,
      endUserId: null,
    })
    createdFileIds.push(anon.fileId)
    const anonRead = await files.readContentForEndUser(anon.fileId, null)
    ok(anonRead.buffer.includes(Buffer.from('anonymous resume')), 'readContentForEndUser 允许匿名读取匿名简历')
    await expectThrow(() => files.readContentForEndUser(anon.fileId, eu1), 'readContentForEndUser 拒绝会员身份借读匿名简历')

    // ── B. 归属鉴权(隔离)──────────────────────────────────────────────
    console.log('\n[B] 归属鉴权')
    ok(canAccessFile(rec!, memberEu1) === true, '本人会员可访问自己简历')
    ok(canAccessFile(rec!, memberEu2) === false, '其他会员不可访问他人简历')
    ok(canAccessFile(rec!, partner1) === false, '合作机构不可访问用户简历')
    ok(canAccessFile(rec!, adminReq) === true, '管理员可访问用户简历')

    await expectThrow(() => files.getAccessUrl(up.fileId, memberEu2, 'inline'), '会员越权获取预览 URL 被拒')
    const selfPreview = await files.getAccessUrl(up.fileId, memberEu1, 'inline')
    ok(selfPreview.response.disposition === 'inline' && selfPreview.needsAdminAudit === false, '本人预览成功且不触发管理员审计')
    const adminDl = await files.getAccessUrl(up.fileId, adminReq, 'attachment')
    ok(adminDl.needsAdminAudit === true, '管理员访问用户文件 → needsAdminAudit=true(应落审计)')
    ok(adminDl.response.url.includes('disposition=attachment'), '下载 URL 带 attachment')

    // ── C. 机构文件隔离 ─────────────────────────────────────────────────
    console.log('\n[C] 机构文件隔离')
    // 真 JPEG 魔数(FF D8 FF)。注意不能用 Buffer.from('\xff…')(默认 utf8 会把
    // U+00FF 编成 C3 BF,过不了魔数校验)。
    const img = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from(' jpeg ' + sfx)])
    const pf = await files.upload({
      buffer: img,
      filename: 'job.jpg',
      mimeType: 'image/jpeg',
      purpose: 'partner_image',
      uploaderId: p1,
      actorRole: 'partner',
      actorOrgId: org1,
    })
    createdFileIds.push(pf.fileId)
    const pfRec = await prisma.fileObject.findUnique({ where: { id: pf.fileId } })
    ok(pfRec?.ownerType === 'partner' && pfRec?.ownerId === org1, '机构文件 ownerType=partner / ownerId=orgId')
    ok(pfRec?.storageKey === `partners/${org1}/job-images/${pf.fileId}.jpg`, `机构图片 objectKey 前缀正确: ${pfRec?.storageKey}`)
    ok(canAccessFile(pfRec!, partner1) === true, '本机构可访问本机构文件')
    ok(canAccessFile(pfRec!, partner2) === false, '其他机构不可访问本机构文件')
    ok(canAccessFile(pfRec!, memberEu1) === false, '会员不可访问机构文件')
    ok(canAccessFile(pfRec!, adminReq) === true, '管理员可访问机构文件')

    // ── D. 直传意图 → raw 写入 → complete ──────────────────────────────
    console.log('\n[D] upload-intent → raw 写入 → complete')
    const intent = await files.createUploadIntent({
      body: { purpose: 'admin_upload', filename: 'doc.pdf', mimeType: 'application/pdf', sizeBytes: 1000 },
      uploaderId: admin1,
      actorRole: 'admin',
      actorOrgId: null,
    })
    createdFileIds.push(intent.fileId)
    ok(intent.direct === false && intent.uploadMethod === 'PUT', '本地后端直传 direct=false / PUT')
    ok(intent.uploadUrl.includes(`/files/${intent.fileId}/raw`), 'uploadUrl 指向本地代理 raw 端点')
    const intentRec = await prisma.fileObject.findUnique({ where: { id: intent.fileId } })
    ok(intentRec?.status === 'uploading', '意图创建后 status=uploading')
    ok(intentRec?.storageKey === `admin/uploads/${intent.fileId}.pdf`, 'admin 直传 objectKey 前缀正确')
    await expectThrow(() => files.readContentForEndUser(intent.fileId, null), 'readContentForEndUser 拒绝匿名读取后台文件')

    const docBytes = Buffer.from('%PDF-1.4 admin doc ' + sfx)
    await files.writeRawUpload(intent.fileId, docBytes)
    const afterRaw = await prisma.fileObject.findUnique({ where: { id: intent.fileId } })
    ok(afterRaw?.status === 'active' && afterRaw?.sizeBytes === docBytes.length, 'raw 写入后 status=active / size 正确')
    ok((afterRaw?.sha256?.length ?? 0) === 64, 'raw 写入后 sha256 已计算')

    const completed = await files.completeUpload(intent.fileId, adminReq)
    ok(completed.status === 'active' && completed.sizeBytes === docBytes.length, 'complete 复核 headObject 通过')

    // ── E. 软删除 ───────────────────────────────────────────────────────
    console.log('\n[E] 软删除 + 物理回收')
    const del = await files.ownerDelete(up.fileId, memberEu1, '本人删除')
    ok(del.deletedAt !== null && del.status === 'deleted', '软删后 deletedAt 非空 / status=deleted')
    await expectThrow(() => files.readContent(up.fileId), '软删后 readContent 视为不存在')
    // 物理对象应被删除
    const localPath = path.join(TMP_STORAGE, `users/${eu1}/resumes/${up.fileId}.pdf`)
    let physicallyGone = false
    try {
      await fs.access(localPath)
    } catch {
      physicallyGone = true
    }
    ok(physicallyGone, '软删后物理对象已回收')

    // ── F. 魔数校验(content-sniff):声明 MIME 必须与真实字节一致 ─────────
    console.log('\n[F] 上传魔数校验(FILE_CONTENT_MISMATCH)')
    const baseArgs = { purpose: 'resume_upload' as const, uploaderId: null, endUserId: null }
    await expectThrowCode(
      () => files.upload({ ...baseArgs, buffer: Buffer.from('plain text, definitely not a pdf'), filename: 'fake.pdf', mimeType: 'application/pdf' }),
      'FILE_CONTENT_MISMATCH',
      '文本字节伪装 application/pdf 被拒(FILE_CONTENT_MISMATCH)',
    )
    const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'latin1')
    await expectThrowCode(
      () => files.upload({ ...baseArgs, buffer: pdfBytes, filename: 'fake.png', mimeType: 'image/png' }),
      'FILE_CONTENT_MISMATCH',
      'PDF 字节伪装 image/png 被拒',
    )
    await expectThrowCode(
      () => files.upload({ ...baseArgs, buffer: pdfBytes, filename: 'fake.txt', mimeType: 'text/plain' }),
      'FILE_CONTENT_MISMATCH',
      'PDF 字节伪装 text/plain 被拒(二进制走私文本声明)',
    )
    const realPng = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('png payload ' + sfx),
    ])
    const pngUp = await files.upload({ ...baseArgs, buffer: realPng, filename: 'real.png', mimeType: 'image/png' })
    createdFileIds.push(pngUp.fileId)
    pass('真 PNG 声明 image/png 正常通过')
    const txtUp = await files.upload({ ...baseArgs, buffer: Buffer.from('纯文本简历导出 ' + sfx, 'utf8'), filename: 'resume.txt', mimeType: 'text/plain' })
    createdFileIds.push(txtUp.fileId)
    pass('纯文本声明 text/plain(purpose=resume_upload)正常通过')
  } finally {
    await prisma.fileObject.deleteMany({ where: { id: { in: createdFileIds } } })
    await prisma.user.deleteMany({ where: { id: { in: [p1, admin1] } } })
    await prisma.organization.deleteMany({ where: { id: { in: [org1, org2] } } })
    await prisma.endUser.deleteMany({ where: { id: { in: [eu1, eu2] } } })
    await prisma.onModuleDestroy()
    await fs.rm(TMP_STORAGE, { recursive: true, force: true }).catch(() => undefined)
  }

  console.log(`\nALL PASS (${passed} checks)`)
}

main().catch((error: unknown) => {
  console.error('\nFatal error:', (error as Error).message)
  console.error((error as Error).stack)
  process.exit(1)
})
