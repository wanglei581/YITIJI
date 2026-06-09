import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import type { PartnerDashboard, PartnerDashboardSyncLog } from './partner-dashboard.types'

const RECENT_LIMIT = 5

@Injectable()
export class PartnerDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 本机构运营数据看板。orgId 强制取自 JWT；只统计岗位/招聘会/数据源/同步日志，
   * 绝不统计候选人/简历/投递/面试/Offer。所有计数为真实查询，无假增长/趋势/访问量。
   */
  async getDashboard(user: AuthedUser): Promise<PartnerDashboard> {
    if (!user.orgId) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' } })
    }
    const orgId = user.orgId

    const org = await this.prisma.organization.findUnique({ where: { id: orgId }, select: { id: true, name: true } })
    if (!org) {
      throw new NotFoundException({ error: { code: 'PARTNER_PROFILE_NOT_FOUND', message: '未找到本机构资料' } })
    }

    const jobWhere = { sourceOrgId: orgId }
    const fairWhere = { sourceOrgId: orgId }

    const [
      jobCount, jobFairCount,
      publishedJobCount, publishedFairCount,
      jobPending, fairPending,
      jobRejected, fairRejected,
      syncSourceCount,
      latestSync,
      recentSyncRows,
      recentJobs,
      recentJobFairs,
    ] = await Promise.all([
      this.prisma.job.count({ where: jobWhere }),
      this.prisma.jobFair.count({ where: fairWhere }),
      this.prisma.job.count({ where: { ...jobWhere, publishStatus: 'published' } }),
      this.prisma.jobFair.count({ where: { ...fairWhere, publishStatus: 'published' } }),
      this.prisma.job.count({ where: { ...jobWhere, reviewStatus: 'pending' } }),
      this.prisma.jobFair.count({ where: { ...fairWhere, reviewStatus: 'pending' } }),
      this.prisma.job.count({ where: { ...jobWhere, reviewStatus: 'rejected' } }),
      this.prisma.jobFair.count({ where: { ...fairWhere, reviewStatus: 'rejected' } }),
      this.prisma.jobSource.count({ where: { orgId } }),
      this.prisma.syncLog.findFirst({ where: { orgId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      this.prisma.syncLog.findMany({
        where: { orgId },
        orderBy: { createdAt: 'desc' },
        take: RECENT_LIMIT,
        select: { id: true, sourceId: true, dataType: true, result: true, addedCount: true, updatedCount: true, errorCount: true, createdAt: true },
      }),
      this.prisma.job.findMany({
        where: jobWhere,
        orderBy: { syncTime: 'desc' },
        take: RECENT_LIMIT,
        select: { id: true, title: true, sourceName: true, reviewStatus: true, publishStatus: true, syncTime: true },
      }),
      this.prisma.jobFair.findMany({
        where: fairWhere,
        orderBy: { startAt: 'desc' },
        take: RECENT_LIMIT,
        select: { id: true, title: true, sourceName: true, reviewStatus: true, publishStatus: true, startAt: true },
      }),
    ])

    // SyncLog 只存 sourceId；批量解析 JobSource.name 作为展示名。
    const sourceIds = [...new Set(recentSyncRows.map((r) => r.sourceId))]
    const sourceNames = new Map<string, string>()
    if (sourceIds.length > 0) {
      const sources = await this.prisma.jobSource.findMany({ where: { id: { in: sourceIds } }, select: { id: true, name: true } })
      for (const s of sources) sourceNames.set(s.id, s.name)
    }

    const recentSyncLogs: PartnerDashboardSyncLog[] = recentSyncRows.map((r) => ({
      id: r.id,
      sourceName: sourceNames.get(r.sourceId) ?? null,
      dataType: r.dataType,
      status: r.result,
      successCount: r.addedCount + r.updatedCount,
      failCount: r.errorCount,
      createdAt: r.createdAt.toISOString(),
    }))

    return {
      org,
      stats: {
        jobCount,
        jobFairCount,
        publishedJobCount,
        publishedFairCount,
        pendingReviewCount: jobPending + fairPending,
        rejectedCount: jobRejected + fairRejected,
        syncSourceCount,
        lastSyncTime: latestSync?.createdAt ? latestSync.createdAt.toISOString() : null,
      },
      recentSyncLogs,
      recentJobs: recentJobs.map((j) => ({
        id: j.id,
        title: j.title,
        sourceName: j.sourceName,
        reviewStatus: j.reviewStatus,
        publishStatus: j.publishStatus,
        syncTime: j.syncTime ? j.syncTime.toISOString() : null,
      })),
      recentJobFairs: recentJobFairs.map((f) => ({
        id: f.id,
        title: f.title,
        sourceName: f.sourceName,
        reviewStatus: f.reviewStatus,
        publishStatus: f.publishStatus,
        startTime: f.startAt ? f.startAt.toISOString() : null,
      })),
      updatedAt: new Date().toISOString(),
    }
  }
}
