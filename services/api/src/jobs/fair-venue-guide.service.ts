import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService, type PrismaTransactionClient } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import type { SaveVenueGuideDto } from './dto/venue-guide.dto'

// ============================================================
// FairVenueGuideService — 场馆导览配置(Admin 写 / Kiosk 只读)
//
// 从 AdminFairsService 拆出,行为零变化。
// 合规:只做会场位置导览与信息查看;企业绑定校验必须属于本招聘会(FairCompany),
// 不复制企业信息;Kiosk DTO 不含内部审计字段。
// ============================================================

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

@Injectable()
export class FairVenueGuideService {
  private readonly logger = new Logger(FairVenueGuideService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── 场馆导览(Venue Guide):Admin 配置 / Kiosk 只读 ─────────────────────────

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

  // ── 私有 helpers ─────────────────────────────────────────────────────────────

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

  private throwFairNotFound(fairId: string): never {
    throw new NotFoundException({ error: { code: 'FAIR_NOT_FOUND', message: `Fair ${fairId} not found` } })
  }

  private async assertFairExists(fairId: string) {
    const fair = await this.prisma.jobFair.findUnique({ where: { id: fairId } })
    if (!fair) this.throwFairNotFound(fairId)
    return fair
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
