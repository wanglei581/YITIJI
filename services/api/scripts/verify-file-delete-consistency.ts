import 'reflect-metadata'

import assert from 'node:assert/strict'
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { FilesService } from '../src/files/files.service'

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
      updateMany: async ({ data }: { data: Partial<typeof record> }) => {
        if (record.deletedAt) return { count: 0 }
        await persist(data)
        return { count: 1 }
      },
    },
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
  let deleteObjectCalls = 0
  const prisma = {
    fileObject: {
      findUnique: async () => record,
      update: async ({ data }: { data: Partial<typeof record> }) => {
        if (options.failMetadata) throw new Error('controlled quarantine metadata failure')
        Object.assign(record, data)
        return record
      },
      updateMany: async ({ data }: { data: Partial<typeof record> }) => {
        if (options.failMetadata) throw new Error('controlled quarantine metadata failure')
        Object.assign(record, data)
        return { count: 1 }
      },
    },
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
      findMany: async () => (record.deletedAt ? [] : [{ ...record }]),
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
        const expiresWhere = where['expiresAt'] as { lt?: Date } | null | undefined
        if (where['status'] && where['status'] !== record.status) return { count: 0 }
        if (
          where['updatedAt'] instanceof Date &&
          where['updatedAt'].getTime() !== record.updatedAt.getTime()
        ) {
          return { count: 0 }
        }
        if (expiresWhere?.lt && (!record.expiresAt || record.expiresAt >= expiresWhere.lt)) {
          return { count: 0 }
        }
        if (expiresWhere === null && record.expiresAt !== null) return { count: 0 }
        if (failFinalMetadata && data.status === 'deleted') {
          throw new Error('controlled cleanup final metadata failure')
        }
        Object.assign(record, data)
        return { count: 1 }
      },
    },
    fairMaterialPrintBridge: {
      findFirst: async () => {
        if (options.extendBeforeQuarantine) {
          record.expiresAt = new Date(Date.now() + 60_000)
          record.updatedAt = new Date(record.updatedAt.getTime() + 1)
        }
        if (options.confirmBeforeQuarantine) {
          record.status = 'active'
          record.updatedAt = new Date(record.updatedAt.getTime() + 1)
        }
        return null
      },
    },
    printTask: { findMany: async () => [] },
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

async function main(): Promise<void> {
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
    /controlled storage delete failure/
  )
  assert.equal(storageFailure.record.status, 'deleted')
  assert.ok(storageFailure.record.deletedAt)
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

  const adminRetry = makeHarness({ failStorageOnce: true })
  const admin = {
    kind: 'user' as const,
    userId: 'admin-1',
    role: 'admin' as const,
    orgId: null,
  }
  await assert.rejects(
    () => adminRetry.service.ownerDelete('file-1', admin, 'admin delete'),
    /controlled storage delete failure/
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
  assert.deepEqual(normal.order, ['metadata', 'storage'])

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
  assert.equal(quarantineMetadataFailure.record.status, 'active')

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

  const cleanup = makeCleanupHarness()
  const firstCleanup = await cleanup.service.cleanupExpired('manual')
  assert.equal(firstCleanup.deletedCount, 0)
  assert.equal(cleanup.record.status, 'quarantined')
  assert.equal(cleanup.record.deletedAt, null)
  await assert.rejects(() => cleanup.service.readContent('file-1'), NotFoundException)
  cleanup.allowFinalMetadata()
  const retriedCleanup = await cleanup.service.cleanupExpired('manual')
  assert.equal(retriedCleanup.deletedCount, 1)
  assert.equal(cleanup.record.status, 'deleted')
  assert.ok(cleanup.record.deletedAt)
  assert.equal(cleanup.deleteObjectCalls(), 2)

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
