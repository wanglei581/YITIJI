import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { StorageService } from '../storage/storage.service'
import { generateObjectKey } from '../storage/object-key'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import { signFairMaterialPreviewUrl, signFairMaterialUrl } from './fair-material-signing'
import type { UpdateFairMaterialDto } from './dto/admin-fair.dto'
import type { PublishAction } from './dto/publish.dto'
import { FairMaterialPrintBridgeService, type FairMaterialPrintView } from './fair-material-print-bridge.service'

// ============================================================
// FairMaterialService — 活动资料管理(上传/更新/发布/删除/读取)
//
// 从 AdminFairsService 拆出,行为零变化。
// 合规:资料文件经 StorageService 落地,Kiosk 只拿 HMAC 签名短时 URL,不暴露存储路径。
// ============================================================

/** 资料文件上限(打印用 PDF / 图片,20MB 足够,防 OOM/DoS)。 */
export const FAIR_MATERIAL_MAX_BYTES = 20 * 1024 * 1024

/** 允许的资料 MIME(可打印格式;Word 需先转 PDF 再上传)。 */
const MATERIAL_ALLOWED_MIME = new Set(['application/pdf', 'image/png', 'image/jpeg'])

/**
 * 魔数校验:防 MIME 伪装。
 * TODO(收敛): 与 files/content-sniff.ts(FileObject 管线共享嗅探器)逻辑重复;
 * 未来以 content-sniff.ts 为唯一实现收敛,本轮刻意不改行为。
 */
function sniffMaterialMime(buffer: Buffer): string | null {
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf'
  if (buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png'
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  return null
}

function extForMime(mime: string): string {
  if (mime === 'application/pdf') return 'pdf'
  if (mime === 'image/png') return 'png'
  return 'jpg'
}

/** 与 shared FairMaterialDTO 对齐的资料 DTO(契约源 packages/shared/src/types/fairDto.ts)。 */
export interface FairMaterialDto {
  id: string
  fairId: string
  name: string
  type: string
  description?: string
  pageCount: number
  fileSizeKB: number
  printCount: number
  previewUrl?: string
  allowPrint: boolean
  publishStatus: string
  updatedAt?: string
}

interface PrismaFairMaterialRow {
  id: string
  jobFairId: string
  name: string
  type: string
  description: string | null
  sizeBytes: number
  pageCount: number
  printCount: number
  allowPrint: boolean
  publishStatus: string
  updatedAt: Date
}

function mapMaterial(m: PrismaFairMaterialRow, previewUrl?: string): FairMaterialDto {
  return {
    id: m.id,
    fairId: m.jobFairId,
    name: m.name,
    type: m.type,
    description: m.description ?? undefined,
    pageCount: m.pageCount,
    fileSizeKB: Math.max(1, Math.round(m.sizeBytes / 1024)),
    printCount: m.printCount,
    previewUrl,
    allowPrint: m.allowPrint,
    publishStatus: m.publishStatus,
    updatedAt: m.updatedAt.toISOString(),
  }
}

@Injectable()
export class FairMaterialService {
  private readonly logger = new Logger(FairMaterialService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly printBridges: FairMaterialPrintBridgeService,
  ) {}

  // ── 活动资料 ────────────────────────────────────────────────────────────────

  async uploadMaterial(args: {
    fairId: string
    buffer: Buffer
    declaredMime: string
    name: string
    type?: string
    description?: string
    pageCount?: number
    user: AuthedUser
  }): Promise<FairMaterialDto> {
    const fair = await this.assertFairExists(args.fairId)

    if (args.buffer.length > FAIR_MATERIAL_MAX_BYTES) {
      throw new BadRequestException({
        error: { code: 'MATERIAL_TOO_LARGE', message: `资料文件不得超过 ${Math.round(FAIR_MATERIAL_MAX_BYTES / 1024 / 1024)}MB` },
      })
    }
    const sniffed = sniffMaterialMime(args.buffer)
    if (!sniffed || !MATERIAL_ALLOWED_MIME.has(sniffed)) {
      throw new BadRequestException({
        error: { code: 'MATERIAL_TYPE_UNSUPPORTED', message: '仅支持 PDF / PNG / JPEG 资料文件(Word 请先转为 PDF)' },
      })
    }
    if (MATERIAL_ALLOWED_MIME.has(args.declaredMime) && args.declaredMime !== sniffed) {
      throw new BadRequestException({
        error: { code: 'MATERIAL_TYPE_MISMATCH', message: '文件内容与声明类型不一致' },
      })
    }

    // 先建行拿 cuid 作为 storageKey 文件名,再落对象存储,失败则回滚行。
    const created = await this.prisma.fairMaterial.create({
      data: {
        jobFairId: args.fairId,
        name: args.name,
        type: args.type ?? 'other',
        description: args.description ?? null,
        storageKey: `pending:${args.fairId}:${Date.now()}`,
        mimeType: sniffed,
        sizeBytes: args.buffer.length,
        sha256: '',
        pageCount: args.pageCount ?? 0,
        createdBy: args.user.userId,
      },
    })
    const storageKey = generateObjectKey({
      purpose: 'fair_material',
      ownerType: 'partner',
      ownerId: fair.sourceOrgId,
      fileId: created.id,
      ext: extForMime(sniffed),
    })
    try {
      const { sha256 } = await this.storage.putObject(storageKey, args.buffer, sniffed)
      const updated = await this.prisma.fairMaterial.update({
        where: { id: created.id },
        data: { storageKey, sha256 },
      })
      await this.writeFairAudit(args.user, 'fair.material.upload', args.fairId, {
        materialId: created.id,
        name: args.name,
        type: args.type ?? 'other',
        sizeBytes: args.buffer.length,
      })
      return mapMaterial(updated, signFairMaterialPreviewUrl(updated.id))
    } catch (e) {
      await this.prisma.fairMaterial.delete({ where: { id: created.id } }).catch(() => undefined)
      this.logger.error(`uploadMaterial storage failed: fair=${args.fairId}`, e as Error)
      throw e
    }
  }

  async updateMaterial(fairId: string, materialId: string, dto: UpdateFairMaterialDto, user: AuthedUser): Promise<FairMaterialDto> {
    await this.assertMaterialInFair(fairId, materialId)
    const updated = await this.prisma.fairMaterial.update({
      where: { id: materialId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.pageCount !== undefined ? { pageCount: dto.pageCount } : {}),
        ...(dto.allowPrint !== undefined ? { allowPrint: dto.allowPrint } : {}),
      },
    })
    if (dto.allowPrint === false) await this.printBridges.revokeForMaterial(materialId, 'printing_disabled')
    await this.writeFairAudit(user, 'fair.material.update', fairId, { materialId })
    return mapMaterial(updated, signFairMaterialPreviewUrl(updated.id))
  }

  async publishMaterial(fairId: string, materialId: string, action: PublishAction, user: AuthedUser): Promise<FairMaterialDto> {
    const material = await this.assertMaterialInFair(fairId, materialId)
    const toStatus = action === 'publish' ? 'published' : 'unpublished'
    const updated = await this.prisma.fairMaterial.update({
      where: { id: materialId },
      data: { publishStatus: toStatus },
    })
    if (action === 'unpublish') await this.printBridges.revokeForMaterial(materialId, 'material_unpublished')
    await this.writeFairAudit(user, 'fair.material.publish', fairId, {
      materialId,
      action,
      fromPublishStatus: material.publishStatus,
      toPublishStatus: toStatus,
    })
    return mapMaterial(updated, signFairMaterialPreviewUrl(updated.id))
  }

  /** 删除资料:物理删对象 + 软删行(保留删除审计线索,符合 CLAUDE.md §11 删除留痕)。 */
  async deleteMaterial(fairId: string, materialId: string, user: AuthedUser): Promise<{ success: true }> {
    const material = await this.assertMaterialInFair(fairId, materialId)
    await this.printBridges.revokeForMaterial(materialId, 'material_deleted')
    if (!material.storageKey.startsWith('pending:')) {
      await this.storage.deleteObject(material.storageKey).catch((e: unknown) => {
        // 对象缺失不阻断删除(可能已被清理);其余错误记日志后继续软删
        this.logger.warn(`deleteMaterial storage delete failed: ${material.id} ${(e as Error).message}`)
      })
    }
    await this.prisma.fairMaterial.update({
      where: { id: materialId },
      data: { deletedAt: new Date(), publishStatus: 'unpublished' },
    })
    await this.writeFairAudit(user, 'fair.material.delete', fairId, { materialId, name: material.name })
    return { success: true }
  }

  /** Kiosk 活动资料列表:招聘会须 approved+published,资料须 published 且未删。 */
  async getPublishedFairMaterials(
    fairId: string,
    page: number,
    pageSize: number,
  ): Promise<{ data: FairMaterialDto[]; total: number; page: number; pageSize: number }> {
    const fair = await this.prisma.jobFair.findFirst({
      where: { id: fairId, reviewStatus: 'approved', publishStatus: 'published' },
      select: { id: true },
    })
    if (!fair) return { data: [], total: 0, page, pageSize }

    const where = { jobFairId: fairId, deletedAt: null, publishStatus: 'published' }
    const [rows, total] = await Promise.all([
      this.prisma.fairMaterial.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.fairMaterial.count({ where }),
    ])
    return {
      data: rows.map((m) => mapMaterial(m, signFairMaterialUrl(m.id).url)),
      total,
      page,
      pageSize,
    }
  }

  /**
   * 将独立 FairMaterial 转为可复用的短期派生 FileObject，供 PrintJobs 统一验签与计费。
   * 不复用 materialId 冒充 fileId，也不放宽 PrintJobs 的 /files/:id/content 白名单。
   */
  async prepareFairMaterialPrint(fairId: string, materialId: string): Promise<FairMaterialPrintView> {
    return this.printBridges.prepare(fairId, materialId)
  }

  /** 签名内容流读取(签名已在 controller 验过)。 */
  async readMaterialContent(materialId: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const material = await this.prisma.fairMaterial.findFirst({
      where: { id: materialId, deletedAt: null },
    })
    if (!material || material.storageKey.startsWith('pending:')) {
      throw new NotFoundException({ error: { code: 'MATERIAL_NOT_FOUND', message: '资料不存在' } })
    }
    const buffer = await this.storage.getObject(material.storageKey)
    return { buffer, mimeType: material.mimeType }
  }

  // ── 私有 helpers ─────────────────────────────────────────────────────────────

  private throwFairNotFound(fairId: string): never {
    throw new NotFoundException({ error: { code: 'FAIR_NOT_FOUND', message: `Fair ${fairId} not found` } })
  }

  private async assertFairExists(fairId: string) {
    const fair = await this.prisma.jobFair.findUnique({ where: { id: fairId } })
    if (!fair) this.throwFairNotFound(fairId)
    return fair
  }

  private async assertMaterialInFair(fairId: string, materialId: string) {
    const material = await this.prisma.fairMaterial.findFirst({
      where: { id: materialId, jobFairId: fairId, deletedAt: null },
    })
    if (!material) {
      throw new NotFoundException({ error: { code: 'MATERIAL_NOT_FOUND', message: `Material ${materialId} not found in fair ${fairId}` } })
    }
    return material
  }

  private async writeFairAudit(user: AuthedUser, action: string, fairId: string, payload: Record<string, unknown>): Promise<void> {
    await this.audit.write({
      actorId: user.userId,
      actorRole: 'admin',
      action,
      targetType: 'fair',
      targetId: fairId,
      payload,
    })
  }
}
