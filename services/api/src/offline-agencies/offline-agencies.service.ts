// ============================================================
// OfflineAgenciesService — G1 线下招聘机构
//
// 合规约束：
//   - Kiosk 公开端点只返回 reviewStatus=approved + publishStatus=published 的机构
//   - 线下机构只做信息展示 + 到店指引，不代收简历、不做平台内投递
//   - externalUrl 只作为到店/外部跳转入口展示，不做平台内处理
//   - Admin 可查所有机构（含草稿/待审）
//   - publish 操作前必须断言 reviewStatus === 'approved'
//   - reject 必须把 publishStatus 强制置回 draft
// ============================================================

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import type { CreateOfflineAgencyDto, UpdateOfflineAgencyDto } from './dto/create-offline-agency.dto'
import type { CreateOfflineJobDto, UpdateOfflineJobDto } from './dto/create-offline-job.dto'
import { assertOrgContentTrustActive, type OrgTrustReader } from '../common/content-trust'

export interface PaginationQuery {
  /** HTTP query 可能是 string；须经 resolveOfflineListPage 后再交给 Prisma take/skip */
  page?: number | string
  pageSize?: number | string
}

export interface AgencyListQuery extends PaginationQuery {
  district?: string
  orgType?: string
  reviewStatus?: string
  publishStatus?: string
  keyword?: string
  /** Kiosk 服务筛选（匹配 services JSON 数组中的项） */
  service?: string
}

export interface JobListQuery extends PaginationQuery {
  jobType?: string
  keyword?: string
}

/** Query string 进来是 string；Prisma skip/take 必须是 Int。负数/NaN 回退默认值。 */
function normalizePage(query: PaginationQuery): { page: number; pageSize: number; skip: number } {
  const rawPage = Number.parseInt(String(query.page ?? 1), 10)
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1
  const rawPageSize = Number.parseInt(String(query.pageSize ?? 20), 10)
  const pageSize = Math.min(100, Number.isFinite(rawPageSize) && rawPageSize > 0 ? rawPageSize : 20)
  return { page, pageSize, skip: (page - 1) * pageSize }
}

/** 供 verify 脚本导入：返回经过强制转 number + 边界保护后的 page/pageSize。 */
export function resolveOfflineListPage(query: PaginationQuery): { page: number; pageSize: number } {
  const { page, pageSize } = normalizePage(query)
  return { page, pageSize }
}

function parseServices(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String)
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return raw.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
  }
}

@Injectable()
export class OfflineAgenciesService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Kiosk 公开端点（只查已审核已发布）─────────────────────────────────────

  async findAll(query: AgencyListQuery) {
    const { page, pageSize, skip } = normalizePage(query)
    const { district, orgType, keyword, service } = query

    const where: Record<string, unknown> = {
      reviewStatus: 'approved',
      publishStatus: 'published',
      status: 'active',
    }
    if (district) where['district'] = district
    if (orgType)  where['orgType']  = orgType
    if (keyword) {
      where['OR'] = [
        { name:        { contains: keyword } },
        { address:     { contains: keyword } },
        { description: { contains: keyword } },
      ]
    }

    const [rows, total] = await Promise.all([
      this.prisma.offlineAgency.findMany({
        where: where as never,
        skip,
        take: pageSize,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        select: {
          id: true, name: true, orgType: true, address: true, district: true,
          lat: true, lng: true, openHours: true, phone: true, contactEmail: true,
          website: true, services: true, description: true, logoUrl: true,
          status: true, sourceOrgId: true, externalId: true, syncTime: true,
          createdAt: true, updatedAt: true,
        },
      }),
      this.prisma.offlineAgency.count({ where: where as never }),
    ])

    let items = rows

    if (service) {
      items = items.filter((item: (typeof items)[number]) => parseServices(item.services).includes(service))
    }

    return {
      data: items,
      total: service ? items.length : total,
      page,
      pageSize,
    }
  }

  async findOne(id: string) {
    const agency = await this.prisma.offlineAgency.findFirst({
      where: { id, reviewStatus: 'approved', publishStatus: 'published', status: 'active' },
      include: {
        jobs: {
          where: { status: 'active' },
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        },
      },
    })
    if (!agency) throw new NotFoundException(`线下机构 ${id} 不存在或未发布`)

    const services = parseServices(agency.services)
    const isOpen = agency.status === 'active'
    const data = {
      id: agency.id,
      name: agency.name,
      type: agency.orgType || 'recruitment',
      status: (isOpen ? 'open' : 'rest') as 'open' | 'rest',
      // status 只表示当前记录的收录状态，不等同于门店实时运营状态；
      // 可见文案由前端统一渲染为中性的“正常收录 / 暂停收录”。
      address: agency.address,
      district: agency.district || '',
      hours: agency.openHours || '以门店公告为准',
      services,
      orgCode: agency.externalId || agency.sourceOrgId || agency.id,
      jobCount: agency.jobs.length,
      syncTime: (agency.syncTime ?? agency.updatedAt).toISOString(),
      phone: agency.phone ?? null,
      description: agency.description ?? null,
      website: agency.website ?? null,
      jobs: agency.jobs.map((j: (typeof agency.jobs)[number]) => ({
        id: j.id,
        title: j.title,
        jobType: j.jobType ?? undefined,
        location: j.location ?? undefined,
        salaryMin: j.salaryMin ?? null,
        salaryMax: j.salaryMax ?? null,
        status: j.status,
      })),
    }
    return data
  }

  async findJobsByAgency(agencyId: string, query: JobListQuery) {
    // 先确认机构已发布
    const agency = await this.prisma.offlineAgency.findFirst({
      where: { id: agencyId, reviewStatus: 'approved', publishStatus: 'published', status: 'active' },
      select: { id: true, name: true },
    })
    if (!agency) throw new NotFoundException(`线下机构 ${agencyId} 不存在或未发布`)

    const { page, pageSize, skip } = normalizePage(query)
    const { jobType, keyword } = query

    const where: Record<string, unknown> = { agencyId, status: 'active' }
    if (jobType) where['jobType'] = jobType
    if (keyword) {
      where['OR'] = [
        { title:        { contains: keyword } },
        { description:  { contains: keyword } },
        { requirements: { contains: keyword } },
      ]
    }

    const [items, total] = await Promise.all([
      this.prisma.offlineJob.findMany({
        where: where as never,
        skip,
        take: pageSize,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      }),
      this.prisma.offlineJob.count({ where: where as never }),
    ])

    return { agencyId, agencyName: agency.name, data: items, total, page, pageSize }
  }

  async findOneJob(id: string) {
    const job = await this.prisma.offlineJob.findFirst({
      where: { id, status: 'active' },
      include: {
        agency: {
          select: {
            id: true, name: true, orgType: true, address: true, district: true,
            phone: true, openHours: true, website: true,
            status: true, reviewStatus: true, publishStatus: true,
          },
        },
      },
    })
    if (!job) throw new NotFoundException(`岗位 ${id} 不存在`)
    if (
      job.agency.status !== 'active' ||
      job.agency.reviewStatus !== 'approved' ||
      job.agency.publishStatus !== 'published'
    ) {
      throw new NotFoundException(`岗位 ${id} 不存在或机构未发布`)
    }

    return job
  }

  // ─── Admin 管理端点（无状态过滤）────────────────────────────────────────────

  async adminFindAll(query: AgencyListQuery) {
    const { page, pageSize, skip } = normalizePage(query)
    const { district, orgType, reviewStatus, publishStatus, keyword } = query

    const where: Record<string, unknown> = {}
    if (district) where['district'] = district
    if (orgType)  where['orgType']  = orgType
    if (reviewStatus) where['reviewStatus'] = reviewStatus
    if (publishStatus) where['publishStatus'] = publishStatus
    if (keyword) {
      where['OR'] = [
        { name:        { contains: keyword } },
        { address:     { contains: keyword } },
        { description: { contains: keyword } },
      ]
    }

    const [items, total] = await Promise.all([
      this.prisma.offlineAgency.findMany({
        where: where as never,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { jobs: true } } },
      }),
      this.prisma.offlineAgency.count({ where: where as never }),
    ])

    return { data: items, total, page, pageSize }
  }

  async adminFindOne(id: string) {
    const agency = await this.prisma.offlineAgency.findUnique({
      where: { id },
      include: { jobs: { orderBy: { createdAt: 'desc' } } },
    })
    if (!agency) throw new NotFoundException(`线下机构 ${id} 不存在`)
    return agency
  }

  async adminCreate(dto: CreateOfflineAgencyDto) {
    return this.prisma.offlineAgency.create({
      data: {
        name:         dto.name,
        orgType:      dto.orgType      ?? 'recruitment',
        address:      dto.address,
        district:     dto.district,
        lat:          dto.lat,
        lng:          dto.lng,
        openHours:    dto.openHours,
        phone:        dto.phone,
        contactEmail: dto.contactEmail,
        website:      dto.website,
        services:     dto.services     ?? '[]',
        description:  dto.description,
        logoUrl:      dto.logoUrl,
        sourceOrgId:  dto.sourceOrgId,
        externalId:   dto.externalId,
      },
    })
  }

  async adminUpdate(id: string, dto: UpdateOfflineAgencyDto) {
    await this._assertAgencyExists(id)
    const hasContentChanges = Object.entries(dto).some(([key, value]) => key !== 'status' && value !== undefined)
    return this.prisma.offlineAgency.update({
      where: { id },
      data: {
        name:         dto.name,
        orgType:      dto.orgType,
        address:      dto.address,
        district:     dto.district,
        lat:          dto.lat,
        lng:          dto.lng,
        openHours:    dto.openHours,
        phone:        dto.phone,
        contactEmail: dto.contactEmail,
        website:      dto.website,
        services:     dto.services,
        description:  dto.description,
        logoUrl:      dto.logoUrl,
        sourceOrgId:  dto.sourceOrgId,
        externalId:   dto.externalId,
        ...(dto.status ? { status: dto.status } : {}),
        ...(hasContentChanges ? { reviewStatus: 'pending', publishStatus: 'draft' } : {}),
      },
    })
  }

  async adminReview(id: string, action: 'reviewing' | 'approve' | 'reject', reason?: string) {
    await this._assertAgencyExists(id)
    const statusMap: Record<string, string> = {
      reviewing: 'reviewing',
      approve:   'approved',
      reject:    'rejected',
    }
    const reviewStatus = statusMap[action]
    if (!reviewStatus) throw new BadRequestException(`无效审核操作: ${action}`)
    if (action === 'reject' && !reason?.trim()) {
      throw new BadRequestException('驳回必须填写原因')
    }

    // reject 时强制将 publishStatus 置回 draft，防止已发布机构继续展示
    const publishStatusOverride = action === 'reject' ? { publishStatus: 'draft' } : {}

    return this.prisma.offlineAgency.update({
      where: { id },
      data: { reviewStatus, ...publishStatusOverride },
    })
  }

  async adminPublish(id: string, publishStatus: string) {
    const agency = await this._assertAgencyExists(id)

    if (publishStatus === 'published' && agency.reviewStatus !== 'approved') {
      throw new BadRequestException('只有已审核通过（approved）的机构才能发布')
    }

    const allowed = ['draft', 'published', 'unpublished']
    if (!allowed.includes(publishStatus)) {
      throw new BadRequestException(`无效发布状态: ${publishStatus}`)
    }

    // 发布闸门：本模型的 sourceOrgId 可空且无外键——**有**来源机构的（外部供稿）
    // 必须过 contentTrust；**没有**来源机构的是 Admin 自录的线下机构目录，
    // 不存在「来源机构信任」这个决策对象，因此不套闸门（详见
    // src/common/content-trust.ts 顶部注释与本 PR 说明）。
    if (publishStatus === 'published' && agency.sourceOrgId) {
      await assertOrgContentTrustActive(this.prisma as unknown as OrgTrustReader, agency.sourceOrgId, {
        contentType: '线下机构',
        contentId: id,
      })
    }

    return this.prisma.offlineAgency.update({
      where: { id },
      data: { publishStatus },
    })
  }

  async adminDelete(id: string) {
    await this._assertAgencyExists(id)
    // 先删子岗位，再删机构（SQLite FK restrict 约束）
    const deletedJobs = await this.prisma.offlineJob.deleteMany({ where: { agencyId: id } })
    const agency = await this.prisma.offlineAgency.delete({ where: { id } })
    return { agency, deletedJobs: deletedJobs.count }
  }

  // ─── Admin 岗位管理 ──────────────────────────────────────────────────────────

  async adminFindJobsByAgency(agencyId: string, query: JobListQuery) {
    await this._assertAgencyExists(agencyId)
    const { page, pageSize, skip } = normalizePage(query)
    const { jobType, keyword } = query

    const where: Record<string, unknown> = { agencyId }
    if (jobType) where['jobType'] = jobType
    if (keyword) {
      where['OR'] = [
        { title:        { contains: keyword } },
        { description:  { contains: keyword } },
        { requirements: { contains: keyword } },
      ]
    }

    const [items, total] = await Promise.all([
      this.prisma.offlineJob.findMany({
        where: where as never,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.offlineJob.count({ where: where as never }),
    ])

    return { data: items, total, page, pageSize }
  }

  async adminCreateJob(agencyId: string, dto: CreateOfflineJobDto) {
    await this._assertAgencyExists(agencyId)
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.offlineJob.create({
        data: {
          agencyId,
          title:        dto.title,
          jobType:      dto.jobType      ?? 'fulltime',
          salaryMin:    dto.salaryMin,
          salaryMax:    dto.salaryMax,
          salaryUnit:   dto.salaryUnit   ?? 'month',
          requirements: dto.requirements,
          description:  dto.description,
          headcount:    dto.headcount    ?? 1,
          location:     dto.location,
          education:    dto.education,
          experience:   dto.experience,
          externalUrl:  dto.externalUrl,
          externalId:   dto.externalId,
        },
      })
      // OfflineJob 暂未迁入 canonical Job；P0 用机构级回审门禁阻止岗位绕过审核公开。
      await tx.offlineAgency.update({
        where: { id: agencyId },
        data: { reviewStatus: 'pending', publishStatus: 'draft' },
      })
      return job
    })
  }

  async adminUpdateJob(agencyId: string, jobId: string, dto: UpdateOfflineJobDto) {
    await this._assertJobExists(agencyId, jobId)
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.offlineJob.update({
        where: { id: jobId },
        data: {
          title:        dto.title,
          jobType:      dto.jobType,
          salaryMin:    dto.salaryMin,
          salaryMax:    dto.salaryMax,
          salaryUnit:   dto.salaryUnit,
          requirements: dto.requirements,
          description:  dto.description,
          headcount:    dto.headcount,
          location:     dto.location,
          education:    dto.education,
          experience:   dto.experience,
          externalUrl:  dto.externalUrl,
          externalId:   dto.externalId,
          ...(dto.status ? { status: dto.status } : {}),
        },
      })
      await tx.offlineAgency.update({
        where: { id: agencyId },
        data: { reviewStatus: 'pending', publishStatus: 'draft' },
      })
      return job
    })
  }

  async adminDeleteJob(agencyId: string, jobId: string) {
    await this._assertJobExists(agencyId, jobId)
    return this.prisma.offlineJob.delete({ where: { id: jobId } })
  }

  // ─── 私有工具 ────────────────────────────────────────────────────────────────

  private async _assertAgencyExists(id: string) {
    const agency = await this.prisma.offlineAgency.findUnique({ where: { id } })
    if (!agency) throw new NotFoundException(`线下机构 ${id} 不存在`)
    return agency
  }

  private async _assertJobExists(agencyId: string, jobId: string) {
    const job = await this.prisma.offlineJob.findFirst({ where: { id: jobId, agencyId } })
    if (!job) throw new NotFoundException(`岗位 ${jobId} 不存在或不属于机构 ${agencyId}`)
    return job
  }
}
