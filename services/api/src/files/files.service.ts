import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { createHash, randomUUID } from 'crypto'
import type {
  CompleteUploadResponse,
  FileAccessUrlResponse,
  FileAssetCategory,
  FileMetadata,
  FileOwnerType,
  FilePurpose,
  FileRetentionPolicy,
  FileRetentionSetBy,
  FileRetentionUpdateResponse,
  FileSensitiveLevel,
  FileStatus,
  FileUploadResponse,
  FileLifecycleSummaryResponse,
  SignedUrlResponse,
  FileCleanupResponse,
  UploadIntentResponse,
} from './file.types'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import type { UserRole } from '../common/decorators/roles.decorator'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
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
import {
  RetentionPolicyError,
  allowedPoliciesForFile,
  computeRetentionDecision,
  defaultRetentionForUpload,
} from './retention-policy'
import { summarizeFileLifecycleRows } from './lifecycle-summary'
import { parseContentFileId, signFileUrl } from './signing'

/**
 * COS 直传 completeUpload 阶段允许整读回嗅探的对象大小上限。
 * StorageService 暂无 Range 读取,超过此值的对象(admin_upload / screensaver_material
 * 等 purpose 允许非视频文件到 500MB)跳过嗅探,避免把数百 MB 读进内存。
 */
export const DIRECT_UPLOAD_SNIFF_MAX_BYTES = 32 * 1024 * 1024
const STORAGE_DELETE_RETRY_BATCH_LIMIT = 100
const ACTIVE_PRINT_PROTECTION_SCAN_LIMIT = 1_000

/**
 * 文件请求者(下载 / 预览 / 删除鉴权用)。
 *   - user:  后台 User(admin / partner / kiosk),来自 User JWT。
 *   - member:C 端求职者(EndUser),来自 member token。
 */
export type FileRequester =
  | { kind: 'user'; userId: string; role: UserRole; orgId: string | null }
  | { kind: 'member'; endUserId: string }

/**
 * 文件服务:落库 + 对象存储(COS / 本地)写入 + 签名 + 软删 + 物理清理。
 *
 * 所有物理读写经 StorageService 路由到 COS 或本地后端,FilesService 不再直接
 * 触碰文件系统。鉴权 + 审计(管理员访问用户文件)在 service / controller 协作完成。
 */
@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService
  ) {}

  // ── 服务端代理上传(multipart;校验后的 buffer 经服务端推送到对象存储)──────

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
    if (args.purpose === 'member_data_export' || args.purpose === 'contract_review_report') {
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
    // 魔数校验:真实字节须与声明 MIME 签名级一致(降低纯客户端声明的混淆空间;
    // 非结构级证明,能力边界见 content-sniff.ts 文件头注释)。
    const sniff = sniffDeclaredMimeMismatch(args.buffer, args.mimeType)
    if (!sniff.ok) {
      this.logger.warn(
        `Upload content mismatch (purpose=${args.purpose}, declared=${args.mimeType}): ${sniff.reason}`
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
        // 不记录 key / 文件名 / owner；原始 create 错误仍是调用方看到的失败。
        this.logger.warn('Object cleanup compensation failed after file metadata persistence error')
      }
      throw createError
    }

    // 上传响应给至多 30 分钟的签名 URL，且不得越过文件自身寿命。
    const ttlSeconds = this.downloadUrlTtlSeconds(record.expiresAt, record.purpose)
    const signed = this.storage.getDownloadUrl(
      {
        objectKey: record.storageKey,
        fileId: record.id,
        filename: record.filename,
        mimeType: record.mimeType,
        ttlSeconds,
        disposition: 'inline',
      },
      record.bucket
    )
    return {
      fileId: record.id,
      filename: record.filename,
      sizeBytes: record.sizeBytes,
      mimeType: record.mimeType,
      sha256: record.sha256,
      signedUrl: signed.url,
      signedUrlExpiresAt: this.ensureSignedExpiryWithinFileLifetime(
        signed.expiresAt,
        record.expiresAt
      ).toISOString(),
      fileExpiresAt: record.expiresAt ? record.expiresAt.toISOString() : null,
    }
  }

  // ── 直传意图(COS 预签名 PUT;本地回 API 代理 PUT)────────────────────────

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
    if (body.purpose === 'member_data_export' || body.purpose === 'contract_review_report') {
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
      body.sensitiveLevel as FileSensitiveLevel | undefined
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
      record.bucket
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
   * 客户端直传完成后确认。headObject 复核对象确实落地 + 实测大小,
   * 通过则 status→active。COS 端 sha256 无法就 buffer 计算,沿用意图阶段客户端值(可空)。
   */
  async completeUpload(fileId: string, requester: FileRequester): Promise<CompleteUploadResponse> {
    const record = await this.requireAlive(fileId)
    if (!canAccessFile(record, requester)) {
      throw new ForbiddenException({
        error: { code: 'FILE_ACCESS_DENIED', message: '无权确认此文件' },
      })
    }
    if (
      !['uploading', 'active'].includes(record.status) ||
      record.storageDeletePendingAt ||
      record.storageDeletedAt
    ) {
      this.throwFileNotFound()
    }

    const head = await this.storage.headObject(record.storageKey, record.bucket)
    if (!head) {
      throw new BadRequestException({
        error: { code: 'FILE_NOT_UPLOADED', message: '对象未上传或上传未完成' },
      })
    }
    // 实测大小复核 purpose 上限(直传可能绕过意图阶段声明)。
    const policy = PURPOSE_POLICY[record.purpose as FilePurpose]
    if (policy && head.sizeBytes > policy.maxBytes) {
      // 先隔离元数据再删对象；DB 失败时不碰对象，存储失败时 quarantined 仍阻断访问并可重试。
      await this.quarantineAndDeleteObject(record)
      throw new BadRequestException({
        error: { code: 'FILE_TOO_LARGE', message: '上传文件超出大小上限,已拒绝' },
      })
    }

    // 魔数校验(直传路径:客户端字节直达对象存储,服务端此前从未看过内容)。
    // 边界:StorageService 没有 ranged/partial read,getObject 会把整个对象读进内存,
    // 故嗅探同时受 DIRECT_UPLOAD_SNIFF_MAX_BYTES 实测大小门限约束——video/* 与超限对象
    // 本轮明确豁免(属已披露残留;待存储接口支持 Range 读取后收口)。
    if (!record.mimeType.startsWith('video/') && head.sizeBytes <= DIRECT_UPLOAD_SNIFF_MAX_BYTES) {
      const bytes = await this.storage.getObject(record.storageKey, record.bucket)
      const sniff = sniffDeclaredMimeMismatch(bytes, record.mimeType)
      if (!sniff.ok) {
        // 与上方超限分支同款处理：先 quarantined，再物理删除。
        this.logger.warn(
          `Direct-upload content mismatch (purpose=${record.purpose}, declared=${record.mimeType}): ${sniff.reason}`
        )
        await this.quarantineAndDeleteObject(record)
        throw new BadRequestException({
          error: {
            code: 'FILE_CONTENT_MISMATCH',
            message: '文件内容与声明的类型不一致，请检查文件后重新上传',
          },
        })
      }
    }

    const completed = await this.prisma.fileObject.updateMany({
      where: {
        id: fileId,
        deletedAt: null,
        status: record.status,
        updatedAt: record.updatedAt,
        storageDeletePendingAt: null,
        storageDeletedAt: null,
      },
      data: { sizeBytes: head.sizeBytes, status: 'active' },
    })
    if (completed.count !== 1) {
      throw new ConflictException({
        error: { code: 'FILE_UPLOAD_STATE_CHANGED', message: '文件状态已变化，请重新上传' },
      })
    }
    const updated = await this.prisma.fileObject.findUnique({ where: { id: fileId } })
    if (!updated || updated.status !== 'active' || updated.deletedAt) {
      throw new ConflictException({
        error: { code: 'FILE_UPLOAD_STATE_CHANGED', message: '文件状态已变化，请重新上传' },
      })
    }
    return {
      fileId: updated.id,
      status: updated.status as FileStatus,
      sizeBytes: updated.sizeBytes,
      sha256: updated.sha256,
      fileExpiresAt: updated.expiresAt ? updated.expiresAt.toISOString() : null,
    }
  }

  /** 本地后端直传:接收原始 buffer 写入,并复核大小/落地 active。 */
  async writeRawUpload(fileId: string, buffer: Buffer): Promise<void> {
    const record = await this.requireAlive(fileId)
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
    // 魔数校验:真实字节须与意图阶段声明的 MIME 签名级一致(非结构级证明)。
    const sniff = sniffDeclaredMimeMismatch(buffer, record.mimeType)
    if (!sniff.ok) {
      this.logger.warn(
        `Raw-upload content mismatch (purpose=${record.purpose}, declared=${record.mimeType}): ${sniff.reason}`
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
      record.bucket
    )
    const completed = await this.prisma.fileObject.updateMany({
      where: {
        id: fileId,
        deletedAt: null,
        status: record.status,
        updatedAt: record.updatedAt,
        storageDeletePendingAt: null,
        storageDeletedAt: null,
      },
      data: { sizeBytes: put.sizeBytes, sha256: put.sha256, status: 'active' },
    })
    if (completed.count === 1) return

    // PUT 不能与 metadata 的删除状态原子提交。若删除在 requireAlive 之后胜出，
    // 迟到 PUT 会重新生成同 key 对象；此时旧 storageDeletedAt 已不再能证明对象
    // 不存在。重新建立 pending 并幂等补偿删除，避免永久隐藏字节。
    await this.compensateRawUploadAfterDeleteRace(record)
    throw new ConflictException({
      error: { code: 'FILE_UPLOAD_STATE_CHANGED', message: '文件状态已变化，请重新上传' },
    })
  }

  // ── 下载 / 预览 短期 URL ──────────────────────────────────────────────────

  /**
   * 生成下载 / 预览 URL,带归属鉴权。
   * 返回 needsAdminAudit 表示"管理员访问了非本人的用户敏感文件",由 controller 落审计。
   */
  async getAccessUrl(
    fileId: string,
    requester: FileRequester,
    disposition: 'inline' | 'attachment'
  ): Promise<{
    response: FileAccessUrlResponse
    record: { purpose: string; ownerType: string | null }
    needsAdminAudit: boolean
  }> {
    const record = await this.requireActive(fileId)
    if (!canAccessFile(record, requester)) {
      throw new ForbiddenException({
        error: { code: 'FILE_ACCESS_DENIED', message: '无权访问此文件' },
      })
    }

    const ttlSeconds = this.downloadUrlTtlSeconds(record.expiresAt, record.purpose)

    const signed = this.storage.getDownloadUrl(
      {
        objectKey: record.storageKey,
        fileId: record.id,
        filename: record.filename,
        mimeType: record.mimeType,
        ttlSeconds,
        disposition,
      },
      record.bucket
    )

    const isUserFile = record.ownerType === 'user' || Boolean(record.endUserId)
    const needsAdminAudit = requester.kind === 'user' && requester.role === 'admin' && isUserFile

    return {
      response: {
        fileId: record.id,
        url: signed.url,
        // printFileUrl 只是应用内部 HMAC 入口；/content 最终读取仍通过
        // requireActive 二次校验 status/deletedAt/expiresAt，不会因签名期越过文件寿命。
        printFileUrl: signFileUrl(record.id).url,
        expiresAt: this.ensureSignedExpiryWithinFileLifetime(
          signed.expiresAt,
          record.expiresAt
        ).toISOString(),
        disposition,
      },
      record: { purpose: record.purpose, ownerType: record.ownerType },
      needsAdminAudit,
    }
  }

  /** 兼容旧端点 GET /files/:id/url:重发短期签名 URL(归属校验)。 */
  async getSignedUrl(fileId: string, user: AuthedUser): Promise<SignedUrlResponse> {
    const requester: FileRequester = {
      kind: 'user',
      userId: user.userId,
      role: user.role,
      orgId: user.orgId,
    }
    const record = await this.requireActive(fileId)
    if (!canAccessFile(record, requester)) {
      throw new ForbiddenException({
        error: { code: 'FILE_ACCESS_DENIED', message: '无权访问此文件' },
      })
    }
    const ttlSeconds = this.downloadUrlTtlSeconds(record.expiresAt, record.purpose)
    const signed = this.storage.getDownloadUrl(
      {
        objectKey: record.storageKey,
        fileId: record.id,
        filename: record.filename,
        mimeType: record.mimeType,
        ttlSeconds,
        disposition: 'inline',
      },
      record.bucket
    )
    return {
      fileId: record.id,
      signedUrl: signed.url,
      expiresAt: this.ensureSignedExpiryWithinFileLifetime(
        signed.expiresAt,
        record.expiresAt
      ).toISOString(),
      purpose: record.purpose as FilePurpose,
    }
  }

  // ── 读取文件 buffer(/content 代理;签名校验由 controller 完成)────────────

  async readContent(
    fileId: string
  ): Promise<{ buffer: Buffer; mimeType: string; filename: string; purpose: FilePurpose }> {
    const record = await this.requireDeletable(fileId, { allowContractReviewReport: true })
    const expired = Boolean(record.expiresAt && record.expiresAt.getTime() <= Date.now())
    const malformedContract = record.purpose === 'contract_upload' && !record.expiresAt
    if (
      record.status !== 'active' ||
      malformedContract ||
      (expired && (
        record.purpose !== 'contract_review_report' ||
        !(await this.hasActivePrintTaskForFile(fileId))
      ))
    ) {
      this.throwFileNotFound()
    }
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
   *
   * - endUserId 为 string: 只允许读取该会员自己的文件。
   * - endUserId 为 null: 只允许读取匿名上传文件(ownerType=system)。
   *
   * 这里故意用 NOT_FOUND 口径，避免通过 fileId 探测他人文件是否存在。
   * 签名 URL 内容代理仍使用 readContent；签名校验由 controller 完成。
   */
  async readContentForEndUser(
    fileId: string,
    endUserId: string | null
  ): Promise<{ buffer: Buffer; mimeType: string; filename: string; purpose: FilePurpose }> {
    const record = await this.requireActive(fileId)
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

  // ── 列表(admin)─────────────────────────────────────────────────────────

  async list(
    args: { includeDeleted?: boolean; purpose?: string; limit?: number } = {}
  ): Promise<FileMetadata[]> {
    const records = await this.prisma.fileObject.findMany({
      where: {
        ...(args.includeDeleted ? {} : { deletedAt: null }),
        ...(args.purpose
          ? { purpose: args.purpose === 'contract_review_report' ? '__hidden__' : args.purpose }
          : { purpose: { not: 'contract_review_report' } }),
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
      now
    )
  }

  // ── 删除 ────────────────────────────────────────────────────────────────────

  /** 管理员强制删除(软删 + 物理删 COS / 本地对象)。 */
  async forceDelete(fileId: string, adminId: string, reason: string): Promise<FileMetadata> {
    return this._delete(fileId, `admin:${adminId}`, reason)
  }

  /**
   * 归属人删除(owner / 管理员)。软删数据库记录,并物理删除对象。
   * 合规:敏感文件删除即物理回收,不留持久公开物。
   */
  async ownerDelete(
    fileId: string,
    requester: FileRequester,
    reason: string
  ): Promise<FileMetadata> {
    // 已写 tombstone 但对象删除失败的记录仍允许原授权主体幂等重试；
    // 其他读取入口继续把 deletedAt 行统一视为不存在。
    const record = await this.requireDeletionRecord(fileId)
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
    args: { retentionPolicy: FileRetentionPolicy; consentVersion?: string }
  ): Promise<FileRetentionUpdateResponse> {
    const record = await this.requireActive(fileId)
    if (!canAccessFile(record, requester)) {
      throw new ForbiddenException({
        error: { code: 'FILE_ACCESS_DENIED', message: '无权修改此文件' },
      })
    }
    try {
      const operationNow = new Date()
      const decision = computeRetentionDecision({
        now: operationNow,
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
      const updated = await this.prisma.fileObject.updateMany({
        where: {
          id: fileId,
          deletedAt: null,
          status: 'active',
          updatedAt: record.updatedAt,
          OR: [{ expiresAt: null }, { expiresAt: { gt: operationNow } }],
        },
        data: {
          expiresAt: decision.expiresAt,
          retentionPolicy: decision.retentionPolicy,
          retentionSetBy: decision.retentionSetBy,
          retentionConsentAt: decision.retentionConsentAt,
          retentionConsentVersion: decision.retentionConsentVersion,
        },
      })
      if (updated.count !== 1) {
        throw new ConflictException({
          error: { code: 'FILE_RETENTION_STATE_CHANGED', message: '文件状态已变化，请刷新后重试' },
        })
      }
      const current = await this.prisma.fileObject.findUnique({ where: { id: fileId } })
      if (!current || current.deletedAt || current.status !== 'active') {
        throw new ConflictException({
          error: { code: 'FILE_RETENTION_STATE_CHANGED', message: '文件状态已变化，请刷新后重试' },
        })
      }
      return {
        file: toMetadata(current),
        allowedPolicies: allowedPoliciesForFile({
          purpose: current.purpose,
          assetCategory: current.assetCategory,
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
    sensitiveLog = false
  ): Promise<FileMetadata> {
    const record = await this.requireDeletionRecord(fileId, {
      allowMemberDataExport,
      allowContractReviewReport: sensitiveLog,
    })
    const deleteRequestedAt = new Date()
    if (!record.deletedAt) {
      // DB tombstone 必须先于对象删除：写库失败时对象仍在，绝不留下 active metadata
      // 指向已删除对象。updateMany 是 CAS，支持并发删除调用安全收敛到同一 tombstone。
      await this.prisma.fileObject.updateMany({
        where: {
          id: fileId,
          deletedAt: null,
          status: record.status,
          updatedAt: record.updatedAt,
          storageDeletedAt: null,
        },
        data: {
          deletedAt: deleteRequestedAt,
          deletedBy,
          deleteReason: reason,
          status: 'deleted',
          storageDeletePendingAt: deleteRequestedAt,
        },
      })
    } else if (!record.storageDeletedAt && !record.storageDeletePendingAt) {
      // 滚动部署 / 历史版本可能已写 tombstone 却没有 pending；在授权主体重试时自愈。
      await this.prisma.fileObject.updateMany({
        where: {
          id: fileId,
          deletedAt: record.deletedAt,
          status: 'deleted',
          storageDeletePendingAt: null,
          storageDeletedAt: null,
        },
        data: { storageDeletePendingAt: deleteRequestedAt },
      })
    }

    let tombstone = await this.prisma.fileObject.findUnique({ where: { id: fileId } })
    if (!tombstone || !tombstone.deletedAt || tombstone.status !== 'deleted') {
      this.throwFileNotFound()
    }

    if (!tombstone.storageDeletedAt) {
      if (!tombstone.storageDeletePendingAt) {
        throw new ServiceUnavailableException({
          error: {
            code: 'FILE_STORAGE_DELETE_PENDING',
            message: '文件已隔离，存储清理暂未完成，请稍后重试',
          },
        })
      }
      try {
        if (tombstone.purpose !== 'member_data_export') {
          await this.revokeFairMaterialBridgeForDeletedFile(fileId, deleteRequestedAt)
        }
        await this.completePendingStorageDelete(tombstone, {
          deletedBy,
          deleteReason: reason,
        })
      } catch (error) {
        const errorType = error instanceof Error ? error.constructor.name : typeof error
        this.logger.warn(
          `code=FILE_OBJECT_DELETE_RETRY_REQUIRED file=${digestFileId(fileId)} errorType=${errorType}`
        )
        throw new ServiceUnavailableException({
          error: {
            code: 'FILE_STORAGE_DELETE_PENDING',
            message: '文件已隔离，存储清理暂未完成，请稍后重试',
            retryable: true,
          },
        })
      }
      tombstone = await this.prisma.fileObject.findUnique({ where: { id: fileId } })
      if (!tombstone?.storageDeletedAt || tombstone.storageDeletePendingAt) {
        throw new ServiceUnavailableException({
          error: {
            code: 'FILE_STORAGE_DELETE_PENDING',
            message: '文件已隔离，存储清理暂未完成，请稍后重试',
          },
        })
      }
    }
    if (sensitiveLog) {
      this.logger.log(`Sensitive file deleted by ${deletedBy}: ${digestFileId(fileId)}`)
    } else {
      this.logger.log(`File deleted by ${deletedBy}: ${fileId}`)
    }
    return toMetadata(tombstone)
  }

  // ── cron / 手动:清理所有已过期文件 ─────────────────────────────────────

  async cleanupExpired(triggeredBy: 'manual' | 'cron'): Promise<FileCleanupResponse> {
    const now = new Date()
    const deletedIds: string[] = []
    const bySensitiveLevel: Record<string, number> = {}
    const byPurpose: Record<string, number> = {}
    const recordDeleted = (file: { id: string; sensitiveLevel: string; purpose: string }) => {
      if (deletedIds.includes(file.id)) return
      deletedIds.push(file.id)
      bySensitiveLevel[file.sensitiveLevel] = (bySensitiveLevel[file.sensitiveLevel] ?? 0) + 1
      byPurpose[file.purpose] = (byPurpose[file.purpose] ?? 0) + 1
    }

    // 第一批只处理已经隔离 / 逻辑删除但尚无物理删除完成凭证的行。
    // 这也覆盖滚动部署期间旧实例写出的无 pending tombstone。会员数据导出必须
    // 继续由 member-privacy reconciler 同步收口请求账本，通用 cron 不得越权。
    const incompleteDeletes = await this.prisma.fileObject.findMany({
      where: {
        purpose: { not: 'member_data_export' },
        storageDeletedAt: null,
        OR: [
          { storageDeletePendingAt: { not: null } },
          { status: 'quarantined' },
          { status: 'deleted', deletedAt: { not: null } },
        ],
      },
      select: {
        id: true,
        storageKey: true,
        bucket: true,
        purpose: true,
        sensitiveLevel: true,
        status: true,
        deletedAt: true,
        deletedBy: true,
        deleteReason: true,
        storageDeletePendingAt: true,
        storageDeletedAt: true,
        updatedAt: true,
      },
      orderBy: [
        { storageDeletePendingAt: { sort: 'asc', nulls: 'first' } },
        { createdAt: 'asc' },
      ],
      take: STORAGE_DELETE_RETRY_BATCH_LIMIT,
    })
    for (const candidate of incompleteDeletes) {
      try {
        // 每次尝试都刷新 pendingAt。失败项因此移动到队尾，不会让最老的
        // 100 条持续失败记录永久饿死后续待删对象。
        const pendingAt = new Date()
        const claimed = await this.prisma.fileObject.updateMany({
          where: {
            id: candidate.id,
            purpose: { not: 'member_data_export' },
            status: candidate.status,
            updatedAt: candidate.updatedAt,
            storageDeletePendingAt: candidate.storageDeletePendingAt,
            storageDeletedAt: null,
          },
          data: { storageDeletePendingAt: pendingAt },
        })
        if (claimed.count === 0) continue
        const pending = { ...candidate, storageDeletePendingAt: pendingAt }
        await this.revokeFairMaterialBridgeForDeletedFile(candidate.id, now)
        await this.completePendingStorageDelete(pending, {
          deletedBy: 'auto',
          deleteReason: 'storage delete retry',
        })
        recordDeleted(candidate)
      } catch {
        this.logger.warn(
          `code=FILE_STORAGE_DELETE_RETRY_FAILED file=${digestFileId(candidate.id)}`
        )
      }
    }

    const activePrintTasks = await this.prisma.printTask.findMany({
      where: { status: { in: ['pending', 'claimed', 'printing'] } },
      select: { fileId: true, fileUrl: true },
      orderBy: { id: 'asc' },
      take: ACTIVE_PRINT_PROTECTION_SCAN_LIMIT + 1,
    })
    const printProtectionOverflow = activePrintTasks.length > ACTIVE_PRINT_PROTECTION_SCAN_LIMIT
    if (printProtectionOverflow) {
      this.logger.warn('code=FILE_CLEANUP_PRINT_PROTECTION_OVERFLOW')
    }
    const protectedPrintFileIds = new Set<string>()
    const legacyUrlProtectedFileIds = new Set<string>()
    for (const task of activePrintTasks) {
      if (task.fileId) protectedPrintFileIds.add(task.fileId)
      const legacyFileId = parseContentFileId(task.fileUrl)
      if (legacyFileId) {
        protectedPrintFileIds.add(legacyFileId)
        if (legacyFileId !== task.fileId) legacyUrlProtectedFileIds.add(legacyFileId)
      }
    }

    const expired = printProtectionOverflow ? [] : await this.prisma.fileObject.findMany({
      // 导出文件必须由 member-privacy reconciler 同步收口请求账本，
      // 通用 cron 不得越过账本直接删除。
      where: {
        deletedAt: null,
        purpose: { not: 'member_data_export' },
        status: { notIn: ['quarantined', 'deleted'] },
        storageDeletePendingAt: null,
        storageDeletedAt: null,
        // 现代任务使用 fileId 外键，可在查询层排除，避免受保护文件占满批次。
        // 旧任务仅有 fileUrl，下面用一次性集合兼容，不再逐文件全表查询。
        printTasks: { none: { status: { in: ['pending', 'claimed', 'printing'] } } },
        OR: [
          { expiresAt: { lt: now } },
          // contract_upload 必须始终有系统锁定的短期寿命；null 是异常高敏行，
          // 按已过期处理，避免因无法命中 expiresAt < now 而无限留存。
          { purpose: 'contract_upload', expiresAt: null },
        ],
      },
      select: {
        id: true,
        storageKey: true,
        bucket: true,
        purpose: true,
        sensitiveLevel: true,
        status: true,
        expiresAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'asc' },
      // 最多只需为仍活跃的历史 fileUrl 任务额外取一行；过滤后仍严格限删 100。
      take: STORAGE_DELETE_RETRY_BATCH_LIMIT + legacyUrlProtectedFileIds.size,
    })

    let expiredDeleteAttempts = 0
    for (const f of expired) {
      try {
        // 任意已建单且仍在履约中的文件都必须保留给 Agent 下载；这里兼容
        // 尚未回填 fileId、只能从历史 fileUrl 解析血缘的任务。
        if (protectedPrintFileIds.has(f.id)) continue
        if (expiredDeleteAttempts >= STORAGE_DELETE_RETRY_BATCH_LIMIT) break
        // 先隔离，确保后续对象删除或最终 tombstone 写入任一失败时都不会继续签发 URL/读取内容。
        // findMany 只是候选快照；隔离时必须再次 CAS 到期条件和原状态。
        // confirm / retention update 若已延长 expiresAt 或推进状态，本轮不得按旧快照删除。
        const stillExpired =
          f.purpose === 'contract_upload' && !f.expiresAt
            ? { purpose: 'contract_upload', expiresAt: null }
            : { expiresAt: { lt: now } }
        const pendingAt = new Date()
        const quarantined = await this.prisma.fileObject.updateMany({
          where: {
            id: f.id,
            deletedAt: null,
            status: f.status,
            updatedAt: f.updatedAt,
            storageDeletePendingAt: null,
            storageDeletedAt: null,
            ...stillExpired,
          },
          data: { status: 'quarantined', storageDeletePendingAt: pendingAt },
        })
        if (quarantined.count === 0) continue
        expiredDeleteAttempts += 1

        await this.revokeFairMaterialBridgeForDeletedFile(f.id, now)
        await this.completePendingStorageDelete({
          ...f,
          deletedAt: null,
          deletedBy: null,
          deleteReason: null,
          storageDeletePendingAt: pendingAt,
          storageDeletedAt: null,
        }, {
          deletedBy: 'auto',
          deleteReason:
            triggeredBy === 'manual' ? 'manual cleanup of expired' : 'cron cleanup of expired',
        })
        recordDeleted(f)
      } catch {
        this.logger.warn(`code=FILE_CLEANUP_ITEM_FAILED file=${digestFileId(f.id)}`)
      }
    }
    if (deletedIds.length > 0) {
      this.logger.log(`Cleanup (${triggeredBy}): completed ${deletedIds.length} file deletions`)
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

  // ── 内部 ────────────────────────────────────────────────────────────────────

  private async hasActivePrintTaskForFile(fileId: string): Promise<boolean> {
    const tasks = await this.prisma.printTask.findMany({
      where: { status: { in: ['pending', 'claimed', 'printing'] } },
      select: { fileId: true, fileUrl: true },
    })
    return tasks.some((task) => task.fileId === fileId || parseContentFileId(task.fileUrl) === fileId)
  }

  private resolveSensitiveLevel(
    purpose: FilePurpose,
    explicit?: FileSensitiveLevel
  ): FileSensitiveLevel {
    if (purpose === 'contract_upload') return 'highly_sensitive'
    return explicit ?? DEFAULT_SENSITIVE_BY_PURPOSE[purpose] ?? 'normal'
  }

  private downloadUrlTtlSeconds(expiresAt: Date | null, purpose: string): number {
    if (purpose === 'contract_upload' && !expiresAt) {
      this.throwFileNotFound()
    }
    if (!expiresAt) return this.storage.signTtlSeconds
    const remainingSeconds = Math.floor((expiresAt.getTime() - Date.now()) / 1000)
    // 对象存储签名的最小安全粒度为 1 秒；不足时禁止调用存储签名。
    if (remainingSeconds < 1) {
      this.throwFileNotFound()
    }
    return Math.min(this.storage.signTtlSeconds, remainingSeconds)
  }

  private ensureSignedExpiryWithinFileLifetime(
    signedExpiresAt: Date,
    fileExpiresAt: Date | null
  ): Date {
    if (fileExpiresAt && signedExpiresAt.getTime() > fileExpiresAt.getTime()) {
      this.throwFileNotFound()
    }
    return signedExpiresAt
  }

  private async requireAlive(
    fileId: string,
    options: { allowMemberDataExport?: boolean; allowContractReviewReport?: boolean } = {},
  ) {
    return this.requireFile(fileId, { ...options, allowExpired: false })
  }

  /** 对外 URL / content 只允许 active；uploading/quarantined 一律按不存在处理。 */
  private async requireActive(fileId: string, options: { allowMemberDataExport?: boolean } = {}) {
    const record = await this.requireAlive(fileId, options)
    if (record.status !== 'active') this.throwFileNotFound()
    return record
  }

  /** 删除/受控打印读取前的 metadata 查询；调用方仍须单独验证 status 与业务生命周期。 */
  private async requireDeletable(
    fileId: string,
    options: { allowMemberDataExport?: boolean; allowContractReviewReport?: boolean } = {}
  ) {
    return this.requireFile(fileId, { ...options, allowExpired: true })
  }

  /**
   * 删除专用读取：允许 status=deleted 的 tombstone 仅用于重试物理对象删除。
   * 普通访问仍走 requireAlive/requireFile 并按 deletedAt fail-closed。
   */
  private async requireDeletionRecord(
    fileId: string,
    options: { allowMemberDataExport?: boolean; allowContractReviewReport?: boolean } = {}
  ) {
    const record = await this.prisma.fileObject.findUnique({ where: { id: fileId } })
    if (
      !record ||
      (!options.allowMemberDataExport && record.purpose === 'member_data_export') ||
      (!options.allowContractReviewReport && record.purpose === 'contract_review_report') ||
      (record.deletedAt && record.status !== 'deleted')
    ) {
      this.throwFileNotFound()
    }
    return record
  }

  /** 直传违规对象的隔离删除：metadata-first，存储失败保留可重试且不可访问的 quarantined 状态。 */
  private async quarantineAndDeleteObject(record: {
    id: string
    storageKey: string
    bucket: string
    status: string
    updatedAt: Date
  }): Promise<void> {
    const pendingAt = new Date()
    const quarantined = await this.prisma.fileObject.updateMany({
      where: {
        id: record.id,
        deletedAt: null,
        status: record.status,
        updatedAt: record.updatedAt,
        storageDeletedAt: null,
      },
      data: { status: 'quarantined', storageDeletePendingAt: pendingAt },
    })
    if (quarantined.count !== 1) this.throwFileNotFound()

    try {
      const pending = await this.prisma.fileObject.findUnique({ where: { id: record.id } })
      if (!pending?.storageDeletePendingAt || pending.storageDeletedAt) this.throwFileNotFound()
      await this.completePendingStorageDelete(pending, {
        deletedBy: 'system',
        deleteReason: 'direct_upload_rejected',
      })
    } catch (error) {
      const errorType = error instanceof Error ? error.constructor.name : typeof error
      this.logger.warn(
        `code=FILE_QUARANTINE_DELETE_RETRY_REQUIRED file=${digestFileId(record.id)} errorType=${errorType}`
      )
      throw new ServiceUnavailableException({
        error: {
          code: 'FILE_STORAGE_DELETE_PENDING',
          message: '文件已隔离，存储清理暂未完成，请稍后重试',
        },
      })
    }
  }

  /**
   * raw PUT 完成后若 metadata CAS 失败，只在删除状态已胜出时接管清理。
   * 先清除可能早于迟到 PUT 的完成证明，再写 pending；对象删除失败时由 cron 重试。
   */
  private async compensateRawUploadAfterDeleteRace(record: {
    id: string
    storageKey: string
    bucket: string
  }): Promise<void> {
    const pendingAt = new Date()
    // 单调删除态认领不依赖易变的 updatedAt：只要任一删除证据已出现，就原子
    // 清除可能早于迟到 PUT 的完成证明并重建 durable pending。正常 active 行不匹配。
    const reclaimed = await this.prisma.fileObject.updateMany({
      where: {
        id: record.id,
        OR: [
          { deletedAt: { not: null } },
          { status: { in: ['quarantined', 'deleted'] } },
          { storageDeletePendingAt: { not: null } },
          { storageDeletedAt: { not: null } },
        ],
      },
      data: {
        status: 'quarantined',
        storageDeletePendingAt: pendingAt,
        storageDeletedAt: null,
      },
    })
    if (reclaimed.count !== 1) return

    const pending = await this.prisma.fileObject.findUnique({ where: { id: record.id } })
    if (!pending?.storageDeletePendingAt || pending.storageDeletedAt) return
    try {
      await this.completePendingStorageDelete(pending, {
        deletedBy: 'system',
        deleteReason: 'raw_upload_delete_race',
      })
    } catch (error) {
      const errorType = error instanceof Error ? error.constructor.name : typeof error
      this.logger.warn(
        `code=FILE_RAW_UPLOAD_DELETE_RETRY_REQUIRED file=${digestFileId(record.id)} errorType=${errorType}`
      )
    }
  }

  /**
   * 完成已经持久化为 pending 的对象删除。
   * COS 404 / 本地 ENOENT 已由 StorageService 后端视为成功；DB 最终写失败时
   * pending 保留，下一轮会再次幂等 DELETE，绝不伪造 storageDeletedAt。
   */
  private async completePendingStorageDelete(
    record: {
      id: string
      storageKey: string
      bucket: string
      storageDeletePendingAt: Date | null
      storageDeletedAt: Date | null
      deletedAt: Date | null
      deletedBy: string | null
      deleteReason: string | null
    },
    fallback: { deletedBy: string; deleteReason: string }
  ): Promise<void> {
    if (record.storageDeletedAt) return
    const pendingAt = record.storageDeletePendingAt
    if (!pendingAt) throw new Error('FILE_STORAGE_DELETE_NOT_CLAIMED')

    await this.storage.deleteObject(record.storageKey, record.bucket)
    const completedAt = new Date()
    const finalized = await this.prisma.fileObject.updateMany({
      where: {
        id: record.id,
        storageDeletePendingAt: pendingAt,
        storageDeletedAt: null,
      },
      data: {
        status: 'deleted',
        deletedAt: record.deletedAt ?? completedAt,
        deletedBy: record.deletedBy ?? fallback.deletedBy,
        deleteReason: record.deleteReason ?? fallback.deleteReason,
        storageDeletePendingAt: null,
        storageDeletedAt: completedAt,
      },
    })
    if (finalized.count === 1) return

    const current = await this.prisma.fileObject.findUnique({
      where: { id: record.id },
      select: { status: true, deletedAt: true, storageDeletePendingAt: true, storageDeletedAt: true },
    })
    if (
      current?.status === 'deleted' &&
      current.deletedAt &&
      !current.storageDeletePendingAt &&
      current.storageDeletedAt
    ) {
      return
    }
    throw new Error('FILE_STORAGE_DELETE_TOMBSTONE_NOT_FINALIZED')
  }

  private async revokeFairMaterialBridgeForDeletedFile(
    fileId: string,
    revokedAt: Date
  ): Promise<void> {
    const bridge = await this.prisma.fairMaterialPrintBridge.findFirst({
      where: { fileObjectId: fileId },
      select: { id: true, status: true, revokedAt: true },
    })
    if (!bridge || bridge.status !== 'ready' || bridge.revokedAt) return
    await this.prisma.fairMaterialPrintBridge.update({
      where: { id: bridge.id },
      data: {
        activeKey: null,
        status: 'expired',
        revokedAt,
        revokeReason: 'file_storage_deleted',
      },
    })
  }

  private async requireFile(
    fileId: string,
    options: {
      allowMemberDataExport?: boolean
      allowContractReviewReport?: boolean
      allowExpired: boolean
    }
  ) {
    const record = await this.prisma.fileObject.findUnique({ where: { id: fileId } })
    if (
      !record ||
      record.deletedAt ||
      record.storageDeletePendingAt ||
      record.storageDeletedAt ||
      (!options.allowExpired && record.purpose === 'contract_upload' && !record.expiresAt) ||
      (!options.allowExpired && record.expiresAt && record.expiresAt.getTime() <= Date.now()) ||
      (!options.allowMemberDataExport && record.purpose === 'member_data_export') ||
      (!options.allowContractReviewReport && record.purpose === 'contract_review_report')
    ) {
      // 禁止通用端点成为导出或合同风险报告 artifact 的存在性探针。
      this.throwFileNotFound()
    }
    return record
  }

  private throwFileNotFound(): never {
    throw new NotFoundException({
      error: { code: 'FILE_NOT_FOUND', message: '文件不存在或已被清理' },
    })
  }
}

function digestFileId(fileId: string): string {
  return createHash('sha256').update(fileId).digest('hex').slice(0, 12)
}

/** 归属判定。member 只能访问 endUserId 匹配;User 按角色 / 上传者 / 机构。 */
export function canAccessFile(
  record: {
    uploaderId: string | null
    endUserId: string | null
    ownerType: string | null
    ownerId: string | null
  },
  requester: FileRequester
): boolean {
  if (requester.kind === 'member') {
    return Boolean(record.endUserId) && record.endUserId === requester.endUserId
  }
  // requester.kind === 'user'
  if (requester.role === 'admin') return true
  if (record.uploaderId && record.uploaderId === requester.userId) return true
  // 合作机构只能访问本机构(partner)文件,绝不能访问用户简历(ownerType='user')
  if (
    requester.role === 'partner' &&
    record.ownerType === 'partner' &&
    record.ownerId &&
    requester.orgId &&
    record.ownerId === requester.orgId
  ) {
    return true
  }
  return false
}

/** 由上传上下文推断 ownerType / ownerId。 */
export function deriveOwner(args: {
  endUserId: string | null
  role: UserRole | null
  uploaderId: string | null
  orgId: string | null
}): {
  ownerType: FileOwnerType
  ownerId: string | null
} {
  if (args.endUserId) return { ownerType: 'user', ownerId: args.endUserId }
  if (args.role === 'admin') return { ownerType: 'admin', ownerId: args.uploaderId }
  if (args.role === 'partner') return { ownerType: 'partner', ownerId: args.orgId }
  return { ownerType: 'system', ownerId: null }
}

function toMetadata(r: {
  id: string
  bucket: string
  region: string
  storageKey: string
  filename: string
  mimeType: string
  sizeBytes: number
  sha256: string
  purpose: string
  sensitiveLevel: string
  ownerType: string | null
  ownerId: string | null
  visibility: string
  status: string
  assetCategory: string
  sourceFileId: string | null
  retentionPolicy: string | null
  retentionSetBy: string | null
  retentionConsentAt: Date | null
  retentionConsentVersion: string | null
  retentionLockedReason: string | null
  uploaderId: string | null
  endUserId: string | null
  createdBy: string | null
  expiresAt: Date | null
  deletedAt: Date | null
  deletedBy: string | null
  deleteReason: string | null
  createdAt: Date
}): FileMetadata {
  const protectedExport = r.purpose === 'member_data_export'
  return {
    id: r.id,
    bucket: protectedExport ? '' : r.bucket,
    region: protectedExport ? '' : r.region,
    objectKey: protectedExport ? '' : r.storageKey,
    filename: r.filename,
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes,
    sha256: protectedExport ? '' : r.sha256,
    purpose: r.purpose as FilePurpose,
    sensitiveLevel: r.sensitiveLevel as FileSensitiveLevel,
    ownerType: r.ownerType as FileOwnerType | null,
    ownerId: r.ownerId,
    visibility: r.visibility as FileMetadata['visibility'],
    status: r.status as FileStatus,
    assetCategory: r.assetCategory as FileAssetCategory,
    sourceFileId: r.sourceFileId,
    retentionPolicy: r.retentionPolicy as FileRetentionPolicy | null,
    retentionSetBy: r.retentionSetBy as FileMetadata['retentionSetBy'],
    retentionConsentAt: r.retentionConsentAt?.toISOString() ?? null,
    retentionConsentVersion: r.retentionConsentVersion,
    retentionLockedReason: r.retentionLockedReason,
    uploaderId: r.uploaderId,
    endUserId: r.endUserId,
    createdBy: r.createdBy,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    deletedAt: r.deletedAt?.toISOString() ?? null,
    deletedBy: r.deletedBy,
    deleteReason: r.deleteReason,
    createdAt: r.createdAt.toISOString(),
  }
}
