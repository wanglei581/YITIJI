import 'reflect-metadata'

/**
 * verify:upload-sessions（会员文档递进一体机）——
 * `POST /upload-sessions/:sessionId/member-file`：小程序已登录会员把自己「我的文档」里的
 * 一份文件递进一体机的手机上传会话。
 *
 * 真 Prisma（本作业的隔离库）+ 真 FilesService + 本地对象存储：本人归属与 404 口径、10MB、
 * 类型白名单与魔数、副本与原件的删除边界，全在真实代码里判。会话状态用 support 里的
 * FakeRedis（与 RedisService.compareAndSetSession 同一原子条件）。最后起一个只挂本控制器的
 * 最小 Nest 应用、随机端口打真实路由：会员守卫、DTO 白名单、错误信封、与 multipart 回执同形。
 *
 * 写会员 / 文件 / 审计行，跑完按 id 删净；对象存储用本脚本独占的临时目录。
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BadRequestException, Module, ValidationPipe, type DynamicModule } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import { memberSessionKey } from '../src/common/guards/end-user-auth.guard'
import { resolveJwtSecret } from '../src/common/jwt-verifier.module'
import { RedisService } from '../src/common/redis/redis.service'
import type { FilePurpose } from '../src/files/file.types'
import { FilesService } from '../src/files/files.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { StorageService } from '../src/storage/storage.service'
import { UploadSessionsController } from '../src/upload-sessions/upload-sessions.controller'
import { UploadSessionsService } from '../src/upload-sessions/upload-sessions.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import { buildRealPdf } from './support/minimal-pdf'
import { FakeRedis } from './support/upload-session-verifier'

const MB = 1024 * 1024
const PHONE_URL = 'http://localhost:5173/upload/phone'
const TERMINAL = 'KSK-PILOT-HZ-03'
// 1×1 真 PNG（过魔数校验）；大图在它后面补零 —— 解码器忽略 IEND 之后的字节。
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const MISMATCH_MESSAGE = '这台一体机现在登录的是另一个账号，不能把你的文档传进去'

interface Harness {
  prisma: PrismaService
  storage: StorageService
  files: FilesService
  endUserIds: string[]
  fileIds: Set<string>
  /** 本次用过的文件名与开跑时刻：断言失败时没记下 id 的匿名副本，按这两样兜底删。 */
  filenames: Set<string>
  startedAt: Date
}
type Created = { sessionId: string; uploadToken: string; controlToken: string; sceneToken: string; expiresAt: string }
type Rejection = { status: number; body: { error?: { code?: string; message?: string } } }

let passed = 0
function pass(label: string): void {
  passed += 1
  console.log(`  PASS ${label}`)
}

async function rejectionOf(run: () => Promise<unknown>): Promise<Rejection> {
  try {
    await run()
  } catch (error) {
    const e = error as { getStatus?: () => number; getResponse?: () => unknown }
    if (typeof e.getStatus === 'function') return { status: e.getStatus(), body: e.getResponse?.() as Rejection['body'] }
    throw error
  }
  throw new Error('expected a rejection, got success')
}

function expectError(r: Rejection, status: number, code: string, label: string): void {
  assert.equal(r.status, status, `${label}: HTTP ${r.status} ${JSON.stringify(r.body)}`)
  assert.equal(r.body.error?.code, code, `${label}: ${JSON.stringify(r.body)}`)
}

/** 包一层计数；测的是「有没有走到这一步」，不改被包方法的行为。 */
function countCalls(target: object, method: string): { readonly count: number; restore(): void } {
  const host = target as Record<string, unknown>
  const own = Object.prototype.hasOwnProperty.call(host, method)
  const original = host[method] as (...args: unknown[]) => unknown
  let count = 0
  host[method] = function (this: unknown, ...args: unknown[]) {
    count += 1
    return original.apply(this, args)
  }
  return {
    get count() { return count },
    restore() { if (own) host[method] = original; else delete host[method] },
  }
}

function freshService(h: Harness): { service: UploadSessionsService; redis: FakeRedis } {
  const redis = new FakeRedis()
  return { service: new UploadSessionsService(redis as never, h.prisma, h.files), redis }
}

function kioskSession(service: UploadSessionsService, purpose: FilePurpose = 'print_doc'): Promise<Created> {
  return service.create({ purpose, mode: 'temporary', channel: 'phone_h5', terminalId: TERMINAL, uploadUrl: PHONE_URL })
}

async function stored(redis: FakeRedis, sessionId: string): Promise<{ status: string; file: unknown; revision?: number }> {
  return JSON.parse((await redis.get(`upload_session:${sessionId}`)) ?? 'null')
}

async function member(h: Harness): Promise<string> {
  const id = `eu_${randomUUID().replace(/-/g, '')}`
  await h.prisma.endUser.create({ data: { id, phoneHash: `verify-member-file-${id}`, phoneEnc: 'verify-member-file' } })
  h.endUserIds.push(id)
  return id
}

/** 「我的文档」里的一份文件：走真 FilesService.upload 落库落对象，和线上会员文件同一条路。 */
async function document(
  h: Harness,
  owner: string | null,
  filename: string,
  buffer: Buffer,
  mimeType = 'application/pdf',
  purpose: FilePurpose = 'resume_upload',
): Promise<string> {
  h.filenames.add(filename)
  const res = await h.files.upload({ buffer, filename, mimeType, purpose, uploaderId: null, endUserId: owner })
  h.fileIds.add(res.fileId)
  return res.fileId
}

function push(service: UploadSessionsService, session: { sessionId: string; uploadToken: string }, fileId: string, endUserId: string) {
  return service.uploadMemberFile({ sessionId: session.sessionId, uploadToken: session.uploadToken, fileId, endUserId })
}

// ── a. 本人 PDF 递进 temporary 会话：落成匿名副本，一体机查得到、确认后拿到签名地址 ──────────
async function ownFileBecomesAnonymousCopy(h: Harness, K: string): Promise<void> {
  const originalId = await document(h, K, '王晓雯-个人简历-2026秋招.pdf', buildRealPdf(2))
  const original = await h.prisma.fileObject.findUniqueOrThrow({ where: { id: originalId } })
  const { service, redis } = freshService(h)
  const session = await kioskSession(service)
  // 小程序真实路径：扫码兑换场景码拿令牌，再递文件。
  const redeemed = await service.resolveScene(session.sceneToken)
  const receipt = await push(service, { sessionId: session.sessionId, uploadToken: redeemed.uploadToken }, originalId, K)
  const copyId = receipt.file?.fileId ?? ''
  h.fileIds.add(copyId)
  assert.equal(receipt.status, 'uploaded')
  assert.ok(copyId && copyId !== originalId, 'receipt must name a new file, not the member original')
  const copy = await h.prisma.fileObject.findUniqueOrThrow({ where: { id: copyId } })
  assert.equal(copy.endUserId, null)
  assert.equal(copy.ownerType, 'system')
  assert.equal(copy.purpose, 'print_doc', 'copy takes the session purpose')
  assert.equal(copy.filename, original.filename)
  assert.equal(copy.sha256, original.sha256, 'copy holds the same bytes')
  pass('a 本人 PDF 落成匿名副本（新 fileId、endUserId=null、按会话用途、字节相同）')

  const originalAfter = await h.prisma.fileObject.findUniqueOrThrow({ where: { id: originalId } })
  assert.equal(originalAfter.endUserId, K)
  assert.equal(originalAfter.deletedAt, null)
  assert.equal(originalAfter.storageKey, original.storageKey)
  for (const key of [`upload_session:${session.sessionId}`, `upload_session_cleanup:${session.sessionId}`]) {
    assert.equal((await redis.get(key))?.includes(originalId), false, `${key} must not hold the original file id`)
  }
  pass('a 原件不动；会话与清理记录里都没有原文件 id')

  const status = await service.getStatus(session.sessionId, session.controlToken)
  assert.equal(status.status, 'uploaded')
  assert.equal(status.file?.fileId, copyId)
  assert.equal(status.requiresKioskConfirmation, false)
  const confirmed = await service.confirm(session.sessionId, session.controlToken, null)
  assert.equal(confirmed.file.fileId, copyId)
  assert.match(confirmed.file.fileUrl ?? '', new RegExp(`^/api/v1/files/${copyId}/content\\?expires=\\d+&sig=[0-9a-f]{64}$`))
  pass('a 一体机 controlToken 查到同一份；confirm 拿到副本的签名地址')

  const audits = await h.prisma.auditLog.findMany({ where: { action: 'file.upload', targetId: copyId } })
  assert.equal(audits.length, 1)
  assert.equal(audits[0]!.actorId, null)
  assert.equal(audits[0]!.actorRole, 'enduser')
  assert.deepEqual(JSON.parse(audits[0]!.payloadJson), { source: 'upload_session_member_file', endUserId: K })
  pass('a 审计 file.upload：actorRole=enduser、payload 只有来源与会员 id（无文件名 / 原文件 id）')
}

// ── b. 别人的 / 不存在的 / 已删除的 / 匿名的 → 同一个 404，会话仍 pending，能接着递自己的 ─────
async function notOwnFilesAreNotFound(h: Harness, K: string, M: string): Promise<void> {
  const othersId = await document(h, M, '李晨阳-求职简历.pdf', buildRealPdf(1))
  const deletedId = await document(h, K, '王晓雯-简历-旧版.pdf', buildRealPdf(1))
  await h.files.systemDelete(deletedId, 'member removed it from 我的文档')
  const anonymousId = await document(h, null, '一体机现场上传-成绩单.pdf', buildRealPdf(1), 'application/pdf', 'print_doc')
  const missingId = randomUUID().replace(/-/g, '')
  const { service, redis } = freshService(h)
  const session = await kioskSession(service)
  const uploads = countCalls(h.files, 'upload')
  const bodies = new Set<string>()
  try {
    for (const fileId of [othersId, missingId, deletedId, anonymousId]) {
      const r = await rejectionOf(() => push(service, session, fileId, K))
      expectError(r, 404, 'FILE_NOT_FOUND', `not own ${fileId}`)
      assert.equal(JSON.stringify(r.body).includes(fileId), false, 'error must not echo the fileId')
      bodies.add(JSON.stringify(r.body))
      const now = await stored(redis, session.sessionId)
      assert.equal(now.status, 'pending')
      assert.equal(now.file, null)
    }
    assert.equal(bodies.size, 1, 'all four cases must be the same 404')
    assert.equal(uploads.count, 0, 'nothing may be written for a file the caller does not own')
  } finally {
    uploads.restore()
  }
  pass('b 别人的 / 不存在 / 已删除 / 匿名文件：同一个 404 FILE_NOT_FOUND、不带 fileId、会话仍 pending、没落任何副本')
  const ownId = await document(h, K, '王晓雯-实习证明.pdf', buildRealPdf(1))
  const receipt = await push(service, session, ownId, K)
  assert.equal(receipt.status, 'uploaded')
  h.fileIds.add(receipt.file!.fileId)
  pass('b 同一单接着递本人文件成功')
}

// ── c. 令牌错 / 已收到文件 / 过期 / 会话不存在 / 正在上传 ─────────────────────────────
async function sessionGates(h: Harness, K: string): Promise<void> {
  const ownId = await document(h, K, '王晓雯-获奖证书.pdf', buildRealPdf(1))
  const { service, redis } = freshService(h)
  const session = await kioskSession(service)
  const reads = countCalls(h.files, 'readContentForEndUser')
  try {
    const wrong = await rejectionOf(() => push(service, { sessionId: session.sessionId, uploadToken: 'x'.repeat(43) }, ownId, K))
    expectError(wrong, 403, 'UPLOAD_TOKEN_INVALID', 'wrong upload token')
    assert.equal((await stored(redis, session.sessionId)).status, 'pending')
    assert.equal(reads.count, 0, 'a bad token must not read the member file')
  } finally {
    reads.restore()
  }
  pass('c uploadToken 错 → 403 UPLOAD_TOKEN_INVALID，没读文件、会话仍 pending')

  const first = await push(service, session, ownId, K)
  h.fileIds.add(first.file!.fileId)
  expectError(await rejectionOf(() => push(service, session, ownId, K)), 400, 'UPLOAD_SESSION_NOT_PENDING', 'second push')
  pass('c 会话已收到文件再递 → 400 UPLOAD_SESSION_NOT_PENDING')

  const late = await kioskSession(service)
  const key = `upload_session:${late.sessionId}`
  const raw = JSON.parse((await redis.get(key)) ?? '{}') as { expiresAt?: string }
  raw.expiresAt = new Date(Date.now() - 1000).toISOString()
  await redis.setExistingWithCurrentTtl(key, JSON.stringify(raw))
  expectError(await rejectionOf(() => push(service, late, ownId, K)), 400, 'UPLOAD_SESSION_EXPIRED', 'expired session')
  pass('c 会话过期 → 400 UPLOAD_SESSION_EXPIRED')

  const gone = { sessionId: randomUUID().replace(/-/g, ''), uploadToken: session.uploadToken }
  expectError(await rejectionOf(() => push(service, gone, ownId, K)), 404, 'UPLOAD_SESSION_NOT_FOUND', 'missing session')
  const busy = await kioskSession(service)
  await redis.setEx(`upload_session_upload_lock:${busy.sessionId}`, 30, 'another-phone')
  expectError(await rejectionOf(() => push(service, busy, ownId, K)), 400, 'UPLOAD_SESSION_UPLOAD_IN_PROGRESS', 'locked session')
  pass('c 会话不存在 → 404 UPLOAD_SESSION_NOT_FOUND；另一部手机正在传 → 400 UPLOAD_SESSION_UPLOAD_IN_PROGRESS')
}

// ── d. 超过 10MB：先按登记大小挡（不整份读进内存），再按真实字节兜底；会话退回 pending ───────
async function tooLargeFallsBackToPending(h: Harness, K: string): Promise<void> {
  const big = Buffer.concat([PNG, Buffer.alloc(11 * MB)])
  const bigId = await document(h, K, '王晓雯-作品集-高清扫描.png', big, 'image/png')
  const understatedId = await document(h, K, '王晓雯-证件照-原图.png', big, 'image/png')
  await h.prisma.fileObject.update({ where: { id: understatedId }, data: { sizeBytes: 2048 } })
  const { service, redis } = freshService(h)
  const session = await kioskSession(service)
  const reads = countCalls(h.files, 'readContentForEndUser')
  const uploads = countCalls(h.files, 'upload')
  try {
    const r1 = await rejectionOf(() => push(service, session, bigId, K))
    expectError(r1, 400, 'FILE_TOO_LARGE', 'oversize own file')
    assert.equal(r1.body.error?.message, '文件超过 10MB，这台一体机这一单收不了')
    assert.equal(reads.count, 0, 'oversize by row must be refused before reading the bytes')
    assert.equal((await stored(redis, session.sessionId)).status, 'pending')
    expectError(await rejectionOf(() => push(service, session, understatedId, K)), 400, 'FILE_TOO_LARGE', 'bytes over 10MB')
    assert.equal(reads.count, 1, 'row said small, so the bytes were read and then refused')
    assert.equal((await stored(redis, session.sessionId)).status, 'pending')
    assert.equal(uploads.count, 0, 'no copy may be written for an oversize file')
  } finally {
    reads.restore()
    uploads.restore()
  }
  pass('d 超过 10MB → 400 FILE_TOO_LARGE（按登记大小先挡、没读字节；登记偏小时按真实字节兜底），会话退回 pending、没落副本')
  const smallId = await document(h, K, '王晓雯-证件照-压缩.png', PNG, 'image/png')
  const receipt = await push(service, session, smallId, K)
  h.fileIds.add(receipt.file!.fileId)
  assert.equal(receipt.status, 'uploaded')
  pass('d 换一份小文件接着递成功')
}

// ── e. 会话用途不收这个类型：打印单不收 txt（简历导出的文本件）→ 被拒、退回 pending ──────────
async function purposeRejectsType(h: Harness, K: string): Promise<void> {
  const txt = Buffer.from('王晓雯\n求职意向：新媒体运营\n2023.07–2025.06 杭州某文创公司 内容运营\n', 'utf8')
  const txtId = await document(h, K, '王晓雯-简历-AI导出.txt', txt, 'text/plain')
  const { service, redis } = freshService(h)
  const session = await kioskSession(service, 'print_doc')
  expectError(await rejectionOf(() => push(service, session, txtId, K)), 400, 'FILE_MIME_NOT_ALLOWED', 'txt into print_doc')
  assert.equal((await stored(redis, session.sessionId)).status, 'pending')
  const pdfId = await document(h, K, '王晓雯-简历-打印版.pdf', buildRealPdf(1))
  const receipt = await push(service, session, pdfId, K)
  h.fileIds.add(receipt.file!.fileId)
  assert.equal(receipt.status, 'uploaded')
  pass('e 打印单递 txt → 400 FILE_MIME_NOT_ALLOWED，会话退回 pending，换 PDF 成功')
}

// ── 同人校验 + f. member 会话：K 的会话 M 递 → 403 且会话一字不动；K 递 → 确认后进 K 的文件库 ──
async function memberSessionSamePersonAndArchive(h: Harness, K: string, M: string): Promise<void> {
  const { service, redis } = freshService(h)
  const session = await service.create({
    purpose: 'resume_upload', mode: 'member', channel: 'phone_h5', terminalId: TERMINAL, uploadUrl: PHONE_URL, endUserId: K,
  })
  const mFile = await document(h, M, '李晨阳-求职简历.pdf', buildRealPdf(1))
  const before = await redis.get(`upload_session:${session.sessionId}`)
  const reads = countCalls(h.files, 'readContentForEndUser')
  try {
    const r = await rejectionOf(() => push(service, session, mFile, M))
    expectError(r, 403, 'UPLOAD_SESSION_MEMBER_MISMATCH', 'other member into K session')
    assert.equal(r.body.error?.message, MISMATCH_MESSAGE)
    assert.equal(reads.count, 0, 'mismatch must be refused before reading the file')
  } finally {
    reads.restore()
  }
  assert.equal(await redis.get(`upload_session:${session.sessionId}`), before, 'session must not be written at all')
  pass('同人校验：一体机会员 K 的 member 会话，手机会员 M 递 → 403 UPLOAD_SESSION_MEMBER_MISMATCH，没读文件，会话一字不动')

  const kFile = await document(h, K, '王晓雯-个人简历-定稿.pdf', buildRealPdf(1))
  const kOriginal = await h.prisma.fileObject.findUniqueOrThrow({ where: { id: kFile } })
  const receipt = await push(service, session, kFile, K)
  const copyId = receipt.file!.fileId
  h.fileIds.add(copyId)
  assert.equal(receipt.status, 'uploaded')
  assert.equal(receipt.requiresKioskConfirmation, true)
  const anonymous = await h.prisma.fileObject.findUniqueOrThrow({ where: { id: copyId } })
  assert.equal(anonymous.endUserId, null)
  const kLiveBefore = await h.prisma.fileObject.count({ where: { endUserId: K, deletedAt: null } })
  pass('同人校验：K 自己递 → 成功（确认前仍是匿名副本）')

  const confirmed = await service.confirm(session.sessionId, session.controlToken, K)
  assert.equal(confirmed.status, 'confirmed')
  assert.equal(confirmed.file.fileId, copyId)
  const archived = await h.prisma.fileObject.findUniqueOrThrow({ where: { id: copyId } })
  assert.equal(archived.ownerType, 'user')
  assert.equal(archived.endUserId, K)
  assert.match(archived.storageKey, new RegExp(`^users/${K}/`))
  assert.equal(archived.replacedStorageKey, null)
  assert.equal(await h.storage.headObject(anonymous.storageKey, anonymous.bucket), null, 'anonymous object must be released')
  assert.equal(await h.prisma.fileObject.count({ where: { endUserId: K, deletedAt: null } }), kLiveBefore + 1)
  const kAfter = await h.prisma.fileObject.findUniqueOrThrow({ where: { id: kFile } })
  assert.equal(kAfter.deletedAt, null)
  assert.equal(kAfter.storageKey, kOriginal.storageKey)
  pass('f member 会话确认后走现有归档：K 的文件库多一份、匿名对象被释放、原件不动')

  const open = freshService(h)
  const temporary = await kioskSession(open.service)
  const mReceipt = await push(open.service, temporary, mFile, M)
  h.fileIds.add(mReceipt.file!.fileId)
  assert.equal(mReceipt.status, 'uploaded')
  pass('同人校验只管 member 会话：temporary 会话 M 照常能递')
}

// ── g. 作废 / 过期清理：只删副本，原件仍在、仍可读 ─────────────────────────────────────
async function abandonDeletesOnlyTheCopy(h: Harness, K: string): Promise<void> {
  for (const mode of ['cancel', 'expire'] as const) {
    const originalId = await document(h, K, `王晓雯-推荐信-${mode === 'cancel' ? '导师' : '实习主管'}.pdf`, buildRealPdf(1))
    const original = await h.prisma.fileObject.findUniqueOrThrow({ where: { id: originalId } })
    const { service } = freshService(h)
    const session = await kioskSession(service)
    const receipt = await push(service, session, originalId, K)
    const copyId = receipt.file!.fileId
    h.fileIds.add(copyId)
    const copy = await h.prisma.fileObject.findUniqueOrThrow({ where: { id: copyId } })
    if (mode === 'cancel') {
      await service.cancel(session.sessionId, session.controlToken)
    } else {
      const swept = await service.cleanupExpiredSessions(new Date(session.expiresAt).getTime() + 1)
      assert.equal(swept.cleaned, 1)
    }
    const copyAfter = await h.prisma.fileObject.findUniqueOrThrow({ where: { id: copyId } })
    assert.ok(copyAfter.deletedAt, `${mode}: copy must be tombstoned`)
    assert.equal(copyAfter.deleteReason, mode === 'cancel' ? 'upload session cancelled' : 'upload session expired')
    assert.ok(copyAfter.storageDeletedAt, `${mode}: copy object deletion recorded`)
    assert.equal(await h.storage.headObject(copy.storageKey, copy.bucket), null)
    const originalAfter = await h.prisma.fileObject.findUniqueOrThrow({ where: { id: originalId } })
    assert.equal(originalAfter.deletedAt, null)
    assert.ok(await h.storage.headObject(original.storageKey, original.bucket), `${mode}: original object must stay`)
    const again = await h.files.readContentForEndUser(originalId, K)
    assert.equal(again.buffer.length, original.sizeBytes)
  }
  pass('g 会话作废（DELETE）与过期清理都只删副本（墓碑 + 对象），原件仍在、本人仍可读')
}

// ── HTTP：真实路由 + 会员守卫 + DTO 白名单 + 错误信封 + 与 multipart 回执同形 ─────────────
@Module({})
class MemberFileHttpModule {
  static with(deps: { service: UploadSessionsService; jwt: JwtService; redis: FakeRedis; prisma: PrismaService }): DynamicModule {
    return {
      module: MemberFileHttpModule,
      controllers: [UploadSessionsController],
      providers: [
        { provide: UploadSessionsService, useValue: deps.service },
        { provide: JwtService, useValue: deps.jwt },
        { provide: RedisService, useValue: deps.redis },
        { provide: PrismaService, useValue: deps.prisma },
      ],
    }
  }
}

async function httpContract(h: Harness, K: string, M: string): Promise<void> {
  const { service, redis } = freshService(h)
  const jwt = new JwtService({ secret: resolveJwtSecret() })
  const app = await NestFactory.create(MemberFileHttpModule.with({ service, jwt, redis, prisma: h.prisma }), { logger: false })
  app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: () => new BadRequestException({ error: { code: 'VALIDATION_FAILED', message: '请求参数校验失败' } }),
  }))
  app.useGlobalFilters(new HttpExceptionFilter())
  await app.listen(0, '127.0.0.1')
  try {
    const address = app.getHttpServer().address() as { port: number }
    const base = `http://127.0.0.1:${address.port}/api/v1/upload-sessions`
    const tokenOf = async (endUserId: string): Promise<string> => {
      const sid = randomUUID()
      await redis.setEx(memberSessionKey(sid), 1800, endUserId)
      return jwt.sign({ sub: endUserId }, { jwtid: sid, audience: 'enduser', expiresIn: '30m' })
    }
    const call = async (sessionId: string, body: unknown, token?: string, headers: Record<string, string> = {}) => {
      const res = await fetch(`${base}/${sessionId}/member-file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
        body: JSON.stringify(body),
      })
      const text = await res.text()
      return { status: res.status, text, json: JSON.parse(text) as { success?: boolean; data?: any; error?: { code?: string; message?: string } } }
    }
    const kToken = await tokenOf(K)
    const mToken = await tokenOf(M)
    const kPdf = await document(h, K, '王晓雯-个人简历-2026秋招-终版.pdf', buildRealPdf(1))
    const mPdf = await document(h, M, '李晨阳-求职简历-终版.pdf', buildRealPdf(1))
    const session = await kioskSession(service)

    const anonymous = await call(session.sessionId, { uploadToken: session.uploadToken, fileId: kPdf })
    assert.equal(anonymous.status, 401)
    assert.equal(anonymous.json.error?.code, 'MEMBER_MISSING_TOKEN')
    for (const body of [
      { uploadToken: session.uploadToken },
      { uploadToken: session.uploadToken, fileId: kPdf, endUserId: M },
      { uploadToken: session.uploadToken, fileId: 'f'.repeat(65) },
    ]) {
      const r = await call(session.sessionId, body, kToken)
      assert.equal(r.status, 400, JSON.stringify(body))
      assert.equal(r.json.error?.code, 'VALIDATION_FAILED')
    }
    pass('HTTP 未登录 → 401 MEMBER_MISSING_TOKEN；缺 fileId / 夹带 endUserId / fileId 超长 → 400 VALIDATION_FAILED')

    const notMine = await call(session.sessionId, { uploadToken: session.uploadToken, fileId: mPdf }, kToken)
    assert.equal(notMine.status, 404)
    assert.deepEqual(notMine.json.error, { code: 'FILE_NOT_FOUND', message: '文件不存在或已被清理' })
    assert.equal(notMine.json.success, false)
    assert.equal(notMine.text.includes(mPdf), false)
    const memberSession = await service.create({
      purpose: 'resume_upload', mode: 'member', channel: 'phone_h5', terminalId: TERMINAL, uploadUrl: PHONE_URL, endUserId: K,
    })
    const mismatch = await call(memberSession.sessionId, { uploadToken: memberSession.uploadToken, fileId: mPdf }, mToken)
    assert.equal(mismatch.status, 403)
    assert.deepEqual(mismatch.json.error, { code: 'UPLOAD_SESSION_MEMBER_MISMATCH', message: MISMATCH_MESSAGE })
    pass('HTTP 别人的文件 → 404 FILE_NOT_FOUND（不回显 fileId）；会员不符 → 403 原文案')

    const ok = await call(session.sessionId, { uploadToken: session.uploadToken, fileId: kPdf }, kToken)
    assert.equal(ok.status, 201, ok.text)
    assert.equal(ok.json.success, true)
    h.fileIds.add(ok.json.data.file.fileId)
    const phone = await kioskSession(service)
    const form = new FormData()
    form.append('uploadToken', phone.uploadToken)
    h.filenames.add('手机相册-简历.pdf')
    form.append('file', new Blob([new Uint8Array(buildRealPdf(1))], { type: 'application/pdf' }), '手机相册-简历.pdf')
    const multipart = await fetch(`${base}/${phone.sessionId}/files`, { method: 'POST', body: form })
    const multipartJson = (await multipart.json()) as { data: any }
    h.fileIds.add(multipartJson.data.file.fileId)
    assert.deepEqual(Object.keys(ok.json.data).sort(), Object.keys(multipartJson.data).sort())
    assert.deepEqual(Object.keys(ok.json.data.file).sort(), Object.keys(multipartJson.data.file).sort())
    assert.equal(ok.json.data.status, multipartJson.data.status)
    pass('HTTP 本人文件 → 201 success，回执与 :sessionId/files 完全同形')

    const plain = await h.prisma.auditLog.findFirstOrThrow({ where: { action: 'file.upload', targetId: ok.json.data.file.fileId } })
    assert.equal('clientDeclaration' in JSON.parse(plain.payloadJson), false)
    const declared = await kioskSession(service)
    const withHeaders = await call(declared.sessionId, { uploadToken: declared.uploadToken, fileId: kPdf }, kToken, {
      'X-Age-14-Plus': 'declared', 'X-Age-14-Plus-Version': 'age14-2026-09',
    })
    assert.equal(withHeaders.status, 201, withHeaders.text)
    h.fileIds.add(withHeaders.json.data.file.fileId)
    const audit = await h.prisma.auditLog.findFirstOrThrow({ where: { action: 'file.upload', targetId: withHeaders.json.data.file.fileId } })
    const payload = JSON.parse(audit.payloadJson) as { clientDeclaration?: { age14?: { status?: string } } }
    assert.equal(payload.clientDeclaration?.age14?.status, 'declared')
    pass('HTTP 审计：没带声明头不记 clientDeclaration，带了照原入口的形状记')
  } finally {
    await app.close()
  }
}

async function cleanup(h: Harness): Promise<void> {
  const owned = await h.prisma.fileObject.findMany({ where: { endUserId: { in: h.endUserIds } }, select: { id: true } })
  const strays = await h.prisma.fileObject.findMany({
    where: { createdAt: { gte: h.startedAt }, filename: { in: [...h.filenames] } },
    select: { id: true },
  })
  const ids = [...new Set([...h.fileIds, ...owned, ...strays].map((row) => (typeof row === 'string' ? row : row.id)))].filter(Boolean)
  if (ids.length > 0) {
    await h.prisma.auditLog.deleteMany({ where: { targetType: 'file', targetId: { in: ids } } })
    await h.prisma.fileObject.deleteMany({ where: { id: { in: ids } } })
  }
  if (h.endUserIds.length > 0) await h.prisma.endUser.deleteMany({ where: { id: { in: h.endUserIds } } })
}

async function main(): Promise<void> {
  // 本脚本要写会员 / 文件 / 审计行。和同链的 verify-upload-sessions-faults.ts 一样自行声明隔离目标
  // （CI 那几行没有前缀）；库名仍须带 ci/dev/test/verify、PG 仍须回环地址，否则直接拒跑。
  process.env['VERIFICATION_DATABASE_TARGET'] ||= 'isolated'
  assertIsolatedVerificationDatabase()
  process.env['FILE_STORAGE_DRIVER'] = 'local'
  const storageDir = mkdtempSync(path.join(tmpdir(), 'verify-upload-member-file-'))
  process.env['FILE_STORAGE_DIR'] = storageDir
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const storage = new StorageService()
  const files = new FilesService(prisma, { write: async () => null } as never, storage)
  const h: Harness = { prisma, storage, files, endUserIds: [], fileIds: new Set(), filenames: new Set(), startedAt: new Date() }
  // 各段互不依赖（各自建会话、建文件），逐段跑完再汇总：一处红不遮住后面的段。
  const failed: string[] = []
  try {
    const K = await member(h)
    const M = await member(h)
    const cases: Array<[string, () => Promise<void>]> = [
      ['a', () => ownFileBecomesAnonymousCopy(h, K)],
      ['b', () => notOwnFilesAreNotFound(h, K, M)],
      ['c', () => sessionGates(h, K)],
      ['d', () => tooLargeFallsBackToPending(h, K)],
      ['e', () => purposeRejectsType(h, K)],
      ['同人校验/f', () => memberSessionSamePersonAndArchive(h, K, M)],
      ['g', () => abandonDeletesOnlyTheCopy(h, K)],
      ['HTTP', () => httpContract(h, K, M)],
    ]
    for (const [name, run] of cases) {
      try {
        await run()
      } catch (error) {
        failed.push(name)
        console.error(`  FAIL ${name}: ${(error as Error).message.split('\n')[0]}`)
      }
    }
  } finally {
    try {
      await cleanup(h)
    } finally {
      await prisma.onModuleDestroy()
      rmSync(storageDir, { recursive: true, force: true })
    }
  }
  if (failed.length > 0) throw new Error(`member-file verification failed: ${failed.join(', ')}`)
  console.log(`PASS upload session member-file verification (${passed} checks)`)
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
