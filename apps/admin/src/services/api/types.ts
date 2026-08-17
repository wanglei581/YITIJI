import type { JobSourceQualitySummaryDTO, ReviewStatus, PublishStatus } from '@ai-job-print/shared'
import type { JobFairStatus } from '@ai-job-print/shared'
import type { AuditLogRecord, AuditLogListResponse, AuditLogListQuery } from '@ai-job-print/shared'

export type { ReviewStatus, PublishStatus, JobFairStatus }
export type { AuditLogRecord, AuditLogListResponse, AuditLogListQuery }

// ─── Device fleet overview (F0 只读白名单投影) ───────────────────────────────

export type DeviceFleetHealth = 'healthy' | 'degraded' | 'offline' | 'unknown'
export type DeviceFleetHealthReason =
  | 'heartbeat_fresh'
  | 'agent_reported_degraded'
  | 'agent_reported_offline'
  | 'agent_reported_error'
  | 'heartbeat_stale'
  | 'never_reported'
export type DeviceFleetConfigState = 'unconfigured' | 'configured' | 'legacy_reference' | 'conflict'
export type DeviceFleetConfigArea = 'screensaver' | 'smart_campus' | 'toolbox'
export type DeviceFleetIssueKind =
  | 'dual_reference_config'
  | 'cross_terminal_reference_collision'
  | 'orphan_config'

export interface DeviceFleetScreensaverConfig {
  state: DeviceFleetConfigState
  enabled: boolean | null
  playlistConfigured: boolean | null
  updatedAt: string | null
}

export interface DeviceFleetSmartCampusConfig {
  state: DeviceFleetConfigState
  enabled: boolean | null
  enabledModuleCount: number | null
  updatedAt: string | null
}

export interface DeviceFleetToolboxConfig {
  state: DeviceFleetConfigState
  enabled: boolean | null
  itemCount: number | null
  updatedAt: string | null
}

export interface DeviceFleetTerminal {
  terminalCode: string
  displayName: string | null
  locationLabel: string | null
  orgName: string | null
  enabled: boolean
  health: DeviceFleetHealth
  healthReason: DeviceFleetHealthReason
  lastHeartbeatAt: string | null
  agentVersion: string | null
  hasConfigurationConflict: boolean
  config: {
    screensaver: DeviceFleetScreensaverConfig
    smartCampus: DeviceFleetSmartCampusConfig
    toolbox: DeviceFleetToolboxConfig
  }
}

export interface DeviceFleetOverview {
  generatedAt: string
  onlineWindowSeconds: 180
  summary: {
    total: number
    healthy: number
    degraded: number
    offline: number
    unknown: number
    disabled: number
    configurationConflictTerminals: number
    orphanConfigurationRecords: number
  }
  terminals: DeviceFleetTerminal[]
  issues: Array<{
    area: DeviceFleetConfigArea
    kind: DeviceFleetIssueKind
    affectedTerminalCodes: string[]
  }>
}

// ─── Terminals (设备管理 — 终端心跳上报) ─────────────────────────────────────
// 严格对齐跨 agent 契约 C1 (GET /admin/terminals)。字段名/类型不得臆造。

/** 打印机状态枚举(取自最近一条 heartbeat 上报)。 */
export type TerminalPrinterStatus =
  | 'ok'
  | 'offline'
  | 'paper_empty'
  | 'error'
  | 'not_found'

export type TerminalLifecycleStatus =
  | 'planned'
  | 'commissioning'
  | 'active'
  | 'maintenance'
  | 'suspended'
  | 'retired'

export interface AdminTerminalRecord {
  id: string
  terminalCode: string
  displayName: string | null
  macAddress: string | null
  locationLabel: string | null
  enabled: boolean
  lifecycleStatus: TerminalLifecycleStatus
  lifecycleVersion: number
  credentialGeneration: number
  hasActiveCredential: boolean
  orgId: string | null            // 所属机构 id；null = 未绑定
  orgName: string | null          // 所属机构名称
  registeredAt: string            // ISO
  lastSeenAt: string              // ISO
  online: boolean                 // lastSeenAt 距今 < 3 分钟 = true
  lastHeartbeatAt: string | null
  agentStatus: 'online' | 'offline' | 'error' | 'agent_degraded' | string | null
  localTaskDatabaseAvailable: boolean | null
  printerStatus: TerminalPrinterStatus | string | null
  wiredNetworkStatus: 'connected' | 'disconnected' | 'unknown' | string | null
  printerNetworkStatus: 'reachable' | 'unreachable' | 'not_network_printer' | 'unknown' | string | null
  agentVersion: string | null
  ipAddress: string | null
  diskFreeGb: number | null
}

export interface CreatePlannedTerminalInput {
  terminalCode: string
  displayName?: string
  locationLabel?: string
  orgId?: string
}

export interface PlannedTerminalCreated {
  terminalId: string
  terminalCode: string
  displayName: string | null
  locationLabel: string | null
  orgId: string | null
  orgName: string | null
  enabled: boolean
  lifecycleStatus: 'planned'
}

export interface AdminTerminalsResponse {
  terminals: AdminTerminalRecord[]
}

// ─── 终端机构归属（绑定/解绑）─────────────────────────────────────────────────

/** 可绑定机构下拉项（仅 enabled）。 */
export interface AdminOrganizationOption {
  id: string
  name: string
  type: string
}

export interface AdminOrgOptionsResponse {
  organizations: AdminOrganizationOption[]
}

/** PATCH /admin/terminals/:id/org 返回。 */
export interface AssignTerminalOrgResult {
  terminalId: string
  terminalCode: string
  oldOrgId: string | null
  newOrgId: string | null
  orgName: string | null
}

export interface UpdateTerminalProfileInput {
  displayName?: string | null
  macAddress?: string | null
  locationLabel?: string | null
  enabled?: boolean
}

export interface UpdateTerminalProfileResult {
  terminalId: string
  terminalCode: string
  displayName: string | null
  macAddress: string | null
  locationLabel: string | null
  enabled: boolean
}

export interface UpdateTerminalLifecycleInput {
  targetStatus: 'active' | 'maintenance' | 'suspended' | 'retired'
  expectedStatus: Exclude<TerminalLifecycleStatus, 'planned' | 'retired'>
  expectedVersion: number
  reason: string
  confirmationText?: string
}

export interface UpdateTerminalLifecycleResult {
  terminalId: string
  terminalCode: string
  oldStatus: TerminalLifecycleStatus
  newStatus: TerminalLifecycleStatus
  inFlightTaskCount: number
  lifecycleVersion: number
  activePrintTaskCount?: number
  activeScanTaskCount?: number
  revokedCredentialCount?: number
  revokedBindCodeCount?: number
}

export interface EmergencyRevokeTerminalInput {
  expectedStatus: Exclude<TerminalLifecycleStatus, 'planned' | 'retired'>
  expectedVersion: number
  expectedCredentialGeneration: number
  reason: string
  confirmationText: string
}

export interface EmergencyRevokeTerminalResult {
  terminalId: string
  terminalCode: string
  oldStatus: TerminalLifecycleStatus
  newStatus: 'suspended'
  lifecycleVersion: number
  credentialGeneration: number
  revokedCredentialCount: number
  revokedBindCodeCount: number
  inFlightTaskCount: number
}

// ── 终端授权绑定码（一次性）────────────────────────────────────────────────────

/** POST /admin/terminals/:id/bind-code 返回。明文 bindCode 仅在本响应中返回一次。 */
export interface TerminalBindCodeCreated {
  terminalId: string
  terminalCode: string
  bindCode: string
  expiresAt: string
}

// ─── Printers (设备管理 — 打印机视图) ───────────────────────────────────────

export type AdminPrinterStatus = 'online' | 'offline' | 'error'
export type AdminPaperStatus = 'normal' | 'low' | 'empty' | 'jam' | 'unknown'

export interface AdminPrinterRecord {
  id: string
  terminalId: string
  terminalCode: string
  name: string
  model: string | null
  serialNumber: string | null
  status: AdminPrinterStatus
  printerStatus: TerminalPrinterStatus | string | null
  currentTask: string | null
  tonerLevel: number | null
  paperTrayLevel: number | null
  paperStatus: AdminPaperStatus | null
  fault: string | null
  lastHeartbeatAt: string | null
  lastSyncAt: string | null
}

export interface AdminPrintersResponse {
  printers: AdminPrinterRecord[]
}

// R1: Added sourceOrgId, sourceUrl, description, tags, requirements
export interface AdminJobSourceRecord {
  id: string
  sourceId?: string        // JobSource.id — set when imported via Excel/Webhook
  sourceOrgId: string
  sourceName: string
  externalId: string
  sourceUrl: string
  title: string
  company: string
  city: string
  salary: string
  tags: string[]
  description?: string
  requirements?: string
  industry?: string
  syncTime: string
  reviewStatus: ReviewStatus
  publishStatus: PublishStatus
  rejectReason?: string | null
}

// R1: Added sourceOrgId, sourceUrl, description
export interface AdminFairSourceRecord {
  id: string
  sourceOrgId: string
  sourceName: string
  externalId: string
  sourceUrl: string
  checkinUrl?: string
  name: string
  organizer: string
  startTime: string
  endTime: string
  venue: string
  status: JobFairStatus
  description?: string
  boothCount?: number
  syncTime: string
  reviewStatus: ReviewStatus
  publishStatus: PublishStatus
  rejectReason?: string | null
}

// ─── Admin AI 服务管理类型 ─────────────────────────────────────
// 只含元数据，禁止出现简历正文/聊天原文/文件名/fileId

export type AiOperation =
  | 'parseResume'
  | 'optimizeResume'
  | 'adjustResumeLayout'
  | 'generateResume'
  | 'chatAssistant'
  | 'classifyIntent'
  | 'jobRecommend'
  | 'jobExplain'
  | 'jobMatch'
  // A-6 成本可见性补齐（2026-07-31）
  | 'careerPlan'
  | 'fairVisitPlan'
  | 'interviewQuestion'
  | 'interviewReport'
  | 'voiceTranscribe'   // ASR：按时长计费，estimatedCostCny 通常为 undefined
  | 'voiceSynthesize'   // TTS：按字符计费，estimatedCostCny 通常为 undefined
  | 'selfAssessment'    // 自我探索 · 倾向参考（2026-08-01）
  | 'contractReview'    // 合同审查（2026-08-17）：此前完全不落 AiServiceLog


export type AiLogStatus = 'success' | 'failed'
export type JobSourceQualitySummary = JobSourceQualitySummaryDTO

export interface AdminAiLogEntry {
  taskId: string
  operation: AiOperation
  provider: string
  status: AiLogStatus
  latencyMs: number
  createdAt: string    // ISO string from backend, formatted string from mock
  errorCode?: string
  tokenUsage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  estimatedCostCny?: number
  terminalId?: string | null
}

/**
 * 单个能力的成本三态（后端真相源：services/api/src/ai/ai-log.service.ts AiOperationCost）。
 *
 * 纯 number 的 0 同时兼表「花了 0 元」和「没采集到」，前端只能一律渲染 ¥0.0000，
 * 对真实付费调用少算成本且运营看不出来。三态判定：
 * - calls === 0                      → 无调用
 * - calls > 0 且 measuredCalls === 0 → **未采集**，必须显示「未估算」，禁止显示 ¥0
 * - measuredCalls > 0                → cny 为已采集部分；不足 calls 时还要标注剩余未估算
 */
export interface AiOperationCost {
  cny: number
  calls: number
  measuredCalls: number
}

export interface AdminAiUsage {
  providerName: string
  totalCalls: number
  successCount: number
  failCount: number
  successRate: number           // 0–100, one decimal
  avgLatencyMs: number          // success-only average
  byOperation: Record<AiOperation, number>
  errorDistribution: Array<{ code: string; count: number }>
  tokenUsageTotals: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  /** 分能力成本三态。**不是纯 number** —— 见 AiOperationCost。 */
  costByOperation: Record<AiOperation, AiOperationCost>
  alerts: Array<{
    level: 'warning' | 'critical'
    code: string
    title: string
    detail: string
  }>
  /** 已采集部分的成本合计。unmeasuredCalls > 0 时这是**下限**，不是全部花费。 */
  estimatedCostCny: number
  /** 窗口内成本未采集的调用数。 */
  unmeasuredCalls: number
  /** token 用量开始采集的日期（YYYY-MM-DD）。此前的调用未采集，且**不回填**。 */
  costCollectionSince: string
}

export interface AdminAiLogsResult {
  total: number
  entries: AdminAiLogEntry[]
}

// ─── Import Batches ────────────────────────────────────────────────────────────

export interface AdminImportBatch {
  id: string
  sourceId: string
  sourceName: string
  orgId: string
  orgName: string
  dataType: 'job' | 'fair'
  fileName: string
  totalRows: number
  validRows: number
  invalidRows: number
  dupRows: number
  status: 'pending' | 'confirmed' | 'cancelled' | 'failed'
  createdBy: string
  confirmedAt: string | null
  createdAt: string
}
