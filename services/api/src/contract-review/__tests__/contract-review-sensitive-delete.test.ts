import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FilesService } from '../../files/files.service'
import { FileQueryService } from '../../files/file-query.service'
import { FileDeleteService } from '../../files/file-delete.service'
import { FileCleanupService } from '../../files/file-cleanup.service'
import { FilesCleanupTask } from '../../files/files.cleanup.task'

test('sensitive system deletion never logs the full file id', async () => {
  const fileId = 'contract-file-secret-370101199001011234'
  const logs: string[] = []
  const storageDeletes: Array<{ storageKey: string; bucket: string }> = []
  const databaseWrites: unknown[] = []
  const row = fileRow(fileId)
  const deletedRow = {
    ...row,
    status: 'deleted',
    deletedAt: new Date('2026-08-01T11:00:00.000Z'),
    deletedBy: 'system',
    deleteReason: 'contract_review_expired',
  }
  const queryService = new FileQueryService({} as never, {} as never)
  ;(queryService as unknown as { requireDeletable: () => Promise<typeof row> }).requireDeletable =
    async () => row

  const deleteService = new FileDeleteService(
    {
      fileObject: {
        update: async (args: unknown) => {
          databaseWrites.push(args)
          return deletedRow
        },
      },
    } as never,
    {
      deleteObject: async (storageKey: string, bucket: string) => {
        storageDeletes.push({ storageKey, bucket })
      },
    } as never,
    queryService,
  )
  ;(deleteService as unknown as { logger: { log(value: string): void } }).logger = {
    log: (value) => logs.push(value),
  }

  const service = new FilesService({} as never, {} as never, deleteService, {} as never)

  const deleted = await service.systemDeleteSensitive(fileId, 'contract_review_expired')

  assert.equal(deleted.id, fileId)
  assert.deepEqual(storageDeletes, [{ storageKey: row.storageKey, bucket: row.bucket }])
  assert.equal(databaseWrites.length, 1)
  assert.equal(logs.length, 1)
  assert.doesNotMatch(logs[0]!, new RegExp(fileId))
  assert.match(logs[0]!, /^Sensitive file deleted by system: [a-f0-9]{12}$/u)
})

test('generic system deletion keeps its existing full-id log behavior', async () => {
  const fileId = 'ordinary-system-file-id'
  const logs: string[] = []
  const row = fileRow(fileId)
  const queryService61 = new FileQueryService({} as never, {} as never)
  ;(queryService61 as unknown as { requireDeletable: () => Promise<typeof row> }).requireDeletable =
    async () => row
  const deleteService61 = new FileDeleteService(
    {
      fileObject: {
        update: async () => ({ ...row, status: 'deleted', deletedAt: new Date() }),
      },
    } as never,
    { deleteObject: async () => undefined } as never,
    queryService61,
  )
  ;(deleteService61 as unknown as { logger: { log(value: string): void } }).logger = {
    log: (value) => logs.push(value),
  }
  const service = new FilesService({} as never, {} as never, deleteService61, {} as never)

  await service.systemDelete(fileId, 'existing_cleanup_reason')

  assert.deepEqual(logs, [`File deleted by system: ${fileId}`])
})

test('generic expired cleanup redacts file ids, storage errors, and cron batch errors', async () => {
  const fileId = 'contract-file-secret-370101199001011234'
  const logs: string[] = []
  const cleanupService84 = new FileCleanupService(
    {
      fileObject: { findMany: async () => [{
        id: fileId, storageKey: 'contracts/member-1/private.pdf', bucket: 'private',
        purpose: 'contract_upload', sensitiveLevel: 'highly_sensitive',
      }] },
      fairMaterialPrintBridge: { findFirst: async () => null },
    } as never,
    { deleteObject: async () => { throw new Error(`storage failed ${fileId} contracts/member-1/private.pdf`) } } as never,
    {} as never,
  )
  ;(cleanupService84 as unknown as { logger: { warn(value: string): void; log(value: string): void } }).logger = {
    warn: (value) => logs.push(value), log: (value) => logs.push(value),
  }
  const service = new FilesService({} as never, {} as never, {} as never, cleanupService84)
  await service.cleanupExpired('cron')
  assert.equal(logs.length, 1)
  assert.match(logs[0]!, /^code=FILE_CLEANUP_ITEM_FAILED file=[a-f0-9]{12}$/u)
  assert.doesNotMatch(logs[0]!, new RegExp(`${fileId}|private\\.pdf|storage failed`, 'u'))

  const cronLogs: string[] = []
  const cron = new FilesCleanupTask({
    async cleanupExpired() { throw new Error(`database failed ${fileId}`) },
  } as never)
  ;(cron as unknown as { logger: { error(value: string): void } }).logger = {
    error: (value) => cronLogs.push(value),
  }
  await cron.handleHourly()
  assert.deepEqual(cronLogs, ['code=FILE_CLEANUP_BATCH_FAILED'])
})

test('cron audit stores irreversible digests instead of raw deleted file ids', async () => {
  const fileId = 'contract-file-secret-370101199001011234'
  const audits: Array<{ payload?: { fileIdDigest?: string[] } }> = []
  const row = fileRow(fileId)
  const cleanupService118 = new FileCleanupService(
    {
      fileObject: {
        findMany: async () => [{
          id: fileId, storageKey: row.storageKey, bucket: row.bucket,
          purpose: row.purpose, sensitiveLevel: row.sensitiveLevel,
        }],
        update: async () => ({ ...row, status: 'deleted', deletedAt: new Date() }),
      },
      fairMaterialPrintBridge: { findFirst: async () => null },
    } as never,
    { deleteObject: async () => undefined } as never,
    { write: async (entry: { payload?: { fileIdDigest?: string[] } }) => { audits.push(entry) } } as never,
  )
  ;(cleanupService118 as unknown as { logger: { warn(): void; log(): void } }).logger = {
    warn: () => undefined, log: () => undefined,
  }
  const service = new FilesService({} as never, {} as never, {} as never, cleanupService118)
  await service.cleanupExpired('cron')
  assert.equal(audits.length, 1)
  assert.equal(audits[0]?.payload?.fileIdDigest?.length, 1)
  assert.match(audits[0]?.payload?.fileIdDigest?.[0] ?? '', /^[a-f0-9]{12}$/u)
  assert.doesNotMatch(JSON.stringify(audits), new RegExp(fileId, 'u'))
})

function fileRow(id: string) {
  return {
    id,
    bucket: 'private',
    region: 'cn',
    storageKey: 'contract/key',
    filename: 'contract.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 10,
    sha256: 'a'.repeat(64),
    purpose: 'contract_upload',
    sensitiveLevel: 'high',
    ownerType: 'user',
    ownerId: 'member-1',
    visibility: 'private',
    status: 'active',
    assetCategory: 'source',
    sourceFileId: null,
    retentionPolicy: 'system_short',
    retentionSetBy: 'system',
    retentionConsentAt: null,
    retentionConsentVersion: null,
    retentionLockedReason: 'contract_review_session_only',
    uploaderId: null,
    endUserId: 'member-1',
    createdBy: null,
    expiresAt: new Date('2026-08-01T12:00:00.000Z'),
    deletedAt: null,
    deletedBy: null,
    deleteReason: null,
    createdAt: new Date('2026-08-01T10:00:00.000Z'),
  }
}
