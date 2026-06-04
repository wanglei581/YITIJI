import { API_MODE } from './client'
import { adminMockAdapter } from './adminMockAdapter'
import { adminHttpAdapter } from './adminHttpAdapter'
import type { AuditLogListQuery, AuditLogListResponse, AuditLogRecord } from './types'

export type { AuditLogListQuery, AuditLogListResponse, AuditLogRecord }

interface AdminAuditServiceInterface {
  getAuditLogs(query?: AuditLogListQuery): Promise<AuditLogListResponse>
}

const adapter: AdminAuditServiceInterface =
  API_MODE === 'http' ? adminHttpAdapter : adminMockAdapter

/** 拉取审计日志(GET /admin/audit-logs)。http 走真实后端,mock 返回示例数据。 */
export const getAuditLogs = (query?: AuditLogListQuery) => adapter.getAuditLogs(query)
