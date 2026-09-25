import 'reflect-metadata'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-upload-sessions-secret-0123456789-abcdef'

import assert from 'node:assert/strict'
import path from 'node:path'
import { BadRequestException } from '@nestjs/common'
import type { FilePurpose } from '../../src/files/file.types'
import { DEFAULT_SENSITIVE_BY_PURPOSE, validateUpload } from '../../src/files/file-validation'
import { defaultRetentionForUpload } from '../../src/files/retention-policy'
import { sniffDeclaredMimeMismatch } from '../../src/files/content-sniff'
import { UPLOAD_SESSION_PHASE_UNCHECKED } from '../../src/common/redis/redis.service'
import { UploadSessionsService } from '../../src/upload-sessions/upload-sessions.service'
import { FilesService } from '../../src/files/files.service'
import { PrismaService } from '../../src/prisma/prisma.service'
import { StorageService } from '../../src/storage/storage.service'

export const ISOLATED_DATABASE = process.env['VERIFICATION_DATABASE_TARGET'] === 'isolated'
export const REAL_STORAGE_DIR = path.join('/tmp', `verify-upload-sessions-${process.pid}`)
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
  storageDeletePendingAt?: Date | null
  retentionPolicy: string | null
  retentionSetBy: string | null
  retentionConsentAt: Date | null
  retentionConsentVersion: string | null
  retentionLockedReason: string | null
}

export class FakeRedis {
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
    expectedRevision: number | null = null,
  ): Promise<'updated' | 'lost-lock' | 'expired' | 'conflict'> {
    const now = Date.now()
    const session = this.values.get(sessionKey)
    if (!session || session.expiresAt <= now) {
      if (session) this.values.delete(sessionKey)
      return 'expired'
    }
    const lock = this.values.get(lockKey)
    if (!lock || lock.expiresAt <= now || lock.value !== lockToken) return 'lost-lock'
    let parsed: { status?: string; revision?: number; file?: { fileId?: string } | null; bind?: { phase?: string } | null }
    try {
      parsed = JSON.parse(session.value) as { status?: string; revision?: number; file?: { fileId?: string } | null; bind?: { phase?: string } | null }
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
    if (expectedPhase !== null && expectedPhase !== UPLOAD_SESSION_PHASE_UNCHECKED) {
      const actualPhase = parsed.bind?.phase ?? ''
      if (expectedPhase === '' ? Boolean(actualPhase) : actualPhase !== expectedPhase) return 'conflict'
    }
    if (expectedRevision !== null && (parsed.revision ?? 0) !== expectedRevision) return 'conflict'
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

export class FakePrisma {
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
    count: async ({
      where,
    }: {
      where?: {
        OR?: Array<{
          pendingStorageKey?: { not: null }
          replacedStorageKey?: { not: null }
        }>
      }
    }) => this.rowsFor(where).length,
    findMany: async ({
      where,
      take,
      skip,
      orderBy,
    }: {
      where?: {
        OR?: Array<{
          pendingStorageKey?: { not: null }
          replacedStorageKey?: { not: null }
        }>
      }
      take?: number
      skip?: number
      orderBy?: Array<Record<string, 'asc' | 'desc'>>
    }) => {
      const rows = this.rowsFor(where).sort((left, right) => {
        for (const order of orderBy ?? []) {
          const key = Object.keys(order)[0] as 'id' | 'updatedAt'
          const direction = order[key] === 'desc' ? -1 : 1
          const a = left[key]
          const b = right[key]
          if (a instanceof Date && b instanceof Date) {
            const diff = a.getTime() - b.getTime()
            if (diff !== 0) return diff * direction
          } else if (a !== b) {
            return String(a) < String(b) ? -direction : direction
          }
        }
        return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
      })
      const start = skip ?? 0
      return rows.slice(start, start + (take ?? rows.length))
    },
  }

  private rowsFor(where?: {
    OR?: Array<{
      pendingStorageKey?: { not: null }
      replacedStorageKey?: { not: null }
    }>
  }): StoredFile[] {
    const rows = [...this.files.values()]
    if (!where?.OR) return rows
    return rows.filter((row) => where.OR!.some((clause) => {
      if (clause.pendingStorageKey) return row.pendingStorageKey != null
      if (clause.replacedStorageKey) return row.replacedStorageKey != null
      return false
    }))
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

export class FakeFilesService {
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
  async deleteObjectAtKey(objectKey: string): Promise<void> {
    for (const [id, row] of this.prisma.files) {
      if (row.storageKey === objectKey) this.storedObjects.delete(id)
    }
  }

}

export function makeService(options?: { beforeUpload?: (callNumber: number) => Promise<void> }): {
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

export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

export function file(args?: Partial<Express.Multer.File>): Express.Multer.File {
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

export async function expectRejects<T extends Error>(
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
