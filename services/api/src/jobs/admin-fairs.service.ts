import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import { mapFair, mapFairCompany, mapFairZone } from './fair.mapper'
import type { Fair, FairCompany, FairZone } from './fair.types'
import { signFairMaterialPreviewUrl } from './fair-material-signing'
import type { UpdateFairInfoDto, SaveFairCompanyDto, SaveFairZoneDto, UpdateFairMaterialDto } from './dto/admin-fair.dto'
import type { SaveVenueGuideDto } from './dto/venue-guide.dto'
import type { PublishAction } from './dto/publish.dto'
import type { FairMaterialPrintView } from './fair-material-print-bridge.service'
import { FairCompanyZoneService } from './fair-company-zone.service'
import { FairMaterialService } from './fair-material.service'
import { FairVenueGuideService } from './fair-venue-guide.service'

// Re-export so existing imports from this file keep working.
export { FAIR_MATERIAL_MAX_BYTES } from './fair-material.service'
export type { FairMaterialDto } from './fair-material.service'
export type { FairVenueGuideDto } from './fair-venue-guide.service'

// ============================================================
// AdminFairsService — 门面聚合层(N5/N6 拆分后)
//
// 公共 API 完全不变,行为零变化。
// 核心职责:
//   listFairs / getFairDetail / updateFairInfo / getAdminStats — 直接实现
//   参展企业/展区 CRUD      → 委托 FairCompanyZoneService
//   活动资料 CRUD + 读取    → 委托 FairMaterialService
//   场馆导览配置 / Kiosk 读 → 委托 FairVenueGuideService
// ============================================================

export interface AdminFairListItem extends Fair {
  counts: { companies: number; zones: number; materials: number }
}

export interface AdminFairDetail {
  fair: Fair
  companies: FairCompany[]
  zones: FairZone[]
  materials: import('./fair-material.service').FairMaterialDto[]
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

function mapMaterial(m: PrismaFairMaterialRow, previewUrl?: string): import('./fair-material.service').FairMaterialDto {
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
    private readonly companyZone: FairCompanyZoneService,
    private readonly material: FairMaterialService,
    private readonly venueGuide: FairVenueGuideService,
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
        companies: { orderBy: { jobsCount: 'desc' }, include: { positions: { orderBy: { sortOrder: 'asc' } } } },
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
    // seekerIntent: 过滤空标签行 → 序列化为 seekerIntentJson;清空(空数组/全空行)写 null。
    const seekerIntentJson =
      dto.seekerIntent === undefined
        ? undefined
        : ((): string | null => {
            const cleaned = dto.seekerIntent.filter((s) => s.label.trim().length > 0)
            return cleaned.length
              ? JSON.stringify(cleaned.map((s) => ({ label: s.label.trim(), percent: s.percent })))
              : null
          })()
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
        ...(dto.latitude !== undefined ? { latitude: dto.latitude } : {}),
        ...(dto.longitude !== undefined ? { longitude: dto.longitude } : {}),
        ...(dto.trafficInfo !== undefined ? { trafficInfo: dto.trafficInfo === '' ? null : dto.trafficInfo } : {}),
        ...(dto.expectedAttendance !== undefined ? { expectedAttendance: dto.expectedAttendance } : {}),
        ...(seekerIntentJson !== undefined ? { seekerIntentJson } : {}),
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

  // ── 参展企业 CRUD — 委托 FairCompanyZoneService ─────────────────────────────

  async createCompany(fairId: string, dto: SaveFairCompanyDto, user: AuthedUser): Promise<FairCompany> {
    return this.companyZone.createCompany(fairId, dto, user)
  }

  async updateCompany(fairId: string, companyId: string, dto: SaveFairCompanyDto, user: AuthedUser): Promise<FairCompany> {
    return this.companyZone.updateCompany(fairId, companyId, dto, user)
  }

  async deleteCompany(fairId: string, companyId: string, user: AuthedUser): Promise<{ success: true }> {
    return this.companyZone.deleteCompany(fairId, companyId, user)
  }

  // ── 展区 CRUD — 委托 FairCompanyZoneService ─────────────────────────────────

  async createZone(fairId: string, dto: SaveFairZoneDto, user: AuthedUser): Promise<FairZone> {
    return this.companyZone.createZone(fairId, dto, user)
  }

  async updateZone(fairId: string, zoneId: string, dto: SaveFairZoneDto, user: AuthedUser): Promise<FairZone> {
    return this.companyZone.updateZone(fairId, zoneId, dto, user)
  }

  async deleteZone(fairId: string, zoneId: string, user: AuthedUser): Promise<{ success: true }> {
    return this.companyZone.deleteZone(fairId, zoneId, user)
  }

  // ── 活动资料 — 委托 FairMaterialService ────────────────────────────────────

  async uploadMaterial(args: {
    fairId: string
    buffer: Buffer
    declaredMime: string
    name: string
    type?: string
    description?: string
    pageCount?: number
    user: AuthedUser
  }): Promise<import('./fair-material.service').FairMaterialDto> {
    return this.material.uploadMaterial(args)
  }

  async updateMaterial(fairId: string, materialId: string, dto: UpdateFairMaterialDto, user: AuthedUser): Promise<import('./fair-material.service').FairMaterialDto> {
    return this.material.updateMaterial(fairId, materialId, dto, user)
  }

  async publishMaterial(fairId: string, materialId: string, action: PublishAction, user: AuthedUser): Promise<import('./fair-material.service').FairMaterialDto> {
    return this.material.publishMaterial(fairId, materialId, action, user)
  }

  async deleteMaterial(fairId: string, materialId: string, user: AuthedUser): Promise<{ success: true }> {
    return this.material.deleteMaterial(fairId, materialId, user)
  }

  async getPublishedFairMaterials(
    fairId: string,
    page: number,
    pageSize: number,
  ): Promise<{ data: import('./fair-material.service').FairMaterialDto[]; total: number; page: number; pageSize: number }> {
    return this.material.getPublishedFairMaterials(fairId, page, pageSize)
  }

  async prepareFairMaterialPrint(fairId: string, materialId: string): Promise<FairMaterialPrintView> {
    return this.material.prepareFairMaterialPrint(fairId, materialId)
  }

  async readMaterialContent(materialId: string): Promise<{ buffer: Buffer; mimeType: string }> {
    return this.material.readMaterialContent(materialId)
  }

  // ── 场馆导览 — 委托 FairVenueGuideService ──────────────────────────────────

  async getVenueGuideAdmin(fairId: string): Promise<{ data: import('./fair-venue-guide.service').FairVenueGuideDto | null }> {
    return this.venueGuide.getVenueGuideAdmin(fairId)
  }

  async saveVenueGuide(fairId: string, dto: SaveVenueGuideDto, user: AuthedUser): Promise<import('./fair-venue-guide.service').FairVenueGuideDto> {
    return this.venueGuide.saveVenueGuide(fairId, dto, user)
  }

  async deleteVenueGuide(fairId: string, user: AuthedUser): Promise<{ success: true }> {
    return this.venueGuide.deleteVenueGuide(fairId, user)
  }

  async getPublishedVenueGuide(fairId: string): Promise<{ data: import('./fair-venue-guide.service').FairVenueGuideDto | null }> {
    return this.venueGuide.getPublishedVenueGuide(fairId)
  }

  // ── 内部断言 helpers(仅供本类直接实现方法使用)──────────────────────────────

  private throwFairNotFound(fairId: string): never {
    throw new NotFoundException({ error: { code: 'FAIR_NOT_FOUND', message: `Fair ${fairId} not found` } })
  }

  private async assertFairExists(fairId: string) {
    const fair = await this.prisma.jobFair.findUnique({ where: { id: fairId } })
    if (!fair) this.throwFairNotFound(fairId)
    return fair
  }
}
