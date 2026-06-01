import type { ReviewStatus, PublishStatus } from '@ai-job-print/shared'
import type { JobFairStatus } from '@ai-job-print/shared'

export type { ReviewStatus, PublishStatus, JobFairStatus }

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

export type AiOperation = 'parseResume' | 'optimizeResume' | 'chatAssistant' | 'classifyIntent'
export type AiLogStatus = 'success' | 'failed'

export interface AdminAiLogEntry {
  taskId: string
  operation: AiOperation
  provider: string
  status: AiLogStatus
  latencyMs: number
  createdAt: string    // ISO string from backend, formatted string from mock
  errorCode?: string
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
    chatAssistant: number
    classifyIntent: number
  }
  errorDistribution: Array<{ code: string; count: number }>
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
