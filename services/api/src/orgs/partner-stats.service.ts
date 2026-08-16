// Partner 数据统计服务
//
// 口径（Codex 审查通过）：
//   - 统计来源：SyncLog 表，按 orgId 隔离
//   - 时区：Asia/Shanghai（UTC+8），按上海日历日分桶
//   - 周期：week=7天 / month=30天 / quarter=90天
//   - 对比基期：等长紧邻上一周期 [prevFrom, prevTo)
//   - 成功率 = success 批次 / 全部批次 × 100；total=0 时 previous=null
//   - deltaPercent=null 当 previous=0 或 null（不显示 ∞%）
//
// C1（2026-08-16）补充：
//   - 时区由服务端单向声明（响应 `timezone` 字段），不接受客户端传参。
//     分桶逻辑本来就硬编码 Asia/Shanghai，接收一个不被消费的 timezone 参数
//     等于假实现；改为服务端把自己实际使用的时区告诉前端，前端照实渲染。
//   - snapshot 扩展为四类在架内容 + 待审核数（全部 orgId 隔离的真实计数），
//     待审核数用于「为什么还没有数据」的空态，不是装饰。
//   - attribution（曝光/详情浏览/打开来源平台/资料打印/转化漏斗）**恒为不可用**：
//     BrowseLog / ExternalJumpLog 在 origin/main 上均无 sourceOrgId 字段
//     （已用 `git show origin/main:services/api/prisma/schema.prisma` 核实），
//     无法按机构归因。可以用 targetId 反查 Job.sourceOrgId，但那是**当前**归属、
//     不是不可变快照——内容换来源机构后历史统计会漂移，因此**刻意不做该 join**。
//     此处如实返回 available:false，不编造漏斗。

import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

const TZ_OFFSET_MS = 8 * 60 * 60 * 1000 // Asia/Shanghai = UTC+8

/** 服务端实际使用的统计时区；随响应下发，不接受客户端覆盖 */
export const STATS_TIMEZONE = 'Asia/Shanghai' as const

/**
 * 最小聚合样本阈值：任一分组少于 5 条时不得给出数字。
 * 防止小样本反推到具体求职者个人。归因分组落地后由该阈值统一把关。
 */
export const MIN_AGGREGATE_SAMPLE = 5

/** 归因不可用的机器可读原因 */
export const ATTRIBUTION_UNAVAILABLE_REASON = 'missing_immutable_source_org_snapshot'

export type StatsPeriod = 'week' | 'month' | 'quarter'

function periodDays(p: StatsPeriod): number {
  return p === 'week' ? 7 : p === 'month' ? 30 : 90
}

function toShanghaiDay(date: Date): string {
  return new Date(date.getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10)
}

function buildPeriodRange(p: StatsPeriod) {
  const days = periodDays(p)
  // 以上海时间"今天"0点为起始参考
  const nowSh = new Date(Date.now() + TZ_OFFSET_MS)
  nowSh.setUTCHours(0, 0, 0, 0)
  const todayUtcStart = new Date(nowSh.getTime() - TZ_OFFSET_MS)

  // 当前周期：[from, to)  — to = 明天 UTC 0点（包含今天全天）
  const to      = new Date(todayUtcStart.getTime() + 24 * 60 * 60 * 1000)
  const from    = new Date(todayUtcStart.getTime() - (days - 1) * 24 * 60 * 60 * 1000)
  // 对比周期
  const prevTo  = from
  const prevFrom = new Date(from.getTime() - days * 24 * 60 * 60 * 1000)

  const labels: Record<StatsPeriod, string> = { week: '本周', month: '本月', quarter: '本季度' }
  const compLabels: Record<StatsPeriod, string> = { week: 'vs 上周', month: 'vs 上月', quarter: 'vs 上季度' }

  return { from, to, prevFrom, prevTo, label: labels[p], compLabel: compLabels[p] }
}

function calcDelta(cur: number, prev: number | null): number | null {
  if (prev === null || prev === 0) return null
  return Math.round(((cur - prev) / prev) * 100)
}

function metric(cur: number, prev: number | null, compLabel: string) {
  return {
    current:      cur,
    previous:     prev,
    deltaPercent: calcDelta(cur, prev),
    comparisonLabel: compLabel,
  }
}

@Injectable()
export class PartnerStatsService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats(orgId: string, period: StatsPeriod) {
    const { from, to, prevFrom, prevTo, label, compLabel } = buildPeriodRange(period)
    const days = periodDays(period)

    // 1. 并发拉取：当期同步日志 + 上期同步日志 + 快照
    //    全部 where 都以 orgId / sourceOrgId 收口，跨机构不可达。
    const PENDING = { in: ['pending', 'reviewing'] }
    const [
      curLogs,
      prevLogs,
      publishedJobs,
      publishedFairs,
      publishedCompanies,
      publishedPolicies,
      activeSources,
      pendingJobs,
      pendingFairs,
      pendingCompanies,
      pendingPolicies,
    ] = await Promise.all([
      this.prisma.syncLog.findMany({
        where:  { orgId, createdAt: { gte: from, lt: to } },
        select: { result: true, addedCount: true, updatedCount: true, errorCount: true, createdAt: true },
      }),
      this.prisma.syncLog.findMany({
        where:  { orgId, createdAt: { gte: prevFrom, lt: prevTo } },
        select: { result: true, addedCount: true, errorCount: true },
      }),
      this.prisma.job.count({ where: { sourceOrgId: orgId, publishStatus: 'published' } }),
      this.prisma.jobFair.count({ where: { sourceOrgId: orgId, publishStatus: 'published' } }),
      this.prisma.companyProfile.count({ where: { sourceOrgId: orgId, publishStatus: 'published' } }),
      this.prisma.policyPost.count({ where: { sourceOrgId: orgId, publishStatus: 'published' } }),
      this.prisma.jobSource.count({ where: { orgId, enabled: true } }),
      this.prisma.job.count({ where: { sourceOrgId: orgId, reviewStatus: PENDING } }),
      this.prisma.jobFair.count({ where: { sourceOrgId: orgId, reviewStatus: PENDING } }),
      this.prisma.companyProfile.count({ where: { sourceOrgId: orgId, reviewStatus: PENDING } }),
      this.prisma.policyPost.count({ where: { sourceOrgId: orgId, reviewStatus: PENDING } }),
    ])

    const pendingReview =
      pendingJobs + pendingFairs + pendingCompanies + pendingPolicies

    // 2. 当期聚合
    type CurLog = (typeof curLogs)[number]
    type PrevLog = (typeof prevLogs)[number]
    const curTotal   = curLogs.length
    const curSuccess = curLogs.filter((l: CurLog) => l.result === 'success').length
    const curPartial = curLogs.filter((l: CurLog) => l.result === 'partial').length
    const curFailed  = curLogs.filter((l: CurLog) => l.result === 'failed').length
    const curAdded   = curLogs.reduce((s: number, l: CurLog) => s + l.addedCount, 0)
    const curRate    = curTotal > 0 ? Math.round((curSuccess / curTotal) * 100) : 0

    // 3. 上期聚合
    const prevTotal   = prevLogs.length
    const prevSuccess = prevLogs.filter((l: PrevLog) => l.result === 'success').length
    const prevAdded   = prevLogs.reduce((s: number, l: PrevLog) => s + l.addedCount, 0)
    const prevFailed  = prevLogs.filter((l: PrevLog) => l.result === 'failed').length
    const prevRate    = prevTotal > 0 ? Math.round((prevSuccess / prevTotal) * 100) : 0

    // 4. 按上海日历日生成趋势桶（补零保证天数完整）
    const bucketMap = new Map<string, { added: number; updated: number; failed: number }>()
    for (let d = 0; d < days; d++) {
      const day = toShanghaiDay(new Date(from.getTime() + d * 24 * 60 * 60 * 1000))
      bucketMap.set(day, { added: 0, updated: 0, failed: 0 })
    }
    for (const log of curLogs) {
      const day = toShanghaiDay(new Date(log.createdAt))
      const b = bucketMap.get(day)
      if (b) { b.added += log.addedCount; b.updated += log.updatedCount; b.failed += log.errorCount }
    }
    const trend = Array.from(bucketMap.entries()).map(([date, b]) => ({ date, ...b }))

    return {
      dataMode: 'live' as const,
      /** 服务端实际用于分桶的时区，由服务端声明；客户端不得传参覆盖 */
      timezone: STATS_TIMEZONE,
      period: {
        label,
        from: toShanghaiDay(from),
        to:   toShanghaiDay(new Date(to.getTime() - 1)),
      },
      snapshot: {
        publishedJobs,
        publishedFairs,
        publishedCompanies,
        publishedPolicies,
        activeSources,
        /** 待管理员审核（pending + reviewing）的内容总数，用于解释「为什么还没有数据」 */
        pendingReview,
      },
      /**
       * 浏览 / 外部跳转 / 打印的机构归因。
       * 恒为 available:false —— 行为日志无不可变 sourceOrgId 快照，见文件头注释。
       * 前端必须据此显示「暂无归因数据」，不得回退成任何估算或演示漏斗。
       */
      attribution: {
        available: false as const,
        reason: ATTRIBUTION_UNAVAILABLE_REASON,
        /** 归因落地后对每个分组生效的最小样本阈值 */
        minSampleThreshold: MIN_AGGREGATE_SAMPLE,
      },
      sync: {
        totalBatches: metric(curTotal,  prevTotal > 0 ? prevTotal  : null, compLabel),
        successRate:  metric(curRate,   prevTotal > 0 ? prevRate   : null, compLabel),
        totalAdded:   metric(curAdded,  prevTotal > 0 ? prevAdded  : null, compLabel),
        totalFailed:  metric(curFailed, prevTotal > 0 ? prevFailed : null, compLabel),
      },
      trend,
      statusDist: { success: curSuccess, partial: curPartial, failed: curFailed },
    }
  }
}
