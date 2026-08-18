import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FilesService } from '../../files/files.service'
import { FilesCleanupTask } from '../../files/files.cleanup.task'

test('sensitive system deletion never logs the full file id', async () => {
  const fileId = 'contract-file-secret-370101199001011234'
  const logs: string[] = []
  const storageDeletes: Array<{ storageKey: string; bucket: string }> = []
  const databaseWrites: unknown[] = []
  const ledgerWrites: Array<{ data?: Record<string, unknown> }> = []
  const operationOrder: string[] = []
  const row = fileRow(fileId)
  const deletedRow = {
    ...row,
    status: 'deleted',
    deletedAt: new Date('2026-08-01T11:00:00.000Z'),
    deletedBy: 'system',
    deleteReason: 'contract_review_expired',
  }
  const service = new FilesService(
    {
      fileObject: {
        updateMany: async (args: unknown) => {
          operationOrder.push('metadata-tombstone')
          databaseWrites.push(args)
          return { count: 1 }
        },
        findUnique: async () => deletedRow,
        // #704(7d6feaf31) 起：物理对象删成功后还要写一条 storageDeletedAt 账本，
        // 让 reconcileStorageDeletions 不再重捞这一行。
        update: async (args: { data?: Record<string, unknown> }) => {
          operationOrder.push('storage-delete-ledger')
          ledgerWrites.push(args)
          return deletedRow
        },
      },
    } as never,
    {} as never,
    {
      deleteObject: async (storageKey: string, bucket: string) => {
        operationOrder.push('object-delete')
        storageDeletes.push({ storageKey, bucket })
      },
    } as never
  )
  ;(
    service as unknown as { requireDeletionRecord: () => Promise<typeof row> }
  ).requireDeletionRecord = async () => row
  ;(service as unknown as { logger: { log(value: string): void } }).logger = {
    log: (value) => logs.push(value),
  }

  const deleted = await service.systemDeleteSensitive(fileId, 'contract_review_expired')

  assert.equal(deleted.id, fileId)
  assert.deepEqual(storageDeletes, [{ storageKey: row.storageKey, bucket: row.bucket }])
  assert.equal(databaseWrites.length, 1)
  // tombstone 必须先于对象删除，账本必须晚于对象真正消失 —— 顺序反了就会出现
  // 「DB 说物理已删、对象还在」的孤儿，而 cleanupExpired 再也捞不到它。
  assert.deepEqual(operationOrder, ['metadata-tombstone', 'object-delete', 'storage-delete-ledger'])
  assert.equal(ledgerWrites.length, 1)
  assert.equal(ledgerWrites[0]?.data?.storageDeletePendingAt, null)
  assert.equal(ledgerWrites[0]?.data?.storageDeleteError, null)
  assert.ok(ledgerWrites[0]?.data?.storageDeletedAt instanceof Date)
  assert.equal(logs.length, 1)
  assert.doesNotMatch(logs[0]!, new RegExp(fileId))
  assert.match(logs[0]!, /^Sensitive file deleted by system: [a-f0-9]{12}$/u)
})

test('generic system deletion keeps its existing full-id log behavior', async () => {
  const fileId = 'ordinary-system-file-id'
  const logs: string[] = []
  const row = fileRow(fileId)
  const service = new FilesService(
    {
      fileObject: {
        updateMany: async () => ({ count: 1 }),
        findUnique: async () => ({ ...row, status: 'deleted', deletedAt: new Date() }),
        // 同 #704：普通 systemDelete 也要落 storageDeletedAt 账本。
        update: async () => ({ ...row, status: 'deleted', deletedAt: new Date() }),
      },
    } as never,
    {} as never,
    { deleteObject: async () => undefined } as never
  )
  ;(
    service as unknown as { requireDeletionRecord: () => Promise<typeof row> }
  ).requireDeletionRecord = async () => row
  ;(service as unknown as { logger: { log(value: string): void } }).logger = {
    log: (value) => logs.push(value),
  }

  await service.systemDelete(fileId, 'existing_cleanup_reason')

  assert.deepEqual(logs, [`File deleted by system: ${fileId}`])
})

test('generic expired cleanup redacts file ids, storage errors, and cron batch errors', async () => {
  const fileId = 'contract-file-secret-370101199001011234'
  const logs: string[] = []
  const pendingLedgerWrites: Array<{ data?: Record<string, unknown> }> = []
  const service = new FilesService(
    {
      fileObject: {
        findMany: async () => [
          {
            id: fileId,
            storageKey: 'contracts/member-1/private.pdf',
            bucket: 'private',
            purpose: 'contract_upload',
            sensitiveLevel: 'highly_sensitive',
          },
        ],
        updateMany: async () => ({ count: 1 }),
        // #704 起，删对象失败要先落可重试账本（markStorageDeletePending）再抛。
        // 夹具必须提供这两个方法，否则这条路径会以 TypeError 提前中断，
        // 下面的日志断言就变成「碰巧通过」而不是真的走过账本写入。
        findUnique: async () => ({ storageDeleteAttempts: 2 }),
        update: async (args: { data?: Record<string, unknown> }) => {
          pendingLedgerWrites.push(args)
          return { id: fileId }
        },
      },
      fairMaterialPrintBridge: { findFirst: async () => null },
      printTask: { findMany: async () => [] },
    } as never,
    {} as never,
    {
      deleteObject: async () => {
        throw new Error(`storage failed ${fileId} contracts/member-1/private.pdf`)
      },
    } as never
  )
  ;(
    service as unknown as { logger: { warn(value: string): void; log(value: string): void } }
  ).logger = {
    warn: (value) => logs.push(value),
    log: (value) => logs.push(value),
  }
  await service.cleanupExpired('cron')
  assert.equal(logs.length, 1)
  assert.match(logs[0]!, /^code=FILE_CLEANUP_ITEM_FAILED file=[a-f0-9]{12}$/u)
  assert.doesNotMatch(logs[0]!, new RegExp(`${fileId}|private\\.pdf|storage failed`, 'u'))
  // 可重试账本只准记错误类型名，不准记 message —— message 带对象键 / 文件名。
  assert.equal(pendingLedgerWrites.length, 1)
  assert.equal(pendingLedgerWrites[0]?.data?.storageDeleteError, 'Error')
  assert.equal(pendingLedgerWrites[0]?.data?.storageDeleteAttempts, 3)
  assert.doesNotMatch(
    JSON.stringify(pendingLedgerWrites[0]?.data ?? {}),
    new RegExp(`${fileId}|private\\.pdf|storage failed`, 'u')
  )

  const cronLogs: string[] = []
  const cron = new FilesCleanupTask({
    async cleanupExpired() {
      throw new Error(`database failed ${fileId}`)
    },
    // #704 起 cron 多了一轮独立的对象存储对账；它的失败必须单独记账、
    // 同样脱敏，且不得因为上一轮已经失败就被连带跳过。
    async reconcileStorageDeletions() {
      throw new Error(`reconcile failed ${fileId} contracts/member-1/private.pdf`)
    },
  } as never)
  ;(cron as unknown as { logger: { error(value: string): void } }).logger = {
    error: (value) => cronLogs.push(value),
  }
  await cron.handleHourly()
  assert.deepEqual(cronLogs, [
    'code=FILE_CLEANUP_BATCH_FAILED',
    'code=FILE_STORAGE_DELETE_RECONCILE_BATCH_FAILED',
  ])
  assert.doesNotMatch(
    cronLogs.join('\n'),
    new RegExp(`${fileId}|private\\.pdf|database failed|reconcile failed`, 'u')
  )
})

test('cron audit stores irreversible digests instead of raw deleted file ids', async () => {
  const fileId = 'contract-file-secret-370101199001011234'
  const audits: Array<{ payload?: { fileIdDigest?: string[] } }> = []
  const row = fileRow(fileId)
  const service = new FilesService(
    {
      fileObject: {
        findMany: async () => [
          {
            id: fileId,
            storageKey: row.storageKey,
            bucket: row.bucket,
            purpose: row.purpose,
            sensitiveLevel: row.sensitiveLevel,
          },
        ],
        updateMany: async () => ({ count: 1 }),
      },
      fairMaterialPrintBridge: { findFirst: async () => null },
      printTask: { findMany: async () => [] },
    } as never,
    {
      write: async (entry: { payload?: { fileIdDigest?: string[] } }) => {
        audits.push(entry)
      },
    } as never,
    { deleteObject: async () => undefined } as never
  )
  ;(service as unknown as { logger: { warn(): void; log(): void } }).logger = {
    warn: () => undefined,
    log: () => undefined,
  }
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
