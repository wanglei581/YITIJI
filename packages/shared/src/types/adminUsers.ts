import type { EndUserStatus } from './member-privacy'

export type AdminUserActivityType = 'file' | 'print' | 'ai' | 'browse' | 'external_jump'

/**
 * 管理员可以直接写入的两个账号状态。
 *
 * 刻意窄于 EndUserStatus：`closing` 与 `anonymized` 属于用户自助注销流程，
 * 由隐私执行器推进。`anonymized` 的手机号标识已被替换为墓碑值，
 * 「恢复」在物理上无法还原，任何把它并进本类型的改动都是数据事故。
 */
export type AdminUserManagedStatus = Extract<EndUserStatus, 'active' | 'disabled'>

/** 停用与恢复共用的请求体。reason 必填，事后追责唯一依据。 */
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
  /**
   * 账号状态事实源。`enabled` 是迁移期保留的旧门禁字段，两者同事务双写。
   * UI 必须按 status 而不是 !enabled 决定能否「恢复」：closing / anonymized
   * 同样是 enabled=false，但它们不可恢复。
   */
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
