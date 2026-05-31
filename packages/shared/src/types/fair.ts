/**
 * JobFair 契约(BE-7,P0 W2)。
 *
 * 服务端落地于 services/api/src/jobs/(JobFair / FairCompany / FairZone Prisma 模型)。
 * Kiosk 招聘会 7 子页(JobFairsPage / JobFairDetailPage / FairCompaniesPage
 * / FairCompanyDetailPage / FairMapPage / FairMaterialsPage / FairStatsPage)
 * 全部消费本契约。
 *
 * 合规约束(CLAUDE.md §10):
 *   - sourceOrgId / externalId / sourceUrl / sourceName 必填
 *   - reviewStatus 默认 pending,approve + publish 才在 C 端可见
 *   - 不存"预约人列表":预约一律走 sourceUrl 跳走对方平台,我方只记跳转计数
 *
 * 校企合作:不是独立模型,通过 theme='campus_corp' 复用 JobFair。
 */

/** 招聘会主题。 */
export type FairTheme =
  | 'general'      // 通用社招/校招
  | 'campus'       // 校园招聘会
  | 'campus_corp'  // 校企合作主题展(秒哒 kiosk/30-32)
  | 'industry'     // 行业专场

/** 审核状态(与 Job 一致)。 */
export type FairReviewStatus = 'pending' | 'reviewing' | 'approved' | 'rejected'

/** 发布状态(与 Job 一致)。 */
export type FairPublishStatus = 'draft' | 'published' | 'unpublished' | 'expired'

/** 招聘会主体。 */
export interface Fair {
  id: string

  // 来源
  sourceOrgId: string
  externalId: string
  sourceName: string
  sourceUrl: string

  // 招聘会信息
  title: string
  theme: FairTheme | string
  startAt: string  // ISO
  endAt: string    // ISO
  venue: string
  city: string
  address: string | null
  mapImageUrl: string | null
  description: string | null
  coverImageUrl: string | null

  // 数据快照(同步任务回填)
  companyCount: number
  jobCount: number
  viewCount: number

  // 状态机
  reviewStatus: FairReviewStatus | string
  publishStatus: FairPublishStatus | string
  reviewedBy: string | null
  reviewedAt: string | null
  rejectReason: string | null

  syncTime: string
  createdAt: string
  updatedAt: string
}

/** 参展企业。 */
export interface FairCompany {
  id: string
  jobFairId: string
  name: string
  logoUrl: string | null
  industry: string | null
  scale: string | null
  description: string | null
  sourceUrl: string | null
  hiringTags: string[]   // 后端是逗号分隔字符串,API 层 split 出 string[]
  jobsCount: number
  createdAt: string
  updatedAt: string
}

/** 创新展区 / 主题展区。 */
export interface FairZone {
  id: string
  jobFairId: string
  name: string
  category: string | null   // 'innovation' / 'service' / 'campus_corp_topic'
  city: string | null
  description: string | null
  coverImageUrl: string | null
  sortOrder: number
  createdAt: string
  updatedAt: string
}

/** 列表查询参数。 */
export interface FairListQuery {
  theme?: FairTheme | string
  city?: string
  startAfter?: string  // ISO,筛选未结束的招聘会
  limit?: number
  offset?: number
}

/** 列表响应。 */
export interface FairListResponse {
  items: Fair[]
  total: number
  limit: number
  offset: number
}

/** 详情响应(嵌入 companies + zones 快照,首屏一次拉到位)。 */
export interface FairDetailResponse {
  fair: Fair
  companies: FairCompany[]
  zones: FairZone[]
}
