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
  // ── 企业速览展示字段（原设计：机构/管理员录入，纯展示，后台可更新）──
  //
  // ⚠️ 现状核实（2026-09-02，全路径 grep 复核，非 basename 匹配）：以下三个字段
  // **服务端从来不赋值** —— Prisma 的 `JobFair` 模型没有对应列，
  // `services/api/src/jobs/fair.mapper.ts` 也不产出它们；真实接口返回的招聘会
  // 永远 undefined。当前唯一的赋值点是 kiosk 本地 mock
  // `apps/kiosk/src/data/externalSources.ts`（MOCK_FAIRS，仅 mockAdapter 走），
  // 而 `apps/kiosk/src/pages/campus/{CampusPage,components/CampusTabs}.tsx` 会照常渲染。
  // 结果就是：**只有跑 mock 时校园页才显示这三行，接真后整段静默消失。**
  //
  // 曾被 2026-08 两份评审同时点名，条目号 FA4 / A4「无数据库来源却在校园页展示」：
  //   - docs/product/partner-console-integration-plan-2026-08.md（P0-12）
  //   - docs/reviews/four-chain-data-integrity-ledger-2026-08.md
  // 两份都给了同一个二选一：**要么补数据源，要么移除展示**。
  //
  // 因此本次未删除（删了会直接打断 kiosk 那两个渲染分支，且 P0-12 的裁决尚未落地）。
  // 谁来补：Partner/Admin 招聘会域负责人按 P0-12 二选一收口 ——
  // 走「补数据源」就要 JobFair 加列 + Partner 录入表单 + fair.mapper 输出；
  // 走「移除展示」就同时删本段字段与 kiosk 两处渲染，并清掉 MOCK_FAIRS 里的赋值。
  // 在此之前，任何新页面都不要再依赖这三个字段（接真即空）。

  /** 副标题（Hero 标语，如「智能招聘·职面未来」）。⚠️ 见上：服务端无来源，仅 kiosk mock 有值。 */
  tagline?: string
  /** 现场服务清单（如 自助打印 / AI求职助手 / 导览地图）。⚠️ 见上：服务端无来源，仅 kiosk mock 有值。 */
  onsiteServices?: string[]
  /** 入场方式说明（如「凭学生证或身份证免费入场」）。⚠️ 见上：服务端无来源，仅 kiosk mock 有值。 */
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
  /** Webhook 共享密钥 — **只在创建那一刻返回一次**，永不出现在 GET 响应里 */
  webhookSecretOnce?: string
  /** API/Webhook 由管理员启停；文件/手工来源可由机构自助启停。 */
  activationManagedBy?: 'admin' | 'partner'
}

export interface PartnerDataSourceCapabilities {
  orgType: string
  allowedAccessModes: AccessMode[]
  allowedSourceKinds: SourceKind[]
  defaultSourceKind: SourceKind
  adminManagedAccessModes: AccessMode[]
  canImportJobs: boolean
  canImportFairs: boolean
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
