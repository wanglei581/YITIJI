/**
 * 校园招聘聚合 —— 纯确定性规则。
 *
 * 契约源：packages/shared/src/types/campusRecruitmentStats.ts
 * 不直接 import @ai-job-print/shared（api 为 commonjs，shared 为 ESM-only）。
 *
 * 硬约束（verify:campus-recruitment-stats 静态守住）：
 *  - 不 import @nestjs/*、PrismaService、process.env、LLM。
 *  - 只计数场次 / 企业 / 岗位，不产出录用率、签约率、offer、候选人数量。
 *  - 每组必须带 sourceOrgId / sourceName / syncTime。
 */

export type CampusRecruitmentStatsEmptyReason = 'no_published_campus_records'

export interface CampusRecruitmentTimeBucket {
  period: string
  fairCount: number
}

export interface CampusRecruitmentSourceGroup {
  sourceOrgId: string
  sourceName: string
  syncTime: string
  fairCount: number
  companyCount: number
  openJobCount: number
  jobListingCount: number
  fairPositionCount: number
  timeDistribution: CampusRecruitmentTimeBucket[]
}

export interface CampusRecruitmentStatsData {
  groups: CampusRecruitmentSourceGroup[]
  reason: CampusRecruitmentStatsEmptyReason | null
  generatedAt: string
  truncated: boolean
  scanLimit: number
  notes: string[]
}

export const CAMPUS_RECRUITMENT_STATS_SCAN_LIMIT = 2000

export const CAMPUS_RECRUITMENT_STATS_NOTES: string[] = [
  '本页只聚合已审核且已发布的校园招聘会与校招岗位，每个数字都带来源机构与同步时间。',
  '不含招聘结果类指标；本平台无法证实录用、签约或候选人规模。',
  '无经核验数据时返回空集合，不使用示例数字。',
]

export const CAMPUS_FAIR_THEMES = ['campus', 'campus_corp'] as const

/** 与一体机 /campus 专区同一套校招识别词，避免列表能看见、统计看不见。 */
export const CAMPUS_TEXT_RE = /校园|校招|高校|大学|学院|应届|毕业生|双选|研究生|校企/

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000

export interface CampusFairRow {
  id: string
  sourceOrgId: string
  sourceName: string
  syncTime: Date
  theme: string
  title: string
  venue: string
  description: string | null
  startAt: Date
  companies: Array<{ name: string; positionCount: number }>
}

export interface CampusJobRow {
  sourceOrgId: string
  sourceName: string
  syncTime: Date
}

export function isCampusFair(row: {
  theme: string
  title: string
  venue: string
  description: string | null
  sourceName: string
}): boolean {
  if ((CAMPUS_FAIR_THEMES as readonly string[]).includes(row.theme)) return true
  return CAMPUS_TEXT_RE.test(`${row.title} ${row.venue} ${row.description ?? ''} ${row.sourceName}`)
}

export function shanghaiYearMonth(date: Date): string {
  const shifted = new Date(date.getTime() + SHANGHAI_OFFSET_MS)
  const year = shifted.getUTCFullYear()
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

interface MutableGroup {
  sourceOrgId: string
  sourceName: string
  syncTime: Date
  fairIds: Set<string>
  companyNames: Set<string>
  jobListingCount: number
  fairPositionCount: number
  months: Map<string, number>
}

function takeGroup(map: Map<string, MutableGroup>, sourceOrgId: string, sourceName: string, syncTime: Date): MutableGroup {
  let group = map.get(sourceOrgId)
  if (!group) {
    group = {
      sourceOrgId,
      sourceName: sourceName.trim() || sourceOrgId,
      syncTime,
      fairIds: new Set(),
      companyNames: new Set(),
      jobListingCount: 0,
      fairPositionCount: 0,
      months: new Map(),
    }
    map.set(sourceOrgId, group)
    return group
  }
  if (syncTime > group.syncTime) {
    group.syncTime = syncTime
    const trimmed = sourceName.trim()
    if (trimmed) group.sourceName = trimmed
  }
  return group
}

export function aggregateCampusRecruitmentStats(input: {
  fairs: CampusFairRow[]
  jobs: CampusJobRow[]
  generatedAt: Date
  truncated: boolean
  scanLimit?: number
}): CampusRecruitmentStatsData {
  const groups = new Map<string, MutableGroup>()

  for (const fair of input.fairs) {
    if (!isCampusFair(fair)) continue
    const group = takeGroup(groups, fair.sourceOrgId, fair.sourceName, fair.syncTime)
    if (group.fairIds.has(fair.id)) continue
    group.fairIds.add(fair.id)
    const period = shanghaiYearMonth(fair.startAt)
    group.months.set(period, (group.months.get(period) ?? 0) + 1)
    for (const company of fair.companies) {
      const name = company.name.trim()
      if (name) group.companyNames.add(name)
      group.fairPositionCount += Math.max(0, company.positionCount)
    }
  }

  for (const job of input.jobs) {
    const group = takeGroup(groups, job.sourceOrgId, job.sourceName, job.syncTime)
    group.jobListingCount += 1
  }

  const list: CampusRecruitmentSourceGroup[] = [...groups.values()]
    .map((group) => {
      const jobListingCount = group.jobListingCount
      const fairPositionCount = group.fairPositionCount
      return {
        sourceOrgId: group.sourceOrgId,
        sourceName: group.sourceName,
        syncTime: group.syncTime.toISOString(),
        fairCount: group.fairIds.size,
        companyCount: group.companyNames.size,
        openJobCount: jobListingCount + fairPositionCount,
        jobListingCount,
        fairPositionCount,
        timeDistribution: [...group.months.entries()]
          .map(([period, fairCount]) => ({ period, fairCount }))
          .sort((a, b) => a.period.localeCompare(b.period)),
      }
    })
    .sort((a, b) => {
      const byTime = b.syncTime.localeCompare(a.syncTime)
      return byTime !== 0 ? byTime : a.sourceName.localeCompare(b.sourceName, 'zh-CN')
    })

  return {
    groups: list,
    reason: list.length === 0 ? 'no_published_campus_records' : null,
    generatedAt: input.generatedAt.toISOString(),
    truncated: input.truncated,
    scanLimit: input.scanLimit ?? CAMPUS_RECRUITMENT_STATS_SCAN_LIMIT,
    notes: CAMPUS_RECRUITMENT_STATS_NOTES,
  }
}
