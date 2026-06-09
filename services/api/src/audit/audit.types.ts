/**
 * 审计契约本地副本。
 *
 * **契约源**:packages/shared/src/types/audit.ts
 *
 * services/api 走 commonjs + node moduleResolution,无法直接 import 共享包;
 * 类型本地副本化、严格遵守 SSOT 注释,任何改动必须同步两处。
 *
 * 改动 checklist:
 *   1. 改 packages/shared/src/types/audit.ts
 *   2. 改本文件
 *   3. git diff 验证两边一致
 */

export type AuditAction =
  | 'file.upload'
  | 'file.force_delete'
  | 'file.cleanup_expired'
  | 'job.review'
  | 'job.publish'
  | 'job.import'
  | 'job_source.create'
  | 'job_source.update'
  | 'fair.review'
  | 'fair.publish'
  | 'fair.import'
  | 'data_source.create'
  | 'data_source.toggle'
  | 'resume.parse_submitted'
  | 'resume.optimize_requested'
  | 'assistant.chat_message'
  | 'organization.create'
  | 'organization.update'
  | 'user.create'
  | 'user.disable'
  | 'system.login'
  | 'system.config_change'
  // Sprint 1 / Task 2:打印运营订单管理(admin)
  | 'order.status_change'
  | 'order.refund'

export type AuditTargetType =
  | 'file'
  | 'job'
  | 'job_source'
  | 'organization'
  | 'fair'
  | 'fair_source'
  | 'user'
  | 'system'
  | 'order'

export interface AuditLogRecord {
  id: string
  actorId: string | null
  actorRole: string
  action: AuditAction | string
  targetType: AuditTargetType | string
  targetId: string | null
  payloadJson: string
  ipAddress: string | null
  userAgent: string | null
  requestId: string | null
  createdAt: string
}

export interface AuditLogListQuery {
  action?: AuditAction | string
  actorId?: string
  targetType?: AuditTargetType | string
  targetId?: string
  startAt?: string
  endAt?: string
  limit?: number
  offset?: number
}

export interface AuditLogListResponse {
  items: AuditLogRecord[]
  total: number
  limit: number
  offset: number
}
