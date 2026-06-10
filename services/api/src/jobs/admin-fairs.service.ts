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
import { mapFair, mapFairCompany, mapFairZone } from './fair.mapper'
import type { Fair, FairCompany, FairZone } from './fair.types'
import { signFairMaterialPreviewUrl, signFairMaterialUrl } from './fair-material-signing'
import type { UpdateFairInfoDto, SaveFairCompanyDto, SaveFairZoneDto, UpdateFairMaterialDto } from './dto/admin-fair.dto'
import type { PublishAction } from './dto/publish.dto'

// ============================================================
// AdminFairsService — 阶段1A:Admin 招聘会管理(内容维护)
//
// 与 JobsService 的审核/发布(fair-sources)分工:
//   - fair-sources(JobsService):合作机构导入数据的 审核(approve/reject)与 发布(publish/unpublish)
//   - 本服务(admin/fairs):招聘会"内容运营" —— 基本信息修订、参展企业、展区、活动资料、统计
//
// 合规:
//   - 只维护展示信息与现场服务资料,不含简历 / 候选人 / 报名 / 面试任何字段
//   - 来源字段(sourceOrgId/externalId/sourceName/sourceUrl)不可修改,保持可溯源
//   - 所有写操作落 AuditLog
//   - 资料文件经 StorageService 落地,Kiosk 只拿 HMAC 签名短时 URL,不暴露存储路径
// ============================================================

/** 资料文件上限(打印用 PDF / 图片,20MB 足够,防 OOM/DoS)。 */
export const FAIR_MATERIAL_MAX_BYTES = 20 * 1024 * 1024

/** 允许的资料 MIME(可打印格式;Word 需先转 PDF 再上传)。 */
const MATERIAL_ALLOWED_MIME = new Set(['application/pdf', 'image/png', 'image/jpeg'])

/** 魔数校验:防 MIME 伪装。 */
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

export interface AdminFairListItem extends Fair {
  counts: { companies: number; zones: number; materials: number }
}

export interface AdminFairDetail {
  fair: Fair
  companies: FairCompany[]
  zones: FairZone[]
  materials: FairMaterialDto[]
}

/** 真实可得的统计聚合(无签到/展位模型,绝不编造对应字段)。 */
export interface AdminFairStats {
  fairId: string
  companyTotal: number
  zoneTotal: number
  materialTotal: number
  materialPublished: number
  materialPrintCount: number
  /** 来源同步快照(展示参考,非真相之源) */
  snapshot: { companyCount: number; jobCount: number; viewCount: number }
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
export class AdminFairsService {
  private readonly logger = new Logger(AdminFairsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  // ── 招聘会列表 / 详情 / 基本信息 ───────────────────────────────────────────

  async listFairs(): Promise<AdminFairListItem[]> {
    const rows = await this.prisma.jobFair.findMany({
      orderBy: { startAt: 'desc' },
      include: { _count: { select: { companies: true, zones: true } } },
    })
    // materials 需排除软删行,_count 不支持过滤 → groupBy 一次拿齐
    const materialCounts = await this.prisma.fairMaterial.groupBy({
      by: ['jobFairId'],
      where: { deletedAt: null },
      _count: { _all: true },
    })
    const matByFair = new Map(materialCounts.map((m) => [m.jobFairId, m._count._all]))
    return rows.map((f) => ({
      ...mapFair(f),
      counts: {
        companies: f._count.companies,
        zones: f._count.zones,
        materials: matByFair.get(f.id) ?? 0,
      },
    }))
  }

  async getFairDetail(fairId: string): Promise<AdminFairDetail> {
    const f = await this.prisma.jobFair.findUnique({
      where: { id: fairId },
      include: {
        companies: { orderBy: { jobsCount: 'desc' } },
        zones: { orderBy: { sortOrder: 'asc' } },
        materials: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' } },
      },
    })
    if (!f) this.throwFairNotFound(fairId)
    return {
      fair: mapFair(f),
      companies: f.companies.map(mapFairCompany),
      zones: f.zones.map(mapFairZone),
      // Admin 详情含 draft/unpublished 资料,预览走短 TTL 签名 URL
      materials: f.materials.map((m) => mapMaterial(m, signFairMaterialPreviewUrl(m.id))),
    }
  }

  async updateFairInfo(fairId: string, dto: UpdateFairInfoDto, user: AuthedUser): Promise<Fair> {
    const fair = await this.prisma.jobFair.findUnique({ where: { id: fairId } })
    if (!fair) this.throwFairNotFound(fairId)

    const startAt = dto.startAt ? new Date(dto.startAt) : fair.startAt
    const endAt = dto.endAt ? new Date(dto.endAt) : fair.endAt
    if (startAt >= endAt) {
      throw new BadRequestException({ error: { code: 'INVALID_TIME_RANGE', message: '开始时间必须早于结束时间' } })
    }

    const changedFields = Object.keys(dto).filter((k) => (dto as Record<string, unknown>)[k] !== undefined)
    const updated = await this.prisma.jobFair.update({
      where: { id: fairId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.theme !== undefined ? { theme: dto.theme } : {}),
        ...(dto.startAt !== undefined ? { startAt } : {}),
        ...(dto.endAt !== undefined ? { endAt } : {}),
        ...(dto.venue !== undefined ? { venue: dto.venue } : {}),
        ...(dto.city !== undefined ? { city: dto.city } : {}),
        ...(dto.address !== undefined ? { address: dto.address } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.mapImageUrl !== undefined ? { mapImageUrl: dto.mapImageUrl } : {}),
        ...(dto.coverImageUrl !== undefined ? { coverImageUrl: dto.coverImageUrl } : {}),
      },
    })
    await this.audit.write({
      actorId: user.userId,
      actorRole: 'admin',
      action: 'fair.update',
      targetType: 'fair',
      targetId: fairId,
      payload: { changedFields },
    })
    this.logger.log(`updateFairInfo: id=${fairId} fields=${changedFields.join(',')} by=${user.userId}`)
    return mapFair(updated)
  }

  // ── 参展企业 CRUD ───────────────────────────────────────────────────────────

  async createCompany(fairId: string, dto: SaveFairCompanyDto, user: AuthedUser): Promise<FairCompany> {
    await this.assertFairExists(fairId)
    const created = await this.prisma.fairCompany.create({
      data: {
        jobFairId: fairId,
        name: dto.name,
        industry: dto.industry ?? null,
        scale: dto.scale ?? null,
        description: dto.description ?? null,
        sourceUrl: dto.sourceUrl ?? null,
        logoUrl: dto.logoUrl ?? null,
        hiringTags: dto.hiringTags ?? '',
        jobsCount: dto.jobsCount ?? 0,
      },
    })
    await this.writeFairAudit(user, 'fair.company.create', fairId, { companyId: created.id, name: dto.name })
    return mapFairCompany(created)
  }

  async updateCompany(fairId: string, companyId: string, dto: SaveFairCompanyDto, user: AuthedUser): Promise<FairCompany> {
    await this.assertCompanyInFair(fairId, companyId)
    const updated = await this.prisma.fairCompany.update({
      where: { id: companyId },
      data: {
        name: dto.name,
        industry: dto.industry ?? null,
        scale: dto.scale ?? null,
        description: dto.description ?? null,
        sourceUrl: dto.sourceUrl ?? null,
        logoUrl: dto.logoUrl ?? null,
        hiringTags: dto.hiringTags ?? '',
        jobsCount: dto.jobsCount ?? 0,
      },
    })
    await this.writeFairAudit(user, 'fair.company.update', fairId, { companyId, name: dto.name })
    return mapFairCompany(updated)
  }

  async deleteCompany(fairId: string, companyId: string, user: AuthedUser): Promise<{ success: true }> {
    const company = await this.assertCompanyInFair(fairId, companyId)
    await this.prisma.fairCompany.delete({ where: { id: companyId } })
    await this.writeFairAudit(user, 'fair.company.delete', fairId, { companyId, name: company.name })
    return { success: true }
  }

  // ── 展区 CRUD ───────────────────────────────────────────────────────────────

  async createZone(fairId: string, dto: SaveFairZoneDto, user: AuthedUser): Promise<FairZone> {
    await this.assertFairExists(fairId)
    const created = await this.prisma.fairZone.create({
      data: {
        jobFairId: fairId,
        name: dto.name,
        category: dto.category ?? null,
        city: dto.city ?? null,
        description: dto.description ?? null,
        coverImageUrl: dto.coverImageUrl ?? null,
        sortOrder: dto.sortOrder ?? 0,
      },
    })
    await this.writeFairAudit(user, 'fair.zone.create', fairId, { zoneId: created.id, name: dto.name })
    return mapFairZone(created)
  }

  async updateZone(fairId: string, zoneId: string, dto: SaveFairZoneDto, user: AuthedUser): Promise<FairZone> {
    await this.assertZoneInFair(fairId, zoneId)
    const updated = await this.prisma.fairZone.update({
      where: { id: zoneId },
      data: {
        name: dto.name,
        category: dto.category ?? null,
        city: dto.city ?? null,
        description: dto.description ?? null,
        coverImageUrl: dto.coverImageUrl ?? null,
        sortOrder: dto.sortOrder ?? 0,
      },
    })
    await this.writeFairAudit(user, 'fair.zone.update', fairId, { zoneId, name: dto.name })
    return mapFairZone(updated)
  }

  async deleteZone(fairId: string, zoneId: string, user: AuthedUser): Promise<{ success: true }> {
    const zone = await this.assertZoneInFair(fairId, zoneId)
    await this.prisma.fairZone.delete({ where: { id: zoneId } })
    await this.writeFairAudit(user, 'fair.zone.delete', fairId, { zoneId, name: zone.name })
    return { success: true }
  }

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

  // ── 统计(仅真实可得字段)──────────────────────────────────────────────────

  async getAdminStats(fairId: string): Promise<AdminFairStats> {
    const fair = await this.assertFairExists(fairId)
    const [companyTotal, zoneTotal, materialTotal, materialPublished, printAgg] = await Promise.all([
      this.prisma.fairCompany.count({ where: { jobFairId: fairId } }),
      this.prisma.fairZone.count({ where: { jobFairId: fairId } }),
      this.prisma.fairMaterial.count({ where: { jobFairId: fairId, deletedAt: null } }),
      this.prisma.fairMaterial.count({ where: { jobFairId: fairId, deletedAt: null, publishStatus: 'published' } }),
      this.prisma.fairMaterial.aggregate({ where: { jobFairId: fairId, deletedAt: null }, _sum: { printCount: true } }),
    ])
    return {
      fairId,
      companyTotal,
      zoneTotal,
      materialTotal,
      materialPublished,
      materialPrintCount: printAgg._sum.printCount ?? 0,
      snapshot: { companyCount: fair.companyCount, jobCount: fair.jobCount, viewCount: fair.viewCount },
    }
  }

  // ── Kiosk 公开读(只放出已发布)────────────────────────────────────────────

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

  // ── 内部断言 / 审计 helpers ─────────────────────────────────────────────────

  private throwFairNotFound(fairId: string): never {
    throw new NotFoundException({ error: { code: 'FAIR_NOT_FOUND', message: `Fair ${fairId} not found` } })
  }

  private async assertFairExists(fairId: string) {
    const fair = await this.prisma.jobFair.findUnique({ where: { id: fairId } })
    if (!fair) this.throwFairNotFound(fairId)
    return fair
  }

  private async assertCompanyInFair(fairId: string, companyId: string) {
    const company = await this.prisma.fairCompany.findFirst({ where: { id: companyId, jobFairId: fairId } })
    if (!company) {
      throw new NotFoundException({ error: { code: 'COMPANY_NOT_FOUND', message: `Company ${companyId} not found in fair ${fairId}` } })
    }
    return company
  }

  private async assertZoneInFair(fairId: string, zoneId: string) {
    const zone = await this.prisma.fairZone.findFirst({ where: { id: zoneId, jobFairId: fairId } })
    if (!zone) {
      throw new NotFoundException({ error: { code: 'ZONE_NOT_FOUND', message: `Zone ${zoneId} not found in fair ${fairId}` } })
    }
    return zone
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
