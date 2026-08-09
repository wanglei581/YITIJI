import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common'
import { createHash, randomUUID } from 'node:crypto'
import { PDFDocument } from 'pdf-lib'
import { CONTRACT_REVIEW_REPORT_FILE_POLICY, validateUpload } from '../files/file-validation'
import { signContractReportAbandonToken, signFileUrl } from '../files/signing'
import { PrismaService } from '../prisma/prisma.service'
import { generateObjectKey } from '../storage/object-key'
import { StorageService } from '../storage/storage.service'
import type { ContractReviewReportView } from './contract-review.types'

const REPORT_FILENAME = 'AI签约风险提示报告.pdf'
const REPORT_MIME = 'application/pdf'
const MAX_REPORT_TTL_MS = 2 * 60 * 60 * 1000
const MAX_PRINT_URL_TTL_MS = 5 * 60 * 1000
const MAX_ABANDON_TOKEN_TTL_MS = 30 * 60 * 1000

@Injectable()
export class ContractReviewReportFileService {
  private readonly logger = new Logger(ContractReviewReportFileService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async create(args: {
    buffer: Buffer
    pageCount: number
    endUserId: string | null
    sourceFileId: string
    expiresAt: Date
  }): Promise<ContractReviewReportView> {
    const now = Date.now()
    if (
      !(args.expiresAt instanceof Date) ||
      !Number.isFinite(args.expiresAt.getTime()) ||
      args.expiresAt.getTime() <= now ||
      args.expiresAt.getTime() > now + MAX_REPORT_TTL_MS
    ) {
      throw invalidReport('CONTRACT_REVIEW_REPORT_RETENTION_INVALID', '合同风险提示报告到期时间无效')
    }
    if (!Buffer.isBuffer(args.buffer) || !Number.isSafeInteger(args.pageCount) || args.pageCount < 1) {
      throw invalidReport('CONTRACT_REVIEW_REPORT_CONTENT_INVALID', '合同风险提示报告内容无效')
    }
    const validation = validateUpload({
      purpose: 'contract_review_report',
      filename: REPORT_FILENAME,
      mimeType: REPORT_MIME,
      sizeBytes: args.buffer.length,
      mode: 'proxy',
    })
    if (!validation.ok) {
      throw invalidReport(validation.code, validation.message)
    }
    const actualPages = await validatePdf(args.buffer)
    if (actualPages !== args.pageCount) {
      throw invalidReport('CONTRACT_REVIEW_REPORT_CONTENT_INVALID', '合同风险提示报告页数无效')
    }

    const id = randomUUID().replace(/-/g, '')
    const ownerType = args.endUserId ? 'user' : 'system'
    const objectKey = generateObjectKey({
      purpose: 'contract_review_report',
      ownerType,
      ownerId: args.endUserId,
      fileId: id,
      ext: validation.ext,
    })
    const bucket = this.storage.defaultBucket
    const region = this.storage.defaultRegion
    const digest = sha256(args.buffer)
    const record = await this.prisma.fileObject.create({
      data: {
        id,
        storageKey: objectKey,
        bucket,
        region,
        filename: REPORT_FILENAME,
        mimeType: REPORT_MIME,
        sizeBytes: args.buffer.length,
        sha256: digest,
        uploaderId: null,
        endUserId: args.endUserId,
        ownerType,
        ownerId: args.endUserId,
        purpose: 'contract_review_report',
        sensitiveLevel: CONTRACT_REVIEW_REPORT_FILE_POLICY.sensitiveLevel,
        visibility: CONTRACT_REVIEW_REPORT_FILE_POLICY.visibility,
        status: 'uploading',
        createdBy: 'system:contract-review-report',
        assetCategory: 'derived',
        sourceFileId: args.sourceFileId,
        expiresAt: args.expiresAt,
        retentionPolicy: CONTRACT_REVIEW_REPORT_FILE_POLICY.retentionPolicy,
        retentionSetBy: CONTRACT_REVIEW_REPORT_FILE_POLICY.retentionSetBy,
        retentionLockedReason: 'contract_review_session_only',
        retentionConsentAt: null,
        retentionConsentVersion: null,
      },
    })
    try {
      const put = await this.storage.putObject(objectKey, args.buffer, REPORT_MIME, bucket)
      if (put.sizeBytes !== args.buffer.length || put.sha256 !== digest) {
        throw new Error('CONTRACT_REVIEW_REPORT_STORAGE_MISMATCH')
      }
      await this.prisma.fileObject.update({
        where: { id },
        data: { status: 'active' },
      })
      return this.toView({
        id: record.id,
        filename: record.filename,
        mimeType: record.mimeType,
        sizeBytes: record.sizeBytes,
        expiresAt: args.expiresAt,
      }, actualPages)
    } catch (error) {
      await this.compensateFailedWrite(record.id, objectKey, bucket)
      this.storageUnavailable('put', error)
    }
  }

  async getAvailable(args: {
    fileId: string
    endUserId: string | null
    sourceFileId: string
  }): Promise<ContractReviewReportView | null> {
    const record = await this.prisma.fileObject.findUnique({ where: { id: args.fileId } })
    const valid = Boolean(
      record &&
      !record.deletedAt &&
      record.status === 'active' &&
      record.purpose === 'contract_review_report' &&
      record.mimeType === REPORT_MIME &&
      record.sensitiveLevel === CONTRACT_REVIEW_REPORT_FILE_POLICY.sensitiveLevel &&
      record.visibility === CONTRACT_REVIEW_REPORT_FILE_POLICY.visibility &&
      record.retentionPolicy === CONTRACT_REVIEW_REPORT_FILE_POLICY.retentionPolicy &&
      record.retentionLockedReason === 'contract_review_session_only' &&
      record.endUserId === args.endUserId &&
      record.ownerType === (args.endUserId ? 'user' : 'system') &&
      record.ownerId === args.endUserId &&
      record.sourceFileId === args.sourceFileId &&
      record.expiresAt &&
      record.expiresAt.getTime() > Date.now() &&
      record.sizeBytes > 0 &&
      record.sizeBytes <= CONTRACT_REVIEW_REPORT_FILE_POLICY.maxBytes
    )
    if (!valid || !record) return null

    let head
    let buffer: Buffer
    try {
      head = await this.storage.headObject(record.storageKey, record.bucket)
      if (!head || head.sizeBytes !== record.sizeBytes) return null
      const contentType = head.contentType?.split(';', 1)[0]?.trim().toLowerCase() ?? null
      if (contentType !== null && contentType !== REPORT_MIME) return null
      buffer = await this.storage.getObject(record.storageKey, record.bucket)
    } catch (error) {
      this.storageUnavailable('read', error)
    }
    if (buffer.length !== record.sizeBytes || sha256(buffer) !== record.sha256) return null
    let pages: number
    try {
      pages = await validatePdf(buffer)
    } catch {
      return null
    }
    return this.toView(record, pages)
  }

  private toView(
    record: { id: string; filename: string; mimeType: string; sizeBytes: number; expiresAt: Date | null },
    pages: number,
  ): ContractReviewReportView {
    if (record.mimeType !== REPORT_MIME || !record.expiresAt) {
      throw new Error('CONTRACT_REVIEW_REPORT_METADATA_INVALID')
    }
    const remainingMs = record.expiresAt.getTime() - Date.now()
    if (remainingMs < 1_000) {
      throw new ServiceUnavailableException({
        error: { code: 'REPORT_NOT_AVAILABLE', message: '合同审查报告暂不可用', retryable: true },
      })
    }
    let printFileUrl: string
    let abandon: ReturnType<typeof signContractReportAbandonToken>
    try {
      const reportExpiresAtMs = record.expiresAt.getTime()
      printFileUrl = signFileUrl(
        record.id,
        Math.min(MAX_PRINT_URL_TTL_MS, remainingMs),
        reportExpiresAtMs,
      ).url
      abandon = signContractReportAbandonToken(
        record.id,
        Math.min(MAX_ABANDON_TOKEN_TTL_MS, remainingMs),
        reportExpiresAtMs,
      )
    } catch (error) {
      this.storageUnavailable('sign', error)
    }
    return {
      fileId: record.id,
      filename: record.filename,
      mimeType: REPORT_MIME,
      sizeBytes: record.sizeBytes,
      pages,
      expiresAt: record.expiresAt.toISOString(),
      printFileUrl,
      abandonToken: abandon.token,
      abandonTokenExpiresAt: abandon.expiresAt.toISOString(),
    }
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
          deleteReason: 'contract_review_report_write_failed',
        },
      })
    } catch (error) {
      this.logStorageFailure('metadata_compensation', error)
    }
  }

  private storageUnavailable(stage: 'put' | 'read' | 'sign', error: unknown): never {
    this.logStorageFailure(stage, error)
    throw new ServiceUnavailableException({
      error: {
        code: 'CONTRACT_REVIEW_REPORT_STORAGE_UNAVAILABLE',
        message: '合同风险提示报告存储暂不可用，请稍后重试',
        retryable: true,
      },
    })
  }

  private logStorageFailure(stage: string, error: unknown): void {
    const errorType = error instanceof Error && error.name ? error.name : typeof error
    this.logger.warn(`Contract review report storage failure stage=${stage} errorType=${errorType}`)
  }
}

async function validatePdf(buffer: Buffer): Promise<number> {
  try {
    const pdf = await PDFDocument.load(buffer)
    const count = pdf.getPageCount()
    if (!Number.isSafeInteger(count) || count < 1) throw new Error('PDF_PAGE_COUNT_INVALID')
    return count
  } catch {
    throw invalidReport('CONTRACT_REVIEW_REPORT_CONTENT_INVALID', '合同风险提示报告内容无效')
  }
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

function invalidReport(code: string, message: string): BadRequestException {
  return new BadRequestException({ error: { code, message } })
}
