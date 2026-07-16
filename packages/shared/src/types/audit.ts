/**
 * 审计日志契约(BE-2)。
 *
 * 服务端落地于 services/api/src/audit,数据库表 AuditLog(BE-1 一并建好)。
 * 前端 Admin 审计页(apps/admin/src/routes/audit/)消费本契约。
 *
 * 合规约束(CLAUDE.md §11/§12):
 *   - 所有 admin / partner 写操作必须落审计
 *   - 同步写入(不走异步队列),demo 时点击强制清理立即看到日志
 *   - 数据库层不暴露 DELETE / UPDATE,业务层只 INSERT + SELECT
 *   - 保留期 ≥ 180 天
 */

/**
 * action 字符串字面量并集,格式 `<resource>.<verb>`。
 * 新增动作必须先在这里声明,服务端枚举一致。
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
  | 'smart_campus_config.update'
  | 'partner.smart_campus_config.update'
  | 'toolbox_config.update'
  | 'terminal.org.update'
  | 'terminal.profile.update'
  | 'resume.parse_submitted'
  | 'resume.optimize_requested'
  | 'assistant.chat_message'
  | 'auth.password_change_self'
  | 'auth.phone_initial_bind_start'
  | 'auth.phone_initial_bind_complete'
  | 'auth.phone_initial_bind_cancel'
  | 'organization.create'
  | 'organization.update'
  | 'user.create'
  | 'user.disable'
  | 'system.login'
  | 'system.config_change'

export type AuditTargetType =
  | 'auth'
  | 'file'
  | 'job'
  | 'job_source'
  | 'organization'
  | 'fair'
  | 'fair_source'
  | 'user'
  | 'system'
  | 'smart_campus_config'
  | 'toolbox_config'
  | 'terminal'

/** 单条审计返回。actorRole 冗余,actor 被禁用后仍可追溯。 */
export interface AuditLogRecord {
  id: string
  actorId: string | null
  actorRole: string  // 'admin' | 'partner' | 'kiosk' | 'system'
  action: AuditAction | string  // string 兜底未来新增的动作
  targetType: AuditTargetType | string
  targetId: string | null
  payloadJson: string  // JSON 字符串,前端 JSON.parse 后展示
  ipAddress: string | null
  userAgent: string | null
  requestId: string | null
  createdAt: string  // ISO
}

/** 审计列表查询(Admin)。 */
export interface AuditLogListQuery {
  /** 按动作名过滤(精确)。 */
  action?: AuditAction | string
  /** 按 actor 用户过滤。 */
  actorId?: string
  /** 按目标资源类型过滤。 */
  targetType?: AuditTargetType | string
  /** 按目标资源 id 过滤。 */
  targetId?: string
  /** 起始时间(ISO,>=)。 */
  startAt?: string
  /** 结束时间(ISO,<)。 */
  endAt?: string
  /** 分页 limit(默认 50,上限 500)。 */
  limit?: number
  /** 偏移(默认 0)。 */
  offset?: number
}

/** 列表返回带 total,供分页器用。 */
export interface AuditLogListResponse {
  items: AuditLogRecord[]
  total: number
  limit: number
  offset: number
}
