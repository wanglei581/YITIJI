// ============================================================
// JobsKioskService — Kiosk 公开只读端点（approved+published）
// N1 拆分子服务：零行为变化。
// ============================================================

import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import {
  type PublishedFairsParams,
  type PublishedFairQueryGroup,
  type PaginatedResult,
  type SingleResult,
  type FairListItemDto,
  type FairStatsDto,
  type JobListItemDto,
  type PrismaJobFairRow,
  buildPublishedFairGroups,
  parseFairStatusFilter,
  buildPublishedJobWhere,
  prismaJobToListItem,
  prismaFairToListItem,
  parseSeekerIntent,
  withPublicFairDemoExclusion,
} from './jobs-shared'
import { jobValidityWhere } from './job-validity'
import { mapFair, mapFairCompany, mapFairZone } from './fair.mapper'
import type { FairDetailResponse, FairCompany, FairZone } from './fair.types'

/** 公开列表/详情的资料份数与资料页口径一致：已发布且未软删。 */
const publicFairCountSelect = {
  companies: true,
  materials: { where: { deletedAt: null, publishStatus: 'published' } },
} as const

const JOB_SOURCE_ORG_TRUST_INCLUDE = {
  org: { select: { contentTrustStatus: true, archivedAt: true } },
} as const

function withSourceOrgTrust(
  dto: JobListItemDto,
  org: { contentTrustStatus: string | null; archivedAt: Date | null } | null,
): JobListItemDto {
  return {
    ...dto,
    sourceContentTrustStatus: org ? org.contentTrustStatus : undefined,
    sourceOrgArchived: org ? org.archivedAt != null : undefined,
  }
}

@Injectable()
export class JobsKioskService {
  constructor(private readonly prisma: PrismaService) {}

  async getPublishedJobs(params?: {
    keyword?: string
    city?: string
    industry?: string
    category?: string
    sourceOrgId?: string
    tag?: string
    page?: number
    pageSize?: number
  }): Promise<PaginatedResult<JobListItemDto>> {
    const page     = Math.max(1, params?.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, params?.pageSize ?? 20))
    // where 由 jobs-shared 统一构造：岗位要求计数端点必须命中同一批岗位（见该函数注释）
    const where = buildPublishedJobWhere(params)
    const [rows, total] = await Promise.all([
      this.prisma.job.findMany({
        where,
        orderBy: [{ syncTime: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: JOB_SOURCE_ORG_TRUST_INCLUDE,
      }),
      this.prisma.job.count({ where }),
    ])
    return {
      data: rows.map((row) => withSourceOrgTrust(prismaJobToListItem(row), row.org)),
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    }
  }

  /**
   * 岗位详情。
   *
   * 有效期条件必须与列表一致（jobValidityWhere）：只筛列表不筛详情的话，
   * 过期岗位虽然搜不到，但收藏夹/浏览记录/外部二维码里的旧链接仍能打开它，
   * 求职者照样会照着一条失效岗位去投递。
   */
  async getPublishedJobById(id: string): Promise<SingleResult<JobListItemDto>> {
    const j = await this.prisma.job.findFirst({
      where: {
        id,
        reviewStatus: 'approved',
        publishStatus: 'published',
        ...jobValidityWhere(),
      },
      include: JOB_SOURCE_ORG_TRUST_INCLUDE,
    })
    return { data: j ? withSourceOrgTrust(prismaJobToListItem(j), j.org) : null, success: true }
  }

  private async resolveCampusPreferredOrgId(terminalId?: string): Promise<string | null> {
    const id = terminalId?.trim()
    if (!id) return null
    const terminal = await this.prisma.terminal.findFirst({
      where: { OR: [{ id }, { terminalCode: id }] },
      select: {
        org: { select: { id: true, type: true, enabled: true } },
      },
    })
    const org = terminal?.org
    if (!org || !org.enabled || org.type !== 'school_employment_center') return null
    return org.id
  }

  private async getPublishedFairRowsByGroups(
    groups: PublishedFairQueryGroup[],
    skip: number,
    pageSize: number,
  ): Promise<{ rows: PrismaJobFairRow[]; total: number }> {
    const totals = await Promise.all(groups.map((group) => this.prisma.jobFair.count({ where: group.where })))
    const total = totals.reduce((sum, count) => sum + count, 0)
    const rows: PrismaJobFairRow[] = []
    let remainingSkip = skip
    let remainingTake = pageSize
    for (let i = 0; i < groups.length && remainingTake > 0; i++) {
      const groupTotal = totals[i]
      if (remainingSkip >= groupTotal) {
        remainingSkip -= groupTotal
        continue
      }
      const take = Math.min(remainingTake, groupTotal - remainingSkip)
      const pageRows = await this.prisma.jobFair.findMany({
        where: groups[i].where,
        orderBy: groups[i].orderBy,
        skip: remainingSkip,
        take,
        include: { _count: { select: publicFairCountSelect } },
      })
      rows.push(...pageRows)
      remainingTake -= take
      remainingSkip = 0
    }
    return { rows, total }
  }

  /**
   * 公开招聘会列表。
   *
   * status / keyword 全部下推到数据库(见 buildPublishedFairGroups),
   * 因此返回的 total 就是「按当前条件真实可翻到的条数」,
   * 不再出现 data 为空但 total 仍报全量的自相矛盾。
   */
  async getPublishedFairs(params?: PublishedFairsParams): Promise<PaginatedResult<FairListItemDto>> {
    const page     = Math.max(1, params?.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, params?.pageSize ?? 20))
    const skip     = (page - 1) * pageSize
    const now      = new Date()

    const base = withPublicFairDemoExclusion({
      reviewStatus: 'approved',
      publishStatus: 'published',
    })
    const preferredOrgId = await this.resolveCampusPreferredOrgId(params?.terminalId)

    const groups = buildPublishedFairGroups({
      base,
      now,
      status: parseFairStatusFilter(params?.status),
      keyword: params?.keyword,
      preferredOrgId,
    })
    const { rows, total } = await this.getPublishedFairRowsByGroups(groups, skip, pageSize)

    return {
      data: rows.map(prismaFairToListItem),
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    }
  }

  async getPublishedFairById(id: string): Promise<SingleResult<FairListItemDto>> {
    const f = await this.prisma.jobFair.findFirst({
      where: withPublicFairDemoExclusion({ id, reviewStatus: 'approved', publishStatus: 'published' }),
      include: { _count: { select: publicFairCountSelect } },
    })
    return { data: f ? prismaFairToListItem(f) : null, success: true }
  }

  async getPublishedFairDetail(id: string): Promise<FairDetailResponse | null> {
    const f = await this.prisma.jobFair.findFirst({
      where: withPublicFairDemoExclusion({ id, reviewStatus: 'approved', publishStatus: 'published' }),
      include: {
        companies: { orderBy: { jobsCount: 'desc' } },
        zones: { orderBy: { sortOrder: 'asc' } },
      },
    })
    if (!f) return null
    return {
      fair: mapFair(f),
      companies: f.companies.map(mapFairCompany),
      zones: f.zones.map(mapFairZone),
    }
  }

  async getFairCompanies(
    fairId: string,
    page: number,
    pageSize: number,
  ): Promise<{ data: FairCompany[]; total: number; page: number; pageSize: number }> {
    const fair = await this.prisma.jobFair.findFirst({
      where: withPublicFairDemoExclusion({ id: fairId, reviewStatus: 'approved', publishStatus: 'published' }),
      select: { id: true },
    })
    if (!fair) return { data: [], total: 0, page, pageSize }
    const [rows, total] = await Promise.all([
      this.prisma.fairCompany.findMany({
        where: { jobFairId: fairId },
        orderBy: { jobsCount: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { positions: { orderBy: { sortOrder: 'asc' } } },
      }),
      this.prisma.fairCompany.count({ where: { jobFairId: fairId } }),
    ])
    return { data: rows.map(mapFairCompany), total, page, pageSize }
  }

  async getFairCompanyById(fairId: string, companyId: string): Promise<{ data: FairCompany | null }> {
    const fair = await this.prisma.jobFair.findFirst({
      where: withPublicFairDemoExclusion({ id: fairId, reviewStatus: 'approved', publishStatus: 'published' }),
      select: { id: true },
    })
    if (!fair) return { data: null }
    const company = await this.prisma.fairCompany.findFirst({
      where: { id: companyId, jobFairId: fairId },
      include: { positions: { orderBy: { sortOrder: 'asc' } } },
    })
    return { data: company ? mapFairCompany(company) : null }
  }

  async getFairZones(fairId: string): Promise<{ data: FairZone[] }> {
    const fair = await this.prisma.jobFair.findFirst({
      where: withPublicFairDemoExclusion({ id: fairId, reviewStatus: 'approved', publishStatus: 'published' }),
      select: { id: true },
    })
    if (!fair) return { data: [] }
    const zones = await this.prisma.fairZone.findMany({
      where: { jobFairId: fairId },
      orderBy: { sortOrder: 'asc' },
    })
    return { data: zones.map(mapFairZone) }
  }

  async getFairMap(fairId: string): Promise<{ data: { mapImageUrl: string | null; zones: FairZone[]; booths: [] } | null }> {
    const fair = await this.prisma.jobFair.findFirst({
      where: withPublicFairDemoExclusion({ id: fairId, reviewStatus: 'approved', publishStatus: 'published' }),
      select: { id: true, mapImageUrl: true },
    })
    if (!fair) return { data: null }
    const zones = await this.prisma.fairZone.findMany({
      where: { jobFairId: fairId, NOT: { category: 'innovation' } },
      orderBy: { sortOrder: 'asc' },
    })
    return {
      data: {
        mapImageUrl: fair.mapImageUrl,
        zones: zones.map(mapFairZone),
        booths: [],
      },
    }
  }

  async getFairStats(fairId: string): Promise<{ data: FairStatsDto | null }> {
    const fair = await this.prisma.jobFair.findFirst({
      where: withPublicFairDemoExclusion({ id: fairId, reviewStatus: 'approved', publishStatus: 'published' }),
      include: { companies: { include: { positions: true } } },
    })
    if (!fair) return { data: null }

    const companies = fair.companies
    const totalCompanies = companies.length
    const totalPositions = companies.reduce((s, c) => s + c.positions.length, 0)
    const totalHeadcount = companies.reduce(
      (s, c) => s + c.positions.reduce((ps, p) => ps + (p.headcount ?? 0), 0),
      0,
    )

    const INDUSTRY_LABEL: Record<string, string> = {
      internet: '互联网/IT', ai: '人工智能', finance: '金融', manufacturing: '智能制造',
      consumer: '消费电子', service: '生活服务', education: '教育', medical: '医疗健康',
    }
    const industryMap = new Map<string, number>()
    for (const c of companies) {
      const raw = c.industry?.trim() || '其他'
      const key = INDUSTRY_LABEL[raw] ?? raw
      industryMap.set(key, (industryMap.get(key) ?? 0) + 1)
    }
    const industryDistribution = [...industryMap.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)

    return {
      data: {
        fairId: fair.id,
        fairName: fair.title,
        totalCompanies,
        checkedInCompanies: null,
        totalPositions,
        totalHeadcount,
        browseCount: null,
        scanCount: null,
        printCount: null,
        checkinCount: null,
        zoneBreakdown: [],
        lastUpdated: fair.updatedAt.toISOString(),
        expectedAttendance: fair.expectedAttendance ?? undefined,
        seekerIntent: parseSeekerIntent(fair.seekerIntentJson),
        industryDistribution,
        dataSourceLabel: '主办方录入数据 · 非实时',
        isMockData: false,
      },
    }
  }
}
