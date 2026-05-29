import type {
  ReviewStatus,
  PublishStatus,
  JobFairStatus,
  SourceKind,
  AccessMode,
} from '@ai-job-print/shared'

export type { ReviewStatus, PublishStatus, JobFairStatus, SourceKind, AccessMode }

// ─── Data Sources ─────────────────────────────────────────────────────────────

export type ConnStatus = 'connected' | 'error' | 'disabled'
export type SyncFreq   = 'manual' | 'hourly' | 'daily' | 'weekly'

/**
 * Partner 端数据源。
 *
 * 数据源用 `sourceKind × accessMode` 双维度刻画:
 * - sourceKind:数据由谁提供(招聘平台 / 高校 / 人社局 / 招聘会主办方 / 聚合平台 / 手动)
 * - accessMode:用什么方式拉取(api / excel / csv / json / webhook / manual)
 *
 * 旧字段 `sourceType: 'excel'|'api'|'webhook'` 已在 B0 阶段废弃。
 */
export interface PartnerDataSource {
  id: string
  name: string
  sourceKind: SourceKind
  accessMode: AccessMode
  syncFreq: SyncFreq
  lastSyncTime: string
  connStatus: ConnStatus
  successCount: number
  failCount: number
  description: string
}

// ─── Jobs ─────────────────────────────────────────────────────────────────────

export type JobCategory = 'fulltime' | 'intern' | 'campus' | 'parttime'

export interface PartnerJobRecord {
  id: string
  externalId: string
  title: string
  company: string
  city: string
  category?: JobCategory
  sourceUrl: string
  syncTime: string
  reviewStatus: ReviewStatus
  publishStatus: PublishStatus
  sourceOrgId: string
  sourceName: string  // R2: added
}

// ─── Fairs ────────────────────────────────────────────────────────────────────

export interface PartnerFairRecord {
  id: string
  externalId: string
  name: string
  organizer: string
  startTime: string
  endTime: string
  venue: string
  status: JobFairStatus
  sourceUrl: string
  syncTime: string
  reviewStatus: ReviewStatus
  publishStatus: PublishStatus
  sourceOrgId: string
  sourceName: string  // R2: added
}

// ─── Import payloads ──────────────────────────────────────────────────────────

export interface ImportJobItem {
  externalId: string
  title: string
  company: string
  city: string
  sourceUrl: string
  salary?: string
  tags?: string[]
  description?: string
  requirements?: string
  industry?: string
  workType?: 'full_time' | 'part_time' | 'internship' | 'contract'
}

export interface ImportFairItem {
  externalId: string
  name: string
  organizer: string
  startTime: string
  endTime: string
  venue: string
  sourceUrl: string
  description?: string
  boothCount?: number
}

export interface ImportResult<T> {
  imported: number
  items: T[]
}

// ─── Sync Logs ────────────────────────────────────────────────────────────────

export type SyncDataType = 'job' | 'fair' | 'policy'
export type SyncResult   = 'success' | 'partial' | 'failed'

// R3: field names aligned with backend SyncLogEntry
export interface PartnerSyncLog {
  id: string
  no: string
  source: string
  dataType: SyncDataType
  addedCount: number      // R3: was successCount
  updatedCount: number    // R3: new field
  errorCount: number      // R3: was failCount
  dupCount: number
  errorFields: string | null
  errorDetail: string | null  // R3: was failReason
  syncTime: string
  status: SyncResult      // R3: was result
}
