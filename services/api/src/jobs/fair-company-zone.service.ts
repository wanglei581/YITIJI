import {
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import { mapFairCompany, mapFairZone } from './fair.mapper'
import type { FairCompany, FairZone } from './fair.types'
import type { SaveFairCompanyDto, SaveFairCompanyPositionDto, SaveFairZoneDto } from './dto/admin-fair.dto'

// ============================================================
// FairCompanyZoneService — 参展企业 & 展区 CRUD
//
// 从 AdminFairsService 拆出,行为零变化。
// 合规:只维护展示信息,不含简历/候选人/报名/面试字段。
// ============================================================

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

@Injectable()
export class FairCompanyZoneService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

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

  // ── 私有 helpers ─────────────────────────────────────────────────────────────

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
