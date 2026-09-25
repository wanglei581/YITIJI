// 校园招聘聚合：只读 Prisma + 纯函数。不调 AI，不写库。

import { Injectable } from '@nestjs/common'
import { isRecruitmentContentHostingEnabled } from '../recruitment-hosting/recruitment-hosting'
import { PrismaService } from '../prisma/prisma.service'
import { buildPublishedJobWhere, withPublicFairDemoExclusion } from './jobs-shared'
import {
  aggregateCampusRecruitmentStats,
  CAMPUS_FAIR_THEMES,
  CAMPUS_RECRUITMENT_STATS_NOTES,
  CAMPUS_RECRUITMENT_STATS_SCAN_LIMIT,
  type CampusFairRow,
  type CampusRecruitmentStatsData,
} from './campus-recruitment-stats.rules'

const CAMPUS_TITLE_HINTS = ['校园', '校招', '高校', '大学', '学院', '应届', '毕业生', '双选', '研究生', '校企'] as const

@Injectable()
export class CampusRecruitmentStatsService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats(options?: { includeJobListings?: boolean }): Promise<CampusRecruitmentStatsData> {
    if (!isRecruitmentContentHostingEnabled()) {
      return {
        groups: [],
        reason: 'no_published_campus_records',
        generatedAt: new Date().toISOString(),
        truncated: false,
        scanLimit: CAMPUS_RECRUITMENT_STATS_SCAN_LIMIT,
        notes: [...CAMPUS_RECRUITMENT_STATS_NOTES],
      }
    }
    const includeJobListings = options?.includeJobListings !== false
    const jobWhere = buildPublishedJobWhere({ category: 'campus' })
    const fairWhere = withPublicFairDemoExclusion({
      reviewStatus: 'approved',
      publishStatus: 'published',
      OR: [
        { theme: { in: [...CAMPUS_FAIR_THEMES] } },
        ...CAMPUS_TITLE_HINTS.flatMap((hint) => [
          { title: { contains: hint } },
          { venue: { contains: hint } },
          { sourceName: { contains: hint } },
          { description: { contains: hint } },
        ]),
      ],
    })

    const [fairs, jobs, fairTotal, jobTotal] = await Promise.all([
      this.prisma.jobFair.findMany({
        where: fairWhere,
        select: {
          id: true,
          sourceOrgId: true,
          sourceName: true,
          syncTime: true,
          theme: true,
          title: true,
          venue: true,
          description: true,
          startAt: true,
          companies: {
            select: {
              name: true,
              _count: { select: { positions: true } },
            },
          },
        },
        orderBy: [{ syncTime: 'desc' }, { id: 'asc' }],
        take: CAMPUS_RECRUITMENT_STATS_SCAN_LIMIT,
      }),
      includeJobListings
        ? this.prisma.job.findMany({
          where: jobWhere,
          select: {
            sourceOrgId: true,
            sourceName: true,
            syncTime: true,
          },
          orderBy: [{ syncTime: 'desc' }, { id: 'asc' }],
          take: CAMPUS_RECRUITMENT_STATS_SCAN_LIMIT,
        })
        : Promise.resolve([]),
      this.prisma.jobFair.count({ where: fairWhere }),
      includeJobListings ? this.prisma.job.count({ where: jobWhere }) : Promise.resolve(0),
    ])

    const fairRows: CampusFairRow[] = fairs.map((fair) => ({
      id: fair.id,
      sourceOrgId: fair.sourceOrgId,
      sourceName: fair.sourceName,
      syncTime: fair.syncTime,
      theme: fair.theme,
      title: fair.title,
      venue: fair.venue,
      description: fair.description,
      startAt: fair.startAt,
      companies: fair.companies.map((company) => ({
        name: company.name,
        positionCount: company._count.positions,
      })),
    }))

    return aggregateCampusRecruitmentStats({
      fairs: fairRows,
      jobs,
      generatedAt: new Date(),
      truncated:
        fairTotal > CAMPUS_RECRUITMENT_STATS_SCAN_LIMIT
        || (includeJobListings && jobTotal > CAMPUS_RECRUITMENT_STATS_SCAN_LIMIT),
      scanLimit: CAMPUS_RECRUITMENT_STATS_SCAN_LIMIT,
      includeJobListings,
    })
  }
}
