/**
 * 岗位要求计数表契约（前端 SSOT）。
 *
 * 用途：22-career-plan.html 的 `ai-down` 支线要求「AI 不可用时仍然给出一张不依赖 AI 的
 * 岗位要求计数表」。这条降级路径的唯一数据来源是**已入库的真实岗位正文**，
 * 全程确定性聚合，**不调用任何大模型**。
 *
 * 三条必须被前端遵守的口径：
 *
 *  1. **证据分级恒为 E2（来源信息）**，不得标 E3（AI 判断）。计数是数出来的，不是判断出来的。
 *  2. **条数 = 本机见到的数量**，不是市场需求、不是前景排名、不是推荐。
 *     禁止在这张表上叠加任何投递 / 推荐 / 匹配裁决（CLAUDE.md §2）。
 *  3. **样本量不足时不给数字**：`sufficient === false` 的维度 `items` 恒为空数组，
 *     前端必须显示「数据不足」，不得自行拿 `statedCount` 去凑一个看起来像统计结果的展示。
 *
 * 后端副本：services/api/src/jobs/job-requirement-stats.rules.ts
 * 任何字段变更必须同时改两处。
 */

/** 统计维度。新增维度必须同时在后端 rules 里给出确定性抽取规则，不允许留空壳。 */
export type JobRequirementDimensionKey = 'education' | 'experience' | 'skill' | 'certificate'

/**
 * 抽取来源。
 *  - `field`：来源平台提供的结构化字段（educationRequirement / experienceRequirement / skills）
 *  - `text`：岗位正文（任职要求 + 岗位描述）里的确定性正则 / 词典命中
 * 两者都可能出现在同一维度；前端要如实展示，不要说成「AI 解析」。
 */
export type JobRequirementStatSource = 'field' | 'text'

/** 整批样本不足的机读原因。 */
export type JobRequirementSampleIssue =
  /** 筛选条件下一条已发布岗位都没有 */
  | 'no_matching_jobs'
  /** 有岗位，但没有一条读得到正文（只有标题的一律不计入） */
  | 'no_readable_jobs'
  /** 读得到正文的条数低于最低样本量门槛 */
  | 'below_min_sample'

/** 单个维度样本不足的机读原因。 */
export type JobRequirementDimensionIssue =
  /** 计数样本里明确写了这一维度的岗位数低于门槛 */
  'below_min_stated'

/** 计数样本的规模与口径。前端展示计数前必须先展示这一段。 */
export interface JobRequirementSampleInfo {
  /** 命中筛选条件的已审核已发布岗位总数（真实总数，不受单次统计上限影响）。 */
  matchedTotal: number
  /** 其中本机读得到正文的条数 —— 这是所有百分比的分母。 */
  countedTotal: number
  /** 只有标题、本机读不到正文，一律不参与计数。 */
  titleOnlyTotal: number
  /**
   * 是否因超过单次统计上限而被截断。
   * `true` 时 `countedTotal` / `titleOnlyTotal` 只描述「按同步时间倒序取到的前 `scanLimit` 条」，
   * 前端必须如实说明这一点，不得把它当成全量口径。
   */
  truncated: boolean
  /** 单次统计上限（条）。 */
  scanLimit: number
  /** 计数样本涉及的来源机构数。 */
  sourceOrgCount: number
  /** 计数样本里最近一次同步时间（ISO 8601）；无样本为 null。 */
  latestSyncTime: string | null
  /** 是否达到最低样本量门槛。false 时所有维度的 `items` 恒为空。 */
  sufficient: boolean
  /** 最低样本量门槛（条）。 */
  minSampleSize: number
  /** 不足的原因；`sufficient === true` 时为 null。 */
  issue: JobRequirementSampleIssue | null
}

/** 一个具体的要求取值及其出现条数。 */
export interface JobRequirementStatItem {
  /** 机读键（枚举维度为固定值；技能 / 证书为归一化后的原值键）。 */
  key: string
  /** 展示名。 */
  label: string
  /** 计数样本里出现这一取值的**岗位条数**（同一岗位内重复出现只计一次）。 */
  count: number
}

/** 单个维度的计数结果。 */
export interface JobRequirementDimensionStat {
  dimension: JobRequirementDimensionKey
  label: string
  /** 本维度实际用到的抽取来源。 */
  sources: JobRequirementStatSource[]
  /** 计数样本里**明确写了**这一维度的岗位条数（分子基数）。 */
  statedCount: number
  /** 分母，等于 `sample.countedTotal`。 */
  sampleSize: number
  /** 是否达到本维度门槛。false 时 `items` 恒为空数组。 */
  sufficient: boolean
  /** 最低有效陈述条数门槛。 */
  minStatedCount: number
  /** 不足的原因；`sufficient === true` 时为 null。 */
  issue: JobRequirementDimensionIssue | null
  /** 按条数降序、同条数按 key 升序；`sufficient === false` 时恒为 `[]`。 */
  items: JobRequirementStatItem[]
  /** 本维度的口径说明。前端直接展示，不要另行发明措辞。 */
  note: string
}

/** 本次统计实际生效的筛选条件（原样回显，便于前端说明「这是按什么数出来的」）。 */
export interface JobRequirementStatsFilter {
  keyword: string | null
  city: string | null
  category: string | null
  industry: string | null
  sourceOrgId: string | null
}

export interface JobRequirementStatsData {
  /** 统计口径版本；抽取规则或证书词典变更时递增。 */
  rulesVersion: string
  /** 证书词典版本；词典没收录的证书不会出现在计数里。 */
  certificateDictionaryVersion: string
  /**
   * 证据分级，恒为 `'E2'`。
   * 这是确定性聚合的结果，**不是 AI 判断**，前端不得标成 E3。
   */
  evidenceLevel: 'E2'
  filter: JobRequirementStatsFilter
  sample: JobRequirementSampleInfo
  dimensions: JobRequirementDimensionStat[]
  /** 必须随表展示的边界说明（口径照抄 22-career-plan.html 的纸面页脚）。 */
  boundaryNotes: string[]
}

export interface JobRequirementStatsResponse {
  data: JobRequirementStatsData
  success: true
}

/** 最低样本量门槛：读得到正文的岗位少于这个数，一律不给分布。 */
export const JOB_REQUIREMENT_MIN_SAMPLE_SIZE = 10

/** 单维度最低有效陈述条数：明确写了这一维度的岗位少于这个数，该维度不给分布。 */
export const JOB_REQUIREMENT_MIN_STATED_COUNT = 5
