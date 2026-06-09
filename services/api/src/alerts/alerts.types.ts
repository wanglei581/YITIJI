// ============================================================
// Admin 告警中心返回契约（Sprint 1 / Task 3）。
//
// 合规（CLAUDE.md §2/§8）：运营后台告警；处理/忽略仅为运营状态记录，
// 不直接远程控制设备。不返回任何用户 PII。
// ============================================================

export type AlertSeverity = 'info' | 'warning' | 'critical'
export type AlertStatus = 'new' | 'processing' | 'resolved' | 'ignored'

/** 列表行。 */
export interface AdminAlertListItem {
  id: string
  alertNo: string
  type: string
  severity: string
  status: string
  title: string
  terminalId: string | null
  deviceName: string | null
  handledBy: string | null
  /** 处理人展示名（由 handledBy 关联 User.name 解析；无则 null）。 */
  handlerName: string | null
  handledAt: string | null
  occurredAt: string
  updatedAt: string
}

export interface AdminAlertsListResponse {
  items: AdminAlertListItem[]
  total: number
  page: number
  pageSize: number
}

export interface AdminAlertDetail extends AdminAlertListItem {
  message: string | null
  /** 原始告警 payload 字符串（如有）。 */
  payloadJson: string | null
  handleNote: string | null
  createdAt: string
}
