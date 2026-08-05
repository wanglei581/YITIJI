/**
 * 文件删除 / 保留期限子服务。
 */
import { Injectable, Logger, ForbiddenException, BadRequestException } from '@nestjs/common'
import type {
  FileAssetCategory,
  FileMetadata,
  FilePurpose,
  FileSensitiveLevel,
  FileOwnerType,
  FileRetentionPolicy,
  FileRetentionUpdateResponse,
} from './file.types'
import { PrismaService } from '../prisma/prisma.service'
import { StorageService } from '../storage/storage.service'
import { RetentionPolicyError, allowedPoliciesForFile, computeRetentionDecision } from './retention-policy'
import { FileQueryService } from './file-query.service'
import { canAccessFile, digestFileId, toMetadata } from './file-helpers'
import type { FileRequester } from './file-helpers'

@Injectable()
export class FileDeleteService {
  private readonly logger = new Logger(FileDeleteService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly query: FileQueryService,
  ) {}

  /** 管理员强制删除（软删 + 物理删 COS / 本地对象）。 */
  async forceDelete(fileId: string, adminId: string, reason: string): Promise<FileMetadata> {
    return this._delete(fileId, `admin:${adminId}`, reason)
  }

  /**
   * 归属人删除（owner / 管理员）。软删数据库记录，并物理删除对象。
   * 合规：敏感文件删除即物理回收，不留持久公开物。
   */
  async ownerDelete(
    fileId: string,
    requester: FileRequester,
    reason: string,
  ): Promise<FileMetadata> {
    const record = await this.query.requireDeletable(fileId)
    if (!canAccessFile(record, requester)) {
      throw new ForbiddenException({
        error: { code: 'FILE_ACCESS_DENIED', message: '无权删除此文件' },
      })
    }
    const deletedBy =
      requester.kind === 'member'
        ? `member:${requester.endUserId}`
        : requester.role === 'admin'
          ? `admin:${requester.userId}`
          : `user:${requester.userId}`
    return this._delete(fileId, deletedBy, reason)
  }

  /** 服务端生命周期任务删除系统派生文件；不暴露给 controller。 */
  async systemDelete(fileId: string, reason: string): Promise<FileMetadata> {
    return this._delete(fileId, 'system', reason, true)
  }

  /** 高敏生命周期任务专用删除入口；成功日志不得暴露完整 fileId。 */
  async systemDeleteSensitive(fileId: string, reason: string): Promise<FileMetadata> {
    return this._delete(fileId, 'system', reason, true, true)
  }

  /** 会员本人修改文件保存期限。Admin 代改留给后续独立审批/锁定通道。 */
  async updateRetention(
    fileId: string,
    requester: FileRequester,
    args: { retentionPolicy: FileRetentionPolicy; consentVersion?: string },
  ): Promise<FileRetentionUpdateResponse> {
    const record = await this.query.requireAlive(fileId)
    if (!canAccessFile(record, requester)) {
      throw new ForbiddenException({
        error: { code: 'FILE_ACCESS_DENIED', message: '无权修改此文件' },
      })
    }
    try {
      const decision = computeRetentionDecision({
        now: new Date(),
        policy: args.retentionPolicy,
        purpose: record.purpose as FilePurpose,
        sensitiveLevel: record.sensitiveLevel as FileSensitiveLevel,
        assetCategory: record.assetCategory as FileAssetCategory,
        ownerType: record.ownerType as FileOwnerType | null,
        endUserId: record.endUserId,
        requesterKind: requester.kind,
        requesterEndUserId: requester.kind === 'member' ? requester.endUserId : null,
        consentVersion: args.consentVersion,
        retentionLockedReason: record.retentionLockedReason,
      })
      const updated = await this.prisma.fileObject.update({
        where: { id: fileId },
        data: {
          expiresAt: decision.expiresAt,
          retentionPolicy: decision.retentionPolicy,
          retentionSetBy: decision.retentionSetBy,
          retentionConsentAt: decision.retentionConsentAt,
          retentionConsentVersion: decision.retentionConsentVersion,
        },
      })
      return {
        file: toMetadata(updated),
        allowedPolicies: allowedPoliciesForFile({
          purpose: updated.purpose,
          assetCategory: updated.assetCategory,
        }),
      }
    } catch (err) {
      if (err instanceof RetentionPolicyError) {
        const payload = { error: { code: err.code, message: err.message } }
        if (
          err.code === 'RETENTION_MEMBER_REQUIRED' ||
          err.code === 'RETENTION_ACCESS_DENIED' ||
          err.code === 'RETENTION_LOCKED'
        ) {
          throw new ForbiddenException(payload)
        }
        throw new BadRequestException(payload)
      }
      throw err
    }
  }

  private async _delete(
    fileId: string,
    deletedBy: string,
    reason: string,
    allowMemberDataExport = false,
    sensitiveLog = false,
  ): Promise<FileMetadata> {
    const record = await this.query.requireDeletable(fileId, { allowMemberDataExport })
    await this.storage.deleteObject(record.storageKey, record.bucket)
    const updated = await this.prisma.fileObject.update({
      where: { id: fileId },
      data: { deletedAt: new Date(), deletedBy, deleteReason: reason, status: 'deleted' },
    })
    if (sensitiveLog) {
      this.logger.log(`Sensitive file deleted by ${deletedBy}: ${digestFileId(fileId)}`)
    } else {
      this.logger.log(`File deleted by ${deletedBy}: ${fileId}`)
    }
    return toMetadata(updated)
  }
}
