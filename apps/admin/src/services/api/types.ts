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

export interface AdminTerminalRecord {
  id: string
  terminalCode: string
  displayName: string | null
  macAddress: string | null
  locationLabel: string | null
  enabled: boolean
  orgId: string | null            // 所属机构 id；null = 未绑定
  orgName: string | null          // 所属机构名称
  registeredAt: string            // ISO
  lastSeenAt: string              // ISO
  online: boolean                 // lastSeenAt 距今 < 3 分钟 = true
  lastHeartbeatAt: string | null
  agentStatus: 'online' | 'offline' | 'error' | 'agent_degraded' | string | null
  localTaskDatabaseAvailable: boolean | null
  printerStatus: TerminalPrinterStatus | string | null
  agentVersion: string | null
  ipAddress: string | null
  diskFreeGb: number | null
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
}

// ─── Admin AI 服务管理类型 ─────────────────────────────────────
// 只含元数据，禁止出现简历正文/聊天原文/文件名/fileId

export type AiOperation =
  | 'parseResume'
  | 'optimizeResume'
  | 'generateResume'
  | 'chatAssistant'
  | 'classifyIntent'
  | 'jobRecommend'
  | 'jobExplain'
  | 'jobMatch'
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

export interface AdminAiUsage {
  providerName: string
  totalCalls: number
  successCount: number
  failCount: number
  successRate: number           // 0–100, one decimal
  avgLatencyMs: number          // success-only average
  byOperation: {
    parseResume: number
    optimizeResume: number
    generateResume: number
    chatAssistant: number
    classifyIntent: number
    jobRecommend: number
    jobExplain: number
    jobMatch: number
  }
  errorDistribution: Array<{ code: string; count: number }>
  tokenUsageTotals: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  costByOperation: Record<AiOperation, number>
  alerts: Array<{
    level: 'warning' | 'critical'
    code: string
    title: string
    detail: string
  }>
  estimatedCostCny: number
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
