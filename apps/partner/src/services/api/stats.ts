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
//
// ── C1 契约修复（2026-08-16）────────────────────────────────────────────────
//   1. 不再发送 ?timezone= —— 服务端 DTO 只白名单 period，全局 ValidationPipe
//      的 forbidNonWhitelisted 会把该参数拒成 400 VALIDATION_FAILED。
//      时区改由服务端在响应 `timezone` 字段单向声明，本文件照实渲染。
//   2. 不再取 body.data —— `services/api/src/orgs/` 的控制器一律返回裸对象
//      （全模块 ApiResponse 出现 0 次），与 orgSelf.ts / policies.ts 同惯例。
//   3. attribution 恒为 available:false —— 行为日志无不可变 sourceOrgId 快照，
//      demo 模式同样不得伪造漏斗。

import { formatDate } from '@ai-job-print/shared'
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

/**
 * 浏览 / 外部跳转 / 打印的机构归因。
 *
 * 当前恒为 `available: false`：`BrowseLog` / `ExternalJumpLog` 两张行为日志表
 * 都没有 `sourceOrgId` 字段，无法按机构归因。可以用 targetId 反查
 * `Job.sourceOrgId`，但那是**当前**归属而非不可变快照——内容换来源机构后
 * 历史统计会漂移，因此刻意不做。前端据此显示「暂无归因数据」，
 * 不得回退成估算值或演示漏斗。
 */
export interface StatsAttribution {
  available: false
  reason: string
  /** 归因落地后对每个分组生效的最小样本阈值（防小样本反推到个人） */
  minSampleThreshold: number
}

export interface PartnerStatsResponse {
  /** live = 真实数据；demo = 演示数据，不代表经营事实 */
  dataMode: 'live' | 'demo'
  /** 服务端声明的统计时区；客户端不传参、只照实渲染 */
  timezone: string
  period: {
    label: string    // "本周" / "本月" / "本季度"
    from: string
    to: string
  }
  /** 当前快照——不受时间选择器影响，不显示环比 */
  snapshot: {
    publishedJobs: number
    publishedFairs: number
    publishedCompanies: number
    publishedPolicies: number
    activeSources: number
    /** 待管理员审核（pending + reviewing）的内容总数 */
    pendingReview: number
  }
  /** 浏览/跳转/打印归因，恒不可用；见 StatsAttribution */
  attribution: StatsAttribution
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
    return { date: formatDate(d), added: a, updated: u, failed: f }
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
    timezone: 'Asia/Shanghai',
    period: { label, from, to },
    snapshot: {
      publishedJobs: 328,
      publishedFairs: 12,
      publishedCompanies: 26,
      publishedPolicies: 9,
      activeSources: 4,
      pendingReview: 4,
    },
    // demo 模式同样不伪造漏斗：归因缺不可变 sourceOrgId 快照，演示态也照实不可用
    attribution: {
      available: false,
      reason: 'missing_immutable_source_org_snapshot',
      minSampleThreshold: 5,
    },
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
  // 只发 period：服务端 PartnerStatsQueryDto 只白名单该字段，
  // 全局 ValidationPipe 的 forbidNonWhitelisted 会把任何多余参数（含 timezone）
  // 拒成 400 VALIDATION_FAILED。时区改由响应的 timezone 字段声明。
  const res = await fetch(`${API_BASE_URL}/partner/stats?period=${period}`, {
    headers: { Accept: 'application/json', ...authHeader() },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(err.error?.message ?? `HTTP ${res.status}`)
  }
  // orgs 模块控制器返回裸对象（全模块 ApiResponse 出现 0 次），不解包 body.data
  return await res.json() as PartnerStatsResponse
}

// ─── 对外 API ───────────────────────────────────────────────────────────────

export async function getPartnerStats(period: StatsPeriod = 'week'): Promise<PartnerStatsResponse> {
  if (API_MODE !== 'http') return buildDemoStats(period)
  return fetchPartnerStats(period)
}
