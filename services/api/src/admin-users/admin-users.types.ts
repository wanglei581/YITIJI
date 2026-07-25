/**
 * CJS runtime mirror of packages/shared/src/types/adminUsers.ts.
 * Any contract change must update both files and run verify:admin-users.
 */

export type AdminUserActivityType = 'file' | 'print' | 'ai' | 'browse' | 'external_jump'

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
