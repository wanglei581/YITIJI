import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService, type PrismaTransactionClient } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { StorageService } from '../storage/storage.service'

import { generateObjectKey } from '../storage/object-key'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import { mapFair, mapFairCompany, mapFairZone } from './fair.mapper'
import type { Fair, FairCompany, FairZone } from './fair.types'
import { signFairMaterialPreviewUrl, signFairMaterialUrl } from './fair-material-signing'
import type { UpdateFairInfoDto, SaveFairCompanyDto, SaveFairCompanyPositionDto, SaveFairZoneDto, UpdateFairMaterialDto } from './dto/admin-fair.dto'
import type { SaveVenueGuideDto } from './dto/venue-guide.dto'
import type { PublishAction } from './dto/publish.dto'
import { FairMaterialPrintBridgeService, type FairMaterialPrintView } from './fair-material-print-bridge.service'

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

/**
 * 参展企业岗位明细 → Prisma nested create 数据。
 * 过滤空标题行(服务端兜底,前端也过滤),sortOrder 按入参顺序写入。
 */
function buildPositionCreates(positions: SaveFairCompanyPositionDto[]) {
  return positions
    .filter((p) => p.title.trim().length > 0)
    .map((p, i) => ({
      title: p.title.trim(),
      headcount: p.headcount ?? 0,
      salary: p.salary ?? null,
      requirements: p.requirements ?? null,
      education: p.education ?? null,
      experience: p.experience ?? null,
      location: p.location ?? null,
      positionType: p.positionType ?? null,
      department: p.department ?? null,
      sortOrder: i,
    }))
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

/** 场馆导览 DTO(契约源 packages/shared/src/types/fairDto.ts FairVenueGuideDTO)。 */
export interface FairVenueGuideDto {
  fairId: string
  venueName: string
  halls: Array<{
    hallId: string
    hallCode: string
    hallName: string
    industryCategory?: string
    description?: string
    boothRange?: string
    companyCount: number
    companies: Array<{
      companyId: string
      companyName: string
      boothNo?: string
      industry?: string
      jobCount: number
      jobTitles: string[]
    }>
  }>
  facilities: Array<{
    id: string
    type: 'entrance' | 'serviceDesk' | 'printPoint' | 'consulting'
    name: string
    locationLabel?: string
    relatedHallCode?: string
  }>
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
    private readonly printBridges: FairMaterialPrintBridgeService,
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
        ...(dto.positions !== undefined ? { positions: { create: buildPositionCreates(dto.positions) } } : {}),
      },
      include: { positions: { orderBy: { sortOrder: 'asc' } } },
    })
    await this.writeFairAudit(user, 'fair.company.create', fairId, {
      companyId: created.id,
      name: dto.name,
      positionCount: created.positions.length,
    })
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
        // 保存即全量替换岗位明细:先删该企业全部岗位,再按表单顺序重建([] / 全空标题 → 清空)。
        ...(dto.positions !== undefined ? { positions: { deleteMany: {}, create: buildPositionCreates(dto.positions) } } : {}),
      },
      include: { positions: { orderBy: { sortOrder: 'asc' } } },
    })
    await this.writeFairAudit(user, 'fair.company.update', fairId, {
      companyId,
      name: dto.name,
      positionCount: updated.positions.length,
    })
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

  // ── 场馆导览(Venue Guide):Admin 配置 / Kiosk 只读 ─────────────────────────
  //
  // 合规:只做会场位置导览与信息查看;企业绑定校验必须属于本招聘会(FairCompany),
  // 不复制企业信息;Kiosk DTO 不含内部审计字段。

  /** Admin 读取完整配置;未配置 → data null(前端按空态处理)。 */
  async getVenueGuideAdmin(fairId: string): Promise<{ data: FairVenueGuideDto | null }> {
    await this.assertFairExists(fairId)
    return { data: await this.loadVenueGuide(fairId) }
  }

  /**
   * 整体保存(upsert + 事务性替换 halls/facilities):
   * - hallCode 去重校验(展厅编码唯一)
   * - 绑定企业必须属于本招聘会,否则 COMPANY_NOT_IN_FAIR
   */
  async saveVenueGuide(fairId: string, dto: SaveVenueGuideDto, user: AuthedUser): Promise<FairVenueGuideDto> {
    await this.assertFairExists(fairId)

    const codes = dto.halls.map((h) => h.hallCode.toUpperCase())
    if (new Set(codes).size !== codes.length) {
      throw new BadRequestException({ error: { code: 'HALL_CODE_DUPLICATE', message: '展厅编码不能重复' } })
    }

    // 设施关联展厅校验:relatedHallCode(若填)必须是本次配置中的展厅编码
    const codeSet = new Set(codes)
    for (const facility of dto.facilities) {
      const related = facility.relatedHallCode?.trim().toUpperCase()
      if (related && !codeSet.has(related)) {
        throw new BadRequestException({
          error: { code: 'FACILITY_HALL_NOT_FOUND', message: `设施「${facility.name}」关联的展厅 ${related} 不存在` },
        })
      }
    }

    // 企业禁止跨展厅重复绑定:同一企业出现在多个展厅 → 拒绝(展位语义唯一)
    const allBindings = dto.halls.flatMap((h) => h.companies.map((c) => c.fairCompanyId))
    if (new Set(allBindings).size !== allBindings.length) {
      throw new BadRequestException({
        error: { code: 'COMPANY_BOUND_MULTIPLE', message: '同一企业只能绑定到一个展厅,请先从其它展厅解绑' },
      })
    }

    // 绑定企业归属校验:全部 fairCompanyId 必须属于本招聘会
    const boundIds = [...new Set(allBindings)]
    if (boundIds.length > 0) {
      const owned = await this.prisma.fairCompany.findMany({
        where: { id: { in: boundIds }, jobFairId: fairId },
        select: { id: true },
      })
      if (owned.length !== boundIds.length) {
        const ownedSet = new Set(owned.map((c) => c.id))
        const bad = boundIds.find((id) => !ownedSet.has(id))
        throw new BadRequestException({
          error: { code: 'COMPANY_NOT_IN_FAIR', message: `企业 ${bad} 不属于本招聘会,不能绑定到展厅` },
        })
      }
    }

    // 事务性替换:upsert guide → 清空旧 halls/facilities → 重建
    await this.prisma.$transaction(async (tx: PrismaTransactionClient) => {
      const guide = await tx.fairVenueGuide.upsert({
        where: { jobFairId: fairId },
        create: { jobFairId: fairId, venueName: dto.venueName },
        update: { venueName: dto.venueName },
      })
      await tx.fairVenueHall.deleteMany({ where: { guideId: guide.id } })
      await tx.fairVenueFacility.deleteMany({ where: { guideId: guide.id } })
      for (const [i, hall] of dto.halls.entries()) {
        await tx.fairVenueHall.create({
          data: {
            guideId: guide.id,
            hallCode: hall.hallCode.toUpperCase(),
            hallName: hall.hallName,
            industryCategory: hall.industryCategory ?? null,
            description: hall.description ?? null,
            boothRange: hall.boothRange ?? null,
            sortOrder: hall.sortOrder ?? i,
            companies: {
              create: hall.companies.map((c, j) => ({
                fairCompanyId: c.fairCompanyId,
                boothNo: c.boothNo ?? null,
                sortOrder: c.sortOrder ?? j,
              })),
            },
          },
        })
      }
      for (const [i, f] of dto.facilities.entries()) {
        await tx.fairVenueFacility.create({
          data: {
            guideId: guide.id,
            type: f.type,
            name: f.name,
            locationLabel: f.locationLabel ?? null,
            relatedHallCode: f.relatedHallCode?.toUpperCase() ?? null,
            sortOrder: f.sortOrder ?? i,
          },
        })
      }
    })

    await this.writeFairAudit(user, 'fair.venue_guide.save', fairId, {
      venueName: dto.venueName,
      hallCount: dto.halls.length,
      facilityCount: dto.facilities.length,
      boundCompanyCount: boundIds.length,
    })
    this.logger.log(`saveVenueGuide: fair=${fairId} halls=${dto.halls.length} by=${user.userId}`)
    const saved = await this.loadVenueGuide(fairId)
    if (!saved) throw new InternalServerErrorException({ error: { code: 'VENUE_GUIDE_SAVE_FAILED', message: '导览保存失败' } })
    return saved
  }

  async deleteVenueGuide(fairId: string, user: AuthedUser): Promise<{ success: true }> {
    await this.assertFairExists(fairId)
    const guide = await this.prisma.fairVenueGuide.findUnique({ where: { jobFairId: fairId } })
    if (guide) {
      await this.prisma.fairVenueGuide.delete({ where: { id: guide.id } }) // halls/facilities 级联删除
      await this.writeFairAudit(user, 'fair.venue_guide.delete', fairId, { venueName: guide.venueName })
    }
    return { success: true }
  }

  /** Kiosk 公开读:招聘会须 approved+published;未配置导览 → data null(空态)。 */
  async getPublishedVenueGuide(fairId: string): Promise<{ data: FairVenueGuideDto | null }> {
    const fair = await this.prisma.jobFair.findFirst({
      where: { id: fairId, reviewStatus: 'approved', publishStatus: 'published' },
      select: { id: true },
    })
    if (!fair) return { data: null }
    return { data: await this.loadVenueGuide(fairId) }
  }

  /** 读取并组装导览 DTO(含企业岗位摘要,来自 FairCompanyPosition 真实统计)。 */
  private async loadVenueGuide(fairId: string): Promise<FairVenueGuideDto | null> {
    const guide = await this.prisma.fairVenueGuide.findUnique({
      where: { jobFairId: fairId },
      include: {
        halls: {
          orderBy: { sortOrder: 'asc' },
          include: {
            companies: {
              orderBy: { sortOrder: 'asc' },
              include: {
                fairCompany: {
                  select: {
                    id: true,
                    name: true,
                    industry: true,
                    positions: { orderBy: { sortOrder: 'asc' }, select: { title: true } },
                  },
                },
              },
            },
          },
        },
        facilities: { orderBy: { sortOrder: 'asc' } },
      },
    })
    if (!guide) return null
    return {
      fairId,
      venueName: guide.venueName,
      halls: guide.halls.map((h) => ({
        hallId: h.id,
        hallCode: h.hallCode,
        hallName: h.hallName,
        industryCategory: h.industryCategory ?? undefined,
        description: h.description ?? undefined,
        boothRange: h.boothRange ?? undefined,
        companyCount: h.companies.length,
        companies: h.companies.map((b) => ({
          companyId: b.fairCompany.id,
          companyName: b.fairCompany.name,
          boothNo: b.boothNo ?? undefined,
          industry: b.fairCompany.industry ?? undefined,
          jobCount: b.fairCompany.positions.length,
          jobTitles: b.fairCompany.positions.slice(0, 3).map((position) => position.title),
        })),
      })),
      facilities: guide.facilities.map((f) => ({
        id: f.id,
        type: f.type as FairVenueGuideDto['facilities'][number]['type'],
        name: f.name,
        locationLabel: f.locationLabel ?? undefined,
        relatedHallCode: f.relatedHallCode ?? undefined,
      })),
    }
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
