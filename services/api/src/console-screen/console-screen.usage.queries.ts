import { SCREEN_MIN_AGGREGATE_SAMPLE, type ScreenContentType, type ScreenUsageRange } from './console-screen.types'
import { daysAgoStart, recruitmentHostingLimit, shanghaiDayKey, shanghaiDayStart } from './console-screen.metric'
import { partnerSourceOrgWhere, type PartnerOrgId } from './console-screen.org'
import type { PrismaService } from '../prisma/prisma.service'

/**
 * heat / pulse 先取出 createdAt，再在内存里按 Asia/Shanghai 分桶。
 * SQLite 与 PostgreSQL 的日期函数不一样，SQL 分桶不能两边共用。
 * 6 万行只带一个时间戳，大约数 MB；再多就整项拒绝，不返回半截桶。
 */
export const USAGE_EVENT_ROW_CAP = 60_000

/** SQLite 默认绑定变量上限 999。200 留给出 where 里的其它条件。 */
export const USAGE_ID_CHUNK = 200

export const USAGE_HEAT_DAYS = 7
export const USAGE_PULSE_BUCKETS = 24
export const USAGE_PULSE_BUCKET_MINUTES = 5

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const PULSE_BUCKET_MS = USAGE_PULSE_BUCKET_MINUTES * 60 * 1000

/**
 * 服务节点口径。verify:console-screen-usage 逐项钉住。
 * classifyIntent 是助手内部的意图分类，不进 aiAdvisor，避免一轮对话算两次。
 * voiceTranscribe / voiceSynthesize / contractReview 不单独成节点。
 * 这四类仍进入 ai.byOperation。AI 节点只数 status=success。
 */
export const USAGE_SERVICE_NODES = [
  { key: 'jobs', lane: 'info', coverage: 'members_only', kind: 'browse', targetTypes: ['job'] },
  { key: 'fairs', lane: 'info', coverage: 'members_only', kind: 'browse', targetTypes: ['job_fair', 'fair_company'] },
  { key: 'policy', lane: 'info', coverage: 'members_only', kind: 'browse', targetTypes: ['policy'] },
  { key: 'company', lane: 'info', coverage: 'members_only', kind: 'browse', targetTypes: ['company_profile'] },
  { key: 'aiResume', lane: 'ai', coverage: 'all_recorded', kind: 'ai_success', operations: ['parseResume', 'optimizeResume', 'adjustResumeLayout', 'generateResume'] },
  { key: 'aiAdvisor', lane: 'ai', coverage: 'all_recorded', kind: 'ai_success', operations: ['chatAssistant'] },
  { key: 'interview', lane: 'ai', coverage: 'all_recorded', kind: 'ai_success', operations: ['interviewQuestion', 'interviewReport'] },
  { key: 'careerPlan', lane: 'ai', coverage: 'all_recorded', kind: 'ai_success', operations: ['careerPlan', 'selfAssessment'] },
  { key: 'jobAi', lane: 'ai', coverage: 'all_recorded', kind: 'ai_success', operations: ['jobRecommend', 'jobExplain', 'jobMatch', 'fairVisitPlan'] },
  { key: 'print', lane: 'print', coverage: 'all_recorded', kind: 'print_created' },
  { key: 'scan', lane: 'print', coverage: 'all_recorded', kind: 'scan_created' },
] as const

/** 成功的解析、面试报告、职业规划。诊断包算在 parseResume 里。 */
export const USAGE_AI_REPORT_OPERATIONS = ['parseResume', 'interviewReport', 'careerPlan'] as const

export const USAGE_RESUME_EXPORT_ACTION = 'resume.diagnosis_exported'

export const USAGE_FALLBACK_PROVIDERS = ['mock', 'stub'] as const

const PROVIDER_LABELS: Record<string, string> = {
  'llm:deepseek': 'DeepSeek',
  'llm:qwen': '千问',
  mock: '未就绪兜底',
  stub: '未就绪兜底',
}

export function usageProviderLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider
}

export function suppressSmallCount(count: number): number | null {
  return count >= SCREEN_MIN_AGGREGATE_SAMPLE ? count : null
}

export function usageWindow(range: ScreenUsageRange, now: Date): { from: Date; to: Date } {
  if (range === 'today') return { from: shanghaiDayStart(now), to: now }
  if (range === '7d') return { from: daysAgoStart(now, 7), to: now }
  return { from: daysAgoStart(now, 30), to: now }
}

export function shanghaiHour(date: Date): number {
  return new Date(date.getTime() + SHANGHAI_OFFSET_MS).getUTCHours()
}

export function usageDayKeys(from: Date, to: Date): string[] {
  const keys: string[] = []
  for (let cursor = shanghaiDayStart(from).getTime(); cursor <= to.getTime(); cursor += DAY_MS) {
    keys.push(shanghaiDayKey(new Date(cursor)))
  }
  return keys
}

/** 近 2 小时对齐到上海时区的 5 分钟刻度，最后一桶是当前未走完的桶。 */
export function pulseWindowStart(now: Date): Date {
  const shifted = new Date(now.getTime() + SHANGHAI_OFFSET_MS)
  const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
  const floored = Math.floor(minutes / USAGE_PULSE_BUCKET_MINUTES) * USAGE_PULSE_BUCKET_MINUTES
  const dayStart = new Date(shifted.getTime())
  dayStart.setUTCHours(0, 0, 0, 0)
  const floorUtc = new Date(dayStart.getTime() + floored * 60 * 1000 - SHANGHAI_OFFSET_MS)
  return new Date(floorUtc.getTime() - (USAGE_PULSE_BUCKETS - 1) * PULSE_BUCKET_MS)
}

export interface UsageTimeline {
  capped: boolean
  rows: number
  lanes: { info: Date[]; ai: Date[]; print: Date[] }
}

interface CreatedReader {
  count(args: { where: { createdAt: { gte: Date; lte: Date } } }): Promise<number>
  findMany(args: {
    where: { createdAt: { gte: Date; lte: Date } }
    select: { createdAt: true }
    take: number
  }): Promise<Array<{ createdAt: Date }>>
}

function emptyLanes(): UsageTimeline['lanes'] {
  return { info: [], ai: [], print: [] }
}

export async function loadUsageTimeline(
  prisma: PrismaService,
  from: Date,
  to: Date,
  rowCap: number,
): Promise<UsageTimeline> {
  const readers: Array<{ lane: 'info' | 'ai' | 'print'; reader: CreatedReader }> = [
    { lane: 'info', reader: prisma.browseLog },
    { lane: 'info', reader: prisma.externalJumpLog },
    { lane: 'info', reader: prisma.favorite },
    { lane: 'ai', reader: prisma.aiServiceLog },
    { lane: 'print', reader: prisma.printTask },
    { lane: 'print', reader: prisma.scanTask },
  ]
  const where = { createdAt: { gte: from, lte: to } }
  const counts = await Promise.all(readers.map((item) => item.reader.count({ where })))
  const rows = counts.reduce((sum, count) => sum + count, 0)
  if (rows > rowCap) return { capped: true, rows, lanes: emptyLanes() }
  const fetched = await Promise.all(readers.map((item) => item.reader.findMany({
    where,
    select: { createdAt: true },
    take: rowCap + 1,
  })))
  const fetchedRows = fetched.reduce((sum, item) => sum + item.length, 0)
  if (fetched.some((item) => item.length > rowCap) || fetchedRows > rowCap) {
    return { capped: true, rows: fetchedRows, lanes: emptyLanes() }
  }
  const lanes: UsageTimeline['lanes'] = { info: [], ai: [], print: [] }
  fetched.forEach((item, index) => {
    lanes[readers[index]!.lane].push(...item.map((row) => row.createdAt))
  })
  return { capped: false, rows: fetchedRows, lanes }
}

export interface UsageAiRow {
  operation: string
  status: string
  count: number
}

export interface UsageProviderRow {
  provider: string | null
  count: number
}

export interface AdminUsageFacts {
  channels: {
    paidOrders: number
    kiosk: number
    miniapp: number
    unlabeled: number
    memberOrders: number
  }
  browseByType: Record<string, number>
  favoriteByType: Record<string, number>
  jumpByType: Record<string, number>
  jumpTotal: number
  favoriteTotal: number
  ai: UsageAiRow[]
  providers: UsageProviderRow[]
  fallbackCalls: number
  estimatedCostCny: number
  costMeasuredCalls: number
  avgLatencyMs: number | null
  printCreated: number
  scanCreated: number
  printed: number
  resumeExported: number
}

function paidWhere(from: Date, to: Date): { payStatus: 'paid'; paidAt: { gte: Date; lte: Date } } {
  return { payStatus: 'paid', paidAt: { gte: from, lte: to } }
}

/** 完成时间优先 completedAt。只标了 printOutcome=printed 且没有 completedAt 的，用 updatedAt。 */
function printedWhere(from: Date, to: Date) {
  const span = { gte: from, lte: to }
  return {
    OR: [
      { status: 'completed', completedAt: span },
      { printOutcome: 'printed', completedAt: span },
      { printOutcome: 'printed', completedAt: null, updatedAt: span },
    ],
  }
}

function recordCounts(rows: Array<{ key: string; count: number }>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const row of rows) out[row.key] = (out[row.key] ?? 0) + row.count
  return out
}

export async function loadAdminUsageFacts(
  prisma: PrismaService,
  from: Date,
  to: Date,
): Promise<AdminUsageFacts> {
  const created = { createdAt: { gte: from, lte: to } }
  const paid = paidWhere(from, to)
  const [
    paidOrders,
    kiosk,
    miniapp,
    unlabeled,
    memberOrders,
    browseRows,
    favoriteRows,
    favoriteTotal,
    jumpRows,
    jumpTotal,
    aiRows,
    providerRows,
    fallbackCalls,
    measured,
    latency,
    printCreated,
    scanCreated,
    printed,
    resumeExported,
  ] = await Promise.all([
    prisma.order.count({ where: paid }),
    prisma.order.count({ where: { ...paid, channel: 'kiosk' } }),
    prisma.order.count({ where: { ...paid, channel: 'miniapp_cloud' } }),
    prisma.order.count({ where: { ...paid, OR: [{ channel: null }, { channel: '' }] } }),
    prisma.order.count({ where: { ...paid, endUserId: { not: null } } }),
    prisma.browseLog.groupBy({ by: ['targetType'], where: created, _count: { _all: true } }),
    prisma.favorite.groupBy({ by: ['targetType'], where: created, _count: { _all: true } }),
    prisma.favorite.count({ where: created }),
    prisma.externalJumpLog.groupBy({ by: ['targetType'], where: created, _count: { _all: true } }),
    prisma.externalJumpLog.count({ where: created }),
    prisma.aiServiceLog.groupBy({ by: ['operation', 'status'], where: created, _count: { _all: true } }),
    prisma.aiServiceLog.groupBy({ by: ['provider'], where: created, _count: { _all: true } }),
    prisma.aiServiceLog.count({ where: { ...created, provider: { in: [...USAGE_FALLBACK_PROVIDERS] } } }),
    prisma.aiServiceLog.aggregate({
      where: { ...created, estimatedCostCny: { not: null } },
      _sum: { estimatedCostCny: true },
      _count: true,
    }),
    prisma.aiServiceLog.aggregate({
      where: { ...created, status: 'success', latencyMs: { not: null } },
      _avg: { latencyMs: true },
    }),
    prisma.printTask.count({ where: created }),
    prisma.scanTask.count({ where: created }),
    prisma.printTask.count({ where: printedWhere(from, to) }),
    prisma.auditLog.count({ where: { ...created, action: USAGE_RESUME_EXPORT_ACTION } }),
  ])
  const cost = measured._sum.estimatedCostCny ?? 0
  return {
    channels: { paidOrders, kiosk, miniapp, unlabeled, memberOrders },
    browseByType: recordCounts(browseRows.map((row) => ({ key: row.targetType, count: row._count._all }))),
    favoriteByType: recordCounts(favoriteRows.map((row) => ({ key: row.targetType, count: row._count._all }))),
    jumpByType: recordCounts(jumpRows.map((row) => ({ key: row.targetType, count: row._count._all }))),
    jumpTotal,
    favoriteTotal,
    ai: aiRows.map((row) => ({ operation: row.operation, status: row.status, count: row._count._all })),
    providers: providerRows.map((row) => ({ provider: row.provider, count: row._count._all })),
    fallbackCalls,
    estimatedCostCny: Math.round(cost * 1_000_000) / 1_000_000,
    costMeasuredCalls: measured._count,
    avgLatencyMs: latency._avg.latencyMs === null ? null : Math.round(latency._avg.latencyMs),
    printCreated,
    scanCreated,
    printed,
    resumeExported,
  }
}

export interface OwnedContent {
  type: ScreenContentType
  targetType: string
  rows: Array<{ id: string; title: string }>
}

/**
 * 四张内容表都有 sourceOrgId。FairCompany 没有机构列，也不在机构端类型里。
 * 企业资料的展示名在 name，没有 title 列。
 */
export async function loadOwnedContent(prisma: PrismaService, orgId: PartnerOrgId): Promise<OwnedContent[]> {
  const where = partnerSourceOrgWhere(orgId)
  const [jobs, fairs, policies, companies] = await Promise.all([
    prisma.job.findMany({ where, select: { id: true, title: true } }),
    prisma.jobFair.findMany({ where, select: { id: true, title: true } }),
    prisma.policyPost.findMany({ where, select: { id: true, title: true } }),
    prisma.companyProfile.findMany({ where, select: { id: true, name: true } }),
  ])
  return [
    { type: 'job', targetType: 'job', rows: jobs },
    { type: 'job_fair', targetType: 'job_fair', rows: fairs },
    { type: 'policy', targetType: 'policy', rows: policies },
    { type: 'company_profile', targetType: 'company_profile', rows: companies.map((row) => ({ id: row.id, title: row.name })) },
  ]
}

function countsTowardPartnerDaily(type: ScreenContentType): boolean {
  return recruitmentHostingLimit() === 'enabled' || type === 'policy'
}

function chunkIds(ids: string[]): string[][] {
  const chunks: string[][] = []
  for (let offset = 0; offset < ids.length; offset += USAGE_ID_CHUNK) {
    chunks.push(ids.slice(offset, offset + USAGE_ID_CHUNK))
  }
  return chunks
}

async function countOwned(
  countChunk: (chunk: string[]) => Promise<number>,
  ids: string[],
): Promise<number> {
  if (ids.length === 0) return 0
  let total = 0
  for (const chunk of chunkIds(ids)) total += await countChunk(chunk)
  return total
}

export interface PartnerUsageFacts {
  byType: Array<{ type: ScreenContentType; browse: number; favorites: number; sourceOpens: number }>
  dailyCapped: boolean
  dailyRows: number
  browseTimes: Date[]
  jumpTimes: Date[]
  top: Array<{ type: ScreenContentType; title: string; browse: number }>
}

export async function loadPartnerUsageFacts(
  prisma: PrismaService,
  orgId: PartnerOrgId,
  from: Date,
  to: Date,
  rowCap: number,
): Promise<PartnerUsageFacts> {
  const owned = await loadOwnedContent(prisma, orgId)
  const created = { gte: from, lte: to }
  const byType = []
  const topCandidates: PartnerUsageFacts['top'] = []
  let browseRows = 0
  let jumpRows = 0
  for (const content of owned) {
    const ids = content.rows.map((row) => row.id)
    const titles = new Map(content.rows.map((row) => [row.id, row.title]))
    const [browse, favorites, sourceOpens] = await Promise.all([
      countOwned(
        (chunk) => prisma.browseLog.count({ where: { targetType: content.targetType, targetId: { in: chunk }, createdAt: created } }),
        ids,
      ),
      countOwned(
        (chunk) => prisma.favorite.count({ where: { targetType: content.targetType, targetId: { in: chunk }, createdAt: created } }),
        ids,
      ),
      countOwned(
        (chunk) => prisma.externalJumpLog.count({ where: { targetType: content.targetType, targetId: { in: chunk }, createdAt: created } }),
        ids,
      ),
    ])
    byType.push({ type: content.type, browse, favorites, sourceOpens })
    if (countsTowardPartnerDaily(content.type)) {
      browseRows += browse
      jumpRows += sourceOpens
    }
    for (const chunk of chunkIds(ids)) {
      const grouped = await prisma.browseLog.groupBy({
        by: ['targetId'],
        where: { targetType: content.targetType, targetId: { in: chunk }, createdAt: created },
        _count: { _all: true },
      })
      for (const row of grouped) {
        if (row._count._all < SCREEN_MIN_AGGREGATE_SAMPLE) continue
        const title = titles.get(row.targetId)
        if (!title) continue
        topCandidates.push({ type: content.type, title, browse: row._count._all })
      }
    }
  }
  const dailyRows = browseRows + jumpRows
  const topPool = recruitmentHostingLimit() === 'enabled'
    ? topCandidates
    : topCandidates.filter((item) => item.type === 'policy')
  const top = topPool
    .sort((a, b) => b.browse - a.browse || a.title.localeCompare(b.title) || a.type.localeCompare(b.type))
    .slice(0, 5)
  if (dailyRows > rowCap) {
    return { byType, dailyCapped: true, dailyRows, browseTimes: [], jumpTimes: [], top }
  }
  const browseTimes: Date[] = []
  const jumpTimes: Date[] = []
  for (const content of owned) {
    if (!countsTowardPartnerDaily(content.type)) continue
    const ids = content.rows.map((row) => row.id)
    for (const chunk of chunkIds(ids)) {
      const [browses, jumps] = await Promise.all([
        prisma.browseLog.findMany({
          where: { targetType: content.targetType, targetId: { in: chunk }, createdAt: created },
          select: { createdAt: true },
          take: rowCap + 1,
        }),
        prisma.externalJumpLog.findMany({
          where: { targetType: content.targetType, targetId: { in: chunk }, createdAt: created },
          select: { createdAt: true },
          take: rowCap + 1,
        }),
      ])
      if (browses.length > rowCap || jumps.length > rowCap) {
        return { byType, dailyCapped: true, dailyRows, browseTimes: [], jumpTimes: [], top }
      }
      browseTimes.push(...browses.map((row) => row.createdAt))
      jumpTimes.push(...jumps.map((row) => row.createdAt))
    }
  }
  if (browseTimes.length + jumpTimes.length > rowCap) {
    return { byType, dailyCapped: true, dailyRows: browseTimes.length + jumpTimes.length, browseTimes: [], jumpTimes: [], top }
  }
  return { byType, dailyCapped: false, dailyRows, browseTimes, jumpTimes, top }
}
