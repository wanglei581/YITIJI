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

export interface PaginationQuery {
  /** HTTP query 可能是 string；须经 resolveOfflineListPage 后再交给 Prisma take/skip */
  page?: number | string
  pageSize?: number | string
}

export interface AgencyListQuery extends PaginationQuery {
  district?: string
  orgType?: string
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

    const [rows, total, districtRows] = await Promise.all([
      this.prisma.offlineAgency.findMany({
        where: where as never,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, name: true, orgType: true, address: true, district: true,
          openHours: true, phone: true, website: true, services: true, status: true,
          sourceOrgId: true, externalId: true, syncTime: true, updatedAt: true,
          _count: { select: { jobs: { where: { status: 'active' } } } },
        },
      }),
      this.prisma.offlineAgency.count({ where: where as never }),
      this.prisma.offlineAgency.findMany({
        where: {
          reviewStatus: 'approved',
          publishStatus: 'published',
          status: 'active',
          district: { not: null },
        } as never,
        select: { district: true },
        distinct: ['district'],
      }),
    ])

    let items = rows.map((row: (typeof rows)[number]) => {
      const services = parseServices(row.services)
      const isOpen = row.status === 'active'
      return {
        id: row.id,
        name: row.name,
        type: row.orgType || 'recruitment',
        status: (isOpen ? 'open' : 'rest') as 'open' | 'rest',
        statusLabel: isOpen ? '营业中' : '机构临时休息 · 以门店公告为准',
        address: row.address,
        district: row.district || '',
        hours: row.openHours || '以门店公告为准',
        services,
        orgCode: row.externalId || row.sourceOrgId || row.id,
        phone: row.phone ?? null,
        website: row.website ?? null,
        jobCount: row._count.jobs,
        syncTime: (row.syncTime ?? row.updatedAt).toISOString(),
      }
    })

    if (service) {
      items = items.filter((it: (typeof items)[number]) => it.services.includes(service))
    }

    const payload = {
      items,
      total: service ? items.length : total,
      page,
      pageSize,
      stats: {
        totalAgencies: service ? items.length : total,
        openAgencies: items.filter((it: (typeof items)[number]) => it.status === 'open').length,
        totalJobs: items.reduce((sum: number, it: (typeof items)[number]) => sum + it.jobCount, 0),
        districts: districtRows.length,
        lastSyncLabel: items[0]?.syncTime ? '已同步' : '暂无同步',
      },
    }

    // Kiosk get() 会取 body.data
    return { data: payload }
  }

  async findOne(id: string) {
    const agency = await this.prisma.offlineAgency.findFirst({
      where: { id, reviewStatus: 'approved', publishStatus: 'published', status: 'active' },
      include: {
        jobs: {
          where: { status: 'active' },
          orderBy: { createdAt: 'desc' },
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
      // 文案由前端根据 status 字段渲染（fallback='请到店咨询'），
      // 这里不再硬编码'营业中'以避免 verify-fusion-w4 反向闸门失效。
      // 原因：'营业中'是运营状态声明，需真实业务数据支撑（如后端聚合"今日开放门店数"），
      // 单纯按 agency.status 字段输出等于相信 DB 字段等于真实运营状态，不真实。
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
    return { data }
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
        orderBy: { createdAt: 'desc' },
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
            id: true, name: true, orgType: true, address: true,
            phone: true, openHours: true, services: true,
            reviewStatus: true, publishStatus: true,
          },
        },
      },
    })
    if (!job) throw new NotFoundException(`岗位 ${id} 不存在`)
    if (job.agency.reviewStatus !== 'approved' || job.agency.publishStatus !== 'published') {
      throw new NotFoundException(`岗位 ${id} 不存在或机构未发布`)
    }

    const unitLabel = job.salaryUnit === 'day' ? '天' : job.salaryUnit === 'hour' ? '时' : '月'
    let salary = '薪资面议'
    if (job.salaryMin != null && job.salaryMax != null) {
      salary = `${job.salaryMin}-${job.salaryMax} 元/${unitLabel}`
    } else if (job.salaryMin != null) {
      salary = `${job.salaryMin} 元起/${unitLabel}`
    }

    const parseText = (raw: string | null | undefined): string[] => {
      if (!raw?.trim()) return []
      try {
        const p = JSON.parse(raw) as unknown
        return Array.isArray(p) ? p.map(String) : [raw]
      } catch {
        return raw.split(/\n+/).map((s) => s.trim()).filter(Boolean)
      }
    }

    const agencyServices = parseServices(job.agency.services)

    const data = {
      id: job.id,
      title: job.title,
      salary,
      jobType: job.jobType ?? undefined,
      location: job.location ?? undefined,
      tags: [] as string[],
      requirements: parseText(job.requirements),
      responsibilities: [] as string[],
      agencyId: job.agencyId,
      agencyName: job.agency.name,
      agencyType: job.agency.orgType || 'recruitment',
      agencyAddress: job.agency.address,
      agencyHours: job.agency.openHours || '',
      agencyPhone: job.agency.phone ?? undefined,
      agencyServices,
      sourceName: job.agency.name,
      sourceType: job.agency.orgType || 'recruitment',
      syncTime: job.updatedAt.toISOString(),
      externalId: job.externalId || '',
    }
    return { data }
  }

  // ─── Admin 管理端点（无状态过滤）────────────────────────────────────────────

  async adminFindAll(query: AgencyListQuery) {
    const { page, pageSize, skip } = normalizePage(query)
    const { district, orgType, keyword } = query

    const where: Record<string, unknown> = {}
    if (district) where['district'] = district
    if (orgType)  where['orgType']  = orgType
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
      },
    })
  }

  async adminReview(id: string, action: 'reviewing' | 'approve' | 'reject', _reason?: string) {
    await this._assertAgencyExists(id)
    const statusMap: Record<string, string> = {
      reviewing: 'reviewing',
      approve:   'approved',
      reject:    'rejected',
    }
    const reviewStatus = statusMap[action]
    if (!reviewStatus) throw new BadRequestException(`无效审核操作: ${action}`)

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
    return this.prisma.offlineJob.create({
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
  }

  async adminUpdateJob(agencyId: string, jobId: string, dto: UpdateOfflineJobDto) {
    await this._assertJobExists(agencyId, jobId)
    return this.prisma.offlineJob.update({
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
