import type { ReviewStatus, PublishStatus, JobFairStatus } from '@ai-job-print/shared'

export type { ReviewStatus, PublishStatus, JobFairStatus }

// ─── Data Sources ─────────────────────────────────────────────────────────────

export type ConnStatus = 'connected' | 'error' | 'disabled'
export type SyncFreq   = 'manual' | 'hourly' | 'daily' | 'weekly'

export interface PartnerDataSource {
  id: string
  name: string
  sourceType: 'excel' | 'api' | 'webhook'
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
