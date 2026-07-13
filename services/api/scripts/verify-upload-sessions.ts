import 'reflect-metadata'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-upload-sessions-secret-0123456789-abcdef'

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import zlib from 'node:zlib'
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { validateUpload, DEFAULT_SENSITIVE_BY_PURPOSE } from '../src/files/file-validation'
import { sniffDeclaredMimeMismatch } from '../src/files/content-sniff'
import type { FilePurpose, FileUploadResponse } from '../src/files/file.types'
import { UploadSessionsService } from '../src/upload-sessions/upload-sessions.service'

// ── PNG fixture 生成器(复制自 verify-print-conversion.ts / verify-id-photo.ts)──
// 生成真实、可通过 content-sniff 魔数校验的最小 PNG:colorType=2(RGB truecolor)、
// bitDepth=8、无 alpha、CRC32 现算现填 —— 不是凭空手写的伪造字节。
const CRC_TABLE: number[] = (() => {
  const table: number[] = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii')
  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32BE(data.length, 0)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf])
}

function makePng(width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(width, 0)
  ihdrData.writeUInt32BE(height, 4)
  ihdrData[8] = 8 // bit depth
  ihdrData[9] = 2 // color type: truecolor RGB
  ihdrData[10] = 0 // compression method
  ihdrData[11] = 0 // filter method
  ihdrData[12] = 0 // interlace method: none
  const ihdr = pngChunk('IHDR', ihdrData)

  const rowBytes = 1 + width * 3 // filter byte + RGB
  const raw = Buffer.alloc(rowBytes * height)
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowBytes
    raw[rowStart] = 0 // filter type: None
    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 3
      raw[px] = Math.floor((x * 255) / Math.max(width - 1, 1))
      raw[px + 1] = Math.floor((y * 255) / Math.max(height - 1, 1))
      raw[px + 2] = 128
    }
  }
  const idat = pngChunk('IDAT', zlib.deflateSync(raw))
  const iend = pngChunk('IEND', Buffer.alloc(0))

  return Buffer.concat([signature, ihdr, idat, iend])
}

interface StoredFile {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  sha256: string
  purpose: FilePurpose
  sensitiveLevel: string
  endUserId: string | null
  ownerType: string
  ownerId: string | null
  deletedAt: Date | null
  expiresAt: Date | null
  retentionPolicy: string | null
  retentionSetBy: string | null
  retentionConsentAt: Date | null
  retentionConsentVersion: string | null
}

class FakeRedis {
  private readonly values = new Map<string, { value: string; expiresAt: number }>()

  async get(key: string): Promise<string | null> {
    const entry = this.values.get(key)
    if (!entry) return null
    if (entry.expiresAt <= Date.now()) {
      this.values.delete(key)
      return null
    }
    return entry.value
  }

  async setEx(key: string, ttlSeconds: number, value: string): Promise<void> {
    this.values.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 })
  }

  async ttl(key: string): Promise<number> {
    const entry = this.values.get(key)
    if (!entry) return -2
    return Math.max(1, Math.ceil((entry.expiresAt - Date.now()) / 1000))
  }

  async setExistingWithCurrentTtl(key: string, value: string): Promise<'missing' | 'updated'> {
    const entry = this.values.get(key)
    if (!entry || entry.expiresAt <= Date.now()) return 'missing'
    this.values.set(key, { ...entry, value })
    return 'updated'
  }

  async setNxEx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    if (await this.get(key)) return false
    this.values.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 })
    return true
  }

  async del(key: string): Promise<number> {
    const existed = this.values.delete(key)
    return existed ? 1 : 0
  }
}

class FakePrisma {
  readonly files = new Map<string, StoredFile>()

  readonly fileObject = {
    findUnique: async ({ where }: { where: { id: string } }) => this.files.get(where.id) ?? null,
    update: async ({ where, data, select }: { where: { id: string }; data: Partial<StoredFile>; select?: { expiresAt?: boolean } }) => {
      const current = this.files.get(where.id)
      if (!current) throw new Error(`file not found: ${where.id}`)
      const next = { ...current, ...data }
      this.files.set(where.id, next)
      if (select?.expiresAt) return { expiresAt: next.expiresAt }
      return next
    },
  }
}

class FakeFilesService {
  private next = 1

  constructor(private readonly prisma: FakePrisma) {}

  async upload(args: {
    buffer: Buffer
    filename: string
    mimeType: string
    purpose: FilePurpose
    endUserId?: string | null
  }): Promise<FileUploadResponse> {
    const validation = validateUpload({
      purpose: args.purpose,
      mimeType: args.mimeType,
      filename: args.filename,
      sizeBytes: args.buffer.length,
      mode: 'proxy',
    })
    if (!validation.ok) {
      throw new BadRequestException({ error: { code: validation.code, message: validation.message } })
    }
    // 与真实 FilesService.upload 同款魔数校验(files/content-sniff.ts),
    // 保证本脚本的拒绝断言走的是同一条服务端校验链。
    const sniff = sniffDeclaredMimeMismatch(args.buffer, args.mimeType)
    if (!sniff.ok) {
      throw new BadRequestException({
        error: { code: 'FILE_CONTENT_MISMATCH', message: '文件内容与声明的类型不一致，请检查文件后重新上传' },
      })
    }
    const id = `file_${this.next++}`
    const file: StoredFile = {
      id,
      filename: args.filename,
      mimeType: args.mimeType,
      sizeBytes: args.buffer.length,
      sha256: `sha_${id}`,
      purpose: args.purpose,
      sensitiveLevel: DEFAULT_SENSITIVE_BY_PURPOSE[args.purpose],
      endUserId: args.endUserId ?? null,
      ownerType: args.endUserId ? 'user' : 'system',
      ownerId: args.endUserId ?? null,
      deletedAt: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      retentionPolicy: 'system_short',
      retentionSetBy: 'system',
      retentionConsentAt: null,
      retentionConsentVersion: null,
    }
    this.prisma.files.set(id, file)
    return {
      fileId: id,
      filename: file.filename,
      sizeBytes: file.sizeBytes,
      mimeType: file.mimeType,
      sha256: file.sha256,
      signedUrl: `https://files.local/${id}`,
      signedUrlExpiresAt: new Date(Date.now() + 60 * 1000).toISOString(),
      fileExpiresAt: file.expiresAt?.toISOString() ?? null,
    }
  }

  async forceDelete(fileId: string, deletedBy: string, reason: string): Promise<unknown> {
    const current = this.prisma.files.get(fileId)
    if (!current) throw new Error(`file not found: ${fileId}`)
    const next = {
      ...current,
      deletedAt: new Date(),
      deletedBy,
      deleteReason: reason,
      status: 'deleted',
    } as StoredFile
    this.prisma.files.set(fileId, next)
    return next
  }
}

class FakeAudit {
  readonly entries: Array<{ action: string; targetId?: string | null; payload?: Record<string, unknown> }> = []
  async write(args: { action: string; targetId?: string | null; payload?: Record<string, unknown> }): Promise<string | null> {
    this.entries.push(args)
    return 'audit_1'
  }
}

function makeService(): { service: UploadSessionsService; prisma: FakePrisma; audit: FakeAudit } {
  const redis = new FakeRedis()
  const prisma = new FakePrisma()
  const files = new FakeFilesService(prisma)
  const audit = new FakeAudit()
  return {
    service: new UploadSessionsService(redis as never, prisma as never, files as never, audit as never),
    prisma,
    audit,
  }
}

function file(args?: Partial<Express.Multer.File>): Express.Multer.File {
  const buffer = args?.buffer ?? Buffer.from('%PDF-1.4 resume')
  return {
    fieldname: 'file',
    originalname: args?.originalname ?? 'resume.pdf',
    encoding: '7bit',
    mimetype: args?.mimetype ?? 'application/pdf',
    size: args?.size ?? buffer.length,
    buffer,
    stream: undefined as never,
    destination: '',
    filename: '',
    path: '',
  }
}

async function expectRejects<T extends Error>(
  action: () => Promise<unknown>,
  errorType: new (...args: never[]) => T,
  label: string,
): Promise<void> {
  let rejected = false
  try {
    await action()
  } catch (error) {
    rejected = true
    assert.ok(error instanceof errorType, `${label}: expected ${errorType.name}, got ${(error as Error).constructor.name}`)
  }
  assert.equal(rejected, true, `${label}: expected rejection`)
}

async function main(): Promise<void> {
  {
    const { service, prisma } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    const uploaded = await service.uploadFile({ sessionId: session.sessionId, uploadToken: session.uploadToken, file: file() })
    assert.equal(uploaded.status, 'uploaded')
    assert.equal(uploaded.file?.filename, 'resume.pdf')
    assert.equal('signedUrl' in uploaded.file!, false)
    assert.equal(prisma.files.get(uploaded.file!.fileId)?.endUserId, null)
    await expectRejects(() => service.getStatus(session.sessionId, undefined), ForbiddenException, 'status requires control token')
    const status = await service.getStatus(session.sessionId, session.controlToken)
    assert.equal(status.file?.fileId, uploaded.file?.fileId)
    assert.equal('signedUrl' in status.file!, false)
  }

  {
    const { service } = makeService()
    await expectRejects(
      () => service.create({ purpose: 'resume_upload', mode: 'member', channel: 'phone_h5', uploadUrl: 'http://localhost:5173/upload/phone' }),
      UnauthorizedException,
      'member session requires kiosk member token',
    )
  }

  {
    const { service, prisma } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'member',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
      endUserId: 'member_1',
    })
    const uploaded = await service.uploadFile({ sessionId: session.sessionId, uploadToken: session.uploadToken, file: file() })
    assert.equal(prisma.files.get(uploaded.file!.fileId)?.endUserId, null)
    const confirmed = await service.confirm(session.sessionId, session.controlToken, 'member_1')
    assert.equal(confirmed.status, 'confirmed')
    assert.equal('signedUrl' in confirmed.file, false)
    const bound = prisma.files.get(uploaded.file!.fileId)
    assert.equal(bound?.endUserId, 'member_1')
    assert.equal(bound?.ownerType, 'user')
    assert.equal(bound?.retentionPolicy, 'months_3')
  }

  {
    const { service } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'member',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
      endUserId: 'member_1',
    })
    await service.uploadFile({ sessionId: session.sessionId, uploadToken: session.uploadToken, file: file() })
    await expectRejects(() => service.confirm(session.sessionId, session.controlToken, 'member_2'), ForbiddenException, 'member mismatch denied')
    await expectRejects(() => service.confirm(session.sessionId, 'bad-control', 'member_1'), ForbiddenException, 'invalid control token denied')
  }

  {
    const { service } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    await service.uploadFile({ sessionId: session.sessionId, uploadToken: session.uploadToken, file: file() })
    await expectRejects(
      () => service.uploadFile({ sessionId: session.sessionId, uploadToken: session.uploadToken, file: file() }),
      BadRequestException,
      'upload token cannot be reused',
    )
  }

  {
    const { service } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    await expectRejects(
      () => service.uploadFile({
        sessionId: session.sessionId,
        uploadToken: session.uploadToken,
        file: file({ buffer: Buffer.alloc(10 * 1024 * 1024 + 1), size: 10 * 1024 * 1024 + 1 }),
      }),
      BadRequestException,
      'phone resume upload is capped at 10MB',
    )
  }

  {
    const { service } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    await expectRejects(
      () => service.uploadFile({ sessionId: session.sessionId, uploadToken: session.uploadToken, file: file({ originalname: 'resume.exe', mimetype: 'application/pdf' }) }),
      BadRequestException,
      'extension mismatch rejected through file validation',
    )
    // 魔数校验:文件名/声明 MIME 全对但真实字节不是 PDF(伪装 PDF)→ 服务端拒绝
    await expectRejects(
      () => service.uploadFile({
        sessionId: session.sessionId,
        uploadToken: session.uploadToken,
        file: file({ buffer: Buffer.from('this is not a pdf at all'), originalname: 'resume.pdf', mimetype: 'application/pdf' }),
      }),
      BadRequestException,
      'fake PDF payload rejected by content sniffing (FILE_CONTENT_MISMATCH)',
    )
    const retry = await service.uploadFile({ sessionId: session.sessionId, uploadToken: session.uploadToken, file: file() })
    assert.equal(retry.status, 'uploaded')
  }

  {
    const { service } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    await expectRejects(
      () => service.uploadFile({ sessionId: session.sessionId, uploadToken: session.uploadToken, file: file({ originalname: 'resume.txt', mimetype: 'text/plain' }) }),
      BadRequestException,
      'plain text resume upload is rejected by server validation',
    )
  }

  {
    const { service, prisma } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    await expectRejects(
      () => service.uploadFile({ sessionId: session.sessionId, uploadToken: 'bad-token', file: file() }),
      ForbiddenException,
      'invalid upload token rejected',
    )
  }

  {
    const { service } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    await service.uploadFile({ sessionId: session.sessionId, uploadToken: session.uploadToken, file: file() })
    await service.confirm(session.sessionId, session.controlToken)
    await expectRejects(() => service.cancel(session.sessionId, session.controlToken), BadRequestException, 'confirmed session cannot be cancelled')
  }

  {
    const { service, prisma } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    const uploaded = await service.uploadFile({ sessionId: session.sessionId, uploadToken: session.uploadToken, file: file() })
    await service.cancel(session.sessionId, session.controlToken)
    assert.notEqual(prisma.files.get(uploaded.file!.fileId)?.deletedAt, null)
  }

  {
    const { service, prisma } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'member',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
      endUserId: 'member_1',
    })
    const uploaded = await service.uploadFile({ sessionId: session.sessionId, uploadToken: session.uploadToken, file: file() })
    const current = prisma.files.get(uploaded.file!.fileId)!
    prisma.files.set(uploaded.file!.fileId, {
      ...current,
      endUserId: 'member_1',
      ownerType: 'user',
      ownerId: 'member_1',
    })
    await service.cancel(session.sessionId, session.controlToken)
    assert.equal(prisma.files.get(uploaded.file!.fileId)?.deletedAt, null, 'bound member file must not be deleted by abandoned cleanup')
  }

  {
    const { service } = makeService()
    await expectRejects(
      () => service.create({ purpose: 'admin_upload', mode: 'temporary', channel: 'phone_h5', uploadUrl: 'http://localhost:5173/upload/phone' }),
      BadRequestException,
      'unsupported purpose rejected at session creation',
    )
  }

  {
    // print_doc: confirm 必须签发本系统 HMAC 内容 URL,供打印任务创建复用(kiosk-upload 同款契约)。
    const { service } = makeService()
    const session = await service.create({
      purpose: 'print_doc',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    await service.uploadFile({ sessionId: session.sessionId, uploadToken: session.uploadToken, file: file({ originalname: 'doc.pdf' }) })
    const confirmed = await service.confirm(session.sessionId, session.controlToken)
    assert.equal(confirmed.status, 'confirmed')
    assert.match(confirmed.file.fileUrl ?? '', /^\/api\/v1\/files\/.+\/content\?expires=\d+&sig=[0-9a-f]+$/, 'print_doc confirm must return a signed content URL')
  }

  {
    // resume_upload 维持原契约:confirm 不应携带 fileUrl(打印域专属字段不应外溢到简历流程)。
    const { service } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    await service.uploadFile({ sessionId: session.sessionId, uploadToken: session.uploadToken, file: file() })
    const confirmed = await service.confirm(session.sessionId, session.controlToken)
    assert.equal(confirmed.file.fileUrl, undefined, 'resume_upload confirm must not carry a print fileUrl')
  }

  {
    // print_doc + member: 仍走同一 bindMemberFile 归属逻辑,但 print_doc 不在 90 天默认名单内,应落短 TTL。
    const { service, prisma } = makeService()
    const session = await service.create({
      purpose: 'print_doc',
      mode: 'member',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
      endUserId: 'member_1',
    })
    const uploaded = await service.uploadFile({ sessionId: session.sessionId, uploadToken: session.uploadToken, file: file({ originalname: 'doc.pdf' }) })
    const confirmed = await service.confirm(session.sessionId, session.controlToken, 'member_1')
    assert.match(confirmed.file.fileUrl ?? '', /^\/api\/v1\/files\//, 'print_doc member confirm must also carry a signed fileUrl')
    const bound = prisma.files.get(uploaded.file!.fileId)
    assert.equal(bound?.endUserId, 'member_1')
    assert.equal(bound?.retentionPolicy, 'system_short', 'print_doc must not get the 90-day resume retention default even when bound to a member')
  }

  {
    // id_scan(设计 §4.7):手机扫码上传证件照 → confirm 签发签名 fileUrl(供 Kiosk 取源排版
    // 复用为 IdPhotoService.verifySourceOwnership 的 fileAccessUrl)+ 补齐此前完全缺失的
    // upload-session 上传审计。
    const { service, prisma, audit } = makeService()
    const session = await service.create({
      purpose: 'id_scan',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    const uploaded = await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file({ buffer: makePng(600, 800), originalname: 'id-photo.png', mimetype: 'image/png' }),
    })
    assert.equal(uploaded.status, 'uploaded')
    assert.equal(uploaded.file?.filename, 'id-photo.png')
    assert.equal(prisma.files.get(uploaded.file!.fileId)?.purpose, 'id_scan')

    const confirmed = await service.confirm(session.sessionId, session.controlToken)
    assert.equal(confirmed.status, 'confirmed')
    assert.match(
      confirmed.file.fileUrl ?? '',
      /^\/api\/v1\/files\/.+\/content\?expires=\d+&sig=[0-9a-f]+$/,
      'id_scan confirm must return a signed content URL usable as fileAccessUrl',
    )

    const uploadAudit = audit.entries.find((e) => e.action === 'file.upload' && e.targetId === uploaded.file!.fileId)
    assert.ok(uploadAudit, 'id_scan phone upload must write a file.upload audit entry (previously entirely missing)')
    assert.equal(uploadAudit?.payload?.['channel'], 'upload_session')
    assert.equal(uploadAudit?.payload?.['purpose'], 'id_scan')
    assert.equal(uploadAudit?.payload?.['sessionId'], session.sessionId)
  }

  {
    // id_scan 会话上传 application/pdf → IMG-only 白名单自动拒绝(validateUpload FILE_MIME_NOT_ALLOWED)。
    const { service } = makeService()
    const session = await service.create({
      purpose: 'id_scan',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    await expectRejects(
      () => service.uploadFile({
        sessionId: session.sessionId,
        uploadToken: session.uploadToken,
        file: file({ originalname: 'doc.pdf', mimetype: 'application/pdf' }),
      }),
      BadRequestException,
      'id_scan session rejects PDF upload via IMG-only whitelist',
    )
  }

  {
    // 回归:resume_upload / print_doc 手机上传路径此前完全没有审计,现补齐后
    // 三个 purpose 均应各写一条 file.upload 审计,互不影响、不重复。
    const { service, audit } = makeService()
    const resumeSession = await service.create({
      purpose: 'resume_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    await service.uploadFile({ sessionId: resumeSession.sessionId, uploadToken: resumeSession.uploadToken, file: file() })
    const uploadAudits = audit.entries.filter((e) => e.action === 'file.upload')
    assert.equal(uploadAudits.length, 1, 'resume_upload phone upload should also gain exactly one upload audit entry')
    assert.equal(uploadAudits[0]?.payload?.['purpose'], 'resume_upload')
  }

  {
    const controller = readFileSync(new URL('../src/upload-sessions/upload-sessions.controller.ts', import.meta.url), 'utf8')
    assert.match(
      controller,
      /@Get\(':sessionId'\)\n\s+@Throttle\(\{ default: \{ ttl: 60_000, limit: 60 \} \}\)/,
      'status polling endpoint should have a wide throttle',
    )
  }

  console.log('PASS upload session verification')
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
