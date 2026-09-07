/**
 * 校园招聘聚合统计契约（前端 SSOT）。
 *
 * GET /api/v1/kiosk/campus/recruitment-stats
 * 只聚合已审核且已发布的校园招聘会与校招岗位。每个数字必须能追到来源机构与同步时间。
 * 不含录用率、签约率、offer 数、候选人数量。
 *
 * 后端副本：services/api/src/jobs/campus-recruitment-stats.rules.ts
 * 任何字段变更必须同时改两处。
 */

/** 无经核验数据时的机读原因。有数据时恒为 null。 */
export type CampusRecruitmentStatsEmptyReason = 'no_published_campus_records'

/** 时间分布的一个月份桶（Asia/Shanghai 墙钟年月）。 */
export interface CampusRecruitmentTimeBucket {
  /** `YYYY-MM` */
  period: string
  fairCount: number
}

/**
 * 一个来源机构（学校就业中心 / 举办方）的聚合。
 * 所有计数只含该机构已审核已发布的校园招聘会与校招岗位。
 */
export interface CampusRecruitmentSourceGroup {
  sourceOrgId: string
  sourceName: string
  /** 该组记录中最近一次同步时间（ISO-8601）。 */
  syncTime: string
  /** 校园招聘会场次数。 */
  fairCount: number
  /** 参会企业数（场内企业名去重）。 */
  companyCount: number
  /**
   * 在招岗位数 = 校招岗位条数 + 场内已录入岗位条数。
   * 两套名录不去重；同一岗位若同时出现在岗位库与场内名录会计两次。
   */
  openJobCount: number
  /** 已审核已发布、category=campus 的岗位条数。 */
  jobListingCount: number
  /** 校园招聘会场内 FairCompanyPosition 条数。 */
  fairPositionCount: number
  timeDistribution: CampusRecruitmentTimeBucket[]
}

export interface CampusRecruitmentStatsData {
  groups: CampusRecruitmentSourceGroup[]
  /** `groups` 为空时给出原因；有数据时为 null。 */
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
