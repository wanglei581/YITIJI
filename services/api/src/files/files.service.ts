import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common'
import { randomUUID } from 'crypto'
import type {
  FileMetadata,
  FilePurpose,
  FileSensitiveLevel,
  FileUploadResponse,
  SignedUrlResponse,
  FileCleanupResponse,
} from './file.types'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import { FILE_DEFAULT_TTL_HOURS } from './file.types'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
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

/**
 * Terminal Agent 当前可真正打印出纸的 MIME(对齐 apps/terminal-agent/src/config.ts
 * SUPPORTED_EXTENSIONS 中已验证真机出纸的子集:.pdf / .jpg / .jpeg / .png)。
 *
 * 注:.bmp / .tiff 在 agent 端列为 SUPPORTED 但当前返回 UNSUPPORTED_FILE_TYPE(需 sharp 预处理),
 * 故不计入"可打印"。webp / Word / 纯文本 / JSON agent 都无法直接出纸。
 *
 * 任何想直接进打印流程的文件,MIME 必须落在此集合内,否则在上传阶段就拒,
 * 不要让"能上传但最后打印失败"的格式走完整条流程(MIME 收口,本次修复点)。
 */
export const PRINTABLE_MIMES = new Set<string>([
  'application/pdf',
  'image/jpeg',
  'image/png',
])

/**
 * 允许上传的 MIME 白名单。防止 .exe / .sh 等被上传。
 *
 * 收口说明:
 *   - print_doc 用途(走打印流程)只接受 PRINTABLE_MIMES,把 Word / webp / text /
 *     json 等"agent 打不出纸"的格式在上传阶段就挡掉,避免走完流程到打印才失败。
 *   - 其它用途(简历上传 / 扫描 / 证件照 / 求职信 / 招聘会素材)是给 AI 解析 /
 *     展示 / 留存用,不直接进打印机,故仍接受 Word / 图片等更宽的集合。
 */
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
 * 审计:
 *   - 管理员强制删除单文件(forceDelete)由 controller 在动作完成后写审计。
 *   - cron / 手动清理过期文件(cleanupExpired)在 service 内直接写审计 —— 该路径
 *     由 @Cron 触发,没有 controller 兜底,必须在此落 AuditLog(合规 CLAUDE.md §11:
 *     "管理员访问文件必须记录日志 / 文件删除后需要保留删除日志")。
 */
@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name)
  private readonly storage = new LocalFileStorage()

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

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
    // MIME 收口:直接进打印流程的 print_doc 必须是 agent 能真正出纸的格式,
    // 否则上传阶段就拒,杜绝"能上传走完流程、最后打印才失败"。
    if (args.purpose === 'print_doc' && !PRINTABLE_MIMES.has(args.mimeType)) {
      throw new BadRequestException({
        error: {
          code: 'FILE_NOT_PRINTABLE',
          message: `该格式无法直接打印,请上传 PDF / JPG / PNG: ${args.mimeType}`,
        },
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

    // 上传响应的签名 URL TTL 给 30 分钟：覆盖"上传 → 预览 → 确认打印"整段触控操作窗口，
    // 避免慢速用户停留超过 5 分钟后提交打印时撞 PRINT_INVALID_FILE_URL(过期)。
    // 匿名 Kiosk 上传无法二次签名，只能依赖此响应 URL 的有效期。
    const signed = signFileUrl(record.id, 30 * 60 * 1000)
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

  /**
   * 重新签名文件 URL，同时执行归属校验：
   *   - admin  → 可访问任意文件
   *   - 其他角色 → uploaderId 必须等于 user.userId（只能访问自己上传的文件）
   *
   * 匿名 Kiosk 上传（uploaderId = null）无法通过此端点二次签名；
   * 应在上传响应的 signedUrl 有效期内直接使用。
   */
  async getSignedUrl(fileId: string, user: AuthedUser): Promise<SignedUrlResponse> {
    const record = await this.requireAlive(fileId)

    if (user.role !== 'admin' && record.uploaderId !== user.userId) {
      throw new ForbiddenException({
        error: { code: 'FILE_ACCESS_DENIED', message: '无权访问此文件' },
      })
    }

    const signed = signFileUrl(record.id)
    return {
      fileId: record.id,
      signedUrl: signed.url,
      expiresAt: signed.expiresAt.toISOString(),
      purpose: record.purpose as FilePurpose,
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
      select: { id: true, storageKey: true, purpose: true, sensitiveLevel: true },
    })

    const deletedIds: string[] = []
    // 审计摘要:按敏感等级 / 用途统计被清理文件数(不含文件名 / 路径等可定位信息)
    const bySensitiveLevel: Record<string, number> = {}
    const byPurpose: Record<string, number> = {}
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
        bySensitiveLevel[f.sensitiveLevel] = (bySensitiveLevel[f.sensitiveLevel] ?? 0) + 1
        byPurpose[f.purpose] = (byPurpose[f.purpose] ?? 0) + 1
      } catch (err) {
        this.logger.warn(`Failed to cleanup file ${f.id}: ${(err as Error).message}`)
      }
    }
    if (deletedIds.length > 0) {
      this.logger.log(`Cleanup (${triggeredBy}): deleted ${deletedIds.length} expired files`)
    }

    // 合规:清理敏感文件(简历 / 身份证)必须落审计。
    //   - cron 路径无 controller 兜底,且无 actor → 必须在此落 'system' 审计(本次修复重点)。
    //   - manual 路径由 FilesController 写带 actor / IP / UA 的审计,此处不再重复写,避免双记。
    // 仅当确有文件被清理时写(避免每小时 cron 空跑刷日志)。
    // payload 只放批次摘要 + 文件 id 摘要(cap 50 个),不含文件名 / 物理路径。
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
          fileIdDigest: deletedIds.slice(0, 50),
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
