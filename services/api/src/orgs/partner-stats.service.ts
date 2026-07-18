// Partner 数据统计服务
//
// 口径（Codex 审查通过）：
//   - 统计来源：SyncLog 表，按 orgId 隔离
//   - 时区：Asia/Shanghai（UTC+8），按上海日历日分桶
//   - 周期：week=7天 / month=30天 / quarter=90天
//   - 对比基期：等长紧邻上一周期 [prevFrom, prevTo)
//   - 成功率 = success 批次 / 全部批次 × 100；total=0 时 previous=null
//   - deltaPercent=null 当 previous=0 或 null（不显示 ∞%）

import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

const TZ_OFFSET_MS = 8 * 60 * 60 * 1000 // Asia/Shanghai = UTC+8

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
    const [curLogs, prevLogs, publishedJobs, publishedFairs, activeSources] =
      await Promise.all([
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
        this.prisma.jobSource.count({ where: { orgId, enabled: true } }),
      ])

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
      period: {
        label,
        from: toShanghaiDay(from),
        to:   toShanghaiDay(new Date(to.getTime() - 1)),
      },
      snapshot: { publishedJobs, publishedFairs, activeSources },
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
