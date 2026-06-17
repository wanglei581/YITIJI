/**
 * JobFair 契约本地副本(BE-7)。
 *
 * **契约源**:packages/shared/src/types/fair.ts
 *
 * services/api 走 commonjs + node moduleResolution,无法直接 import 共享包。
 * 任何字段改动必须同时改两处,git diff 验证。
 */

export type FairTheme =
  | 'general'
  | 'campus'
  | 'campus_corp'
  | 'industry'

export type FairReviewStatus = 'pending' | 'reviewing' | 'approved' | 'rejected'
export type FairPublishStatus = 'draft' | 'published' | 'unpublished' | 'expired'

/** 求职意向分布切片（机构录入的预计值，Kiosk 大屏展示用）。 */
export interface FairIntentSlice {
  label: string
  percent: number
}

export interface Fair {
  id: string
  sourceOrgId: string
  externalId: string
  sourceName: string
  sourceUrl: string
  title: string
  theme: FairTheme | string
  startAt: string
  endAt: string
  venue: string
  city: string
  address: string | null
  mapImageUrl: string | null
  description: string | null
  coverImageUrl: string | null
  hostSchoolName: string | null
  audienceLabel: string | null
  onsiteServices: string[]
  admissionMethod: string | null
  // P1-A① 招聘会大屏/地图字段（Admin 可录入，Kiosk 已消费）。
  // 注：本地 Fair 副本为支持 Admin 回填新增这几字段；packages/shared 的 Fair（Kiosk 契约源）
  // 按 P1-A① 范围不改——shared 不需要这些 admin 回填字段，差异为有意的局部分叉。
  latitude: number | null
  longitude: number | null
  trafficInfo: string | null
  expectedAttendance: number | null
  seekerIntent: FairIntentSlice[]
  companyCount: number
  jobCount: number
  viewCount: number
  reviewStatus: FairReviewStatus | string
  publishStatus: FairPublishStatus | string
  reviewedBy: string | null
  reviewedAt: string | null
  rejectReason: string | null
  syncTime: string
  createdAt: string
  updatedAt: string
}

export interface FairCompanyPosition {
  id: string
  title: string
  headcount: number
  salary: string | null
  requirements: string | null
  education: string | null
  experience: string | null
  location: string | null
  positionType: string | null
  department: string | null
  sourceUrl: string | null
}

export interface FairCompany {
  id: string
  jobFairId: string
  name: string
  logoUrl: string | null
  industry: string | null
  scale: string | null
  description: string | null
  sourceUrl: string | null
  hiringTags: string[]
  jobsCount: number
  // 展示扩展字段（参展企业汇编 / 企业详情）
  coverImageUrl: string | null
  founded: string | null
  headquarters: string | null
  registeredCapital: string | null
  honorTags: string[]
  zoneId: string | null
  /** 关联展区名称（经 zoneId join FairZone 回填；无关联或展区不存在 → null）。 */
  zoneName: string | null
  boothNumber: string | null
  positions: FairCompanyPosition[]
  createdAt: string
  updatedAt: string
}

export interface FairZone {
  id: string
  jobFairId: string
  name: string
  category: string | null
  city: string | null
  description: string | null
  coverImageUrl: string | null
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface FairListQuery {
  theme?: FairTheme | string
  city?: string
  startAfter?: string
  limit?: number
  offset?: number
}

export interface FairListResponse {
  items: Fair[]
  total: number
  limit: number
  offset: number
}

export interface FairDetailResponse {
  fair: Fair
  companies: FairCompany[]
  zones: FairZone[]
}
