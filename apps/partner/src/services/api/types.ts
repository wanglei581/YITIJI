import type {
  ReviewStatus,
  PublishStatus,
  JobFairStatus,
  SourceKind,
  AccessMode,
  AuthType,
  ConnStatus,
  SyncFrequency,
  PartnerDataSourceView,
  DataSourceConfig,
  FieldMappingRule,
  MappingValidationError,
  ImportBatch,
  ImportRecord,
} from '@ai-job-print/shared'

export type {
  ReviewStatus,
  PublishStatus,
  JobFairStatus,
  SourceKind,
  AccessMode,
  AuthType,
  ConnStatus,
  SyncFrequency,
  DataSourceConfig,
  FieldMappingRule,
  MappingValidationError,
  ImportBatch,
  ImportRecord,
}

// ─── Data Sources ─────────────────────────────────────────────────────────────

/**
 * Partner 端数据源 UI 形状。
 *
 * Phase 7.11 R4 后契约已对齐 packages/shared/PartnerDataSourceView：
 *   - sourceKind / accessMode / syncFreq / connStatus / 凭证字段全部来自 shared
 *   - 不暴露 apiSecret / accessToken / webhookSecret 明文
 *   - credentialConfigured 是持久标志，webhookSecretOnce 仅创建时一次性返回
 *
 * 是 {@link DataSourceConfig} 的扁平 UI 投影，不替代后者作为完整配置存储模型。
 */
export type PartnerDataSource = PartnerDataSourceView

/** @deprecated 使用 SyncFrequency，本别名仅为兼容 Phase 7.10 前的调用点保留 */
export type SyncFreq = SyncFrequency

export interface CreateDataSourcePayload {
  name: string
  sourceKind?: SourceKind
  accessMode?: AccessMode
  syncFreq?: SyncFrequency
  description?: string
  endpoint?: string
  authType?: AuthType
  credential?: string
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
