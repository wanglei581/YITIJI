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
  | 'offline_agency.review'
  | 'offline_agency.publish'
  | 'offline_agency.delete'
  | 'job_source.create'
  | 'job_source.update'
  | 'fair.review'
  | 'fair.publish'
  | 'fair.import'
  | 'data_source.create'
  | 'data_source.toggle'
  | 'smart_campus_config.update'
  | 'partner.smart_campus_config.update'
  | 'toolbox_config.update'
  | 'terminal.org.update'
  | 'terminal.profile.update'
  | 'resume.parse_submitted'
  | 'resume.optimize_requested'
  | 'resume.self_assessment_create'
  | 'resume.self_assessment_view'
  | 'resume.self_assessment_print'
  | 'resume.self_assessment_withdraw'
  | 'assistant.chat_message'
  | 'auth.password_change_self'
  | 'auth.phone_initial_bind_start'
  | 'auth.phone_initial_bind_complete'
  | 'auth.phone_initial_bind_cancel'
  | 'auth.phone_transfer_start'
  | 'auth.phone_transfer_complete'
  | 'auth.phone_transfer_cancel'
  | 'auth.phone_released_by_admin'
  | 'organization.create'
  | 'organization.update'
  /** 内容信任标记（发布闸门的人工核验决策，见 src/common/content-trust.ts） */
  | 'organization.content_trust'
  | 'user.create'
  | 'user.disable'
  | 'system.login'
  | 'system.config_change'
  | 'print_job.admin_abandon'
  | 'print_job.admin_verify_outcome'
  | 'alert.acknowledge'
  | 'alert.silence'
  | 'alert.close'
  | 'alert.reopen'

export type AuditTargetType =
  | 'auth'
  | 'file'
  | 'job'
  | 'job_source'
  | 'offline_agency'
  | 'organization'
  | 'fair'
  | 'fair_source'
  | 'user'
  | 'system'
  | 'smart_campus_config'
  | 'toolbox_config'
  | 'terminal'
  | 'print_task'
  | 'derived_alert'

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
