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

/**
 * 待清理的孤儿对象清单（PlatformSetting 的一行，值是 JSON 数组）。
 * 对象存储和数据库没法放进同一个事务：先写对象、再写记录；记录写失败就要把对象删掉，可删除也可能失败（存储同时出问题），
 * 那个对象就成了孤儿。失败时：日志记一条 BRAND_LOGO_ORPHAN_OBJECT，并把存储键记进这份清单；之后每次上传（或手动调 drainPendingCleanup）
 * 先把清单里的对象重试删一遍，删掉的移出清单。清单最多留 200 项，满了只记日志。
 * 日志是第一道留痕（一定写）；清单是第二道（尽力而为：两次失败恰好并发时可能丢项，丢了的还能从日志里的存储键找回）。
 */
export const BRAND_LOGO_PENDING_CLEANUP_KEY = 'brand.logoPendingCleanup'
const PENDING_CLEANUP_MAX = 200

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
    // 文件合格才顺手把之前没删掉的孤儿对象重试一遍（被拒的上传不额外查库）；重试本身失败不影响这次上传。
    await this.drainPendingCleanup().catch((error: unknown) =>
      this.logger.warn(`BRAND_LOGO_ORPHAN_DRAIN_FAILED error=${errorText(error)}`),
    )
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
      // 记账失败就把刚落盘的对象收回，别留下没有登记的文件；收不回来要留下可追踪的记录，不能悄悄吞掉。
      await this.removeOrphan(storageKey, error)
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

  /** 删孤儿对象；删不掉就记日志并进待清理清单（记清单本身失败也要有日志，最后一道留痕）。 */
  private async removeOrphan(storageKey: string, cause: unknown): Promise<void> {
    try {
      await this.storage.deleteObject(storageKey)
      return
    } catch (cleanupError) {
      this.logger.error(
        `BRAND_LOGO_ORPHAN_OBJECT key=${storageKey} dbError=${errorText(cause)} cleanupError=${errorText(cleanupError)}`,
      )
    }
    try {
      const pending = await this.readPending()
      if (!pending.includes(storageKey) && pending.length < PENDING_CLEANUP_MAX) {
        await this.writePending([...pending, storageKey])
      } else if (pending.length >= PENDING_CLEANUP_MAX) {
        this.logger.error(`BRAND_LOGO_ORPHAN_LIST_FULL key=${storageKey} size=${pending.length}`)
      }
    } catch (recordError) {
      this.logger.error(`BRAND_LOGO_ORPHAN_UNRECORDED key=${storageKey} error=${errorText(recordError)}`)
    }
  }

  /** 重试删除清单里的孤儿对象，返回仍然没删掉的数量。 */
  async drainPendingCleanup(): Promise<number> {
    const pending = await this.readPending()
    if (pending.length === 0) return 0
    const remaining: string[] = []
    for (const key of pending) {
      try {
        await this.storage.deleteObject(key)
      } catch (error) {
        remaining.push(key)
        this.logger.warn(`BRAND_LOGO_ORPHAN_RETRY_FAILED key=${key} error=${errorText(error)}`)
      }
    }
    if (remaining.length !== pending.length) await this.writePending(remaining)
    return remaining.length
  }

  private async readPending(): Promise<string[]> {
    const row = await this.prisma.platformSetting.findUnique({ where: { key: BRAND_LOGO_PENDING_CLEANUP_KEY } })
    if (!row?.value) return []
    try {
      const parsed: unknown = JSON.parse(row.value)
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
    } catch {
      return []
    }
  }

  private async writePending(keys: string[]): Promise<void> {
    await this.prisma.platformSetting.upsert({
      where: { key: BRAND_LOGO_PENDING_CLEANUP_KEY },
      create: { key: BRAND_LOGO_PENDING_CLEANUP_KEY, value: JSON.stringify(keys), updatedBy: null },
      update: { value: JSON.stringify(keys) },
    })
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

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
