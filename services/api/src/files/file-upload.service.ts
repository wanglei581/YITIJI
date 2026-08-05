/**
 * 文件上传子服务 — 代理上传、直传意图、完成确认、本地原始写入。
 */
import { Injectable, Logger, BadRequestException, ForbiddenException } from '@nestjs/common'
import { randomUUID } from 'crypto'
import type {
  CompleteUploadResponse,
  FileAssetCategory,
  FilePurpose,
  FileSensitiveLevel,
  FileStatus,
  FileUploadResponse,
  UploadIntentResponse,
} from './file.types'
import type { UserRole } from '../common/decorators/roles.decorator'
import { PrismaService } from '../prisma/prisma.service'
import { StorageService } from '../storage/storage.service'
import { generateObjectKey, type FileOwnerType as ObjKeyOwnerType } from '../storage/object-key'
import {
  DEFAULT_SENSITIVE_BY_PURPOSE,
  PURPOSE_POLICY,
  validateUpload,
  isPurpose,
  type UploadValidationMode,
} from './file-validation'
import { sniffDeclaredMimeMismatch } from './content-sniff'
import { defaultRetentionForUpload } from './retention-policy'
import { FileQueryService } from './file-query.service'
import {
  DIRECT_UPLOAD_SNIFF_MAX_BYTES,
  canAccessFile,
  deriveOwner,
} from './file-helpers'
import type { FileRequester } from './file-helpers'

@Injectable()
export class FileUploadService {
  private readonly logger = new Logger(FileUploadService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly query: FileQueryService,
  ) {}

  // ── 服务端代理上传（multipart；校验后的 buffer 经服务端推送到对象存储）─────

  async upload(args: {
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
    /** 仅服务端内部调用可设 intent；外部 multipart 调用省略时固定为 proxy(15MB)。 */
    validationMode?: UploadValidationMode
    /** 仅服务端派生成果可收紧默认 system_short 到明确到期时间。 */
    expiresAtOverride?: Date
  }): Promise<FileUploadResponse> {
    if (args.purpose === 'member_data_export') {
      throw new BadRequestException({
        error: {
          code: 'FILE_PURPOSE_SERVER_GENERATED_ONLY',
          message: '该文件用途仅允许服务端生成',
        },
      })
    }
    const validation = validateUpload({
      purpose: args.purpose,
      mimeType: args.mimeType,
      filename: args.filename,
      sizeBytes: args.buffer.length,
      mode: args.validationMode ?? 'proxy',
    })
    if (!validation.ok) {
      throw new BadRequestException({
        error: { code: validation.code, message: validation.message },
      })
    }
    const sniff = sniffDeclaredMimeMismatch(args.buffer, args.mimeType)
    if (!sniff.ok) {
      this.logger.warn(
        `Upload content mismatch (purpose=${args.purpose}, declared=${args.mimeType}): ${sniff.reason}`,
      )
      throw new BadRequestException({
        error: {
          code: 'FILE_CONTENT_MISMATCH',
          message: '文件内容与声明的类型不一致，请检查文件后重新上传',
        },
      })
    }

    const sensitiveLevel = this.resolveSensitiveLevel(args.purpose, args.sensitiveLevel)
    const id = randomUUID().replace(/-/g, '')
    const owner = deriveOwner({
      endUserId: args.endUserId ?? null,
      role: args.actorRole ?? null,
      uploaderId: args.uploaderId,
      orgId: args.actorOrgId ?? null,
    })
    const retention = defaultRetentionForUpload({
      purpose: args.purpose,
      sensitiveLevel,
      ownerType: owner.ownerType,
      endUserId: args.endUserId ?? null,
    })
    const expiresAtOverride =
      args.purpose === 'contract_upload' ? undefined : args.expiresAtOverride
    if (
      expiresAtOverride &&
      (!Number.isFinite(expiresAtOverride.getTime()) || expiresAtOverride.getTime() <= Date.now())
    ) {
      throw new BadRequestException({
        error: { code: 'FILE_EXPIRY_INVALID', message: '文件到期时间无效' },
      })
    }
    const objectKey = generateObjectKey({
      purpose: args.purpose,
      ownerType: owner.ownerType as ObjKeyOwnerType,
      ownerId: owner.ownerId,
      fileId: id,
      ext: validation.ext,
    })

    const put = await this.storage.putObject(objectKey, args.buffer, args.mimeType)
    const bucket = this.storage.defaultBucket
    const region = this.storage.defaultRegion
    let record
    try {
      record = await this.prisma.fileObject.create({
        data: {
          id,
          storageKey: objectKey,
          bucket,
          region,
          filename: args.filename,
          mimeType: args.mimeType,
          sizeBytes: put.sizeBytes,
          sha256: put.sha256,
          uploaderId: args.uploaderId,
          endUserId: args.endUserId ?? null,
          ownerType: owner.ownerType,
          ownerId: owner.ownerId,
          purpose: args.purpose,
          sensitiveLevel,
          visibility: 'private',
          status: 'active',
          createdBy: args.createdBy ?? args.uploaderId ?? null,
          assetCategory: args.assetCategory ?? 'original',
          sourceFileId: args.sourceFileId ?? null,
          expiresAt: expiresAtOverride ?? retention.expiresAt,
          retentionPolicy: retention.retentionPolicy,
          retentionSetBy: retention.retentionSetBy,
          retentionConsentAt: retention.retentionConsentAt,
          retentionConsentVersion: retention.retentionConsentVersion,
          retentionLockedReason:
            args.purpose === 'contract_upload' ? 'contract_review_session_only' : null,
        },
      })
    } catch (createError) {
      try {
        await this.storage.deleteObject(objectKey, bucket)
      } catch {
        this.logger.warn('Object cleanup compensation failed after file metadata persistence error')
      }
      throw createError
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
      filename: record.filename,
      sizeBytes: record.sizeBytes,
      mimeType: record.mimeType,
      sha256: record.sha256,
      signedUrl: signed.url,
      signedUrlExpiresAt: this.query
        .ensureSignedExpiryWithinFileLifetime(signed.expiresAt, record.expiresAt)
        .toISOString(),
      fileExpiresAt: record.expiresAt ? record.expiresAt.toISOString() : null,
    }
  }

  // ── 直传意图（COS 预签名 PUT；本地回 API 代理 PUT）──────────────────────────

  async createUploadIntent(args: {
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
    const { body } = args
    if (body.purpose === 'member_data_export') {
      throw new BadRequestException({
        error: {
          code: 'FILE_PURPOSE_SERVER_GENERATED_ONLY',
          message: '该文件用途仅允许服务端生成',
        },
      })
    }
    if (!isPurpose(body.purpose)) {
      throw new BadRequestException({
        error: { code: 'FILE_PURPOSE_INVALID', message: '不支持的文件用途' },
      })
    }
    const declaredSize = Number(body.sizeBytes ?? 1)
    const validation = validateUpload({
      purpose: body.purpose,
      mimeType: body.mimeType,
      filename: body.filename,
      sizeBytes: Number.isFinite(declaredSize) && declaredSize > 0 ? declaredSize : 1,
      mode: 'intent',
    })
    if (!validation.ok) {
      throw new BadRequestException({
        error: { code: validation.code, message: validation.message },
      })
    }

    const sensitiveLevel = this.resolveSensitiveLevel(
      body.purpose as FilePurpose,
      body.sensitiveLevel as FileSensitiveLevel | undefined,
    )
    const id = randomUUID().replace(/-/g, '')
    const owner = deriveOwner({
      endUserId: args.endUserId ?? null,
      role: args.actorRole ?? null,
      uploaderId: args.uploaderId,
      orgId: args.actorOrgId ?? null,
    })
    const retention = defaultRetentionForUpload({
      purpose: body.purpose as FilePurpose,
      sensitiveLevel,
      ownerType: owner.ownerType,
      endUserId: args.endUserId ?? null,
    })
    const objectKey = generateObjectKey({
      purpose: body.purpose as FilePurpose,
      ownerType: owner.ownerType as ObjKeyOwnerType,
      ownerId: owner.ownerId,
      fileId: id,
      ext: validation.ext,
    })

    const record = await this.prisma.fileObject.create({
      data: {
        id,
        storageKey: objectKey,
        bucket: this.storage.defaultBucket,
        region: this.storage.defaultRegion,
        filename: body.filename,
        mimeType: body.mimeType,
        sizeBytes: 0,
        sha256: typeof body.sha256 === 'string' ? body.sha256 : '',
        uploaderId: args.uploaderId,
        endUserId: args.endUserId ?? null,
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        purpose: body.purpose,
        sensitiveLevel,
        visibility: 'private',
        status: 'uploading',
        createdBy: args.createdBy ?? args.uploaderId ?? null,
        expiresAt: retention.expiresAt,
        retentionPolicy: retention.retentionPolicy,
        retentionSetBy: retention.retentionSetBy,
        retentionConsentAt: retention.retentionConsentAt,
        retentionConsentVersion: retention.retentionConsentVersion,
        retentionLockedReason:
          body.purpose === 'contract_upload' ? 'contract_review_session_only' : null,
      },
    })

    const upload = this.storage.getUploadUrl(
      {
        objectKey: record.storageKey,
        fileId: record.id,
        contentType: record.mimeType,
        ttlSeconds: this.storage.signTtlSeconds,
      },
      record.bucket,
    )

    return {
      fileId: record.id,
      bucket: record.bucket,
      region: record.region,
      objectKey: record.storageKey,
      uploadUrl: upload.url,
      uploadMethod: upload.method,
      uploadHeaders: upload.headers,
      uploadUrlExpiresAt: upload.expiresAt.toISOString(),
      direct: upload.direct,
    }
  }

  /**
   * 客户端直传完成后确认。headObject 复核对象确实落地 + 实测大小，
   * 通过则 status → active。
   */
  async completeUpload(fileId: string, requester: FileRequester): Promise<CompleteUploadResponse> {
    const record = await this.query.requireAlive(fileId)
    if (!canAccessFile(record, requester)) {
      throw new ForbiddenException({
        error: { code: 'FILE_ACCESS_DENIED', message: '无权确认此文件' },
      })
    }

    const head = await this.storage.headObject(record.storageKey, record.bucket)
    if (!head) {
      throw new BadRequestException({
        error: { code: 'FILE_NOT_UPLOADED', message: '对象未上传或上传未完成' },
      })
    }
    const policy = PURPOSE_POLICY[record.purpose as FilePurpose]
    if (policy && head.sizeBytes > policy.maxBytes) {
      await this.storage.deleteObject(record.storageKey, record.bucket).catch(() => undefined)
      await this.prisma.fileObject.update({
        where: { id: fileId },
        data: { status: 'quarantined' },
      })
      throw new BadRequestException({
        error: { code: 'FILE_TOO_LARGE', message: '上传文件超出大小上限，已拒绝' },
      })
    }

    if (!record.mimeType.startsWith('video/') && head.sizeBytes <= DIRECT_UPLOAD_SNIFF_MAX_BYTES) {
      const bytes = await this.storage.getObject(record.storageKey, record.bucket)
      const sniff = sniffDeclaredMimeMismatch(bytes, record.mimeType)
      if (!sniff.ok) {
        this.logger.warn(
          `Direct-upload content mismatch (purpose=${record.purpose}, declared=${record.mimeType}): ${sniff.reason}`,
        )
        await this.storage.deleteObject(record.storageKey, record.bucket).catch(() => undefined)
        await this.prisma.fileObject.update({
          where: { id: fileId },
          data: { status: 'quarantined' },
        })
        throw new BadRequestException({
          error: {
            code: 'FILE_CONTENT_MISMATCH',
            message: '文件内容与声明的类型不一致，请检查文件后重新上传',
          },
        })
      }
    }

    const updated = await this.prisma.fileObject.update({
      where: { id: fileId },
      data: { sizeBytes: head.sizeBytes, status: 'active' },
    })
    return {
      fileId: updated.id,
      status: updated.status as FileStatus,
      sizeBytes: updated.sizeBytes,
      sha256: updated.sha256,
      fileExpiresAt: updated.expiresAt ? updated.expiresAt.toISOString() : null,
    }
  }

  /** 本地后端直传：接收原始 buffer 写入，并复核大小 / 落地 active。 */
  async writeRawUpload(fileId: string, buffer: Buffer): Promise<void> {
    const record = await this.query.requireAlive(fileId)
    const validation = validateUpload({
      purpose: record.purpose,
      mimeType: record.mimeType,
      filename: record.filename,
      sizeBytes: buffer.length,
      mode: 'intent',
    })
    if (!validation.ok) {
      throw new BadRequestException({
        error: { code: validation.code, message: validation.message },
      })
    }
    const sniff = sniffDeclaredMimeMismatch(buffer, record.mimeType)
    if (!sniff.ok) {
      this.logger.warn(
        `Raw-upload content mismatch (purpose=${record.purpose}, declared=${record.mimeType}): ${sniff.reason}`,
      )
      throw new BadRequestException({
        error: {
          code: 'FILE_CONTENT_MISMATCH',
          message: '文件内容与声明的类型不一致，请检查文件后重新上传',
        },
      })
    }
    const put = await this.storage.putObject(
      record.storageKey,
      buffer,
      record.mimeType,
      record.bucket,
    )
    await this.prisma.fileObject.update({
      where: { id: fileId },
      data: { sizeBytes: put.sizeBytes, sha256: put.sha256, status: 'active' },
    })
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private resolveSensitiveLevel(
    purpose: FilePurpose,
    explicit?: FileSensitiveLevel,
  ): FileSensitiveLevel {
    if (purpose === 'contract_upload') return 'highly_sensitive'
    return explicit ?? DEFAULT_SENSITIVE_BY_PURPOSE[purpose] ?? 'normal'
  }
}
