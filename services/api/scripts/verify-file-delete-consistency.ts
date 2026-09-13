import 'reflect-metadata'

import assert from 'node:assert/strict'
import { ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
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
    storageDeletedAt: null as Date | null,
    storageDeletePendingAt: null as Date | null,
    storageDeleteAttempts: null as number | null,
    storageDeleteError: null as string | null,
  }
}

type FileRecord = ReturnType<typeof makeRecord>

function uploadPdfArgs() {
  return {
    buffer: Buffer.from('%PDF-1.4 verify-upload-compensation'),
    filename: 'resume.pdf',
    mimeType: 'application/pdf',
    purpose: 'resume_upload' as const,
    uploaderId: null,
    endUserId: 'member-1',
  }
}

function makeUploadHarness(options: { failSign?: boolean; failStorageDelete?: boolean } = {}) {
  const filesById = new Map<string, FileRecord>()
  const liveObjects = new Set<string>()
  let putObjectCalls = 0
  let deleteObjectCalls = 0
  let getDownloadUrlCalls = 0

  const prisma = {
    fileObject: {
      create: async ({ data }: { data: Partial<FileRecord> & { id: string } }) => {
        const record: FileRecord = {
          ...makeRecord(),
          ...data,
          deletedAt: data.deletedAt ?? null,
          deletedBy: data.deletedBy ?? null,
          deleteReason: data.deleteReason ?? null,
          storageDeletedAt: null,
          storageDeletePendingAt: null,
          storageDeleteAttempts: null,
          storageDeleteError: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
        filesById.set(record.id, record)
        return record
      },
      findUnique: async ({ where }: { where: { id: string } }) => filesById.get(where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<FileRecord> }) => {
        const record = filesById.get(where.id)
        if (!record) throw new Error('controlled missing file for update')
        Object.assign(record, data)
        return record
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id?: string; deletedAt?: Date | null }
        data: Partial<FileRecord>
      }) => {
        const record = where.id ? filesById.get(where.id) : undefined
        if (!record) return { count: 0 }
        if (where.deletedAt === null && record.deletedAt) return { count: 0 }
        Object.assign(record, data)
        return { count: 1 }
      },
    },
    printTask: { findMany: async () => [] as Array<{ fileId: string; fileUrl: string | null }> },
  }
  const storage = {
    defaultBucket: 'private-files',
    defaultRegion: 'local',
    signTtlSeconds: 1800,
    putObject: async (objectKey: string, buffer: Buffer) => {
      putObjectCalls += 1
      liveObjects.add(objectKey)
      return { sizeBytes: buffer.length, sha256: 'b'.repeat(64) }
    },
    getDownloadUrl: () => {
      getDownloadUrlCalls += 1
      if (options.failSign) {
        throw new Error('controlled download URL signing failure')
      }
      return {
        url: 'https://files.local/signed',
        expiresAt: new Date(Date.now() + 1800_000),
      }
    },
    deleteObject: async (objectKey: string) => {
      deleteObjectCalls += 1
      if (options.failStorageDelete) {
        throw new Error('controlled storage delete failure')
      }
      liveObjects.delete(objectKey)
    },
  }
  return {
    filesById,
    liveObjects,
    putObjectCalls: () => putObjectCalls,
    deleteObjectCalls: () => deleteObjectCalls,
    getDownloadUrlCalls: () => getDownloadUrlCalls,
    onlyRecord(): FileRecord {
      assert.equal(filesById.size, 1, 'upload must persist exactly one FileObject')
      const record = [...filesById.values()][0]
      assert.ok(record, 'upload FileObject missing after create')
      return record
    },
    service: new FilesService(prisma as never, {} as never, storage as never),
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
    printTask: { findMany: async () => [] as Array<{ fileId: string; fileUrl: string | null }> },
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
    prisma,
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
    printTask: { findMany: async () => [] as Array<{ fileId: string; fileUrl: string | null }> },
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

function makeCleanupHarness() {
  const record = makeRecord()
  record.expiresAt = new Date(Date.now() - 60_000)
  let deleteObjectCalls = 0
  let failFinalMetadata = true
  const prisma = {
    fileObject: {
      findMany: async () => (record.deletedAt ? [] : [record]),
      findUnique: async () => record,
      update: async ({ data }: { data: Partial<typeof record> }) => {
        if (failFinalMetadata && data.status === 'deleted') {
          throw new Error('controlled cleanup final metadata failure')
        }
        Object.assign(record, data)
        return record
      },
      updateMany: async ({ data }: { data: Partial<typeof record> }) => {
        if (failFinalMetadata && data.status === 'deleted') {
          throw new Error('controlled cleanup final metadata failure')
        }
        Object.assign(record, data)
        return { count: 1 }
      },
    },
    fairMaterialPrintBridge: { findFirst: async () => null },
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
  // 本条守的是「DB tombstone 必须先于对象删除」，不是「总共只准写两次库」。
  // 删除成功后新增了一次物理删除账本写入（storageDeletedAt，CLAUDE.md §11 要求
  // 删除后保留删除日志），所以原来的整串 deepEqual 会误判。下界不降反升：
  // 前两步仍逐字钉死、storage 仍只准调一次，并且额外正向要求那次删除日志存在。
  assert.deepEqual(normal.order.slice(0, 2), ['metadata', 'storage'])
  assert.equal(
    normal.order.filter((step) => step === 'storage').length,
    1,
    'successful delete must touch object storage exactly once'
  )
  assert.equal(
    normal.order[2],
    'metadata',
    'successful object deletion must be recorded in the storage-delete ledger (§11 删除日志)'
  )
  assert.equal(normal.order.length, 3, 'no unexpected extra writes in the success path')

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

  const inUse = makeHarness()
  inUse.prisma.printTask.findMany = async () => [{ fileId: 'file-1', fileUrl: null }]
  await assert.rejects(
    () =>
      inUse.service.ownerDelete(
        'file-1',
        { kind: 'member', endUserId: 'member-1' },
        'owner delete while printing',
      ),
    (err: unknown) => {
      const body = (err as { getResponse?: () => { error?: { code?: string } } }).getResponse?.()
      assert.equal(body?.error?.code, 'FILE_IN_USE')
      return true
    },
  )
  assert.equal(inUse.record.deletedAt, null, 'in-use file must not be tombstoned')
  const systemCleanup = makeHarness()
  systemCleanup.prisma.printTask.findMany = async () => [{ fileId: 'file-1', fileUrl: null }]
  const systemDeleted = await systemCleanup.service.systemDelete('file-1', 'expired cleanup')
  assert.equal(systemDeleted.status, 'deleted', 'system cleanup path is exempt from FILE_IN_USE')

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

  const successfulUpload = makeUploadHarness()
  const uploaded = await successfulUpload.service.upload(uploadPdfArgs())
  assert.equal(successfulUpload.putObjectCalls(), 1)
  assert.equal(successfulUpload.getDownloadUrlCalls(), 1)
  assert.equal(successfulUpload.deleteObjectCalls(), 0, 'successful upload must not delete the object')
  assert.equal(successfulUpload.liveObjects.size, 1)
  assert.equal(successfulUpload.onlyRecord().status, 'active')
  assert.equal(successfulUpload.onlyRecord().deletedAt, null)
  assert.equal(uploaded.signedUrl, 'https://files.local/signed')

  const signFailure = makeUploadHarness({ failSign: true })
  await assert.rejects(
    () => signFailure.service.upload(uploadPdfArgs()),
    (err: unknown) => {
      assert.equal(
        err instanceof Error ? err.message : String(err),
        'controlled download URL signing failure',
        'original signing error must propagate; compensation must not replace it'
      )
      return true
    }
  )
  assert.equal(signFailure.putObjectCalls(), 1)
  assert.equal(signFailure.getDownloadUrlCalls(), 1)
  assert.equal(signFailure.deleteObjectCalls(), 1, 'compensating systemDelete must attempt object deletion once')
  const compensated = signFailure.onlyRecord()
  assert.equal(compensated.status, 'deleted')
  assert.ok(compensated.deletedAt, 'compensated FileObject must be tombstoned, not left active')
  assert.equal(compensated.deletedBy, 'system')
  assert.equal(compensated.deleteReason, 'upload response failed, compensating orphaned file')
  assert.ok(compensated.storageDeletedAt, 'successful compensating delete must write the storage-delete ledger')
  assert.equal(compensated.storageDeletePendingAt, null)
  assert.equal(signFailure.liveObjects.size, 0, 'physical object must not remain after successful compensation')
  await assert.rejects(
    () =>
      signFailure.service.getAccessUrl(
        compensated.id,
        { kind: 'member', endUserId: 'member-1' },
        'inline'
      ),
    NotFoundException
  )

  const signFailureStoragePending = makeUploadHarness({ failSign: true, failStorageDelete: true })
  await assert.rejects(
    () => signFailureStoragePending.service.upload(uploadPdfArgs()),
    (err: unknown) => {
      assert.equal(
        err instanceof Error ? err.message : String(err),
        'controlled download URL signing failure',
        'storage-delete failure during compensation must not replace the original signing error'
      )
      return true
    }
  )
  const pending = signFailureStoragePending.onlyRecord()
  assert.equal(pending.status, 'deleted', 'failed physical delete must still leave a tombstone, not an active orphan')
  assert.ok(pending.deletedAt)
  assert.equal(pending.deletedBy, 'system')
  assert.ok(
    pending.storageDeletePendingAt,
    'physical delete failure must retain cleanup evidence on the deletion ledger'
  )
  assert.equal(pending.storageDeletedAt, null, 'failed physical delete must not forge a storageDeletedAt log')
  assert.equal(pending.storageDeleteAttempts, 1)
  assert.equal(pending.storageDeleteError, 'Error')
  assert.equal(
    signFailureStoragePending.liveObjects.size,
    1,
    'object bytes remain until reconcileStorageDeletions retries the pending ledger'
  )
  await assert.rejects(
    () =>
      signFailureStoragePending.service.getAccessUrl(
        pending.id,
        { kind: 'member', endUserId: 'member-1' },
        'inline'
      ),
    NotFoundException
  )

  console.log('PASS: file deletion tombstones metadata before idempotent object deletion')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
