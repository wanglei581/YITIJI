import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { randomBytes } from 'crypto'
import { AuditService } from '../audit/audit.service'
import { PrismaService } from '../prisma/prisma.service'
import { StorageService } from '../storage/storage.service'
import { generateObjectKey } from '../storage/object-key'
import { inspectBrandLogo } from './brand-logo-image'
import { BRAND_LOGO_ID_PATTERN, brandLogoUrl, type BrandLogoUploadResult } from './branding.types'

export interface BrandLogoAuditContext {
  actorId: string
  actorRole: string
  ipAddress?: string | null
  userAgent?: string | null
  requestId?: string | null
}

export interface PublicBrandLogo {
  buffer: Buffer
  mimeType: string
  sha256: string
}

/**
 * 贴牌 Logo 的存取。存储复用对象存储（StorageService），元数据放 BrandLogo 表，
 * 与待机宣传屏素材（AdAsset）完全分开：Logo 不会出现在素材列表里，也进不了播放方案。
 * 公开读取只认 BrandLogo 表，所以别的素材读不到。
 */
@Injectable()
export class BrandLogoService {
  private readonly logger = new Logger(BrandLogoService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  /** 检查 → 重编码（去掉辅助块、规整压缩流；像素原样保留）→ 落盘 → 记一行。上传不会自动启用，调用方拿 assetId 再去保存。 */
  async upload(buffer: Buffer, context: BrandLogoAuditContext): Promise<BrandLogoUploadResult> {
    const inspected = inspectBrandLogo(buffer)
    if (!inspected.ok) {
      throw new BadRequestException({ error: { code: inspected.code, message: inspected.message } })
    }
    const id = randomBytes(16).toString('hex')
    const storageKey = generateObjectKey({
      purpose: 'admin_upload',
      ownerType: 'admin',
      ownerId: context.actorId,
      fileId: id,
      ext: inspected.ext,
    })
    const { sha256 } = await this.storage.putObject(storageKey, inspected.sanitized, inspected.mimeType)
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.brandLogo.create({
          data: {
            id,
            storageKey,
            mimeType: inspected.mimeType,
            sizeBytes: inspected.sanitized.length,
            sha256,
            width: inspected.width,
            height: inspected.height,
            createdBy: context.actorId,
          },
        })
        await this.audit.writeRequired(tx, {
          actorId: context.actorId,
          actorRole: context.actorRole,
          action: 'branding.logo_upload',
          targetType: 'system',
          targetId: 'branding',
          payload: {
            assetId: id,
            mimeType: inspected.mimeType,
            width: inspected.width,
            height: inspected.height,
            sizeBytes: inspected.sanitized.length,
          },
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
          requestId: context.requestId ?? null,
        })
      })
    } catch (error) {
      // 记账失败就把刚落盘的对象收回，别留下没有登记的文件。
      await this.storage.deleteObject(storageKey).catch(() => undefined)
      throw error
    }
    this.logger.log(`Brand logo uploaded: ${id} (${inspected.mimeType}, ${inspected.width}x${inspected.height})`)
    return {
      assetId: id,
      logoUrl: brandLogoUrl(id),
      mimeType: inspected.mimeType,
      width: inspected.width,
      height: inspected.height,
      sizeBytes: inspected.sanitized.length,
    }
  }

  /** assetId 是否对应一张已登记的 Logo（写入机构或平台的品牌覆盖前要核）。 */
  async exists(assetId: string): Promise<boolean> {
    if (!BRAND_LOGO_ID_PATTERN.test(assetId)) return false
    return (await this.prisma.brandLogo.count({ where: { id: assetId } })) > 0
  }

  /** 候选里第一个真实存在的 Logo 编号；都不存在返回 null（找不到就回退字标，不报错）。 */
  async firstExisting(candidates: Array<string | null | undefined>): Promise<string | null> {
    const ids = candidates.filter((id): id is string => typeof id === 'string' && BRAND_LOGO_ID_PATTERN.test(id))
    if (ids.length === 0) return null
    const rows = await this.prisma.brandLogo.findMany({ where: { id: { in: ids } }, select: { id: true } })
    const found = new Set(rows.map((row) => row.id))
    return ids.find((id) => found.has(id)) ?? null
  }

  /** 公开读取。形状不对、没登记、对象丢了都返回 null（调用方统一 404）。 */
  async readPublic(assetId: string): Promise<PublicBrandLogo | null> {
    if (!BRAND_LOGO_ID_PATTERN.test(assetId)) return null
    const row = await this.prisma.brandLogo.findUnique({ where: { id: assetId } })
    if (!row) return null
    try {
      const buffer = await this.storage.getObject(row.storageKey)
      return { buffer, mimeType: row.mimeType, sha256: row.sha256 }
    } catch (error) {
      this.logger.warn(`Brand logo object missing: ${assetId} (${error instanceof Error ? error.message : 'unknown'})`)
      return null
    }
  }
}
