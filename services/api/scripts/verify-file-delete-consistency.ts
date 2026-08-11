import 'reflect-metadata'

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { FilesService } from '../src/files/files.service'
import { StorageService } from '../src/storage/storage.service'

const apiRoot = join(__dirname, '..')

function verifyStorageDeleteSchemaContract(): void {
  const sqliteSchema = readFileSync(join(apiRoot, 'prisma/schema.prisma'), 'utf8')
  const postgresSchema = readFileSync(join(apiRoot, 'prisma/postgres/schema.prisma'), 'utf8')
  const sqliteMigration = readFileSync(
    join(apiRoot, 'prisma/migrations/20260811143000_add_file_storage_delete_retry/migration.sql'),
    'utf8'
  )
  const postgresMigration = readFileSync(
    join(
      apiRoot,
      'prisma/postgres/migrations/20260811143000_add_file_storage_delete_retry/migration.sql'
    ),
    'utf8'
  )
  for (const [label, schema] of [
    ['SQLite', sqliteSchema],
    ['PostgreSQL', postgresSchema],
  ] as const) {
    assert.match(schema, /storageDeletePendingAt DateTime\?/, `${label} pending field must be nullable`)
    assert.match(schema, /storageDeletedAt DateTime\?/, `${label} completion field must be nullable`)
    assert.match(schema, /@@index\(\[storageDeletePendingAt\]\)/, `${label} pending index missing`)
    assert.match(
      schema,
      /@@index\(\[status, storageDeletedAt\]\)/,
      `${label} legacy-recovery index missing`
    )
  }
  for (const [label, migration] of [
    ['SQLite', sqliteMigration],
    ['PostgreSQL', postgresMigration],
  ] as const) {
    assert.match(migration, /storageDeletePendingAt/, `${label} pending migration missing`)
    assert.match(migration, /storageDeletedAt/, `${label} completion migration missing`)
    assert.doesNotMatch(
      migration,
      /\b(?:DROP|UPDATE|INSERT|DELETE|RENAME|SET\s+NOT\s+NULL)\b/i,
      `${label} migration must remain additive without fabricated completion backfill`
    )
  }
}

function verifyStorageBucketRoutingContract(): void {
  const keys = [
    'FILE_STORAGE_DRIVER',
    'TENCENT_COS_SECRET_ID',
    'TENCENT_COS_SECRET_KEY',
    'TENCENT_COS_BUCKET',
    'TENCENT_COS_REGION',
  ] as const
  const previous = new Map(keys.map((key) => [key, process.env[key]]))
  try {
    process.env['FILE_STORAGE_DRIVER'] = 'local'
    delete process.env['TENCENT_COS_SECRET_ID']
    delete process.env['TENCENT_COS_SECRET_KEY']
    delete process.env['TENCENT_COS_BUCKET']
    delete process.env['TENCENT_COS_REGION']
    const localDefault = new StorageService()
    assert.throws(
      () => localDefault.deleteObject('opaque/object', 'unregistered-bucket'),
      /STORAGE_BACKEND_UNAVAILABLE/
    )

    process.env['FILE_STORAGE_DRIVER'] = 'cos'
    process.env['TENCENT_COS_SECRET_ID'] = 'verify-secret-id'
    process.env['TENCENT_COS_SECRET_KEY'] = 'verify-secret-key'
    process.env['TENCENT_COS_BUCKET'] = 'configured-bucket-1250000000'
    process.env['TENCENT_COS_REGION'] = 'ap-guangzhou'
    const cosDefault = new StorageService()
    assert.throws(
      () => cosDefault.deleteObject('opaque/object', 'other-bucket-1250000000'),
      /STORAGE_BACKEND_UNAVAILABLE/
    )
  } finally {
    for (const key of keys) {
      const value = previous.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

function makeRecord() {
  return {
    id: 'file-1',
    bucket: 'private-files',
    region: 'local',
    storageKey: 'users/member-1/resumes/file-1.pdf',
    filename: 'resume.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 100,
    sha256: 'a'.repeat(64),
    uploaderId: null,
    endUserId: 'member-1',
    ownerType: 'user',
    ownerId: 'member-1',
    purpose: 'resume_upload',
    sensitiveLevel: 'sensitive',
    visibility: 'private',
    status: 'active',
    createdBy: null,
    expiresAt: new Date(Date.now() + 60_000),
    deletedAt: null as Date | null,
    deletedBy: null as string | null,
    deleteReason: null as string | null,
    storageDeletePendingAt: null as Date | null,
    storageDeletedAt: null as Date | null,
    assetCategory: 'original',
    sourceFileId: null,
    retentionPolicy: 'system_short',
    retentionSetBy: 'system',
    retentionConsentAt: null,
    retentionConsentVersion: null,
    retentionLockedReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

function matchesRecord(record: ReturnType<typeof makeRecord>, where: Record<string, unknown>): boolean {
  if (where['id'] && where['id'] !== record.id) return false
  if (where['deletedAt'] === null && record.deletedAt !== null) return false
  if (
    where['deletedAt'] instanceof Date &&
    record.deletedAt?.getTime() !== where['deletedAt'].getTime()
  ) {
    return false
  }
  if (where['status'] && typeof where['status'] === 'string' && where['status'] !== record.status) {
    return false
  }
  const statusWhere = where['status'] as { in?: string[]; notIn?: string[] } | undefined
  if (statusWhere?.in && !statusWhere.in.includes(record.status)) return false
  if (statusWhere?.notIn?.includes(record.status)) return false
  if (
    where['updatedAt'] instanceof Date &&
    where['updatedAt'].getTime() !== record.updatedAt.getTime()
  ) {
    return false
  }
  for (const field of ['storageDeletePendingAt', 'storageDeletedAt'] as const) {
    const condition = where[field]
    if (condition === null && record[field] !== null) return false
    if (condition instanceof Date && record[field]?.getTime() !== condition.getTime()) return false
    if (
      typeof condition === 'object' &&
      condition !== null &&
      'not' in condition &&
      (condition as { not: unknown }).not === null &&
      record[field] === null
    ) {
      return false
    }
  }
  const purposeWhere = where['purpose'] as { not?: string } | undefined
  if (purposeWhere?.not && record.purpose === purposeWhere.not) return false
  const expiresWhere = where['expiresAt'] as { lt?: Date } | null | undefined
  if (expiresWhere?.lt && (!record.expiresAt || record.expiresAt >= expiresWhere.lt)) return false
  if (expiresWhere === null && record.expiresAt !== null) return false
  const branches = where['OR'] as Record<string, unknown>[] | undefined
  if (branches && !branches.some((branch) => matchesRecord(record, branch))) return false
  return true
}

function makeHarness(options: { failMetadata?: boolean; failStorageOnce?: boolean } = {}) {
  const record = makeRecord()
  const order: string[] = []
  let deleteObjectCalls = 0
  let failStorage = options.failStorageOnce ?? false

  const persist = async (data: Partial<typeof record>) => {
    order.push('metadata')
    if (options.failMetadata) throw new Error('controlled metadata write failure')
    Object.assign(record, data)
    return record
  }
  const prisma = {
    fileObject: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === record.id ? record : null,
      update: async ({ data }: { data: Partial<typeof record> }) => persist(data),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<typeof record> }) => {
        if (!matchesRecord(record, where)) return { count: 0 }
        await persist(data)
        return { count: 1 }
      },
    },
    fairMaterialPrintBridge: { findFirst: async () => null },
  }
  const storage = {
    deleteObject: async () => {
      order.push('storage')
      deleteObjectCalls += 1
      if (failStorage) {
        failStorage = false
        throw new Error('controlled storage delete failure')
      }
    },
    getDownloadUrl: () => {
      throw new Error('deleted files must not reach URL signing')
    },
    getObject: async () => {
      throw new Error('deleted files must not reach object reads')
    },
    signTtlSeconds: 1800,
  }
  return {
    record,
    order,
    deleteObjectCalls: () => deleteObjectCalls,
    service: new FilesService(prisma as never, {} as never, storage as never),
  }
}

function makeQuarantineHarness(options: { failMetadata?: boolean; failStorage?: boolean } = {}) {
  const record = makeRecord()
  record.status = 'uploading'
  let deleteObjectCalls = 0
  const prisma = {
    fileObject: {
      findUnique: async () => record,
      update: async ({ data }: { data: Partial<typeof record> }) => {
        if (options.failMetadata) throw new Error('controlled quarantine metadata failure')
        Object.assign(record, data)
        return record
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<typeof record> }) => {
        if (options.failMetadata) throw new Error('controlled quarantine metadata failure')
        if (!matchesRecord(record, where)) return { count: 0 }
        Object.assign(record, data)
        return { count: 1 }
      },
    },
    fairMaterialPrintBridge: { findFirst: async () => null },
  }
  const storage = {
    headObject: async () => ({ sizeBytes: 21 * 1024 * 1024, contentType: 'application/pdf' }),
    deleteObject: async () => {
      deleteObjectCalls += 1
      if (options.failStorage) throw new Error('controlled quarantine storage failure')
    },
    getDownloadUrl: () => {
      throw new Error('quarantined files must not reach URL signing')
    },
    getObject: async () => {
      throw new Error('quarantined files must not reach object reads')
    },
    signTtlSeconds: 1800,
  }
  return {
    record,
    deleteObjectCalls: () => deleteObjectCalls,
    service: new FilesService(prisma as never, {} as never, storage as never),
  }
}

function makeRawUploadDeleteRaceHarness(options: { failStorageDelete?: boolean } = {}) {
  const record = makeRecord()
  record.status = 'uploading'
  let deleteObjectCalls = 0
  let putObjectCalls = 0
  const prisma = {
    fileObject: {
      findUnique: async () => record,
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>
        data: Partial<typeof record>
      }) => {
        if (!matchesRecord(record, where)) return { count: 0 }
        Object.assign(record, data)
        return { count: 1 }
      },
    },
    fairMaterialPrintBridge: { findFirst: async () => null, update: async () => undefined },
  }
  const storage = {
    putObject: async () => {
      putObjectCalls += 1
      // 模拟 requireAlive 已返回、PUT 执行期间另一删除者完成 metadata + 对象删除。
      record.status = 'deleted'
      record.deletedAt = new Date()
      record.deletedBy = 'user'
      record.deleteReason = 'owner delete won before delayed PUT'
      record.storageDeletePendingAt = null
      record.storageDeletedAt = new Date()
      record.updatedAt = new Date(record.updatedAt.getTime() + 1)
      return { sizeBytes: 24, sha256: 'b'.repeat(64) }
    },
    deleteObject: async () => {
      deleteObjectCalls += 1
      if (options.failStorageDelete) throw new Error('controlled compensation delete failure')
    },
    signTtlSeconds: 1800,
  }
  return {
    record,
    putObjectCalls: () => putObjectCalls,
    deleteObjectCalls: () => deleteObjectCalls,
    service: new FilesService(prisma as never, {} as never, storage as never),
  }
}

function makeCleanupHarness(
  options: { extendBeforeQuarantine?: boolean; confirmBeforeQuarantine?: boolean } = {}
) {
  const record = makeRecord()
  record.expiresAt = new Date(Date.now() - 60_000)
  if (options.confirmBeforeQuarantine) record.status = 'uploading'
  let deleteObjectCalls = 0
  let failFinalMetadata = true
  const prisma = {
    fileObject: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        const rows = matchesRecord(record, where) ? [{ ...record }] : []
        if (rows.length > 0 && where['deletedAt'] === null) {
          if (options.extendBeforeQuarantine) {
            record.expiresAt = new Date(Date.now() + 60_000)
            record.updatedAt = new Date(record.updatedAt.getTime() + 1)
          }
          if (options.confirmBeforeQuarantine) {
            record.status = 'active'
            record.updatedAt = new Date(record.updatedAt.getTime() + 1)
          }
        }
        return rows
      },
      findUnique: async () => record,
      update: async ({ data }: { data: Partial<typeof record> }) => {
        if (failFinalMetadata && data.status === 'deleted') {
          throw new Error('controlled cleanup final metadata failure')
        }
        Object.assign(record, data)
        return record
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>
        data: Partial<typeof record>
      }) => {
        if (!matchesRecord(record, where)) return { count: 0 }
        if (failFinalMetadata && data.status === 'deleted') {
          throw new Error('controlled cleanup final metadata failure')
        }
        Object.assign(record, data)
        return { count: 1 }
      },
    },
    fairMaterialPrintBridge: {
      findFirst: async () => null,
      update: async () => undefined,
    },
    printTask: {
      findMany: async () => [],
    },
  }
  const storage = {
    deleteObject: async () => {
      deleteObjectCalls += 1
    },
    getDownloadUrl: () => {
      throw new Error('cleanup quarantine must not reach URL signing')
    },
    getObject: async () => {
      throw new Error('cleanup quarantine must not reach object reads')
    },
    signTtlSeconds: 1800,
  }
  return {
    record,
    deleteObjectCalls: () => deleteObjectCalls,
    allowFinalMetadata: () => {
      failFinalMetadata = false
    },
    service: new FilesService(
      prisma as never,
      { write: async () => undefined } as never,
      storage as never
    ),
  }
}

function makeRetentionRaceHarness() {
  const record = makeRecord()
  const originalExpiry = record.expiresAt
  const prisma = {
    fileObject: {
      findUnique: async () => record,
      updateMany: async ({ where }: { where: { status?: string; updatedAt?: Date } }) => {
        record.status = 'quarantined'
        record.updatedAt = new Date(record.updatedAt.getTime() + 1)
        if (
          where.status !== record.status ||
          where.updatedAt?.getTime() !== record.updatedAt.getTime()
        ) {
          return { count: 0 }
        }
        return { count: 1 }
      },
    },
  }
  return {
    record,
    originalExpiry,
    service: new FilesService(prisma as never, {} as never, {} as never),
  }
}

function makePendingRetryHarness(options: {
  status?: 'quarantined' | 'deleted'
  withPending?: boolean
  failStorage?: boolean
  purpose?: string
} = {}) {
  const record = makeRecord()
  record.status = options.status ?? 'deleted'
  record.deletedAt = record.status === 'deleted' ? new Date() : null
  record.purpose = options.purpose ?? 'resume_upload'
  record.storageDeletePendingAt = options.withPending === false ? null : new Date()
  let deleteObjectCalls = 0
  const prisma = {
    fileObject: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        matchesRecord(record, where) ? [{ ...record }] : [],
      findUnique: async () => record,
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>
        data: Partial<typeof record>
      }) => {
        if (!matchesRecord(record, where)) return { count: 0 }
        Object.assign(record, data)
        return { count: 1 }
      },
    },
    fairMaterialPrintBridge: { findFirst: async () => null, update: async () => undefined },
    printTask: { findMany: async () => [] },
  }
  const storage = {
    deleteObject: async () => {
      deleteObjectCalls += 1
      if (options.failStorage) throw new Error('controlled retry storage failure')
    },
    signTtlSeconds: 1800,
  }
  return {
    record,
    deleteObjectCalls: () => deleteObjectCalls,
    service: new FilesService(
      prisma as never,
      { write: async () => undefined } as never,
      storage as never
    ),
  }
}

function makePendingBatchHarness() {
  const failed = makeRecord()
  failed.id = 'file-failed'
  failed.storageKey = 'files/failed.pdf'
  failed.status = 'deleted'
  failed.deletedAt = new Date()
  failed.storageDeletePendingAt = new Date()
  const healthy = makeRecord()
  healthy.id = 'file-healthy'
  healthy.storageKey = 'files/healthy.pdf'
  healthy.status = 'deleted'
  healthy.deletedAt = new Date()
  healthy.storageDeletePendingAt = new Date()
  const records = new Map([
    [failed.id, failed],
    [healthy.id, healthy],
  ])
  const prisma = {
    fileObject: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        Array.from(records.values()).filter((record) => matchesRecord(record, where)),
      findUnique: async ({ where }: { where: { id: string } }) => records.get(where.id) ?? null,
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>
        data: Partial<typeof failed>
      }) => {
        const record = records.get(String(where['id']))
        if (!record || !matchesRecord(record, where)) return { count: 0 }
        Object.assign(record, data)
        return { count: 1 }
      },
    },
    fairMaterialPrintBridge: { findFirst: async () => null, update: async () => undefined },
    printTask: { findMany: async () => [] },
  }
  const storage = {
    deleteObject: async (storageKey: string) => {
      if (storageKey === failed.storageKey) throw new Error('controlled batch item failure')
    },
    signTtlSeconds: 1800,
  }
  return {
    failed,
    healthy,
    service: new FilesService(
      prisma as never,
      { write: async () => undefined } as never,
      storage as never
    ),
  }
}

function makePendingStarvationHarness() {
  const base = new Date('2026-01-01T00:00:00.000Z').getTime()
  const records = new Map<string, ReturnType<typeof makeRecord>>()
  for (let index = 0; index < 101; index += 1) {
    const record = makeRecord()
    record.id = index === 100 ? 'file-healthy-101' : `file-failed-${String(index).padStart(3, '0')}`
    record.storageKey = `files/${record.id}.pdf`
    record.status = 'deleted'
    record.deletedAt = new Date(base)
    record.storageDeletePendingAt = new Date(base + index)
    record.createdAt = new Date(base + index)
    record.updatedAt = new Date(base + index)
    records.set(record.id, record)
  }
  const prisma = {
    fileObject: {
      findMany: async ({
        where,
        take,
      }: {
        where: Record<string, unknown>
        take?: number
      }) =>
        Array.from(records.values())
          .filter((record) => matchesRecord(record, where))
          .sort((left, right) => {
            const pendingOrder =
              (left.storageDeletePendingAt?.getTime() ?? -1) -
              (right.storageDeletePendingAt?.getTime() ?? -1)
            return pendingOrder || left.createdAt.getTime() - right.createdAt.getTime()
          })
          .slice(0, take),
      findUnique: async ({ where }: { where: { id: string } }) => records.get(where.id) ?? null,
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>
        data: Partial<ReturnType<typeof makeRecord>>
      }) => {
        const record = records.get(String(where['id']))
        if (!record || !matchesRecord(record, where)) return { count: 0 }
        Object.assign(record, data)
        return { count: 1 }
      },
    },
    fairMaterialPrintBridge: { findFirst: async () => null, update: async () => undefined },
    printTask: { findMany: async () => [] },
  }
  const storage = {
    deleteObject: async (storageKey: string) => {
      if (!storageKey.includes('file-healthy-101')) {
        throw new Error('controlled oldest-item storage failure')
      }
    },
    signTtlSeconds: 1800,
  }
  return {
    healthy: records.get('file-healthy-101')!,
    service: new FilesService(
      prisma as never,
      { write: async () => undefined } as never,
      storage as never
    ),
  }
}

function makeExpiredPrintProtectionStarvationHarness() {
  const records = new Map<string, ReturnType<typeof makeRecord>>()
  const directProtectedIds = new Set<string>()
  const urlProtectedId = 'file-url-protected-101'
  const healthyId = 'file-expired-healthy-102'
  for (let index = 0; index < 102; index += 1) {
    const record = makeRecord()
    record.id =
      index < 100 ? `file-printing-${index}` : index === 100 ? urlProtectedId : healthyId
    record.storageKey = `files/${record.id}.pdf`
    record.expiresAt = new Date(Date.now() - 60_000)
    record.createdAt = new Date(Date.now() - (102 - index) * 1_000)
    record.updatedAt = new Date(record.createdAt)
    records.set(record.id, record)
    if (index < 100) directProtectedIds.add(record.id)
  }
  const prisma = {
    fileObject: {
      findMany: async ({
        where,
        take,
      }: {
        where: Record<string, unknown>
        take?: number
      }) => {
        const candidates = Array.from(records.values())
          .filter((record) => matchesRecord(record, where))
          .filter((record) => !where['printTasks'] || !directProtectedIds.has(record.id))
          .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
        return candidates.slice(0, take)
      },
      findUnique: async ({ where }: { where: { id: string } }) => records.get(where.id) ?? null,
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>
        data: Partial<ReturnType<typeof makeRecord>>
      }) => {
        const record = records.get(String(where['id']))
        if (!record || !matchesRecord(record, where)) return { count: 0 }
        Object.assign(record, data)
        return { count: 1 }
      },
    },
    fairMaterialPrintBridge: { findFirst: async () => null, update: async () => undefined },
    printTask: {
      findMany: async () =>
        Array.from(directProtectedIds).map((fileId, index) => ({
          fileId,
          fileUrl:
            index === 0
              ? `/api/v1/files/${urlProtectedId}/content`
              : `/api/v1/files/${fileId}/content`,
        })),
    },
  }
  const storage = { deleteObject: async () => undefined, signTtlSeconds: 1800 }
  return {
    urlProtected: records.get(urlProtectedId)!,
    healthy: records.get(healthyId)!,
    service: new FilesService(
      prisma as never,
      { write: async () => undefined } as never,
      storage as never
    ),
  }
}

function makePrintProtectionOverflowHarness() {
  const record = makeRecord()
  record.expiresAt = new Date(Date.now() - 60_000)
  let expiredQueryCalls = 0
  const prisma = {
    fileObject: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        if (where['deletedAt'] === null) expiredQueryCalls += 1
        return []
      },
    },
    printTask: {
      findMany: async () =>
        Array.from({ length: 1_001 }, (_, index) => ({
          fileId: `protected-${index}`,
          fileUrl: `/api/v1/files/protected-${index}/content`,
        })),
    },
  }
  return {
    expiredQueryCalls: () => expiredQueryCalls,
    service: new FilesService(
      prisma as never,
      { write: async () => undefined } as never,
      { signTtlSeconds: 1800 } as never
    ),
  }
}

async function main(): Promise<void> {
  verifyStorageDeleteSchemaContract()
  verifyStorageBucketRoutingContract()
  const metadataFailure = makeHarness({ failMetadata: true })
  await assert.rejects(
    () =>
      metadataFailure.service.ownerDelete(
        'file-1',
        { kind: 'member', endUserId: 'member-1' },
        'owner delete'
      ),
    /controlled metadata write failure/
  )
  assert.equal(metadataFailure.deleteObjectCalls(), 0)
  assert.equal(metadataFailure.record.status, 'active')
  assert.equal(metadataFailure.record.deletedAt, null)

  const storageFailure = makeHarness({ failStorageOnce: true })
  await assert.rejects(
    () =>
      storageFailure.service.ownerDelete(
        'file-1',
        { kind: 'member', endUserId: 'member-1' },
        'owner delete'
      ),
    ServiceUnavailableException
  )
  assert.equal(storageFailure.record.status, 'deleted')
  assert.ok(storageFailure.record.deletedAt)
  assert.ok(storageFailure.record.storageDeletePendingAt)
  assert.equal(storageFailure.record.storageDeletedAt, null)
  await assert.rejects(
    () =>
      storageFailure.service.getAccessUrl(
        'file-1',
        { kind: 'member', endUserId: 'member-1' },
        'inline'
      ),
    NotFoundException
  )
  await assert.rejects(() => storageFailure.service.readContent('file-1'), NotFoundException)

  await assert.rejects(
    () =>
      storageFailure.service.ownerDelete(
        'file-1',
        { kind: 'member', endUserId: 'member-2' },
        'unauthorized retry'
      ),
    ForbiddenException
  )
  assert.equal(storageFailure.deleteObjectCalls(), 1)

  const retried = await storageFailure.service.ownerDelete(
    'file-1',
    { kind: 'member', endUserId: 'member-1' },
    'owner delete retry'
  )
  assert.equal(retried.status, 'deleted')
  assert.equal(storageFailure.deleteObjectCalls(), 2)
  assert.equal(storageFailure.record.storageDeletePendingAt, null)
  assert.ok(storageFailure.record.storageDeletedAt)

  const adminRetry = makeHarness({ failStorageOnce: true })
  const admin = {
    kind: 'user' as const,
    userId: 'admin-1',
    role: 'admin' as const,
    orgId: null,
  }
  await assert.rejects(
    () => adminRetry.service.ownerDelete('file-1', admin, 'admin delete'),
    ServiceUnavailableException
  )
  const adminRetried = await adminRetry.service.ownerDelete('file-1', admin, 'admin retry')
  assert.equal(adminRetried.status, 'deleted')
  assert.equal(adminRetry.deleteObjectCalls(), 2)

  const normal = makeHarness()
  const deleted = await normal.service.ownerDelete(
    'file-1',
    { kind: 'member', endUserId: 'member-1' },
    'owner delete'
  )
  assert.equal(deleted.status, 'deleted')
  assert.deepEqual(normal.order, ['metadata', 'storage', 'metadata'])
  assert.equal(normal.record.storageDeletePendingAt, null)
  assert.ok(normal.record.storageDeletedAt)
  await normal.service.ownerDelete(
    'file-1',
    { kind: 'member', endUserId: 'member-1' },
    'completed delete retry'
  )
  assert.equal(normal.deleteObjectCalls(), 1)

  const unauthorized = makeHarness()
  await assert.rejects(
    () =>
      unauthorized.service.ownerDelete(
        'file-1',
        { kind: 'member', endUserId: 'member-2' },
        'unauthorized delete'
      ),
    ForbiddenException
  )
  assert.deepEqual(unauthorized.order, [])

  const quarantineMetadataFailure = makeQuarantineHarness({ failMetadata: true })
  await assert.rejects(
    () =>
      quarantineMetadataFailure.service.completeUpload('file-1', {
        kind: 'member',
        endUserId: 'member-1',
      }),
    /controlled quarantine metadata failure/
  )
  assert.equal(quarantineMetadataFailure.deleteObjectCalls(), 0)
  assert.equal(quarantineMetadataFailure.record.status, 'uploading')

  const quarantineStorageFailure = makeQuarantineHarness({ failStorage: true })
  await assert.rejects(
    () =>
      quarantineStorageFailure.service.completeUpload('file-1', {
        kind: 'member',
        endUserId: 'member-1',
      }),
    ServiceUnavailableException
  )
  assert.equal(quarantineStorageFailure.record.status, 'quarantined')
  assert.ok(quarantineStorageFailure.record.storageDeletePendingAt)
  assert.equal(quarantineStorageFailure.record.storageDeletedAt, null)
  await assert.rejects(
    () =>
      quarantineStorageFailure.service.getAccessUrl(
        'file-1',
        { kind: 'member', endUserId: 'member-1' },
        'inline'
      ),
    NotFoundException
  )
  await assert.rejects(
    () => quarantineStorageFailure.service.readContent('file-1'),
    NotFoundException
  )
  await assert.rejects(
    () =>
      quarantineStorageFailure.service.completeUpload('file-1', {
        kind: 'member',
        endUserId: 'member-1',
      }),
    NotFoundException
  )
  assert.equal(quarantineStorageFailure.record.status, 'quarantined')

  const quarantineSuccess = makeQuarantineHarness()
  await assert.rejects(
    () =>
      quarantineSuccess.service.completeUpload('file-1', {
        kind: 'member',
        endUserId: 'member-1',
      }),
    BadRequestException
  )
  assert.equal(quarantineSuccess.record.status, 'deleted')
  assert.ok(quarantineSuccess.record.deletedAt)
  assert.equal(quarantineSuccess.record.storageDeletePendingAt, null)
  assert.ok(quarantineSuccess.record.storageDeletedAt)

  const rawUploadDeleteRace = makeRawUploadDeleteRaceHarness()
  await assert.rejects(
    () => rawUploadDeleteRace.service.writeRawUpload('file-1', Buffer.from('%PDF-1.4\n%%EOF')),
    ConflictException
  )
  assert.equal(rawUploadDeleteRace.putObjectCalls(), 1)
  assert.equal(rawUploadDeleteRace.deleteObjectCalls(), 1)
  assert.equal(rawUploadDeleteRace.record.status, 'deleted')
  assert.ok(rawUploadDeleteRace.record.deletedAt)
  assert.equal(rawUploadDeleteRace.record.storageDeletePendingAt, null)
  assert.ok(rawUploadDeleteRace.record.storageDeletedAt)

  const failedRawUploadCompensation = makeRawUploadDeleteRaceHarness({
    failStorageDelete: true,
  })
  await assert.rejects(
    () =>
      failedRawUploadCompensation.service.writeRawUpload(
        'file-1',
        Buffer.from('%PDF-1.4\n%%EOF')
      ),
    ConflictException
  )
  assert.equal(failedRawUploadCompensation.deleteObjectCalls(), 1)
  assert.equal(failedRawUploadCompensation.record.status, 'quarantined')
  assert.ok(failedRawUploadCompensation.record.storageDeletePendingAt)
  assert.equal(failedRawUploadCompensation.record.storageDeletedAt, null)

  const cleanup = makeCleanupHarness()
  const firstCleanup = await cleanup.service.cleanupExpired('manual')
  assert.equal(firstCleanup.deletedCount, 0)
  assert.equal(cleanup.record.status, 'quarantined')
  assert.equal(cleanup.record.deletedAt, null)
  assert.ok(cleanup.record.storageDeletePendingAt)
  assert.equal(cleanup.record.storageDeletedAt, null)
  await assert.rejects(() => cleanup.service.readContent('file-1'), NotFoundException)
  cleanup.allowFinalMetadata()
  const retriedCleanup = await cleanup.service.cleanupExpired('manual')
  assert.equal(retriedCleanup.deletedCount, 1)
  assert.equal(cleanup.record.status, 'deleted')
  assert.ok(cleanup.record.deletedAt)
  assert.equal(cleanup.record.storageDeletePendingAt, null)
  assert.ok(cleanup.record.storageDeletedAt)
  assert.equal(cleanup.deleteObjectCalls(), 2)

  const pendingOwnerDelete = makePendingRetryHarness()
  assert.equal((await pendingOwnerDelete.service.cleanupExpired('cron')).deletedCount, 1)
  assert.equal(pendingOwnerDelete.record.storageDeletePendingAt, null)
  assert.ok(pendingOwnerDelete.record.storageDeletedAt)
  assert.equal(pendingOwnerDelete.deleteObjectCalls(), 1)
  assert.equal((await pendingOwnerDelete.service.cleanupExpired('cron')).deletedCount, 0)
  assert.equal(pendingOwnerDelete.deleteObjectCalls(), 1)

  const legacyDeleted = makePendingRetryHarness({ withPending: false })
  assert.equal((await legacyDeleted.service.cleanupExpired('cron')).deletedCount, 1)
  assert.ok(legacyDeleted.record.storageDeletedAt)

  const legacyQuarantined = makePendingRetryHarness({
    status: 'quarantined',
    withPending: false,
  })
  assert.equal((await legacyQuarantined.service.cleanupExpired('cron')).deletedCount, 1)
  assert.equal(legacyQuarantined.record.status, 'deleted')
  assert.ok(legacyQuarantined.record.deletedAt)
  assert.ok(legacyQuarantined.record.storageDeletedAt)

  const persistentFailure = makePendingRetryHarness({ failStorage: true })
  assert.equal((await persistentFailure.service.cleanupExpired('cron')).deletedCount, 0)
  assert.ok(persistentFailure.record.storageDeletePendingAt)
  assert.equal(persistentFailure.record.storageDeletedAt, null)

  const mixedBatch = makePendingBatchHarness()
  const mixedResult = await mixedBatch.service.cleanupExpired('cron')
  assert.deepEqual(mixedResult.deletedFileIds, ['file-healthy'])
  assert.ok(mixedBatch.failed.storageDeletePendingAt)
  assert.equal(mixedBatch.failed.storageDeletedAt, null)
  assert.equal(mixedBatch.healthy.storageDeletePendingAt, null)
  assert.ok(mixedBatch.healthy.storageDeletedAt)

  const pendingStarvation = makePendingStarvationHarness()
  assert.equal((await pendingStarvation.service.cleanupExpired('cron')).deletedCount, 0)
  const rotatedPendingBatch = await pendingStarvation.service.cleanupExpired('cron')
  assert.ok(rotatedPendingBatch.deletedFileIds.includes('file-healthy-101'))
  assert.equal(pendingStarvation.healthy.storageDeletePendingAt, null)
  assert.ok(pendingStarvation.healthy.storageDeletedAt)

  const protectedExpiredBatch = makeExpiredPrintProtectionStarvationHarness()
  const protectedExpiredResult = await protectedExpiredBatch.service.cleanupExpired('cron')
  assert.deepEqual(protectedExpiredResult.deletedFileIds, ['file-expired-healthy-102'])
  assert.equal(protectedExpiredBatch.urlProtected.storageDeletedAt, null)
  assert.ok(protectedExpiredBatch.healthy.storageDeletedAt)

  const printProtectionOverflow = makePrintProtectionOverflowHarness()
  assert.equal((await printProtectionOverflow.service.cleanupExpired('cron')).deletedCount, 0)
  assert.equal(printProtectionOverflow.expiredQueryCalls(), 0)

  const protectedExport = makePendingRetryHarness({ purpose: 'member_data_export' })
  assert.equal((await protectedExport.service.cleanupExpired('cron')).deletedCount, 0)
  assert.equal(protectedExport.deleteObjectCalls(), 0)
  assert.ok(protectedExport.record.storageDeletePendingAt)

  const extendedDuringCleanup = makeCleanupHarness({ extendBeforeQuarantine: true })
  const skippedStaleCandidate = await extendedDuringCleanup.service.cleanupExpired('manual')
  assert.equal(skippedStaleCandidate.deletedCount, 0)
  assert.equal(extendedDuringCleanup.record.status, 'active')
  assert.equal(extendedDuringCleanup.record.deletedAt, null)
  assert.equal(extendedDuringCleanup.deleteObjectCalls(), 0)

  const confirmedDuringCleanup = makeCleanupHarness({ confirmBeforeQuarantine: true })
  const skippedConfirmedCandidate = await confirmedDuringCleanup.service.cleanupExpired('manual')
  assert.equal(skippedConfirmedCandidate.deletedCount, 0)
  assert.equal(confirmedDuringCleanup.record.status, 'active')
  assert.equal(confirmedDuringCleanup.record.deletedAt, null)
  assert.equal(confirmedDuringCleanup.deleteObjectCalls(), 0)

  const retentionRace = makeRetentionRaceHarness()
  await assert.rejects(
    () =>
      retentionRace.service.updateRetention(
        'file-1',
        { kind: 'member', endUserId: 'member-1' },
        { retentionPolicy: 'months_3' }
      ),
    ConflictException
  )
  assert.equal(retentionRace.record.status, 'quarantined')
  assert.equal(retentionRace.record.expiresAt, retentionRace.originalExpiry)

  console.log('PASS: file deletion tombstones metadata before idempotent object deletion')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
