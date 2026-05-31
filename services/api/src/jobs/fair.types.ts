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
