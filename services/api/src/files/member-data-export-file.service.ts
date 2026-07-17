import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { createHash, randomUUID } from 'node:crypto'
import { PrismaService } from '../prisma/prisma.service'
import { StorageService } from '../storage/storage.service'
import { generateObjectKey } from '../storage/object-key'
import { sniffDeclaredMimeMismatch } from './content-sniff'
import { MEMBER_DATA_EXPORT_FILE_POLICY, validateUpload } from './file-validation'

const EXPORT_FILENAME = 'member-data-export.json'
const EXPORT_MIME = 'application/json'

export interface MemberDataExportFileResult {
  fileId: string
  filename: string
  mimeType: 'application/json'
  sizeBytes: number
  sha256: string
  fileExpiresAt: string
}

export type MemberDataExportFileInspection =
  | { status: 'available'; tracked: true }
  | { status: 'missing'; tracked: boolean }

/**
 * 会员数据导出专用文件边界。
 *
 * 不生成签名 URL，不接收 controller 的通用上传 DTO；只向
 * member-privacy processor/download service 提供 create/read。
 */
@Injectable()
export class MemberDataExportFileService {
  private readonly logger = new Logger(MemberDataExportFileService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async create(args: {
    buffer: Buffer
    endUserId: string
    expiresAt: Date
  }): Promise<MemberDataExportFileResult> {
    if (!args.endUserId?.trim()) {
      throw new BadRequestException({
        error: { code: 'FILE_EXPORT_OWNER_INVALID', message: '会员数据导出归属无效' },
      })
    }
    const now = Date.now()
    const latestExpiry = now + MEMBER_DATA_EXPORT_FILE_POLICY.maxTtlHours * 60 * 60 * 1000
    if (
      !(args.expiresAt instanceof Date) ||
      !Number.isFinite(args.expiresAt.getTime()) ||
      args.expiresAt.getTime() <= now ||
      args.expiresAt.getTime() > latestExpiry
    ) {
      throw new BadRequestException({
        error: { code: 'FILE_EXPORT_RETENTION_INVALID', message: '会员数据导出到期时间必须在 24 小时内' },
      })
    }
    if (!Buffer.isBuffer(args.buffer)) {
      throw new BadRequestException({
        error: { code: 'FILE_EXPORT_CONTENT_INVALID', message: '会员数据导出内容必须是有效 JSON' },
      })
    }
    const validation = validateUpload({
      purpose: 'member_data_export',
      mimeType: EXPORT_MIME,
      filename: EXPORT_FILENAME,
      sizeBytes: args.buffer.length,
      mode: 'proxy',
    })
    if (!validation.ok) {
      throw new BadRequestException({ error: { code: validation.code, message: validation.message } })
    }
    const sniff = sniffDeclaredMimeMismatch(args.buffer, EXPORT_MIME)
    if (!sniff.ok || !isJsonObject(args.buffer)) {
      throw new BadRequestException({
        error: { code: 'FILE_EXPORT_CONTENT_INVALID', message: '会员数据导出内容必须是有效 JSON' },
      })
    }

    const id = randomUUID().replace(/-/g, '')
    const objectKey = generateObjectKey({
      purpose: 'member_data_export',
      ownerType: 'user',
      ownerId: args.endUserId,
      fileId: id,
      ext: validation.ext,
    })
    const bucket = this.storage.defaultBucket
    const region = this.storage.defaultRegion
    // 元数据必须先于对象写入。这样即使 putObject 已落盘后抛错、且补偿删除也失败，
    // reconciler 仍能通过 FileObject 扫描并回收高敏对象，不会产生无账本孤儿。
    const record = await this.prisma.fileObject.create({
      data: {
        id,
        storageKey: objectKey,
        bucket,
        region,
        filename: EXPORT_FILENAME,
        mimeType: EXPORT_MIME,
        sizeBytes: args.buffer.length,
        sha256: sha256(args.buffer),
        uploaderId: null,
        endUserId: args.endUserId,
        ownerType: 'user',
        ownerId: args.endUserId,
        purpose: 'member_data_export',
        sensitiveLevel: MEMBER_DATA_EXPORT_FILE_POLICY.sensitiveLevel,
        visibility: MEMBER_DATA_EXPORT_FILE_POLICY.visibility,
        status: 'active',
        createdBy: 'system:member-data-export',
        assetCategory: 'derived',
        sourceFileId: null,
        expiresAt: args.expiresAt,
        retentionPolicy: MEMBER_DATA_EXPORT_FILE_POLICY.retentionPolicy,
        retentionSetBy: MEMBER_DATA_EXPORT_FILE_POLICY.retentionSetBy,
        retentionLockedReason: 'member_data_export',
        retentionConsentAt: null,
        retentionConsentVersion: null,
      },
    })
    try {
      await this.storage.putObject(objectKey, args.buffer, EXPORT_MIME)
    } catch (error) {
      await this.compensateFailedWrite(record.id, objectKey, bucket)
      this.storageUnavailable('put', error)
    }
    return {
      fileId: record.id,
      filename: record.filename,
      mimeType: 'application/json',
      sizeBytes: record.sizeBytes,
      sha256: record.sha256,
      fileExpiresAt: args.expiresAt.toISOString(),
    }
  }

  async inspect(fileId: string, endUserId: string): Promise<MemberDataExportFileInspection> {
    const record = await this.prisma.fileObject.findUnique({ where: { id: fileId } })
    const tracked = Boolean(
      record
      && record.purpose === 'member_data_export'
      && record.ownerType === 'user'
      && record.ownerId === endUserId
      && record.endUserId === endUserId,
    )
    const metadataValid = tracked
      && !record!.deletedAt
      && record!.mimeType === EXPORT_MIME
      && record!.sensitiveLevel === MEMBER_DATA_EXPORT_FILE_POLICY.sensitiveLevel
      && record!.visibility === MEMBER_DATA_EXPORT_FILE_POLICY.visibility
      && record!.status === 'active'
      && record!.retentionPolicy === MEMBER_DATA_EXPORT_FILE_POLICY.retentionPolicy
      && record!.expiresAt !== null
      && record!.expiresAt.getTime() > Date.now()
      && record!.sizeBytes <= MEMBER_DATA_EXPORT_FILE_POLICY.maxBytes
    if (!metadataValid) return { status: 'missing', tracked }

    let head
    try {
      head = await this.storage.headObject(record!.storageKey, record!.bucket)
    } catch (error) {
      this.storageUnavailable('head', error)
    }
    const contentType = head?.contentType?.split(';', 1)[0]?.trim().toLowerCase() ?? null
    if (!head || head.sizeBytes !== record!.sizeBytes || (contentType !== null && contentType !== EXPORT_MIME)) {
      return { status: 'missing', tracked: true }
    }
    return { status: 'available', tracked: true }
  }

  async read(
    fileId: string,
    endUserId: string,
    maxBytes: number,
  ): Promise<{ buffer: Buffer; mimeType: 'application/json'; filename: string; sizeBytes: number }> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      throw new BadRequestException({
        error: { code: 'FILE_EXPORT_MAX_BYTES_INVALID', message: '会员数据导出读取上限无效' },
      })
    }
    const effectiveMaxBytes = Math.min(maxBytes, MEMBER_DATA_EXPORT_FILE_POLICY.maxBytes)
    const record = await this.prisma.fileObject.findUnique({ where: { id: fileId } })
    const valid =
      record &&
      !record.deletedAt &&
      record.purpose === 'member_data_export' &&
      record.mimeType === EXPORT_MIME &&
      record.sensitiveLevel === MEMBER_DATA_EXPORT_FILE_POLICY.sensitiveLevel &&
      record.visibility === MEMBER_DATA_EXPORT_FILE_POLICY.visibility &&
      record.status === 'active' &&
      record.retentionPolicy === MEMBER_DATA_EXPORT_FILE_POLICY.retentionPolicy &&
      record.ownerType === 'user' &&
      record.ownerId === endUserId &&
      record.endUserId === endUserId &&
      record.expiresAt !== null &&
      record.expiresAt.getTime() > Date.now()
    if (!valid) this.notFound()
    if (record.sizeBytes > effectiveMaxBytes) this.tooLarge()

    let head
    try {
      head = await this.storage.headObject(record.storageKey, record.bucket)
    } catch (error) {
      this.storageUnavailable('head', error)
    }
    if (!head) this.notFound()
    if (!Number.isSafeInteger(head.sizeBytes) || head.sizeBytes < 0) {
      this.storageUnavailable('head', new TypeError('invalid storage metadata'))
    }
    if (head.sizeBytes > effectiveMaxBytes) this.tooLarge()
    // 本地文件系统无 content-type 元数据（null）；COS 等提供者若返回则必须是 JSON。
    const actualContentType = head.contentType?.split(';', 1)[0]?.trim().toLowerCase() ?? null
    if (actualContentType !== null && actualContentType !== EXPORT_MIME) this.notFound()

    let buffer: Buffer
    try {
      buffer = await this.storage.getObject(record.storageKey, record.bucket)
    } catch (error) {
      this.storageUnavailable('get', error)
    }
    if (buffer.length > effectiveMaxBytes) this.tooLarge()
    if (buffer.length !== head.sizeBytes) {
      this.storageUnavailable('get', new RangeError('storage size changed during read'))
    }
    return { buffer, mimeType: 'application/json', filename: record.filename, sizeBytes: buffer.length }
  }

  private storageUnavailable(stage: 'put' | 'head' | 'get', error: unknown): never {
    this.logStorageFailure(stage, error)
    throw new ServiceUnavailableException({
      error: { code: 'FILE_EXPORT_STORAGE_UNAVAILABLE', message: '会员数据导出存储暂不可用，请稍后重试' },
    })
  }

  private async compensateFailedWrite(
    fileId: string,
    objectKey: string,
    bucket: string,
  ): Promise<void> {
    try {
      await this.storage.deleteObject(objectKey, bucket)
    } catch (error) {
      this.logStorageFailure('delete_compensation', error)
      return
    }
    try {
      await this.prisma.fileObject.updateMany({
        where: { id: fileId, deletedAt: null },
        data: {
          status: 'deleted',
          deletedAt: new Date(),
          deletedBy: 'system',
          deleteReason: 'member_data_export_write_failed',
        },
      })
    } catch (error) {
      // 对象已确认删除；元数据即使暂时仍 active，也会被 orphan sweep 幂等收口。
      this.logStorageFailure('metadata_compensation', error)
    }
  }

  private logStorageFailure(stage: string, error: unknown): void {
    this.logger.warn(`Member data export storage failure stage=${stage} errorType=${safeErrorType(error)}`)
  }

  private notFound(): never {
    throw new NotFoundException({ error: { code: 'FILE_NOT_FOUND', message: '文件不存在或已被清理' } })
  }

  private tooLarge(): never {
    throw new BadRequestException({
      error: { code: 'FILE_EXPORT_TOO_LARGE', message: '会员数据导出超出读取上限' },
    })
  }
}

function isJsonObject(buffer: Buffer): boolean {
  try {
    const text = buffer.toString('utf8')
    if (!Buffer.from(text, 'utf8').equals(buffer)) return false
    const parsed: unknown = JSON.parse(text)
    return Boolean(parsed) && typeof parsed === 'object' && !Array.isArray(parsed)
  } catch {
    return false
  }
}

function safeErrorType(error: unknown): string {
  const candidate = error instanceof Error ? error.name : typeof error
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(candidate) ? candidate : 'UnknownError'
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}
