// ============================================================
// 审核与发布状态
// ============================================================

/** 审核状态：pending 未审核 → reviewing 审核中 → approved 通过 / rejected 拒绝 */
export type ReviewStatus = 'pending' | 'reviewing' | 'approved' | 'rejected'

/** 发布状态：draft 草稿 → published 已发布 → unpublished 已下架 / expired 已过期 */
export type PublishStatus = 'draft' | 'published' | 'unpublished' | 'expired'

// ============================================================
// 外部数据核心模型
// ============================================================

export type JobFairStatus = 'upcoming' | 'ongoing' | 'ended'

export interface ExternalJobSource {
  sourceOrgId: string
  externalId: string
  sourceName: string
  sourceUrl: string
  syncTime: string
  reviewStatus: ReviewStatus
  publishStatus: PublishStatus
}

export interface ExternalJob extends ExternalJobSource {
  id: string
  title: string
  company: string
  city: string
  salary?: string
  tags: string[]
  description?: string
  requirements?: string
}

export interface ExternalJobFair extends ExternalJobSource {
  id: string
  name: string
  organizer: string
  startTime: string
  endTime: string
  venue: string
  status: JobFairStatus
  description?: string
  boothCount?: number
}

// ============================================================
// 数据源配置
// ============================================================

/**
 * 数据来源机构种类（描述"是谁提供数据"）
 * job_platform   — 招聘平台（智联/前程/Boss等）
 * hr_company     — 人力资源公司
 * school         — 高校就业系统
 * fair_organizer — 招聘会主办方
 * aggregator     — 第三方数据聚合平台
 * manual         — 后台手动录入
 */
export type SourceKind =
  | 'job_platform'
  | 'hr_company'
  | 'school'
  | 'fair_organizer'
  | 'aggregator'
  | 'manual'

/**
 * 数据接入方式（描述"用什么方式拉取数据"）
 * api      — REST/GraphQL API 接入
 * excel    — Excel 文件导入
 * csv      — CSV 文件导入
 * json     — JSON 文件导入
 * webhook  — 第三方主动推送
 * manual   — 后台手动录入
 */
export type AccessMode = 'api' | 'excel' | 'csv' | 'json' | 'webhook' | 'manual'

export type DataSourceStatus = 'active' | 'inactive' | 'error' | 'syncing'

/** bearer / oauth2 / api_key / basic / custom — 不允许使用 "key" 缩写 */
export type AuthType = 'bearer' | 'oauth2' | 'api_key' | 'basic' | 'custom'

export type SyncFrequency = 'realtime' | 'hourly' | 'daily' | 'weekly' | 'manual'

export type SyncStatus = 'success' | 'failed' | 'partial'

/**
 * 数据源连接状态（UI 表头使用）。
 * 由 `DataSourceConfig.enabled` × `DataSourceSync.lastSyncStatus` 派生：
 *   - !enabled                           → 'disabled'
 *   - enabled && lastSyncStatus==='failed' → 'error'
 *   - 其它                                → 'connected'
 */
export type ConnStatus = 'connected' | 'error' | 'disabled'

export interface SyncLogEntry {
  time: string
  status: SyncStatus
  addedCount: number
  updatedCount: number
  errorCount: number
  errorDetail?: string
}

/**
 * 数据源接入配置（前端可见部分，不含任何敏感凭证）
 * 敏感字段（apiSecret、accessToken 等）只保存在服务端，永远不出现在此类型中。
 */
export interface DataSourceAccess {
  // API 类接入 — 非敏感配置
  apiEndpoint?: string
  apiKeyHeader?: string       // 请求头名称，默认 X-API-Key
  authType?: AuthType
  credentialConfigured?: boolean  // 服务端是否已配置凭证（只读，不暴露具体值）

  // 文件导入类接入
  fileFormat?: 'excel' | 'csv' | 'json' | 'xml'
  fileFields?: Record<string, string>
}

export interface DataSourceSync {
  frequency: SyncFrequency
  lastSyncTime?: string
  lastSyncStatus?: SyncStatus
  lastSyncError?: string
  syncLog: SyncLogEntry[]
}

export interface DataSourceConfig {
  id: string
  name: string
  sourceKind: SourceKind
  accessMode: AccessMode
  orgId: string
  enabled: boolean
  syncEnabled: boolean
  access: DataSourceAccess
  sync: DataSourceSync
  fieldMapping: Record<string, string>  // 外部字段名 → 标准字段名
  createdAt: string
  updatedAt: string
}

/**
 * 合作机构后台数据源管理页消费的 UI 投影。
 *
 * 是 {@link DataSourceConfig} 的扁平、只读、安全展示形态：
 *   - 不暴露 `apiSecret` / `accessToken` / `webhookSecret` 明文
 *   - `credentialConfigured` 标志服务端是否已存凭证（持久语义，前端只读）
 *   - `webhookSecretOnce` 仅在 **创建 webhook 源** 那一次响应里返回，后续 GET 不再回显
 *   - `connStatus` 由 enabled × lastSyncStatus 派生（见 {@link ConnStatus}）
 *
 * 服务端 (services/api) 与前端 (apps/partner) 都消费这同一形状：
 * 后端 PartnerDataSourceDto 直接以本类型为契约，前端 PartnerDataSource = 本类型。
 */
export interface PartnerDataSourceView {
  id: string
  name: string
  sourceKind: SourceKind
  accessMode: AccessMode
  syncFreq: SyncFrequency
  lastSyncTime: string
  connStatus: ConnStatus
  successCount: number
  failCount: number
  description: string
  /** 服务端是否已配置 API 凭证 / Webhook 共享密钥（持久标志，只读） */
  credentialConfigured?: boolean
  /** API 直连模式的 endpoint（非敏感，可回显） */
  endpoint?: string
  /** Webhook 接收地址（相对路径 `/api/v1/sync/webhook?source=…`，前端按 origin 拼接） */
  webhookUrl?: string
  /** Webhook 共享密钥 — **只在创建那一刻返回一次**，永不出现在 GET 响应里 */
  webhookSecretOnce?: string
}

// ============================================================
// 字段映射
// ============================================================

export interface FieldMappingRule {
  externalField: string
  standardField: string
  required: boolean
  defaultValue?: string
  transform?: 'trim' | 'lowercase' | 'uppercase' | 'none'
}

export interface MappingValidationError {
  externalField: string
  standardField: string
  rowIndex?: number
  value: string
  reason: string
}

// ============================================================
// 导入批次（文件导入专用）
// ============================================================

export type ImportBatchStatus = 'pending' | 'validating' | 'confirmed' | 'failed' | 'cancelled'

export interface ImportBatch {
  id: string
  sourceId: string
  fileName: string
  fileSize: number
  totalRows: number
  validRows: number
  invalidRows: number
  dupRows: number
  status: ImportBatchStatus
  validationErrors: MappingValidationError[]
  createdAt: string
  confirmedAt?: string
  confirmedBy?: string
}

export interface ImportRecord {
  id: string
  batchId: string
  rowIndex: number
  rawData: Record<string, string>
  mappedData: Partial<ExternalJob> | Partial<ExternalJobFair>
  status: 'ok' | 'invalid' | 'dup'
  errors: MappingValidationError[]
}

// ============================================================
// Phase 7 DTO — 岗位展示
// ============================================================

/**
 * 岗位展示 DTO（/api/v1/jobs 接口响应类型）。
 * 继承 ExternalJob，新增展示友好字段。
 * 合规说明：不含企业联系方式，不含任何招聘闭环字段。
 */
export interface ExternalJobDTO extends ExternalJob {
  industry?: string
  /** 格式化薪资展示字符串，如 "8,000–12,000 元/月" */
  salaryDisplay: string
  workType?: 'full_time' | 'part_time' | 'internship' | 'contract'
  headcount?: number
  /** 合规来源说明（必须展示） */
  dataSourceNote: string
}
