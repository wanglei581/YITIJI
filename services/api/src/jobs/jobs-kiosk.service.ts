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
  buildJobIndustryTag,
  prismaJobToListItem,
  prismaFairToListItem,
  parseSeekerIntent,
  withPublicFairDemoExclusion,
} from './jobs-shared'
import { mapFair, mapFairCompany, mapFairZone } from './fair.mapper'
import type { FairDetailResponse, FairCompany, FairZone } from './fair.types'

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
    const kw = params?.keyword?.trim()

    const tagContains: { tagsJson: { contains: string } }[] = []
    if (params?.tag)      tagContains.push({ tagsJson: { contains: `"${params.tag}"` } })
    if (params?.industry) tagContains.push({ tagsJson: { contains: `"${buildJobIndustryTag(params.industry)}"` } })

    const where = {
      reviewStatus:  'approved',
      publishStatus: 'published',
      ...(params?.city        ? { city: params.city }                 : {}),
      ...(params?.category     ? { category: params.category }         : {}),
      ...(params?.sourceOrgId  ? { sourceOrgId: params.sourceOrgId }   : {}),
      ...(tagContains.length   ? { AND: tagContains }                  : {}),
      ...(kw ? {
        OR: [
          { title:       { contains: kw } },
          { company:     { contains: kw } },
          { description: { contains: kw } },
        ],
      } : {}),
    }
    const [rows, total] = await Promise.all([
      this.prisma.job.findMany({
        where,
        orderBy: { syncTime: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.job.count({ where }),
    ])
    return {
      data: rows.map(prismaJobToListItem),
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    }
  }

  async getPublishedJobById(id: string): Promise<SingleResult<JobListItemDto>> {
    const j = await this.prisma.job.findFirst({
      where: { id, reviewStatus: 'approved', publishStatus: 'published' },
    })
    return { data: j ? prismaJobToListItem(j) : null, success: true }
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
        include: { _count: { select: { companies: true } } },
      })
      rows.push(...pageRows)
      remainingTake -= take
      remainingSkip = 0
    }
    return { rows, total }
  }

  async getPublishedFairs(params?: PublishedFairsParams): Promise<PaginatedResult<FairListItemDto>> {
    const page     = Math.max(1, params?.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, params?.pageSize ?? 20))
    const where = withPublicFairDemoExclusion({
      reviewStatus: 'approved',
      publishStatus: 'published',
    })
    const skip = (page - 1) * pageSize
    const hasTerminalScope = !!params?.terminalId?.trim()
    const preferredOrgId = await this.resolveCampusPreferredOrgId(params?.terminalId)
    let rows: PrismaJobFairRow[]
    let total: number
    if (!preferredOrgId) {
      if (!hasTerminalScope) {
        const result = await Promise.all([
          this.prisma.jobFair.findMany({
            where,
            orderBy: { startAt: 'asc' },
            skip,
            take: pageSize,
            include: { _count: { select: { companies: true } } },
          }),
          this.prisma.jobFair.count({ where }),
        ])
        rows = result[0]
        total = result[1]
      } else {
        const now = new Date()
        const result = await this.getPublishedFairRowsByGroups([
          { where: { ...where, endAt: { gte: now } }, orderBy: { startAt: 'asc' } },
          { where: { ...where, endAt: { lt: now } }, orderBy: { startAt: 'desc' } },
        ], skip, pageSize)
        rows = result.rows
        total = result.total
      }
    } else {
      const now = new Date()
      const result = await this.getPublishedFairRowsByGroups([
        { where: { ...where, sourceOrgId: preferredOrgId, endAt: { gte: now } }, orderBy: { startAt: 'asc' } },
        { where: { ...where, sourceOrgId: preferredOrgId, endAt: { lt: now } }, orderBy: { startAt: 'desc' } },
        { where: { ...where, NOT: { sourceOrgId: preferredOrgId }, endAt: { gte: now } }, orderBy: { startAt: 'asc' } },
        { where: { ...where, NOT: { sourceOrgId: preferredOrgId }, endAt: { lt: now } }, orderBy: { startAt: 'desc' } },
      ], skip, pageSize)
      rows = result.rows
      total = result.total
    }
    type FairStatusFilter = 'upcoming' | 'ongoing' | 'ended'
    let data = rows.map(prismaFairToListItem)
    if (params?.status && (params.status === 'upcoming' || params.status === 'ongoing' || params.status === 'ended')) {
      const filterStatus = params.status as FairStatusFilter
      data = data.filter((d) => d.status === filterStatus)
    }
    return {
      data,
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    }
  }

  async getPublishedFairById(id: string): Promise<SingleResult<FairListItemDto>> {
    const f = await this.prisma.jobFair.findFirst({
      where: withPublicFairDemoExclusion({ id, reviewStatus: 'approved', publishStatus: 'published' }),
      include: { _count: { select: { companies: true } } },
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
        checkedInCompanies: 0,
        totalPositions,
        totalHeadcount,
        browseCount: fair.viewCount,
        scanCount: 0,
        printCount: 0,
        checkinCount: 0,
        zoneBreakdown: [],
        lastUpdated: new Date().toISOString(),
        expectedAttendance: fair.expectedAttendance ?? undefined,
        seekerIntent: parseSeekerIntent(fair.seekerIntentJson),
        industryDistribution,
        dataSourceLabel: '预计 / 来源数据 · 非实时',
        isMockData: false,
      },
    }
  }
}
