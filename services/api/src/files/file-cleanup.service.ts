/**
 * 文件过期清理子服务 — cron / 手动触发。
 */
import { Injectable, Logger } from '@nestjs/common'
import type { FileCleanupResponse } from './file.types'
import { PrismaService } from '../prisma/prisma.service'
import { StorageService } from '../storage/storage.service'
import { AuditService } from '../audit/audit.service'
import { parseContentFileId } from './signing'
import { digestFileId } from './file-helpers'

@Injectable()
export class FileCleanupService {
  private readonly logger = new Logger(FileCleanupService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async cleanupExpired(triggeredBy: 'manual' | 'cron'): Promise<FileCleanupResponse> {
    const now = new Date()
    const expired = await this.prisma.fileObject.findMany({
      // 导出文件必须由 member-privacy reconciler 同步收口请求账本，
      // 通用 cron 不得越过账本直接删除。
      where: {
        deletedAt: null,
        purpose: { not: 'member_data_export' },
        OR: [
          { expiresAt: { lt: now } },
          // contract_upload 必须始终有系统锁定的短期寿命；null 是异常高敏行，
          // 按已过期处理，避免因无法命中 expiresAt < now 而无限留存。
          { purpose: 'contract_upload', expiresAt: null },
        ],
      },
      select: { id: true, storageKey: true, bucket: true, purpose: true, sensitiveLevel: true },
    })

    const deletedIds: string[] = []
    const bySensitiveLevel: Record<string, number> = {}
    const byPurpose: Record<string, number> = {}

    for (const f of expired) {
      try {
        const bridge = await this.prisma.fairMaterialPrintBridge.findFirst({
          where: { fileObjectId: f.id },
          select: { id: true, status: true, revokedAt: true },
        })
        if (bridge && (await this.hasActivePrintTaskForFile(f.id))) {
          continue
        }
        await this.storage.deleteObject(f.storageKey, f.bucket)
        await this.prisma.fileObject.update({
          where: { id: f.id },
          data: {
            deletedAt: now,
            deletedBy: 'auto',
            deleteReason:
              triggeredBy === 'manual' ? 'manual cleanup of expired' : 'cron cleanup of expired',
            status: 'deleted',
          },
        })
        if (bridge && bridge.status === 'ready' && !bridge.revokedAt) {
          await this.prisma.fairMaterialPrintBridge.update({
            where: { id: bridge.id },
            data: {
              activeKey: null,
              status: 'expired',
              revokedAt: now,
              revokeReason: 'file_expired_cleanup',
            },
          })
        }
        deletedIds.push(f.id)
        bySensitiveLevel[f.sensitiveLevel] = (bySensitiveLevel[f.sensitiveLevel] ?? 0) + 1
        byPurpose[f.purpose] = (byPurpose[f.purpose] ?? 0) + 1
      } catch {
        this.logger.warn(`code=FILE_CLEANUP_ITEM_FAILED file=${digestFileId(f.id)}`)
      }
    }

    if (deletedIds.length > 0) {
      this.logger.log(`Cleanup (${triggeredBy}): deleted ${deletedIds.length} expired files`)
    }

    if (triggeredBy === 'cron' && deletedIds.length > 0) {
      await this.audit.write({
        actorId: null,
        actorRole: 'system',
        action: 'file.cleanup_expired',
        targetType: 'file',
        targetId: null,
        payload: {
          triggeredBy,
          deletedCount: deletedIds.length,
          bySensitiveLevel,
          byPurpose,
          fileIdDigest: deletedIds.slice(0, 50).map(digestFileId),
        },
      })
    }

    return {
      deletedCount: deletedIds.length,
      deletedFileIds: deletedIds,
      triggeredBy,
      triggeredAt: now.toISOString(),
    }
  }

  private async hasActivePrintTaskForFile(fileId: string): Promise<boolean> {
    const tasks = await this.prisma.printTask.findMany({
      where: { status: { in: ['pending', 'claimed', 'printing'] } },
      select: { fileUrl: true },
    })
    return tasks.some((task) => parseContentFileId(task.fileUrl) === fileId)
  }
}
