import { createHash } from 'crypto'
import { HttpException, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import type { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service'
import type { FileCleanupResponse, FileMetadata } from './file.types'
import { toMetadata } from './file-metadata'

/** 与管理员账号敏感操作同一错误码，不另起名字。 */
export const ADMIN_AUDIT_UNAVAILABLE_CODE = 'ADMIN_USER_AUDIT_UNAVAILABLE'

const DELETE_AUDIT_MESSAGE = '删除未能写入审计，文件未删除，请稍后重试'
const CLEANUP_AUDIT_MESSAGE = '清理未能写入审计，文件未删除，请稍后重试'

export type AdminDeleteAuditWriter = (
  tx: PrismaTransactionClient,
  file: { filename: string; sensitiveLevel: string },
) => Promise<void>

export type ManualCleanupAuditWriter = (
  tx: PrismaTransactionClient,
  fileIds: string[],
) => Promise<void>

type StoragePort = {
  deleteObject(objectKey: string, bucket?: string | null): Promise<void>
}

type DeletionRecord = {
  id: string
  storageKey: string
  bucket: string
  filename: string
  sensitiveLevel: string
  deletedAt: Date | null
  status: string
}

type CleanupRow = {
  id: string
  storageKey: string
  bucket: string
  bridgeId: string | null
}

/**
 * 管理员手动删除。
 * 这一次动作的必达审计和墓碑在同一事务里：没有墓碑就先落墓碑再写审计，
 * 已经有墓碑也要为这一次管理员动作写审计。审计写不进则整笔回滚，已有墓碑保持原样，对象不动。
 * 事务提交并且这一次审计已写下之后，才删存储对象。
 */
export async function commitAdminFileDelete(args: {
  prisma: PrismaService
  storage: StoragePort
  record: DeletionRecord
  deletedBy: string
  reason: string
  writeAudit: AdminDeleteAuditWriter
  markStorageDeletePending: (fileId: string, errorType: string) => Promise<void>
  markStorageDeleted: (fileId: string) => Promise<void>
}): Promise<FileMetadata> {
  let audited = false
  try {
    audited = await args.prisma.$transaction(async (tx) => {
      await tx.fileObject.updateMany({
        where: { id: args.record.id, deletedAt: null },
        data: {
          deletedAt: new Date(),
          deletedBy: args.deletedBy,
          deleteReason: args.reason,
          status: 'deleted',
        },
      })
      const current = await tx.fileObject.findUnique({
        where: { id: args.record.id },
        select: { deletedAt: true, status: true },
      })
      if (!current?.deletedAt || current.status !== 'deleted') return false
      await args.writeAudit(tx, {
        filename: args.record.filename,
        sensitiveLevel: args.record.sensitiveLevel,
      })
      return true
    })
  } catch (error) {
    throw auditFailure(error, DELETE_AUDIT_MESSAGE)
  }

  const tombstone = await args.prisma.fileObject.findUnique({ where: { id: args.record.id } })
  if (!tombstone || !tombstone.deletedAt || tombstone.status !== 'deleted') {
    throw new NotFoundException({
      error: { code: 'FILE_NOT_FOUND', message: '文件不存在或已被清理' },
    })
  }
  if (!audited) {
    throw new ServiceUnavailableException({
      error: { code: ADMIN_AUDIT_UNAVAILABLE_CODE, message: DELETE_AUDIT_MESSAGE },
    })
  }

  try {
    await args.storage.deleteObject(tombstone.storageKey, tombstone.bucket)
  } catch (error) {
    const errorType = error instanceof Error ? error.constructor.name : typeof error
    await args.markStorageDeletePending(args.record.id, errorType)
    throw error
  }
  await args.markStorageDeleted(args.record.id)
  return toMetadata(tombstone)
}

/**
 * 管理员点的「清理过期文件」。
 * 先跳过正在打印的文件（那些不写删除审计），再在一笔事务里做 CAS 墓碑、
 * 收口招聘会材料桥，最后写汇总审计。审计失败则整笔回滚，存储未动。
 * 零条候选也写一条汇总审计。存储删除放在提交之后；单项失败只记账，不当成审计不可用。
 */
export async function commitManualCleanupAudit(args: {
  prisma: PrismaService
  storage: StoragePort
  requireAudit: ManualCleanupAuditWriter
  isPrinting: (fileId: string) => Promise<boolean>
  markStorageDeletePending: (fileId: string, errorType: string) => Promise<void>
  markStorageDeleted: (fileId: string) => Promise<void>
  warn: (message: string) => void
}): Promise<FileCleanupResponse> {
  const now = new Date()
  const stillEligibleWhere = {
    deletedAt: null,
    purpose: { not: 'member_data_export' },
    OR: [
      { expiresAt: { lt: now } },
      { purpose: 'contract_upload', expiresAt: null },
    ],
  }
  const expired = await args.prisma.fileObject.findMany({
    where: stillEligibleWhere,
    select: { id: true, storageKey: true, bucket: true },
  })

  const eligible: CleanupRow[] = []
  for (const file of expired) {
    if (await args.isPrinting(file.id)) continue
    const bridge = await args.prisma.fairMaterialPrintBridge.findFirst({
      where: { fileObjectId: file.id },
      select: { id: true, status: true, revokedAt: true },
    })
    eligible.push({
      id: file.id,
      storageKey: file.storageKey,
      bucket: file.bucket,
      bridgeId: bridge && bridge.status === 'ready' && !bridge.revokedAt ? bridge.id : null,
    })
  }

  let deletedIds: string[] = []
  try {
    deletedIds = await args.prisma.$transaction(async (tx) => {
      const committed: string[] = []
      for (const file of eligible) {
        const tombstoned = await tx.fileObject.updateMany({
          where: { ...stillEligibleWhere, id: file.id },
          data: {
            deletedAt: now,
            deletedBy: 'auto',
            deleteReason: 'manual cleanup of expired',
            status: 'deleted',
          },
        })
        if (tombstoned.count === 0) continue
        if (file.bridgeId) {
          await tx.fairMaterialPrintBridge.update({
            where: { id: file.bridgeId },
            data: {
              activeKey: null,
              status: 'expired',
              revokedAt: now,
              revokeReason: 'file_expired_cleanup',
            },
          })
        }
        committed.push(file.id)
      }
      await args.requireAudit(tx, committed)
      return committed
    })
  } catch (error) {
    throw auditFailure(error, CLEANUP_AUDIT_MESSAGE)
  }

  const deleted = new Set(deletedIds)
  for (const file of eligible) {
    if (!deleted.has(file.id)) continue
    try {
      await args.storage.deleteObject(file.storageKey, file.bucket)
      await args.markStorageDeleted(file.id)
    } catch (error) {
      const errorType = error instanceof Error ? error.constructor.name : typeof error
      await args.markStorageDeletePending(file.id, errorType)
      args.warn(`code=FILE_CLEANUP_ITEM_FAILED file=${digestFileId(file.id)} errorType=${errorType}`)
    }
  }

  return {
    deletedCount: deletedIds.length,
    deletedFileIds: deletedIds,
    triggeredBy: 'manual',
    triggeredAt: now.toISOString(),
  }
}

function auditFailure(error: unknown, message: string): Error {
  if (error instanceof HttpException) return error
  return new ServiceUnavailableException({
    error: { code: ADMIN_AUDIT_UNAVAILABLE_CODE, message },
  })
}

function digestFileId(fileId: string): string {
  return createHash('sha256').update(fileId).digest('hex').slice(0, 12)
}
