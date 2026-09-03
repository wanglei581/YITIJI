/**
 * CJS runtime mirror of packages/shared/src/types/adminUsers.ts.
 * Any contract change must update both files and run verify:admin-users.
 */

export type AdminUserActivityType = 'file' | 'print' | 'ai' | 'browse' | 'external_jump'

/**
 * 与 packages/shared/src/types/member-privacy.ts 的 END_USER_STATUSES 保持一致。
 * services/api 走 commonjs，不直接 import @ai-job-print/shared，故在此镜像。
 */
export type EndUserStatus = 'active' | 'disabled' | 'closing' | 'anonymized'

/**
 * 管理员可以直接写入的两个账号状态。
 *
 * 刻意窄于 EndUserStatus：`closing` 与 `anonymized` 属用户自助注销流程，
 * `anonymized` 已把手机号换成墓碑值，「恢复」在物理上无法还原。
 */
export type AdminUserManagedStatus = Extract<EndUserStatus, 'active' | 'disabled'>

export type AdminUserStatusIntent = 'disable' | 'restore'

export interface AdminUserStatusChangeRequest {
  reason: string
}

export interface AdminUserStatusChangeResult {
  user: AdminUserListItem
  /** false = 账号已处于目标状态，本次调用未产生新事实，也未写审计。 */
  changed: boolean
  statusChangedAt: string | null
}

export interface AdminUserListQuery {
  page: number
  pageSize: 10 | 20 | 50 | 100
  keyword?: string
  phone?: string
  enabled?: boolean
  registeredFrom?: string
  registeredTo?: string
}

export interface AdminUserListItem {
  id: string
  nickname: string | null
  maskedPhone: string
  enabled: boolean
  /** 账号状态事实源；`enabled` 是迁移期保留的旧门禁字段，两者同事务双写。 */
  status: EndUserStatus
  lastLoginAt: string | null
  createdAt: string
}

export interface AdminUserListResult {
  items: AdminUserListItem[]
  total: number
  page: number
  pageSize: number
}

export interface AdminUserActivityItem {
  id: string
  type: AdminUserActivityType
  occurredAt: string
  status: string | null
  terminalId: string | null
  category: string | null
  action: string | null
}

export interface AdminUserDetailResult {
  user: AdminUserListItem & { updatedAt: string }
  stats: {
    fileCount: number
    printTaskCount: number
    aiResultCount: number
    browseCount: number
    externalJumpCount: number
  }
  recentActivities: AdminUserActivityItem[]
  retentionNotice: string
}

export interface AdminUserAuditContext {
  actorId: string
  actorRole: string
  ipAddress: string | null
  userAgent: string | null
  requestId: string | null
}
