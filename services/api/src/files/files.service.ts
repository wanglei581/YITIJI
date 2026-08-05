/**
 * 文件服务 — 薄门面，将所有调用委托给各子服务。
 *
 * 外部调用方（controller、其他模块）继续 import FilesService，签名不变。
 * 子服务拆分在 file-upload / file-access / file-delete / file-cleanup 中。
 *
 * 向后兼容重导出：
 *   canAccessFile, deriveOwner, FileRequester, DIRECT_UPLOAD_SNIFF_MAX_BYTES
 */
import { Injectable } from '@nestjs/common'
import type {
  CompleteUploadResponse,
  FileAccessUrlResponse,
  FileAssetCategory,
  FileCleanupResponse,
  FileLifecycleSummaryResponse,
  FileMetadata,
  FilePurpose,
  FileRetentionPolicy,
  FileRetentionUpdateResponse,
  FileSensitiveLevel,
  FileUploadResponse,
  SignedUrlResponse,
  UploadIntentResponse,
} from './file.types'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import type { UserRole } from '../common/decorators/roles.decorator'
import { FileUploadService } from './file-upload.service'
import { FileAccessService } from './file-access.service'
import { FileDeleteService } from './file-delete.service'
import { FileCleanupService } from './file-cleanup.service'
import { FileQueryService } from './file-query.service'
import type { UploadValidationMode } from './file-validation'
import type { FileRequester } from './file-helpers'

// Re-export so existing callers (ai.service.ts, files.controller.ts) keep working.
export {
  canAccessFile,
  deriveOwner,
  DIRECT_UPLOAD_SNIFF_MAX_BYTES,
} from './file-helpers'
export type { FileRequester } from './file-helpers'

@Injectable()
export class FilesService {
  constructor(
    private readonly uploadSvc: FileUploadService,
    private readonly accessSvc: FileAccessService,
    private readonly deleteSvc: FileDeleteService,
    private readonly cleanupSvc: FileCleanupService,
  ) {}

  /**
   * Convenience factory for verify scripts and integration harnesses.
   * Mirrors the NestJS DI graph without requiring module setup.
   */
  static create(prisma: unknown, audit: unknown, storage: unknown): FilesService {
    const query = new FileQueryService(prisma as never, storage as never)
    return new FilesService(
      new FileUploadService(prisma as never, storage as never, query),
      new FileAccessService(prisma as never, storage as never, query),
      new FileDeleteService(prisma as never, storage as never, query),
      new FileCleanupService(prisma as never, storage as never, audit as never),
    )
  }

  // ── Upload ─────────────────────────────────────────────────────────────────

  upload(args: {
    buffer: Buffer
    filename: string
    mimeType: string
    purpose: FilePurpose
    sensitiveLevel?: FileSensitiveLevel
    uploaderId: string | null
    endUserId?: string | null
    assetCategory?: FileAssetCategory
    sourceFileId?: string | null
    actorRole?: UserRole | null
    actorOrgId?: string | null
    createdBy?: string | null
    validationMode?: UploadValidationMode
    expiresAtOverride?: Date
  }): Promise<FileUploadResponse> {
    return this.uploadSvc.upload(args)
  }

  createUploadIntent(args: {
    body: {
      purpose: string
      filename: string
      mimeType: string
      sizeBytes?: number
      sensitiveLevel?: string
      sha256?: string
    }
    uploaderId: string | null
    endUserId?: string | null
    actorRole?: UserRole | null
    actorOrgId?: string | null
    createdBy?: string | null
  }): Promise<UploadIntentResponse> {
    return this.uploadSvc.createUploadIntent(args)
  }

  completeUpload(fileId: string, requester: FileRequester): Promise<CompleteUploadResponse> {
    return this.uploadSvc.completeUpload(fileId, requester)
  }

  writeRawUpload(fileId: string, buffer: Buffer): Promise<void> {
    return this.uploadSvc.writeRawUpload(fileId, buffer)
  }

  // ── Access / Read ──────────────────────────────────────────────────────────

  getAccessUrl(
    fileId: string,
    requester: FileRequester,
    disposition: 'inline' | 'attachment',
  ): Promise<{
    response: FileAccessUrlResponse
    record: { purpose: string; ownerType: string | null }
    needsAdminAudit: boolean
  }> {
    return this.accessSvc.getAccessUrl(fileId, requester, disposition)
  }

  getSignedUrl(fileId: string, user: AuthedUser): Promise<SignedUrlResponse> {
    return this.accessSvc.getSignedUrl(fileId, user)
  }

  readContent(
    fileId: string,
  ): Promise<{ buffer: Buffer; mimeType: string; filename: string; purpose: FilePurpose }> {
    return this.accessSvc.readContent(fileId)
  }

  readContentForEndUser(
    fileId: string,
    endUserId: string | null,
  ): Promise<{ buffer: Buffer; mimeType: string; filename: string; purpose: FilePurpose }> {
    return this.accessSvc.readContentForEndUser(fileId, endUserId)
  }

  list(
    args: { includeDeleted?: boolean; purpose?: string; limit?: number } = {},
  ): Promise<FileMetadata[]> {
    return this.accessSvc.list(args)
  }

  lifecycleSummary(now?: Date): Promise<FileLifecycleSummaryResponse> {
    return this.accessSvc.lifecycleSummary(now)
  }

  // ── Delete / Retention ─────────────────────────────────────────────────────

  forceDelete(fileId: string, adminId: string, reason: string): Promise<FileMetadata> {
    return this.deleteSvc.forceDelete(fileId, adminId, reason)
  }

  ownerDelete(
    fileId: string,
    requester: FileRequester,
    reason: string,
  ): Promise<FileMetadata> {
    return this.deleteSvc.ownerDelete(fileId, requester, reason)
  }

  systemDelete(fileId: string, reason: string): Promise<FileMetadata> {
    return this.deleteSvc.systemDelete(fileId, reason)
  }

  systemDeleteSensitive(fileId: string, reason: string): Promise<FileMetadata> {
    return this.deleteSvc.systemDeleteSensitive(fileId, reason)
  }

  updateRetention(
    fileId: string,
    requester: FileRequester,
    args: { retentionPolicy: FileRetentionPolicy; consentVersion?: string },
  ): Promise<FileRetentionUpdateResponse> {
    return this.deleteSvc.updateRetention(fileId, requester, args)
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  cleanupExpired(triggeredBy: 'manual' | 'cron'): Promise<FileCleanupResponse> {
    return this.cleanupSvc.cleanupExpired(triggeredBy)
  }
}
