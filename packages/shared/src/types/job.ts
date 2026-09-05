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

/** 求职意向分布切片（数据大屏饼图；机构录入的预计值，非实时） */
export interface FairIntentSlice {
  label: string
  /** 占比百分数 0–100 */
  percent: number
}

/** 参展企业行业分布切片（数据大屏柱状图；按已录企业聚合） */
export interface FairIndustrySlice {
  label: string
  count: number
}

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
  /** 来源平台/官方签到入口。Kiosk 仅用于“扫码前往来源平台签到”，不记录签到结果。 */
  checkinUrl?: string
  /** 招聘岗位数（快照，卡片"N 个岗位"展示） */
  jobCount?: number
  /** 主题：general 综合 / campus 校园 / campus_corp 校企合作 / industry 行业专场 */
  theme?: string
  // ── 招聘会详情/导航/预计（对齐 JobFair 表，均为展示用，非招聘闭环）──
  /** 城市（列表城市标签筛选） */
  city?: string
  /** 详细地址（导航块展示） */
  address?: string
  /** 静态导览图 / 地图截图 URL */
  mapImageUrl?: string
  /** 场馆纬度（生成手机导航深链用） */
  latitude?: number
  /** 场馆经度 */
  longitude?: number
  /** 交通指引文字（地铁/公交/自驾） */
  trafficInfo?: string
  /** 预计参会人数（机构录入，标注"预计"，非实时） */
  expectedAttendance?: number
  /** 预计求职意向分布（机构录入，数据大屏饼图） */
  seekerIntent?: FairIntentSlice[]
  // ── 企业速览展示字段（机构/管理员录入，纯展示，后台可更新）──
  /** 副标题（Hero 标语，如「智能招聘·职面未来」） */
  tagline?: string
  /** 现场服务清单（如 自助打印 / AI求职助手 / 导览地图） */
  onsiteServices?: string[]
  /** 入场方式说明（如「凭学生证或身份证免费入场」） */
  admissionMethod?: string
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
  /**
   * Webhook 共享密钥 — **只在创建那一刻、或一次轮换响应里返回一次**，
   * 永不出现在 GET 响应里。见 {@link PartnerDataSourceCredentialRotationResult}。
   */
  webhookSecretOnce?: string
  /** API/Webhook 由管理员启停；文件/手工来源可由机构自助启停。 */
  activationManagedBy?: 'admin' | 'partner'
  /**
   * 已归档：来源停止接收 Webhook 推送与 API 拉取，且不再参与内容发布治理。
   * 归档是数据源的退役路径（**不做物理删除**，理由见
   * services/api/src/jobs/jobs-partner.service.ts 的 archivePartnerDataSource 注释）。
   */
  archived?: boolean
  /** 归档时间（ISO 8601）；未归档为 null。 */
  archivedAt?: string | null
  /**
   * 凭证最近一次轮换时间（ISO 8601）；从未轮换为 null。
   * 只是时间戳，不含任何密钥内容，可安全回显——供机构确认轮换是否已生效。
   */
  credentialRotatedAt?: string | null
}

/**
 * `POST /partner/data-sources/:id/rotate-credential` 的响应契约。
 *
 * 安全口径（CLAUDE.md §12 / §18）：
 *   - `webhookSecretOnce` **只在本次轮换响应里出现一次**，此后任何 GET 都不回显；
 *     前端必须提示用户当场保存，不得写入 localStorage 或日志。
 *   - `api` 接入模式不返回任何密钥：上游 token 由机构自己从来源平台取得，
 *     平台无法代为签发，只负责加密保存。
 *   - 轮换后旧密钥**立即失效**（库里单值覆盖，无双密钥灰度窗口）。
 *   - 请求必须带 {@link ROTATE_CREDENTIAL_CONFIRMATION}；空 body 不会生成新密钥。
 *   - 归档源禁止轮换。紧急停止接收推送请归档（partner 不能 toggle 管理员托管源）。
 */
export const ROTATE_CREDENTIAL_CONFIRMATION = 'ROTATE_CREDENTIAL' as const

/** Webhook 自填密钥写入下限。验签路径不使用本常量，避免存量短密钥推送全挂。 */
export const WEBHOOK_SECRET_MIN_LENGTH = 32

export interface PartnerDataSourceCredentialRotationResult {
  id: string
  accessMode: AccessMode
  /** 轮换后服务端是否持有凭证（正常轮换必为 true） */
  credentialConfigured: boolean
  /** 本次轮换时间（ISO 8601） */
  rotatedAt: string
  /** 仅 webhook 模式返回，且仅此一次 */
  webhookSecretOnce?: string
}

/**
 * `GET /partner/data-sources/capabilities` 的响应契约。
 *
 * 权威实现是服务端 `services/api/src/jobs/partner-capabilities.ts` 的
 * PARTNER_CAPABILITY_MATRIX——**本接口只是它的形状声明，不是第二份规则**。
 * Partner 控制台按这里的布尔值决定入口是否可点/侧栏是否展示；服务端按同一份矩阵
 * 拒写。前端不得另写一份机构类型判断。
 */
export interface PartnerDataSourceCapabilities {
  orgType: string
  allowedAccessModes: AccessMode[]
  allowedSourceKinds: SourceKind[]
  defaultSourceKind: SourceKind
  adminManagedAccessModes: AccessMode[]
  canImportJobs: boolean
  canImportFairs: boolean
  /** 能否创建政策内容（policies.service.ts 的 ORG_TYPE_NOT_ALLOWED_FOR_POLICY 同源）。 */
  canManagePolicies: boolean
  /** 能否读写智慧校园配置（smart-campus.service.ts 的 PARTNER_NOT_SCHOOL 同源，读写都拒）。 */
  canManageSmartCampus: boolean
  /** 能否维护企业展示资料（写入范围见 companyManageScope）。 */
  canManageCompanies: boolean
  /**
   * unrestricted：不额外限制；
   * fair_associated：招聘会主办方只能维护本机构招聘会已录入的参展企业；
   * own_enterprise：企业来源方只能维护本企业（名称与机构名称一致）。
   */
  companyManageScope: 'unrestricted' | 'fair_associated' | 'own_enterprise'
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

export type JobQualityLevel = 'ready' | 'partial' | 'insufficient'

export interface JobNormalizedFields {
  educationRequirement?: string
  experienceRequirement?: string
  skills?: string[]
  benefits?: string[]
  salaryMin?: number
  salaryMax?: number
  salaryUnit?: 'monthly' | 'yearly' | 'daily' | string
  validThrough?: string
}

export interface JobDataQualitySnapshotDTO {
  id: string
  jobId: string
  sourceOrgId: string
  missingFields: string[]
  qualityLevel: JobQualityLevel
  sourceUrlReachable: boolean | null
  checkedAt: string
  lastError?: string | null
}

export interface JobSourceQualitySummaryDTO {
  sourceOrgId: string
  sourceId: string | null
  totalJobs: number
  readyJobs: number
  partialJobs: number
  insufficientJobs: number
  staleJobs: number
  brokenSourceUrlJobs: number
  lastCheckedAt: string | null
}

/**
 * 岗位展示 DTO（/api/v1/jobs 接口响应类型）。
 * 继承 ExternalJob，新增展示友好字段。
 * 合规说明：不含企业联系方式，不含任何招聘闭环字段。
 */
export interface ExternalJobDTO extends ExternalJob, JobNormalizedFields {
  industry?: string
  /** 格式化薪资展示字符串，如 "8,000–12,000 元/月" */
  salaryDisplay: string
  workType?: 'full_time' | 'part_time' | 'internship' | 'contract' | 'campus'
  /** 岗位类型原值（DB category 列）：fulltime 全职 / intern 实习 / campus 校招 / parttime 兼职 */
  category?: 'fulltime' | 'intern' | 'campus' | 'parttime'
  headcount?: number
  /** 合规来源说明（必须展示） */
  dataSourceNote: string
  /** 企业展示关联（可选）：有值时前端可提供「查看企业」入口（/companies/:id） */
  companyProfileId?: string | null
}
