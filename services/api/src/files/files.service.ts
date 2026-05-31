import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common'
import { randomUUID } from 'crypto'
import type {
  FileMetadata,
  FilePurpose,
  FileSensitiveLevel,
  FileUploadResponse,
  SignedUrlResponse,
  FileCleanupResponse,
} from './file.types'
import { FILE_DEFAULT_TTL_HOURS } from './file.types'
import { PrismaService } from '../prisma/prisma.service'
import { LocalFileStorage } from './storage'
import { signFileUrl } from './signing'

/**
 * 文件用途 → 默认敏感等级映射。显式传 sensitiveLevel 会覆盖(但只能更严)。
 */
const DEFAULT_SENSITIVE_BY_PURPOSE: Record<FilePurpose, FileSensitiveLevel> = {
  resume_upload: 'highly_sensitive',
  resume_scan: 'highly_sensitive',
  id_scan: 'highly_sensitive',
  print_doc: 'normal',
  fair_material: 'normal',
  cover_letter: 'normal',
}

/** 允许的 MIME / 扩展名白名单。防止 .exe / .sh 等被上传。 */
const ALLOWED_MIMES = new Set<string>([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/plain',
  'application/json',
])

const MAX_BYTES = 10 * 1024 * 1024 // 10 MB,与 Kiosk 上传 UI 限制一致

/**
 * 文件服务:落库 + 物理写入 + 签名 + 软删 + 物理清理。
 *
 * 跟 AuditLog 解耦:管理员强制清理动作由 controller 在 service 完成后写审计,
 * 避免 service 依赖 AuditService(BE-2 还在路上)。
 */
@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name)
  private readonly storage = new LocalFileStorage()

  constructor(private readonly prisma: PrismaService) {}

  // ── 上传 ────────────────────────────────────────────────────────────────────

  async upload(args: {
    buffer: Buffer
    filename: string
    mimeType: string
    purpose: FilePurpose
    sensitiveLevel?: FileSensitiveLevel
    uploaderId: string | null
  }): Promise<FileUploadResponse> {
    if (args.buffer.length === 0) {
      throw new BadRequestException({
        error: { code: 'FILE_EMPTY', message: '上传文件为空' },
      })
    }
    if (args.buffer.length > MAX_BYTES) {
      throw new BadRequestException({
        error: { code: 'FILE_TOO_LARGE', message: '文件超出 10MB 上限' },
      })
    }
    if (!ALLOWED_MIMES.has(args.mimeType)) {
      throw new BadRequestException({
        error: { code: 'FILE_MIME_NOT_ALLOWED', message: `不支持的文件类型: ${args.mimeType}` },
      })
    }

    const sensitiveLevel: FileSensitiveLevel =
      args.sensitiveLevel ?? DEFAULT_SENSITIVE_BY_PURPOSE[args.purpose]
    const ttlHours = FILE_DEFAULT_TTL_HOURS[sensitiveLevel]
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000)

    const id = randomUUID().replace(/-/g, '')
    const ext = extractExt(args.filename, args.mimeType)
    const { storageKey, sha256 } = await this.storage.put(args.purpose, ext, id, args.buffer)

    const record = await this.prisma.fileObject.create({
      data: {
        id,
        storageKey,
        filename: args.filename,
        mimeType: args.mimeType,
        sizeBytes: args.buffer.length,
        sha256,
        uploaderId: args.uploaderId,
        purpose: args.purpose,
        sensitiveLevel,
        expiresAt,
      },
    })

    const signed = signFileUrl(record.id)
    return {
      fileId: record.id,
      filename: record.filename,
      sizeBytes: record.sizeBytes,
      mimeType: record.mimeType,
      sha256: record.sha256,
      signedUrl: signed.url,
      signedUrlExpiresAt: signed.expiresAt.toISOString(),
      fileExpiresAt: record.expiresAt.toISOString(),
    }
  }

  // ── 二次签名(已有 fileId) ───────────────────────────────────────────────

  async getSignedUrl(fileId: string): Promise<SignedUrlResponse> {
    const record = await this.requireAlive(fileId)
    const signed = signFileUrl(record.id)
    return {
      fileId: record.id,
      signedUrl: signed.url,
      expiresAt: signed.expiresAt.toISOString(),
    }
  }

  // ── 读取文件 buffer(签名校验由 controller 完成) ─────────────────────────

  async readContent(fileId: string): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
    const record = await this.requireAlive(fileId)
    const buffer = await this.storage.read(record.storageKey)
    return { buffer, mimeType: record.mimeType, filename: record.filename }
  }

  // ── 列表(admin)─────────────────────────────────────────────────────────

  async list(args: { includeDeleted?: boolean; purpose?: string; limit?: number } = {}): Promise<FileMetadata[]> {
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

  // ── 软删 + 物理清理 ────────────────────────────────────────────────────────

  async forceDelete(fileId: string, adminId: string, reason: string): Promise<FileMetadata> {
    const record = await this.requireAlive(fileId)
    await this.storage.delete(record.storageKey)
    const updated = await this.prisma.fileObject.update({
      where: { id: fileId },
      data: {
        deletedAt: new Date(),
        deletedBy: `admin:${adminId}`,
        deleteReason: reason,
      },
    })
    this.logger.log(`File force-deleted by admin:${adminId}: ${fileId} (${record.filename})`)
    return toMetadata(updated)
  }

  // ── cron / 手动:清理所有已过期文件 ─────────────────────────────────────

  async cleanupExpired(triggeredBy: 'manual' | 'cron'): Promise<FileCleanupResponse> {
    const now = new Date()
    const expired = await this.prisma.fileObject.findMany({
      where: {
        deletedAt: null,
        expiresAt: { lt: now },
      },
      select: { id: true, storageKey: true },
    })

    const deletedIds: string[] = []
    for (const f of expired) {
      try {
        await this.storage.delete(f.storageKey)
        await this.prisma.fileObject.update({
          where: { id: f.id },
          data: {
            deletedAt: now,
            deletedBy: 'auto',
            deleteReason: triggeredBy === 'manual' ? 'manual cleanup of expired' : 'cron cleanup of expired',
          },
        })
        deletedIds.push(f.id)
      } catch (err) {
        this.logger.warn(`Failed to cleanup file ${f.id}: ${(err as Error).message}`)
      }
    }
    if (deletedIds.length > 0) {
      this.logger.log(`Cleanup (${triggeredBy}): deleted ${deletedIds.length} expired files`)
    }
    return {
      deletedCount: deletedIds.length,
      deletedFileIds: deletedIds,
      triggeredBy,
      triggeredAt: now.toISOString(),
    }
  }

  // ── 内部:取存活文件,不存在 / 已删则抛 ─────────────────────────────────

  private async requireAlive(fileId: string) {
    const record = await this.prisma.fileObject.findUnique({ where: { id: fileId } })
    if (!record || record.deletedAt) {
      throw new NotFoundException({
        error: { code: 'FILE_NOT_FOUND', message: '文件不存在或已被清理' },
      })
    }
    return record
  }
}

function toMetadata(r: {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  sha256: string
  purpose: string
  sensitiveLevel: string
  uploaderId: string | null
  expiresAt: Date
  deletedAt: Date | null
  deletedBy: string | null
  deleteReason: string | null
  createdAt: Date
}): FileMetadata {
  return {
    id: r.id,
    filename: r.filename,
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes,
    sha256: r.sha256,
    purpose: r.purpose as FilePurpose,
    sensitiveLevel: r.sensitiveLevel as FileSensitiveLevel,
    uploaderId: r.uploaderId,
    expiresAt: r.expiresAt.toISOString(),
    deletedAt: r.deletedAt?.toISOString() ?? null,
    deletedBy: r.deletedBy,
    deleteReason: r.deleteReason,
    createdAt: r.createdAt.toISOString(),
  }
}

function extractExt(filename: string, mime: string): string {
  const dot = filename.lastIndexOf('.')
  if (dot >= 0 && dot < filename.length - 1) return filename.slice(dot + 1)
  // 由 MIME 反推
  if (mime === 'application/pdf') return 'pdf'
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  return 'bin'
}
