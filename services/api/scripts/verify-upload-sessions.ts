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
  storageKey: string
  bucket: string
  purpose: FilePurpose
  sensitiveLevel: string
  endUserId: string | null
  ownerType: string
  ownerId: string | null
  deletedAt: Date | null
  expiresAt: Date | null
  pendingStorageKey?: string | null
  replacedStorageKey?: string | null
  updatedAt?: Date | null
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

  async getDel(key: string): Promise<string | null> {
    const value = await this.get(key)
    if (value !== null) this.values.delete(key)
    return value
  }

  async getAndDelIfEquals(key: string, expectedValue: string): Promise<'missing' | 'matched' | 'mismatched'> {
    const entry = this.values.get(key)
    if (!entry || entry.expiresAt <= Date.now()) {
      this.values.delete(key)
      return 'missing'
    }
    if (entry.value !== expectedValue) return 'mismatched'
    this.values.delete(key)
    return 'matched'
  }

  /** 与 RedisService.compareAndSetSession 同一原子条件：锁、状态、无文件、TTL。 */
  async compareAndSetSession(
    sessionKey: string,
    lockKey: string,
    lockToken: string,
    nextValue: string,
    expectedStatus: string,
    expectedFileId: string | null = null,
    expectedPhase: string | null = null,
    cleanup: {
      key: string
      value: string
      ttlSeconds: number
      indexKey: string
      indexScore: number
      indexMember: string
    } | null = null,
  ): Promise<'updated' | 'lost-lock' | 'expired' | 'conflict'> {
    const now = Date.now()
    const session = this.values.get(sessionKey)
    if (!session || session.expiresAt <= now) {
      if (session) this.values.delete(sessionKey)
      return 'expired'
    }
    const lock = this.values.get(lockKey)
    if (!lock || lock.expiresAt <= now || lock.value !== lockToken) return 'lost-lock'
    let parsed: { status?: string; file?: { fileId?: string } | null; bind?: { phase?: string } | null }
    try {
      parsed = JSON.parse(session.value) as { status?: string; file?: { fileId?: string } | null; bind?: { phase?: string } | null }
    } catch {
      return 'conflict'
    }
    const actualId = parsed.file?.fileId ?? null
    if (parsed.status !== expectedStatus) return 'conflict'
    if (!expectedFileId) {
      if (actualId) return 'conflict'
    } else if (actualId !== expectedFileId) {
      return 'conflict'
    }
    if (expectedPhase !== null) {
      const actualPhase = parsed.bind?.phase ?? ''
      if (expectedPhase === '' ? Boolean(actualPhase) : actualPhase !== expectedPhase) return 'conflict'
    }
    this.values.set(sessionKey, { value: nextValue, expiresAt: session.expiresAt })
    if (cleanup) {
      this.values.set(cleanup.key, {
        value: cleanup.value,
        expiresAt: now + cleanup.ttlSeconds * 1000,
      })
      const index = this.sortedSets.get(cleanup.indexKey) ?? new Map<string, number>()
      index.set(cleanup.indexMember, cleanup.indexScore)
      this.sortedSets.set(cleanup.indexKey, index)
    }
    return 'updated'
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
      const next = { ...current, ...data, updatedAt: new Date() }
      this.files.set(where.id, next)
      if (select?.expiresAt) return { expiresAt: next.expiresAt }
      return next
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: {
        id?: string
        storageKey?: string
        deletedAt?: null
        pendingStorageKey?: string | null
        replacedStorageKey?: string | null
        updatedAt?: { lt: Date }
      }
      data: Partial<StoredFile>
    }) => {
      const current = where.id ? this.files.get(where.id) : undefined
      if (!current || !this.matches(current, where)) return { count: 0 }
      await this.fileObject.update({ where: { id: current.id }, data })
      return { count: 1 }
    },
    findMany: async ({
      where,
      take,
    }: {
      where?: {
        OR?: Array<{
          pendingStorageKey?: { not: null }
          replacedStorageKey?: { not: null }
        }>
      }
      take?: number
    }) => {
      let rows = [...this.files.values()]
      if (where?.OR) {
        rows = rows.filter((row) => where.OR!.some((clause) => {
          if (clause.pendingStorageKey) return row.pendingStorageKey != null
          if (clause.replacedStorageKey) return row.replacedStorageKey != null
          return false
        }))
      }
      return rows.slice(0, take ?? rows.length)
    },
  }

  private matches(
    row: StoredFile,
    where: {
      id?: string
      storageKey?: string
      deletedAt?: null
      pendingStorageKey?: string | null
      replacedStorageKey?: string | null
      updatedAt?: { lt: Date }
    },
  ): boolean {
    if (where.id && row.id !== where.id) return false
    if ('deletedAt' in where && where.deletedAt === null && row.deletedAt !== null) return false
    if (typeof where.storageKey === 'string' && row.storageKey !== where.storageKey) return false
    if ('pendingStorageKey' in where) {
      if (where.pendingStorageKey === null) {
        if (row.pendingStorageKey != null) return false
      } else if (row.pendingStorageKey !== where.pendingStorageKey) return false
    }
    if (typeof where.replacedStorageKey === 'string' && row.replacedStorageKey !== where.replacedStorageKey) return false
    if (where.updatedAt?.lt) {
      if (!row.updatedAt || row.updatedAt.getTime() >= where.updatedAt.lt.getTime()) return false
    }
    return true
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
      storageKey: `tmp/uploads/${id}/${id}.pdf`,
      bucket: 'local-fs',
      purpose: args.purpose,
      sensitiveLevel,
      endUserId: args.endUserId ?? null,
      ownerType: args.endUserId ? 'user' : 'system',
      ownerId: args.endUserId ?? null,
      deletedAt: null,
      expiresAt: retention.expiresAt,
      pendingStorageKey: null,
      replacedStorageKey: null,
      updatedAt: new Date(),
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

  async copyObjectToKey(): Promise<void> {}
  async deleteObjectAtKey(): Promise<void> {}

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
    const bindingCalls = prisma.fileUpdateCalls.filter((call) => call.data.ownerType === 'user')
    assert.ok(bindingCalls.length >= 1, 'member confirm must write user ownership')
    assert.ok(
      bindingCalls.every(
        (call) =>
          call.data.expiresAt?.toISOString() === originalExpiry &&
          call.data.retentionLockedReason === 'contract_review_session_only'
      ),
      `winning binding must preserve expiry and never clear the retention lock: ${JSON.stringify(
        bindingCalls
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
    assert.match(
      bound?.storageKey ?? '',
      /^users\/member_1\//,
      'API-29c 绑定会员后 storageKey 必须离开 tmp/uploads',
    )
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
        if (lockReaders >= 2) lockReadersReady.resolve()
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

  {
    // 场景码兑换若拿着过期快照回写，会把已经 uploaded 的会话盖回 pending，
    // 手机收到成功回执，一体机却看不到文件，清理索引也不再指向这份字节。
    const { service, prisma } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    const sessionKey = `upload_session:${session.sessionId}`
    const redis = (service as unknown as { redis: FakeRedis }).redis
    const originalGet = redis.get.bind(redis)
    const releaseStaleRead = deferred()
    const staleReadHeld = deferred()
    let holdSessionRead = true
    redis.get = async (key: string) => {
      if (holdSessionRead && key === sessionKey) {
        holdSessionRead = false
        const value = await originalGet(key)
        staleReadHeld.resolve()
        await releaseStaleRead.promise
        return value
      }
      return originalGet(key)
    }
    const resolving = service.resolveScene(session.sceneToken).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    )
    await staleReadHeld.promise
    const uploaded = await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file({ originalname: 'held-resume.pdf' }),
    }).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    )
    releaseStaleRead.resolve()
    await resolving
    const status = await service.getStatus(session.sessionId, session.controlToken)
    if (uploaded.ok) {
      assert.equal(status.status, 'uploaded', 'a successful phone upload must stay uploaded after scene resolve')
      assert.equal(status.file?.fileId, uploaded.value.file?.fileId, 'scene resolve must not detach the uploaded file')
      assert.equal(prisma.files.get(uploaded.value.file!.fileId)?.deletedAt ?? null, null)
    } else {
      assert.notEqual(status.status, 'uploaded', 'rejected upload must not be reported as received')
      assert.equal(status.file, null)
    }
  }

  {
    const uploadEntered = deferred()
    const releaseUpload = deferred()
    const { service, prisma, redis } = makeService({
      beforeUpload: async (callNumber) => {
        if (callNumber === 1) {
          uploadEntered.resolve()
          await releaseUpload.promise
        }
      },
    })
    const session = await service.create({
      purpose: 'print_doc',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    const lockKey = `upload_session_upload_lock:${session.sessionId}`
    const pending = service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file({ originalname: 'slow.pdf' }),
    })
    await uploadEntered.promise
    await redis.setEx(lockKey, 30, 'successor-lock')
    releaseUpload.resolve()
    await expectRejects(
      () => pending,
      BadRequestException,
      'upload that lost its lock must not report success',
    )
    assert.equal(await redis.get(lockKey), 'successor-lock', 'finishing upload must not delete a successor lock')
    const status = await service.getStatus(session.sessionId, session.controlToken)
    assert.equal(status.file, null, 'uncommitted upload must not remain the kiosk receipt')
    for (const stored of prisma.files.values()) {
      assert.notEqual(stored.deletedAt, null, 'bytes written after the lock was lost must be deleted')
    }
  }

  {
    const { service } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    const garbled = Buffer.from('张三_简历.pdf', 'utf8').toString('latin1')
    const uploaded = await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file({ originalname: garbled }),
    })
    assert.equal(uploaded.file?.filename, '张三_简历.pdf', 'phone multipart UTF-8 filenames must be restored before receipt')
    const plain = await service.create({
      purpose: 'resume_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    const kept = await service.uploadFile({
      sessionId: plain.sessionId,
      uploadToken: plain.uploadToken,
      file: file({ originalname: 'résumé.pdf' }),
    })
    assert.equal(kept.file?.filename, 'résumé.pdf', 'latin1 filenames without Han characters stay unchanged')
  }

  {
    // A 读到自己的锁之后、写入 uploaded 之前，锁过期。B 完成上传。
    // A 若仍用非原子 SET 回写，两部手机都收到成功，一体机只留下后写的那一份。
    const { service, prisma, redis } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    const sessionKey = `upload_session:${session.sessionId}`
    const cleanupKey = `upload_session_cleanup:${session.sessionId}`
    const originalCommit = redis.compareAndSetSession.bind(redis)
    let armed = true
    let winnerId = ''
    redis.compareAndSetSession = async (key, heldLock, lockToken, nextValue, expectedStatus) => {
      if (armed && key === sessionKey && expectedStatus === 'uploading') {
        const parsed = JSON.parse(nextValue) as { status?: string }
        if (parsed.status === 'uploaded') {
          armed = false
          await redis.del(heldLock)
          const winner = await service.uploadFile({
            sessionId: session.sessionId,
            uploadToken: session.uploadToken,
            file: file({ originalname: 'winner.pdf' }),
          })
          winnerId = winner.file!.fileId
          // 锁值又变回 A，只核对锁就会盖掉 B 已经写成的收据。
          await redis.setEx(heldLock, 30, lockToken)
        }
      }
      return originalCommit(key, heldLock, lockToken, nextValue, expectedStatus)
    }
    let loserOk = true
    try {
      await service.uploadFile({
        sessionId: session.sessionId,
        uploadToken: session.uploadToken,
        file: file({ originalname: 'loser.pdf' }),
      })
    } catch {
      loserOk = false
    }
    const status = await service.getStatus(session.sessionId, session.controlToken)
    const cleanup = JSON.parse((await redis.get(cleanupKey)) ?? '{}') as { file?: { fileId?: string } | null }
    const loserFile = [...prisma.files.values()].find((item) => item.filename === 'loser.pdf')
    assert.equal(loserOk, false, 'upload whose lock expired before commit must not report success')
    assert.equal(status.status, 'uploaded')
    assert.equal(status.file?.fileId, winnerId, 'kiosk receipt must stay with the upload that committed under the lock')
    assert.equal(cleanup.file?.fileId, winnerId, 'expiry cleanup record must name the same file as the receipt')
    assert.equal(prisma.files.get(winnerId)?.deletedAt ?? null, null)
    assert.ok(loserFile?.deletedAt, 'loser may delete only its own bytes')
  }

  {
    const { service, prisma, redis } = makeService()
    const session = await service.create({
      purpose: 'print_doc',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    const sessionKey = `upload_session:${session.sessionId}`
    const cleanupKey = `upload_session_cleanup:${session.sessionId}`
    const originalCommit = redis.compareAndSetSession.bind(redis)
    let armed = true
    let winnerId = ''
    redis.compareAndSetSession = async (key, heldLock, lockToken, nextValue, expectedStatus) => {
      if (armed && key === sessionKey && expectedStatus === 'uploading') {
        const parsed = JSON.parse(nextValue) as { status?: string }
        if (parsed.status === 'uploaded') {
          armed = false
          await redis.del(heldLock)
          const winner = await service.uploadFile({
            sessionId: session.sessionId,
            uploadToken: session.uploadToken,
            file: file({ originalname: 'kept.pdf' }),
          })
          winnerId = winner.file!.fileId
          await redis.setEx(heldLock, 30, 'successor-lock')
        }
      }
      return originalCommit(key, heldLock, lockToken, nextValue, expectedStatus)
    }
    await expectRejects(
      () => service.uploadFile({
        sessionId: session.sessionId,
        uploadToken: session.uploadToken,
        file: file({ originalname: 'dropped.pdf' }),
      }),
      BadRequestException,
      'stale upload must not overwrite the successor receipt',
    )
    const status = await service.getStatus(session.sessionId, session.controlToken)
    const cleanup = JSON.parse((await redis.get(cleanupKey)) ?? '{}') as { file?: { fileId?: string } | null }
    assert.equal(await redis.get(`upload_session_upload_lock:${session.sessionId}`), 'successor-lock')
    assert.equal(status.file?.fileId, winnerId)
    assert.equal(cleanup.file?.fileId, winnerId)
    assert.equal(prisma.files.get(winnerId)?.deletedAt ?? null, null)
    const dropped = [...prisma.files.values()].find((item) => item.filename === 'dropped.pdf')
    assert.ok(dropped?.deletedAt, 'dropped upload deletes its own file')
  }

  {
    const { service, prisma } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    const sessionKey = `upload_session:${session.sessionId}`
    const lockKey = `upload_session_upload_lock:${session.sessionId}`
    const redis = (service as unknown as { redis: FakeRedis }).redis
    const originalGet = redis.get.bind(redis)
    const releaseRead = deferred()
    const readHeld = deferred()
    let holdRead = true
    redis.get = async (key: string) => {
      if (holdRead && key === sessionKey) {
        holdRead = false
        const value = await originalGet(key)
        readHeld.resolve()
        await releaseRead.promise
        return value
      }
      return originalGet(key)
    }
    const resolving = service.resolveScene(session.sceneToken).then(
      (value) => ({ ok: true as const, value }),
      () => ({ ok: false as const }),
    )
    await readHeld.promise
    await redis.del(lockKey)
    const uploaded = await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file({ originalname: 'during-resolve.pdf' }),
    })
    releaseRead.resolve()
    const resolved = await resolving
    const status = await service.getStatus(session.sessionId, session.controlToken)
    assert.equal(resolved.ok, false, 'scene resolve must not mint a token after its lock timed out')
    assert.equal(status.status, 'uploaded')
    assert.equal(status.file?.fileId, uploaded.file?.fileId, 'scene resolve must not rewind an uploaded receipt')
    assert.equal(prisma.files.get(uploaded.file!.fileId)?.deletedAt ?? null, null)
  }

  {
    // A 拿到锁并读到 pending 后、写入 uploading 前锁过期。B 已原子提交。
    // 普通 persist 会把 B 的收据盖成 uploading 且没有文件，B 的字节脱离会话。
    const { service, prisma, redis, files } = makeService()
    const session = await service.create({
      purpose: 'resume_upload',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    const sessionKey = `upload_session:${session.sessionId}`
    const lockKey = `upload_session_upload_lock:${session.sessionId}`
    const cleanupKey = `upload_session_cleanup:${session.sessionId}`
    const originalGet = redis.get.bind(redis)
    let armed = true
    let winnerId = ''
    redis.get = async (key: string) => {
      const value = await originalGet(key)
      if (armed && key === sessionKey && value?.includes('"status":"pending"')) {
        armed = false
        await redis.del(lockKey)
        const winner = await service.uploadFile({
          sessionId: session.sessionId,
          uploadToken: session.uploadToken,
          file: file({ originalname: 'winner-before-uploading.pdf' }),
        })
        winnerId = winner.file!.fileId
      }
      return value
    }
    let loserOk = true
    try {
      await service.uploadFile({
        sessionId: session.sessionId,
        uploadToken: session.uploadToken,
        file: file({ originalname: 'loser-before-uploading.pdf' }),
      })
    } catch {
      loserOk = false
    }
    const status = await service.getStatus(session.sessionId, session.controlToken)
    const cleanup = JSON.parse((await redis.get(cleanupKey)) ?? '{}') as { file?: { fileId?: string } | null }
    assert.equal(loserOk, false, 'A must not report success after its lock expired before uploading')
    assert.equal(status.status, 'uploaded')
    assert.equal(status.file?.fileId, winnerId, 'B receipt must survive A resuming the uploading write')
    assert.equal(cleanup.file?.fileId, winnerId)
    assert.equal(prisma.files.get(winnerId)?.deletedAt ?? null, null)
    assert.equal(files.uploadCalls.length, 1, 'A must not store a file after the uploading transition loses the lock')
    assert.equal(files.uploadCalls[0]?.filename, 'winner-before-uploading.pdf')
  }

  {
    // 会员确认在绑定文件时锁过期。取消先删文件再标 cancelled。
    // 旧确认恢复后普通 persist(confirmed)，对已删除文件返回成功。
    const { service, prisma, redis, files } = makeService()
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
    const lockKey = `upload_session_upload_lock:${session.sessionId}`
    const entered = deferred()
    const release = deferred()
    const originalCopy = files.copyObjectToKey.bind(files)
    files.copyObjectToKey = async (fromKey: string, toKey: string, mimeType: string, bucket?: string | null) => {
      entered.resolve()
      await release.promise
      return originalCopy(fromKey, toKey, mimeType, bucket)
    }
    const confirming = service.confirm(session.sessionId, session.controlToken, 'member_1').then(
      () => ({ ok: true as const }),
      () => ({ ok: false as const }),
    )
    await entered.promise
    await redis.del(lockKey)
    await service.cancel(session.sessionId, session.controlToken)
    release.resolve()
    const confirmed = await confirming
    const status = await service.getStatus(session.sessionId, session.controlToken)
    assert.equal(confirmed.ok, false, 'confirm must not succeed after cancel committed during member bind')
    assert.equal(status.status, 'cancelled')
    assert.notEqual(prisma.files.get(uploaded.file!.fileId)?.deletedAt ?? null, null)
  }

  {
    // 取消读到 uploaded 后锁过期，确认先完成。旧取消仍会删除已确认文件。
    const { service, prisma, redis } = makeService()
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
    const sessionKey = `upload_session:${session.sessionId}`
    const lockKey = `upload_session_upload_lock:${session.sessionId}`
    const originalGet = redis.get.bind(redis)
    const held = deferred()
    const release = deferred()
    let armed = true
    redis.get = async (key: string) => {
      const value = await originalGet(key)
      if (armed && key === sessionKey && value?.includes('"status":"uploaded"')) {
        armed = false
        held.resolve()
        await release.promise
        return value
      }
      return value
    }
    const cancelling = service.cancel(session.sessionId, session.controlToken).then(
      () => ({ ok: true as const }),
      () => ({ ok: false as const }),
    )
    await held.promise
    await redis.del(lockKey)
    const confirmed = await service.confirm(session.sessionId, session.controlToken)
    release.resolve()
    await cancelling
    const status = await service.getStatus(session.sessionId, session.controlToken)
    assert.equal(confirmed.status, 'confirmed')
    assert.equal(status.status, 'confirmed')
    assert.equal(status.file?.fileId, confirmed.file.fileId)
    assert.equal(prisma.files.get(uploaded.file!.fileId)?.deletedAt ?? null, null, 'stale cancel must not delete a confirmed file')
  }

  {
    // 确认还在绑文件时会话到期。过期清扫若先删文件再写 expired，确认仍可能返回成功。
    const { service, prisma, redis, files } = makeService()
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
    const sessionKey = `upload_session:${session.sessionId}`
    const lockKey = `upload_session_upload_lock:${session.sessionId}`
    const entered = deferred()
    const release = deferred()
    const originalCopy = files.copyObjectToKey.bind(files)
    files.copyObjectToKey = async (fromKey: string, toKey: string, mimeType: string, bucket?: string | null) => {
      entered.resolve()
      await release.promise
      return originalCopy(fromKey, toKey, mimeType, bucket)
    }
    const confirming = service.confirm(session.sessionId, session.controlToken, 'member_1').then(
      () => ({ ok: true as const }),
      () => ({ ok: false as const }),
    )
    await entered.promise
    const raw = await redis.get(sessionKey)
    assert.ok(raw)
    const parsed = JSON.parse(raw) as { expiresAt: string }
    parsed.expiresAt = new Date(Date.now() - 1000).toISOString()
    await redis.setExistingWithCurrentTtl(sessionKey, JSON.stringify(parsed))
    await redis.zadd('upload_session_expiry_index', Date.now() - 1000, session.sessionId)
    await redis.del(lockKey)
    await service.cleanupExpiredSessions(Date.now())
    release.resolve()
    const confirmed = await confirming
    const status = await service.getStatus(session.sessionId, session.controlToken)
    assert.equal(confirmed.ok, false, 'confirm must not succeed after expiry cleanup committed')
    assert.notEqual(status.status, 'confirmed')
    assert.notEqual(prisma.files.get(uploaded.file!.fileId)?.deletedAt ?? null, null)
  }

  {
    // 比较先把 file 写成 null，随后 systemDelete 失败。重试清扫只看见空文件指针，对象泄漏。
    const { service, prisma, redis, files } = makeService()
    const session = await service.create({
      purpose: 'print_doc',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    const uploaded = await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file({ originalname: 'delete-once.pdf' }),
    })
    let failDelete = true
    const originalDelete = files.systemDelete.bind(files)
    files.systemDelete = async (fileId: string, reason: string) => {
      if (failDelete) {
        failDelete = false
        throw new Error('storage delete failed once')
      }
      return originalDelete(fileId, reason)
    }
    await expectRejects(
      () => service.cancel(session.sessionId, session.controlToken),
      Error,
      'cancel must not succeed when the object delete fails',
    )
    assert.equal(prisma.files.get(uploaded.file!.fileId)?.deletedAt ?? null, null)
    await service.cleanupExpiredSessions(new Date(session.expiresAt).getTime() + 1)
    assert.notEqual(
      prisma.files.get(uploaded.file!.fileId)?.deletedAt ?? null,
      null,
      'retry cleanup must delete the object the failed cancel still owns',
    )
    assert.equal(
      redis.hasSortedSetMember('upload_session_expiry_index', session.sessionId),
      false,
      'expiry index stays until the object delete succeeds',
    )
  }

  {
    // 会员归属在最终比较前已经写上。取消看到 ownerType=user 就跳过删除，确认比较失败，留下已取消会话的会员文件。
    const { service, prisma, redis } = makeService()
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
    const lockKey = `upload_session_upload_lock:${session.sessionId}`
    const entered = deferred()
    const release = deferred()
    const originalUpdate = prisma.fileObject.update.bind(prisma.fileObject)
    prisma.fileObject.update = async (args) => {
      const updated = await originalUpdate(args)
      if (args.data.ownerType === 'user') {
        entered.resolve()
        await release.promise
      }
      return updated
    }
    const confirming = service.confirm(session.sessionId, session.controlToken, 'member_1').then(
      () => ({ ok: true as const }),
      () => ({ ok: false as const }),
    )
    await entered.promise
    await redis.del(lockKey)
    let cancelOk = true
    try {
      await service.cancel(session.sessionId, session.controlToken)
    } catch {
      cancelOk = false
    }
    release.resolve()
    const confirmed = await confirming
    const status = await service.getStatus(session.sessionId, session.controlToken)
    const stored = prisma.files.get(uploaded.file!.fileId)
    const liveMember = Boolean(stored && !stored.deletedAt && (stored.ownerType === 'user' || stored.endUserId))
    if (status.status === 'cancelled' || status.status === 'expired') {
      assert.equal(liveMember, false, 'a cancelled upload must not leave a live member-owned file')
    }
    if (confirmed.ok) {
      assert.equal(status.status, 'confirmed')
      assert.equal(stored?.deletedAt ?? null, null)
    } else {
      assert.notEqual(status.status, 'confirmed')
    }
    assert.equal(cancelOk && liveMember && status.status === 'cancelled', false)
  }

  {
    // 确认比较已经写成 confirmed，随后会员归属的数据库更新失败。
    // 调用方收到错误，但一体机读到的仍是 confirmed，而且不能再重试绑定。
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
    const originalUpdate = prisma.fileObject.update.bind(prisma.fileObject)
    let failUpdate = true
    prisma.fileObject.update = async (args) => {
      if (failUpdate && args.data.ownerType === 'user') {
        failUpdate = false
        throw new Error('member bind update failed')
      }
      return originalUpdate(args)
    }
    await expectRejects(
      () => service.confirm(session.sessionId, session.controlToken, 'member_1'),
      Error,
      'confirm must not succeed when member ownership update fails',
    )
    const during = await service.getStatus(session.sessionId, session.controlToken)
    assert.notEqual(during.status, 'confirmed', 'kiosk must not observe success after the failed confirm')
    const row = prisma.files.get(uploaded.file!.fileId)
    assert.equal(row?.deletedAt ?? null, null, 'failed ownership update must not drop the original file')
    assert.notEqual(row?.ownerType, 'user')
    const retried = await service.confirm(session.sessionId, session.controlToken, 'member_1')
    assert.equal(retried.status, 'confirmed')
    assert.equal(prisma.files.get(uploaded.file!.fileId)?.ownerType, 'user')
    assert.equal(prisma.files.get(uploaded.file!.fileId)?.deletedAt ?? null, null)
  }

  {
    // 复制已经落到会员 key，比较失败后 deleteObjectAtKey 也失败。这份复制不能留下。
    const { service, prisma, redis, files } = makeService()
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
    const lockKey = `upload_session_upload_lock:${session.sessionId}`
    const objects = new Set<string>()
    let stagedKey = ''
    let failStagedDelete = true
    const entered = deferred()
    const release = deferred()
    files.copyObjectToKey = async (_from: string, to: string) => {
      objects.add(to)
      stagedKey = to
      entered.resolve()
      await release.promise
    }
    files.deleteObjectAtKey = async (key: string) => {
      if (failStagedDelete && key === stagedKey) {
        failStagedDelete = false
        throw new Error('staged object delete failed')
      }
      objects.delete(key)
    }
    const confirming = service.confirm(session.sessionId, session.controlToken, 'member_1').then(
      () => ({ ok: true as const }),
      () => ({ ok: false as const }),
    )
    await entered.promise
    await redis.del(lockKey)
    await service.cancel(session.sessionId, session.controlToken)
    release.resolve()
    const confirmed = await confirming
    assert.equal(confirmed.ok, false, 'confirm must not succeed after the compare loses')
    assert.notEqual(prisma.files.get(uploaded.file!.fileId)?.deletedAt ?? null, null)
    await redis.del(`upload_session:${session.sessionId}`)
    await service.cleanupExpiredSessions(new Date(session.expiresAt).getTime() + 1)
    assert.equal(objects.has(stagedKey), false, 'staged member object must be removed after the compare loses')
  }

  {
    // 取消时对象删除失败。主会话键先过期后，清理记录仍要留着 fileId，重试才能删掉对象。
    const { service, prisma, redis, files } = makeService()
    const session = await service.create({
      purpose: 'print_doc',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    const uploaded = await service.uploadFile({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      file: file({ originalname: 'cleanup-pointer.pdf' }),
    })
    const originalDelete = files.systemDelete.bind(files)
    let failDelete = true
    files.systemDelete = async (fileId: string, reason: string) => {
      if (failDelete) {
        failDelete = false
        throw new Error('storage delete failed once')
      }
      return originalDelete(fileId, reason)
    }
    await expectRejects(
      () => service.cancel(session.sessionId, session.controlToken),
      Error,
      'cancel must not succeed when delete fails',
    )
    await redis.del(`upload_session:${session.sessionId}`)
    const cleanupRaw = await redis.get(`upload_session_cleanup:${session.sessionId}`)
    assert.equal(cleanupRaw?.includes(uploaded.file!.fileId), true, 'cleanup record must keep the file id after the session key expires')
    await service.cleanupExpiredSessions(new Date(session.expiresAt).getTime() + 1)
    assert.notEqual(prisma.files.get(uploaded.file!.fileId)?.deletedAt ?? null, null)
  }

  {
    // 一批过期会话里有一条删除失败时，后面的会话也必须在同一次清扫里被处理。
    const { service, prisma, redis, files } = makeService()
    const first = await service.create({
      purpose: 'print_doc',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    const firstUpload = await service.uploadFile({
      sessionId: first.sessionId,
      uploadToken: first.uploadToken,
      file: file({ originalname: 'batch-first.pdf' }),
    })
    const second = await service.create({
      purpose: 'print_doc',
      mode: 'temporary',
      channel: 'phone_h5',
      uploadUrl: 'http://localhost:5173/upload/phone',
    })
    const secondUpload = await service.uploadFile({
      sessionId: second.sessionId,
      uploadToken: second.uploadToken,
      file: file({ originalname: 'batch-second.pdf' }),
    })
    for (const id of [first.sessionId, second.sessionId]) {
      const raw = await redis.get(`upload_session:${id}`)
      assert.ok(raw)
      const parsed = JSON.parse(raw) as { expiresAt: string }
      parsed.expiresAt = new Date(1).toISOString()
      await redis.setExistingWithCurrentTtl(`upload_session:${id}`, JSON.stringify(parsed))
      const cleanupRaw = await redis.get(`upload_session_cleanup:${id}`)
      if (cleanupRaw) {
        const cleanup = JSON.parse(cleanupRaw) as { expiresAt: string }
        cleanup.expiresAt = new Date(1).toISOString()
        await redis.setEx(`upload_session_cleanup:${id}`, 24 * 60 * 60, JSON.stringify(cleanup))
      }
    }
    await redis.zadd('upload_session_expiry_index', 1, first.sessionId)
    await redis.zadd('upload_session_expiry_index', 2, second.sessionId)
    const originalDelete = files.systemDelete.bind(files)
    files.systemDelete = async (fileId: string, reason: string) => {
      if (fileId === firstUpload.file!.fileId) throw new Error('poison session delete')
      return originalDelete(fileId, reason)
    }
    const result = await service.cleanupExpiredSessions(10)
    assert.equal(prisma.files.get(firstUpload.file!.fileId)?.deletedAt ?? null, null)
    assert.notEqual(prisma.files.get(secondUpload.file!.fileId)?.deletedAt ?? null, null, 'one poison session must not abort the rest of the batch')
    assert.equal(redis.hasSortedSetMember('upload_session_expiry_index', first.sessionId), true)
    assert.ok((result as { failed?: number }).failed && (result as { failed?: number }).failed! >= 1)
  }

  {
    // 进程在会员归属写入之前被杀掉。公开状态不能是 confirmed，恢复后必须绑定且不留下匿名键。
    const { service, prisma, redis } = makeService()
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
    const fileId = uploaded.file!.fileId
    const originalCommit = redis.compareAndSetSession.bind(redis)
    let stopped = false
    redis.compareAndSetSession = async (...args: Parameters<FakeRedis['compareAndSetSession']>) => {
      const result = await originalCommit(...args)
      const next = JSON.parse(args[3]) as { status?: string; bind?: { phase?: string } | null }
      const row = prisma.files.get(fileId)
      const bound = Boolean(row && row.ownerType === 'user' && row.storageKey.startsWith('users/'))
      const crossedIntent = next.status === 'confirmed' || next.bind?.phase === 'intent' || next.bind?.phase === 'copied'
      if (!stopped && result === 'updated' && !bound && crossedIntent) {
        stopped = true
        throw new Error('HARD_STOP before ownership')
      }
      return result
    }
    await expectRejects(
      () => service.confirm(session.sessionId, session.controlToken, 'member_1'),
      Error,
      'hard stop before ownership',
    )
    assert.notEqual(
      (await service.getStatus(session.sessionId, session.controlToken)).status,
      'confirmed',
      'kiosk must not observe confirmed before the row is bound',
    )
    await redis.del(`upload_session:${session.sessionId}`)
    const cleanupRaw = await redis.get(`upload_session_cleanup:${session.sessionId}`)
    assert.equal(cleanupRaw?.includes(fileId), true, 'cleanup record must still name the file after the session key is gone')
    await service.cleanupExpiredSessions(Date.now() + 1000)
    const recovered = prisma.files.get(fileId)
    assert.equal(recovered?.ownerType, 'user')
    assert.match(recovered?.storageKey ?? '', /^users\/member_1\//)
    assert.equal(recovered?.deletedAt ?? null, null)
    assert.equal(recovered?.pendingStorageKey ?? null, null)
    assert.equal(recovered?.replacedStorageKey ?? null, null)
  }

  {
    // 锁过期时数据库已经写成会员，但匿名键还在。此时公开状态不能已经是 confirmed。
    const { service, prisma, redis, files } = makeService()
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
    const fileId = uploaded.file!.fileId
    const previousKey = prisma.files.get(fileId)!.storageKey
    const objects = new Set<string>([previousKey])
    files.copyObjectToKey = async (_from: string, to: string) => {
      objects.add(to)
    }
    files.deleteObjectAtKey = async (key: string) => {
      objects.delete(key)
    }
    const entered = deferred()
    const release = deferred()
    let paused = false
    const originalUpdate = prisma.fileObject.update.bind(prisma.fileObject)
    prisma.fileObject.update = async (args) => {
      const updated = await originalUpdate(args)
      if (!paused && args.data.ownerType === 'user') {
        paused = true
        entered.resolve()
        await release.promise
      }
      return updated
    }
    const confirming = service.confirm(session.sessionId, session.controlToken, 'member_1').then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    )
    await entered.promise
    await redis.del(`upload_session_upload_lock:${session.sessionId}`)
    const mid = await service.getStatus(session.sessionId, session.controlToken)
    if (mid.status === 'confirmed') {
      assert.equal(objects.has(previousKey), false, 'public confirmed while the obsolete anonymous key still exists')
    }
    await service.cleanupExpiredSessions(Date.now() + 1000)
    release.resolve()
    const confirmed = await confirming
    const finalStatus = await service.getStatus(session.sessionId, session.controlToken)
    assert.equal(finalStatus.status, 'confirmed')
    assert.equal(confirmed.ok, true)
    assert.equal(objects.has(previousKey), false, 'lock expiry recovery must delete the anonymous key')
    assert.equal(prisma.files.get(fileId)?.deletedAt ?? null, null)
    assert.match(prisma.files.get(fileId)?.storageKey ?? '', /^users\/member_1\//)
  }

  {
    // 归属更新已经提交，旧键删除和随后的 Redis 写入都失败。不能退回 uploaded，取消也不能删掉会员文件。
    const { service, prisma, redis, files } = makeService()
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
    const fileId = uploaded.file!.fileId
    const previousKey = prisma.files.get(fileId)!.storageKey
    const objects = new Set<string>([previousKey])
    let failDelete = true
    let failRedisWrite = true
    files.copyObjectToKey = async (_from: string, to: string) => {
      objects.add(to)
    }
    files.deleteObjectAtKey = async (key: string) => {
      if (failDelete && key === previousKey) throw new Error('old key delete failed')
      objects.delete(key)
    }
    const originalSetEx = redis.setEx.bind(redis)
    redis.setEx = async (key: string, ttlSeconds: number, value: string) => {
      if (failRedisWrite && key.startsWith('upload_session_cleanup:') && value.includes(previousKey)) {
        throw new Error('cleanup redis write failed')
      }
      return originalSetEx(key, ttlSeconds, value)
    }
    const originalCommit = redis.compareAndSetSession.bind(redis)
    redis.compareAndSetSession = async (...args: Parameters<FakeRedis['compareAndSetSession']>) => {
      if (failRedisWrite && args[3].includes('"status":"confirmed"')) {
        throw new Error('confirm redis write failed')
      }
      return originalCommit(...args)
    }
    await expectRejects(
      () => service.confirm(session.sessionId, session.controlToken, 'member_1'),
      Error,
      'confirm must not succeed when the obsolete key or the confirm write fails',
    )
    assert.notEqual((await service.getStatus(session.sessionId, session.controlToken)).status, 'confirmed')
    const bound = prisma.files.get(fileId)
    assert.equal(bound?.ownerType, 'user')
    assert.match(bound?.storageKey ?? '', /^users\/member_1\//)
    assert.equal(objects.has(bound?.storageKey ?? ''), true, 'the live member object must stay')
    let cancelDeleted = false
    const originalSystemDelete = files.systemDelete.bind(files)
    files.systemDelete = async (id: string, reason: string) => {
      if (id === fileId) cancelDeleted = true
      return originalSystemDelete(id, reason)
    }
    try {
      await service.cancel(session.sessionId, session.controlToken)
    } catch {
      // 已经归属的会话应拒绝取消，或在删掉旧键前失败。两种都不能删会员文件。
    }
    assert.equal(cancelDeleted, false, 'cancel must not delete the live member object')
    assert.equal(prisma.files.get(fileId)?.deletedAt ?? null, null)
    failDelete = false
    failRedisWrite = false
    await service.cleanupExpiredSessions(Date.now() + 60_000)
    try {
      await service.confirm(session.sessionId, session.controlToken, 'member_1')
    } catch {
      // 清扫已经完成时，再次确认会看到 confirmed。
    }
    const recovered = prisma.files.get(fileId)
    assert.equal(recovered?.ownerType, 'user')
    assert.equal(recovered?.deletedAt ?? null, null)
    assert.equal(objects.has(previousKey), false, 'recovery must delete the anonymous key')
    assert.equal((await service.getStatus(session.sessionId, session.controlToken)).status, 'confirmed')
  }

  console.log('PASS upload session verification')
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
