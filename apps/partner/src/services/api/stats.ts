// Partner 数据统计服务
//
// HTTP 模式：GET /partner/stats?period=week|month|quarter
// Mock 模式：返回固定演示数据，dataMode='demo'，禁止混入真实链路。
//
// 口径约定（遵循 Codex 审查结论）：
//   - snapshot 指标不显示环比（当前快照，不受时间选择器影响）
//   - sync 指标含环比：current/previous/deltaPercent（previous=null 时不显示 delta）
//   - deltaPercent=null 时显示"无可比基期"，不显示 ∞% 或伪造 0%
//   - 时区统一 Asia/Shanghai；周期使用等长半开区间 [from,to)
//   - 成功率 = successBatches / totalBatches × 100；total=0 时 rate=null

import { API_BASE_URL, API_MODE } from './client'
import { authHeader } from '../auth'

// ─── 类型定义 ───────────────────────────────────────────────────────────────

export type StatsPeriod = 'week' | 'month' | 'quarter'

export interface StatsMetric {
  current: number
  previous: number | null
  /** null = 无可比基期；不显示 ∞% 或伪造 0% */
  deltaPercent: number | null
  /** 对照说明，例 "vs 上周" */
  comparisonLabel: string
}

export interface StatsBucket {
  date: string   // YYYY-MM-DD
  added: number
  updated: number
  failed: number
}

export interface PartnerStatsResponse {
  /** live = 真实数据；demo = 演示数据，不代表经营事实 */
  dataMode: 'live' | 'demo'
  period: {
    label: string    // "本周" / "本月" / "本季度"
    from: string
    to: string
  }
  /** 当前快照——不受时间选择器影响，不显示环比 */
  snapshot: {
    publishedJobs: number
    publishedFairs: number
    activeSources: number
  }
  /** 周期内同步统计（含环比） */
  sync: {
    totalBatches: StatsMetric
    successRate: StatsMetric   // 0–100，null current 表示无数据
    totalAdded: StatsMetric
    totalFailed: StatsMetric
  }
  /** 按日趋势（长度 = 周期天数） */
  trend: StatsBucket[]
  /** 周期内同步状态分布 */
  statusDist: { success: number; partial: number; failed: number }
}

// ─── Mock 演示数据 ──────────────────────────────────────────────────────────

function buildDemoTrend(days: number): StatsBucket[] {
  // 固定演示序列，不依赖 Date.now()，避免伪造动态数据
  const BASE: [number, number, number][] = [
    [12, 4, 1], [8, 3, 0], [15, 6, 2], [10, 2, 0],
    [18, 7, 1], [6, 1, 0], [22, 8, 3], [14, 5, 0],
    [9, 3, 1], [11, 2, 0], [20, 9, 2], [7, 1, 0],
    [13, 4, 1], [17, 6, 0], [8, 2, 1], [19, 7, 0],
    [11, 3, 0], [14, 5, 2], [10, 2, 0], [16, 6, 1],
    [12, 4, 0], [9, 3, 1], [18, 7, 0], [13, 4, 2],
    [7, 1, 0], [21, 8, 1], [15, 5, 0], [11, 3, 1],
    [16, 6, 0], [10, 2, 0], [14, 4, 2],
  ]
  return Array.from({ length: days }, (_, i) => {
    const [a, u, f] = BASE[i % BASE.length]!
    // 用固定偏移标注演示日期（从 2026-05-20 起）
    const d = new Date('2026-05-20T00:00:00Z')
    d.setUTCDate(d.getUTCDate() + i)
    return { date: d.toISOString().slice(0, 10), added: a, updated: u, failed: f }
  })
}

function buildDemoStats(period: StatsPeriod): PartnerStatsResponse {
  const days = period === 'week' ? 7 : period === 'month' ? 30 : 90
  const trend = buildDemoTrend(days)
  const total = trend.reduce((s, b) => ({ a: s.a + b.added, u: s.u + b.updated, f: s.f + b.failed }), { a: 0, u: 0, f: 0 })
  const batches = days * 2   // 演示：每天约 2 个批次
  const successBatches = batches - total.f
  const prevBatches = Math.round(batches * 0.85)
  const prevSuccessBatches = prevBatches - Math.round(total.f * 0.9)
  const prevAdded = Math.round(total.a * 0.78)

  const labels: Record<StatsPeriod, [string, string, string]> = {
    week:    ['本周',   '2026-05-20', '2026-05-26'],
    month:   ['本月',   '2026-05-01', '2026-05-30'],
    quarter: ['本季度', '2026-04-01', '2026-06-30'],
  }
  const [label, from, to] = labels[period]

  return {
    dataMode: 'demo',
    period: { label, from, to },
    snapshot: { publishedJobs: 328, publishedFairs: 12, activeSources: 4 },
    sync: {
      totalBatches: {
        current: batches, previous: prevBatches,
        deltaPercent: Math.round(((batches - prevBatches) / prevBatches) * 100),
        comparisonLabel: `vs 上${period === 'week' ? '周' : period === 'month' ? '月' : '季度'}`,
      },
      successRate: {
        current: Math.round((successBatches / batches) * 100),
        previous: Math.round((prevSuccessBatches / prevBatches) * 100),
        deltaPercent: Math.round(((successBatches / batches) - (prevSuccessBatches / prevBatches)) * 100),
        comparisonLabel: `vs 上${period === 'week' ? '周' : period === 'month' ? '月' : '季度'}`,
      },
      totalAdded: {
        current: total.a, previous: prevAdded,
        deltaPercent: Math.round(((total.a - prevAdded) / prevAdded) * 100),
        comparisonLabel: `vs 上${period === 'week' ? '周' : period === 'month' ? '月' : '季度'}`,
      },
      totalFailed: {
        current: total.f, previous: Math.round(total.f * 1.2),
        deltaPercent: total.f === 0 ? null : -17,
        comparisonLabel: `vs 上${period === 'week' ? '周' : period === 'month' ? '月' : '季度'}`,
      },
    },
    trend,
    statusDist: {
      success: successBatches,
      partial: Math.round(batches * 0.06),
      failed: total.f,
    },
  }
}

// ─── HTTP 接口 ──────────────────────────────────────────────────────────────

async function fetchPartnerStats(period: StatsPeriod): Promise<PartnerStatsResponse> {
  const res = await fetch(`${API_BASE_URL}/partner/stats?period=${period}&timezone=Asia%2FShanghai`, {
    headers: { Accept: 'application/json', ...authHeader() },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(err.error?.message ?? `HTTP ${res.status}`)
  }
  const body = await res.json() as { data: PartnerStatsResponse }
  return body.data
}

// ─── 对外 API ───────────────────────────────────────────────────────────────

export async function getPartnerStats(period: StatsPeriod = 'week'): Promise<PartnerStatsResponse> {
  if (API_MODE !== 'http') return buildDemoStats(period)
  return fetchPartnerStats(period)
}
