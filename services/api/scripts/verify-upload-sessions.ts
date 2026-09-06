import 'reflect-metadata'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-upload-sessions-secret-0123456789-abcdef'

import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { validateUpload, DEFAULT_SENSITIVE_BY_PURPOSE } from '../src/files/file-validation'
import { CONTRACT_REVIEW_TTL_MS, defaultRetentionForUpload } from '../src/files/retention-policy'
import { sniffDeclaredMimeMismatch } from '../src/files/content-sniff'
import type { FilePurpose, FileUploadResponse } from '../src/files/file.types'
import { UploadSessionsService } from '../src/upload-sessions/upload-sessions.service'
import { FilesCleanupTask } from '../src/files/files.cleanup.task'
import { FilesService } from '../src/files/files.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { StorageService } from '../src/storage/storage.service'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

const ISOLATED_DATABASE = process.env['VERIFICATION_DATABASE_TARGET'] === 'isolated'
const REAL_STORAGE_DIR = path.join('/tmp', `verify-upload-sessions-${process.pid}`)
if (ISOLATED_DATABASE) process.env['FILE_STORAGE_DIR'] = REAL_STORAGE_DIR

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
  retentionLockedReason: string | null
}

class FakeRedis {
  private readonly values = new Map<string, { value: string; expiresAt: number }>()
  private readonly sortedSets = new Map<string, Map<string, number>>()

  get client(): this {
    return this
  }

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
    const current = this.values.get(key)
    if (current && current.expiresAt > Date.now()) return false
    if (current) this.values.delete(key)
    this.values.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 })
    return true
  }

  async del(key: string): Promise<number> {
    const existed = this.values.delete(key)
    return existed ? 1 : 0
  }

  async zAdd(key: string, score: number, member: string): Promise<void> {
    const index = this.sortedSets.get(key) ?? new Map<string, number>()
    index.set(member, score)
    this.sortedSets.set(key, index)
  }

  zadd(key: string, score: number, member: string): Promise<void> {
    return this.zAdd(key, score, member)
  }

  async zRangeByScore(key: string, maxScore: number, limit: number): Promise<string[]> {
    return [...(this.sortedSets.get(key) ?? new Map()).entries()]
      .filter(([, score]) => score <= maxScore)
      .sort(([, left], [, right]) => left - right)
      .slice(0, limit)
      .map(([member]) => member)
  }

  zrangebyscore(
    key: string,
    _min: string,
    maxScore: number,
    _limit: string,
    _offset: number,
    limit: number,
  ): Promise<string[]> {
    return this.zRangeByScore(key, maxScore, limit)
  }

  async zRem(key: string, member: string): Promise<void> {
    this.sortedSets.get(key)?.delete(member)
  }

  zrem(key: string, member: string): Promise<void> {
    return this.zRem(key, member)
  }

  hasSortedSetMember(key: string, member: string): boolean {
    return this.sortedSets.get(key)?.has(member) ?? false
  }

  hasLiveKey(key: string): boolean {
    const entry = this.values.get(key)
    return Boolean(entry && entry.expiresAt > Date.now())
  }
}

class FakePrisma {
  readonly files = new Map<string, StoredFile>()
  readonly fileUpdateCalls: Array<{ id: string; data: Partial<StoredFile> }> = []

  readonly fileObject = {
    findUnique: async ({ where }: { where: { id: string } }) => this.files.get(where.id) ?? null,
    update: async ({
      where,
      data,
      select,
    }: {
      where: { id: string }
      data: Partial<StoredFile>
      select?: { expiresAt?: boolean }
    }) => {
      const current = this.files.get(where.id)
      if (!current) throw new Error(`file not found: ${where.id}`)
      this.fileUpdateCalls.push({ id: where.id, data })
      const next = { ...current, ...data }
      this.files.set(where.id, next)
      if (select?.expiresAt) return { expiresAt: next.expiresAt }
      return next
    },
  }
}

class FakeFilesService {
  private next = 1
  readonly uploadCalls: Array<{ purpose: FilePurpose; filename: string }> = []
  readonly storedObjects = new Set<string>()
  readonly deletionLog: Array<{ fileId: string; deletedBy: string; reason: string }> = []

  constructor(
    private readonly prisma: FakePrisma,
    private readonly beforeUpload?: (callNumber: number) => Promise<void>
  ) {}

  async upload(args: {
    buffer: Buffer
    filename: string
    mimeType: string
    purpose: FilePurpose
    endUserId?: string | null
  }): Promise<FileUploadResponse> {
    this.uploadCalls.push({ purpose: args.purpose, filename: args.filename })
    await this.beforeUpload?.(this.uploadCalls.length)
    const validation = validateUpload({
      purpose: args.purpose,
      mimeType: args.mimeType,
      filename: args.filename,
      sizeBytes: args.buffer.length,
      mode: 'proxy',
    })
    if (!validation.ok) {
      throw new BadRequestException({
        error: { code: validation.code, message: validation.message },
      })
    }
    // 与真实 FilesService.upload 同款魔数校验(files/content-sniff.ts),
    // 保证本脚本的拒绝断言走的是同一条服务端校验链。
    const sniff = sniffDeclaredMimeMismatch(args.buffer, args.mimeType)
    if (!sniff.ok) {
      throw new BadRequestException({
        error: {
          code: 'FILE_CONTENT_MISMATCH',
          message: '文件内容与声明的类型不一致，请检查文件后重新上传',
        },
      })
    }
    const id = `file_${this.next++}`
    const sensitiveLevel = DEFAULT_SENSITIVE_BY_PURPOSE[args.purpose]
    const retention = defaultRetentionForUpload({
      purpose: args.purpose,
      sensitiveLevel,
      ownerType: args.endUserId ? 'user' : 'system',
      endUserId: args.endUserId ?? null,
    })
    const file: StoredFile = {
      id,
      filename: args.filename,
      mimeType: args.mimeType,
      sizeBytes: args.buffer.length,
      sha256: `sha_${id}`,
      purpose: args.purpose,
      sensitiveLevel,
      endUserId: args.endUserId ?? null,
      ownerType: args.endUserId ? 'user' : 'system',
      ownerId: args.endUserId ?? null,
      deletedAt: null,
      expiresAt: retention.expiresAt,
      retentionPolicy: retention.retentionPolicy,
      retentionSetBy: retention.retentionSetBy,
      retentionConsentAt: retention.retentionConsentAt,
      retentionConsentVersion: retention.retentionConsentVersion,
      retentionLockedReason:
        args.purpose === 'contract_upload' ? 'contract_review_session_only' : null,
    }
    this.prisma.files.set(id, file)
    this.storedObjects.add(id)
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
    this.storedObjects.delete(fileId)
    this.deletionLog.push({ fileId, deletedBy, reason })
    return next
  }

  async systemDelete(fileId: string, reason: string): Promise<unknown> {
    return this.forceDelete(fileId, 'system', reason)
  }

}

function makeService(options?: { beforeUpload?: (callNumber: number) => Promise<void> }): {
  service: UploadSessionsService
  prisma: FakePrisma
  files: FakeFilesService
  redis: FakeRedis
} {
  const redis = new FakeRedis()
  const prisma = new FakePrisma()
  const files = new FakeFilesService(prisma, options?.beforeUpload)
  return {
    service: new UploadSessionsService(redis as never, prisma as never, files as never),
    prisma,
    files,
    redis,
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
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
  label: string
): Promise<void> {
  let rejected = false
  try {
    await action()
  } catch (error) {
    rejected = true
    assert.ok(
      error instanceof errorType,
      `${label}: expected ${errorType.name}, got ${(error as Error).constructor.name}`
    )
  }
  assert.equal(rejected, true, `${label}: expected rejection`)
}

async function main(): Promise<void> {
  {
    const { service, prisma } = makeService()
    const session = await service.create({
      purpose: 'contract_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    const beforeUpload = Date.now()
    const uploaded = await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file({ originalname: 'contract.pdf' }),
    })
    const stored = prisma.files.get(uploaded.file!.fileId)
    assert.equal(stored?.sensitiveLevel, 'highly_sensitive')
    assert.equal(stored?.retentionPolicy, 'system_short')
    assert.equal(stored?.retentionSetBy, 'system')
    assert.equal(stored?.retentionLockedReason, 'contract_review_session_only')
    assert.ok(stored?.expiresAt)
    assert.ok(
      stored!.expiresAt!.getTime() >= beforeUpload + CONTRACT_REVIEW_TTL_MS &&
        stored!.expiresAt!.getTime() <= Date.now() + CONTRACT_REVIEW_TTL_MS,
      'temporary contract upload must expire exactly two hours after upload'
    )
    const confirmed = await service.confirm(session.sessionId, session.controlToken)
    assert.match(
      confirmed.file.fileUrl ?? '',
      /^\/api\/v1\/files\/.+\/content\?expires=\d+&sig=[0-9a-f]+$/,
      'contract upload confirmation must mint a signed content URL for anonymous proof'
    )
  }

  {
    const { service, prisma } = makeService()
    const session = await service.create({
      purpose: 'contract_upload',
      mode: 'member',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
      endUserId: 'member_contract',
    })
    const uploaded = await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file({ originalname: 'contract.pdf' }),
    })
    const originalExpiry = prisma.files.get(uploaded.file!.fileId)?.expiresAt?.toISOString()
    await service.confirm(session.sessionId, session.controlToken, 'member_contract')
    const bound = prisma.files.get(uploaded.file!.fileId)
    assert.equal(bound?.endUserId, 'member_contract')
    assert.equal(bound?.ownerType, 'user')
    assert.equal(
      bound?.retentionPolicy,
      'system_short',
      'member binding must not promote contract uploads to 90 days'
    )
    assert.equal(bound?.retentionLockedReason, 'contract_review_session_only')
    assert.equal(
      bound?.expiresAt?.toISOString(),
      originalExpiry,
      'member binding must preserve the original session expiry'
    )
  }

  {
    const { service, prisma } = makeService()
    const session = await service.create({
      purpose: 'contract_upload',
      mode: 'member',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
      endUserId: 'member_missing_expiry',
    })
    const uploaded = await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file({ originalname: 'contract.pdf' }),
    })
    const stored = prisma.files.get(uploaded.file!.fileId)!
    prisma.files.set(stored.id, { ...stored, expiresAt: null })

    let caught: unknown
    try {
      await service.confirm(session.sessionId, session.controlToken, 'member_missing_expiry')
    } catch (error) {
      caught = error
    }
    assert.ok(caught instanceof BadRequestException)
    const response = caught.getResponse() as { error?: { code?: string; message?: string } }
    assert.equal(response.error?.code, 'CONTRACT_FILE_EXPIRY_MISSING')
    assert.doesNotMatch(response.error?.message ?? '', /expiresAt|null|contract/i)
    assert.equal(prisma.fileUpdateCalls.length, 0, 'missing expiry must fail before file update')
    assert.equal(prisma.files.get(stored.id)?.endUserId, null)
  }

  {
    const { service, prisma } = makeService()
    const session = await service.create({
      purpose: 'contract_upload',
      mode: 'member',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
      endUserId: 'member_concurrent',
    })
    const uploaded = await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file({ originalname: 'contract.pdf' }),
    })
    const originalExpiry = prisma.files.get(uploaded.file!.fileId)!.expiresAt!.toISOString()

    const results = await Promise.allSettled([
      service.confirm(session.sessionId, session.controlToken, 'member_concurrent'),
      service.confirm(session.sessionId, session.controlToken, 'member_concurrent'),
    ])
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1)
    const bound = prisma.files.get(uploaded.file!.fileId)!
    assert.equal(bound.expiresAt?.toISOString(), originalExpiry)
    assert.equal(bound.retentionLockedReason, 'contract_review_session_only')
    assert.ok(
      prisma.fileUpdateCalls.every(
        (call) =>
          call.data.expiresAt?.toISOString() === originalExpiry &&
          call.data.retentionLockedReason === 'contract_review_session_only'
      ),
      `winning binding must preserve expiry and never clear the retention lock: ${JSON.stringify(
        prisma.fileUpdateCalls
      )}`
    )
  }

  {
    const { service, files } = makeService()
    const session = await service.create({
      purpose: 'contract_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file({ originalname: '' }),
    })
    assert.equal(files.uploadCalls[0]?.filename, 'contract.pdf')
  }

  {
    const { service, prisma } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    const uploaded = await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file(),
    })
    assert.equal(uploaded.status, 'uploaded')
    assert.equal(uploaded.file?.filename, 'resume.pdf')
    assert.equal('signedUrl' in uploaded.file!, false)
    assert.equal(prisma.files.get(uploaded.file!.fileId)?.endUserId, null)
    await expectRejects(
      () => service.getStatus(session.sessionId, undefined),
      ForbiddenException,
      'status requires control token'
    )
    const status = await service.getStatus(session.sessionId, session.controlToken)
    assert.equal(status.file?.fileId, uploaded.file?.fileId)
    assert.equal('signedUrl' in status.file!, false)
  }

  {
    const { service } = makeService()
    await expectRejects(
      () =>
        service.create({
          purpose: 'resume_upload',
          mode: 'member',
          channel: 'phone_h5',
          uploadUrl: 'http://localhost:5173/upload/phone',
        }),
      UnauthorizedException,
      'member session requires kiosk member token'
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
    const uploaded = await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file(),
    })
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
    const { service, prisma, files } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    const uploaded = await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file(),
    })
    const result = await service.cleanupExpiredSessions(new Date(session.expiresAt).getTime() + 1)
    assert.equal(result.cleaned, 1, 'expired unread session must be collected by one scheduler run')
    assert.notEqual(prisma.files.get(uploaded.file!.fileId)?.deletedAt, null)
    assert.equal(files.storedObjects.has(uploaded.file!.fileId), false, 'expired unread storage object must be deleted')
    assert.deepEqual(files.deletionLog[0], {
      fileId: uploaded.file!.fileId,
      deletedBy: 'system',
      reason: 'upload session expired',
    })
  }

  {
    const { service, prisma, files } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    const uploaded = await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file(),
    })
    const recordKey = `upload_session:${session.sessionId}`
    const raw = await (service as unknown as { redis: FakeRedis }).redis.get(recordKey)
    assert.ok(raw)
    await (service as unknown as { redis: FakeRedis }).redis.setExistingWithCurrentTtl(
      recordKey,
      JSON.stringify({ ...JSON.parse(raw!), expiresAt: new Date(Date.now() - 1).toISOString() })
    )
    const race = await Promise.allSettled([
      service.confirm(session.sessionId, session.controlToken),
      service.cleanupExpiredSessions(Date.now()),
    ])
    assert.equal(race.filter((entry) => entry.status === 'fulfilled').length, 1, 'only confirm or expiry cleanup may win')
    assert.equal(race.filter((entry) => entry.status === 'rejected').length, 1)
    assert.notEqual(prisma.files.get(uploaded.file!.fileId)?.deletedAt, null)
    assert.equal(files.deletionLog.length, 1)
  }

  {
    const { service } = makeService()
    const warnings: string[] = []
    const task = new FilesCleanupTask({} as never, service)
    ;(task as unknown as { logger: { warn(message: string): void; log(message: string): void } }).logger = {
      warn: (message) => warnings.push(message),
      log: () => undefined,
    }
    ;(service as unknown as { cleanupExpiredSessions: () => Promise<never> }).cleanupExpiredSessions = async () => {
      throw new Error('redis unavailable')
    }
    await task.handleEveryMinute()
    assert.deepEqual(warnings, ['code=UPLOAD_SESSION_CLEANUP_SKIPPED reason=redis_unavailable'])
  }

  {
    const { service } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      terminalId: 'Terminal Display Name',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    let exception: unknown
    try {
      await service.getStatus(session.sessionId, 'bad-control-token')
    } catch (error) {
      exception = error
    }
    assert.ok(exception instanceof ForbiddenException)
    let body: unknown
    const response = {
      status: () => ({ json: (value: unknown) => { body = value } }),
    }
    new HttpExceptionFilter().catch(exception, {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({
          method: 'GET',
          route: { path: '/upload-sessions/:sessionId' },
          originalUrl: `/upload-sessions/${session.sessionId}`,
          headers: { authorization: `Bearer ${session.controlToken}` },
          requestId: 'verify-request',
          requestStartedAt: Date.now(),
        }),
      }),
    } as never)
    const serialized = JSON.stringify(body)
    for (const forbidden of [session.uploadToken, session.controlToken, 'Terminal Display Name', 'bad-control-token']) {
      assert.equal(serialized.includes(forbidden), false, `phone error envelope leaked ${forbidden}`)
    }
    assert.doesNotMatch(serialized, /\bat\s+.+\(/, 'phone error envelope must not expose a stack frame')
    assert.match(serialized, /UPLOAD_SESSION_CONTROL_INVALID/)
  }

  {
    const { service, prisma, files } = makeService()
    const session = await service.create({
      purpose: 'print_doc',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    const uploaded = await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file({ originalname: 'print.pdf' }),
    })
    await service.confirm(session.sessionId, session.controlToken)
    assert.equal(
      (service as unknown as { redis: FakeRedis }).redis.hasSortedSetMember(
        'upload_session_expiry_index',
        session.sessionId,
      ),
      false,
      'confirmation must immediately remove its expiry cleanup index entry',
    )
    const result = await service.cleanupExpiredSessions(new Date(session.expiresAt).getTime() + 1)
    assert.equal(result.cleaned, 0, 'confirmed session must be removed from expiry cleanup')
    assert.equal(prisma.files.get(uploaded.file!.fileId)?.deletedAt, null)
    assert.equal(files.storedObjects.has(uploaded.file!.fileId), true)
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
    await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file(),
    })
    await expectRejects(
      () => service.confirm(session.sessionId, session.controlToken, 'member_2'),
      ForbiddenException,
      'member mismatch denied'
    )
    await expectRejects(
      () => service.confirm(session.sessionId, 'bad-control', 'member_1'),
      ForbiddenException,
      'invalid control token denied'
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
    await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file(),
    })
    await expectRejects(
      () =>
        service.uploadFile({
          sessionId: session.sessionId,
          uploadToken: session.uploadToken,
          file: file(),
        }),
      BadRequestException,
      'upload token cannot be reused'
    )
  }

  {
    const uploadEntered = deferred()
    const releaseUpload = deferred()
    const { service, prisma, files, redis } = makeService({
      beforeUpload: async (callNumber) => {
        if (callNumber === 1) {
          uploadEntered.resolve()
          await releaseUpload.promise
        }
      },
    })
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    const lockKey = `upload_session_upload_lock:${session.sessionId}`
    const originalGet = redis.get.bind(redis)
    const lockReadersReady = deferred()
    let lockReaders = 0
    redis.get = async (key: string) => {
      if (key === lockKey) {
        lockReaders += 1
        if (lockReaders === 2) lockReadersReady.resolve()
        await lockReadersReady.promise
      }
      return originalGet(key)
    }

    const request = () =>
      service.uploadFile({
        sessionId: session.sessionId,
        uploadToken: session.uploadToken,
        file: file(),
      })
    const first = request()
    const second = request()
    await uploadEntered.promise

    const asSettled = (promise: Promise<unknown>) =>
      promise.then(
        (value) => ({ status: 'fulfilled' as const, value }),
        (reason: unknown) => ({ status: 'rejected' as const, reason })
      )
    try {
      const earlyResult = await Promise.race([asSettled(first), asSettled(second)])
      assert.equal(
        earlyResult.status,
        'rejected',
        'the competing request must reject while the lock holder is still uploading'
      )
    } finally {
      releaseUpload.resolve()
    }

    const results = await Promise.allSettled([first, second])
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1)
    assert.equal(files.uploadCalls.length, 1)
    assert.equal(prisma.files.size, 1)
    assert.equal(redis.hasLiveKey(lockKey), false, 'upload lock must be cleaned after completion')
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
      () =>
        service.uploadFile({
          sessionId: session.sessionId,
          uploadToken: session.uploadToken,
          file: file({ buffer: Buffer.alloc(10 * 1024 * 1024 + 1), size: 10 * 1024 * 1024 + 1 }),
        }),
      BadRequestException,
      'phone resume upload is capped at 10MB'
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
      () =>
        service.uploadFile({
          sessionId: session.sessionId,
          uploadToken: session.uploadToken,
          file: file({ originalname: 'resume.exe', mimetype: 'application/pdf' }),
        }),
      BadRequestException,
      'extension mismatch rejected through file validation'
    )
    // 魔数校验:文件名/声明 MIME 全对但真实字节不是 PDF(伪装 PDF)→ 服务端拒绝
    await expectRejects(
      () =>
        service.uploadFile({
          sessionId: session.sessionId,
          uploadToken: session.uploadToken,
          file: file({
            buffer: Buffer.from('this is not a pdf at all'),
            originalname: 'resume.pdf',
            mimetype: 'application/pdf',
          }),
        }),
      BadRequestException,
      'fake PDF payload rejected by content sniffing (FILE_CONTENT_MISMATCH)'
    )
    const retry = await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file(),
    })
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
      () =>
        service.uploadFile({
          sessionId: session.sessionId,
          uploadToken: session.uploadToken,
          file: file({ originalname: 'resume.txt', mimetype: 'text/plain' }),
        }),
      BadRequestException,
      'plain text resume upload is rejected by server validation'
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
      () =>
        service.uploadFile({
          sessionId: session.sessionId,
          uploadToken: 'bad-token',
          file: file(),
        }),
      ForbiddenException,
      'invalid upload token rejected'
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
    await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file(),
    })
    await service.confirm(session.sessionId, session.controlToken)
    await expectRejects(
      () => service.cancel(session.sessionId, session.controlToken),
      BadRequestException,
      'confirmed session cannot be cancelled'
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
    const uploaded = await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file(),
    })
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
    const uploaded = await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file(),
    })
    const current = prisma.files.get(uploaded.file!.fileId)!
    prisma.files.set(uploaded.file!.fileId, {
      ...current,
      endUserId: 'member_1',
      ownerType: 'user',
      ownerId: 'member_1',
    })
    await service.cancel(session.sessionId, session.controlToken)
    assert.equal(
      prisma.files.get(uploaded.file!.fileId)?.deletedAt,
      null,
      'bound member file must not be deleted by abandoned cleanup'
    )
  }

  {
    const { service } = makeService()
    await expectRejects(
      () =>
        service.create({
          purpose: 'admin_upload',
          mode: 'temporary',
          channel: 'phone_h5',
          uploadUrl: 'http://localhost:5173/upload/phone',
        }),
      BadRequestException,
      'unsupported purpose rejected at session creation'
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
    await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file({ originalname: 'doc.pdf' }),
    })
    const confirmed = await service.confirm(session.sessionId, session.controlToken)
    assert.equal(confirmed.status, 'confirmed')
    assert.match(
      confirmed.file.fileUrl ?? '',
      /^\/api\/v1\/files\/.+\/content\?expires=\d+&sig=[0-9a-f]+$/,
      'print_doc confirm must return a signed content URL'
    )
  }

  {
    // resume_upload:confirm 签发短时内容 URL，供一体机在提交诊断前核对原文件。
    const { service } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file(),
    })
    const confirmed = await service.confirm(session.sessionId, session.controlToken)
    assert.match(
      confirmed.file.fileUrl ?? '',
      /^\/api\/v1\/files\/.+\/content\?expires=\d+&sig=[0-9a-f]+$/,
      'resume_upload confirm must return a signed preview URL'
    )
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
    const uploaded = await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file({ originalname: 'doc.pdf' }),
    })
    const confirmed = await service.confirm(session.sessionId, session.controlToken, 'member_1')
    assert.match(
      confirmed.file.fileUrl ?? '',
      /^\/api\/v1\/files\//,
      'print_doc member confirm must also carry a signed fileUrl'
    )
    const bound = prisma.files.get(uploaded.file!.fileId)
    assert.equal(bound?.endUserId, 'member_1')
    assert.equal(
      bound?.retentionPolicy,
      'system_short',
      'print_doc must not get the 90-day resume retention default even when bound to a member'
    )
  }

  {
    const controller = readFileSync(
      new URL('../src/upload-sessions/upload-sessions.controller.ts', import.meta.url),
      'utf8'
    )
    assert.match(
      controller,
      /@Get\(':sessionId'\)\n\s+@Throttle\(\{ default: \{ ttl: 60_000, limit: 60 \} \}\)/,
      'status polling endpoint should have a wide throttle'
    )
  }

  if (ISOLATED_DATABASE) {
    assertIsolatedVerificationDatabase()
    const prisma = new PrismaService()
    const storage = new StorageService()
    const files = new FilesService(prisma, { write: async () => null } as never, storage)
    const redis = new FakeRedis()
    const service = new UploadSessionsService(redis as never, prisma, files)
    try {
      const session = await service.create({
        purpose: 'resume_upload',
        mode: 'temporary',
        channel: 'phone_h5',
        uploadUrl: 'http://localhost:5173/upload/phone',
      })
      const uploaded = await service.uploadFile({
        sessionId: session.sessionId,
        uploadToken: session.uploadToken,
        file: file({ originalname: 'isolated-expiry.pdf' }),
      })
      const before = await prisma.fileObject.findUnique({ where: { id: uploaded.file!.fileId } })
      assert.ok(before)
      assert.ok(await storage.headObject(before.storageKey, before.bucket))

      const cleanup = await service.cleanupExpiredSessions(new Date(session.expiresAt).getTime() + 1)
      assert.equal(cleanup.cleaned, 1)
      const after = await prisma.fileObject.findUnique({ where: { id: uploaded.file!.fileId } })
      assert.ok(after?.deletedAt, 'expired unread FileObject must have a deletion tombstone')
      assert.equal(after?.deletedBy, 'system')
      assert.equal(after?.deleteReason, 'upload session expired')
      assert.ok(after?.storageDeletedAt, 'physical object deletion must be recorded')
      assert.equal(await storage.headObject(before.storageKey, before.bucket), null)
      console.log('  PASS isolated expiry cleanup removes FileObject storage and records deletion ledger')
    } finally {
      await prisma.onModuleDestroy()
      rmSync(REAL_STORAGE_DIR, { recursive: true, force: true })
    }
  }

  console.log('PASS upload session verification')
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
