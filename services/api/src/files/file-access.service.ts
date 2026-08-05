/**
 * 文件读取 / 签名 URL 子服务。
 */
import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common'
import type {
  FileAccessUrlResponse,
  FileLifecycleSummaryResponse,
  FileMetadata,
  FilePurpose,
  FileRetentionPolicy,
  FileRetentionSetBy,
  SignedUrlResponse,
} from './file.types'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import { PrismaService } from '../prisma/prisma.service'
import { StorageService } from '../storage/storage.service'
import { summarizeFileLifecycleRows } from './lifecycle-summary'
import { signFileUrl } from './signing'
import { FileQueryService } from './file-query.service'
import { canAccessFile, toMetadata } from './file-helpers'
import type { FileRequester } from './file-helpers'

@Injectable()
export class FileAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly query: FileQueryService,
  ) {}

  /**
   * 生成下载 / 预览 URL，带归属鉴权。
   * 返回 needsAdminAudit 表示"管理员访问了非本人的用户敏感文件"，由 controller 落审计。
   */
  async getAccessUrl(
    fileId: string,
    requester: FileRequester,
    disposition: 'inline' | 'attachment',
  ): Promise<{
    response: FileAccessUrlResponse
    record: { purpose: string; ownerType: string | null }
    needsAdminAudit: boolean
  }> {
    const record = await this.query.requireAlive(fileId)
    if (!canAccessFile(record, requester)) {
      throw new ForbiddenException({
        error: { code: 'FILE_ACCESS_DENIED', message: '无权访问此文件' },
      })
    }

    const ttlSeconds = this.query.downloadUrlTtlSeconds(record.expiresAt, record.purpose)
    const signed = this.storage.getDownloadUrl(
      {
        objectKey: record.storageKey,
        fileId: record.id,
        filename: record.filename,
        mimeType: record.mimeType,
        ttlSeconds,
        disposition,
      },
      record.bucket,
    )

    const isUserFile = record.ownerType === 'user' || Boolean(record.endUserId)
    const needsAdminAudit = requester.kind === 'user' && requester.role === 'admin' && isUserFile

    return {
      response: {
        fileId: record.id,
        url: signed.url,
        printFileUrl: signFileUrl(record.id).url,
        expiresAt: this.query
          .ensureSignedExpiryWithinFileLifetime(signed.expiresAt, record.expiresAt)
          .toISOString(),
        disposition,
      },
      record: { purpose: record.purpose, ownerType: record.ownerType },
      needsAdminAudit,
    }
  }

  /** 兼容旧端点 GET /files/:id/url：重发短期签名 URL（归属校验）。 */
  async getSignedUrl(fileId: string, user: AuthedUser): Promise<SignedUrlResponse> {
    const requester: FileRequester = {
      kind: 'user',
      userId: user.userId,
      role: user.role,
      orgId: user.orgId,
    }
    const record = await this.query.requireAlive(fileId)
    if (!canAccessFile(record, requester)) {
      throw new ForbiddenException({
        error: { code: 'FILE_ACCESS_DENIED', message: '无权访问此文件' },
      })
    }
    const ttlSeconds = this.query.downloadUrlTtlSeconds(record.expiresAt, record.purpose)
    const signed = this.storage.getDownloadUrl(
      {
        objectKey: record.storageKey,
        fileId: record.id,
        filename: record.filename,
        mimeType: record.mimeType,
        ttlSeconds,
        disposition: 'inline',
      },
      record.bucket,
    )
    return {
      fileId: record.id,
      signedUrl: signed.url,
      expiresAt: this.query
        .ensureSignedExpiryWithinFileLifetime(signed.expiresAt, record.expiresAt)
        .toISOString(),
      purpose: record.purpose as FilePurpose,
    }
  }

  // ── 读取文件 buffer（/content 代理；签名校验由 controller 完成）────────────

  async readContent(
    fileId: string,
  ): Promise<{ buffer: Buffer; mimeType: string; filename: string; purpose: FilePurpose }> {
    const record = await this.query.requireAlive(fileId)
    const buffer = await this.storage.getObject(record.storageKey, record.bucket)
    return {
      buffer,
      mimeType: record.mimeType,
      filename: record.filename,
      purpose: record.purpose as FilePurpose,
    }
  }

  /**
   * 会员 / 匿名业务流按上传归属读取文件内容。
   * 故意用 NOT_FOUND 口径，避免通过 fileId 探测他人文件是否存在。
   */
  async readContentForEndUser(
    fileId: string,
    endUserId: string | null,
  ): Promise<{ buffer: Buffer; mimeType: string; filename: string; purpose: FilePurpose }> {
    const record = await this.query.requireAlive(fileId)
    if (record.status !== 'active') {
      throw new NotFoundException({
        error: { code: 'FILE_NOT_FOUND', message: '文件不存在或已被清理' },
      })
    }
    const allowed = endUserId
      ? record.endUserId === endUserId
      : record.endUserId === null && record.ownerType === 'system'
    if (!allowed) {
      throw new NotFoundException({
        error: { code: 'FILE_NOT_FOUND', message: '文件不存在或已被清理' },
      })
    }
    const buffer = await this.storage.getObject(record.storageKey, record.bucket)
    return {
      buffer,
      mimeType: record.mimeType,
      filename: record.filename,
      purpose: record.purpose as FilePurpose,
    }
  }

  // ── Admin 列表 / 统计 ────────────────────────────────────────────────────

  async list(
    args: { includeDeleted?: boolean; purpose?: string; limit?: number } = {},
  ): Promise<FileMetadata[]> {
    const records = await this.prisma.fileObject.findMany({
      where: {
        ...(args.includeDeleted ? {} : { deletedAt: null }),
        ...(args.purpose ? { purpose: args.purpose } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(args.limit ?? 100, 500),
    })
    return records.map(toMetadata)
  }

  /** Admin 文件生命周期全局只读统计。 */
  async lifecycleSummary(now = new Date()): Promise<FileLifecycleSummaryResponse> {
    const rows = await this.prisma.fileObject.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        retentionPolicy: true,
        retentionSetBy: true,
        expiresAt: true,
      },
    })
    return summarizeFileLifecycleRows(
      rows.map((row) => ({
        id: row.id,
        retentionPolicy: row.retentionPolicy as FileRetentionPolicy | null,
        retentionSetBy: row.retentionSetBy as FileRetentionSetBy | null,
        expiresAt: row.expiresAt,
        deletedAt: null,
      })),
      now,
    )
  }
}
