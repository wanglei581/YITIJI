import { API_MODE, API_BASE_URL, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

// ─── Types(镜像后端 services/api/src/alerts/alerts.types.ts)──────────────────
//
// 后端各端点以 ApiResponse<T>(即 { data: T })包装,http adapter 内拆 .data。
// 合规:运营告警;处理/忽略仅运营状态记录,不远程控制设备。

export type AlertSeverity = 'info' | 'warning' | 'critical'
export type AlertStatus = 'new' | 'processing' | 'resolved' | 'ignored'

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
  payloadJson: string | null
  handleNote: string | null
  createdAt: string
}

export interface ListAlertsOptions {
  keyword?: string
  severity?: string
  status?: string
  type?: string
  terminalId?: string
  page?: number
  pageSize?: number
}

export interface AdminAlertsServiceInterface {
  /** GET /admin/alerts — 告警列表(筛选 + 分页) */
  listAlerts(opts?: ListAlertsOptions): Promise<AdminAlertsListResponse>
  /** GET /admin/alerts/:id — 详情 */
  getAlert(id: string): Promise<AdminAlertDetail>
  /** PATCH /admin/alerts/:id/status — 处理告警(运营状态记录,不远程控制设备,后端写审计) */
  updateAlertStatus(id: string, status: 'processing' | 'resolved' | 'ignored', note?: string): Promise<AdminAlertDetail>
}

// ─── HTTP adapter ─────────────────────────────────────────────────────────────

function handleAuthFailure(status: number, code: string): void {
  if (status === 401) {
    redirectToLogin()
    throw new ApiHttpError(code || 'AUTH_REQUIRED', '登录已过期', status)
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...authHeader() }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    credentials: 'include',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) {
    let code = `HTTP_${res.status}`
    let message = res.statusText
    try {
      const errBody = (await res.json()) as { error?: { code?: string; message?: string } }
      if (errBody.error?.code) code = errBody.error.code
      if (errBody.error?.message) message = errBody.error.message
    } catch {
      /* keep defaults */
    }
    handleAuthFailure(res.status, code)
    throw new ApiHttpError(code, message, res.status)
  }
  return res.json() as Promise<T>
}

async function unwrap<T>(p: Promise<{ data: T }>): Promise<T> {
  return (await p).data
}

function buildQuery(opts?: ListAlertsOptions): string {
  const q = new URLSearchParams()
  if (opts?.keyword && opts.keyword.trim()) q.set('keyword', opts.keyword.trim())
  if (opts?.severity) q.set('severity', opts.severity)
  if (opts?.status) q.set('status', opts.status)
  if (opts?.type) q.set('type', opts.type)
  if (opts?.terminalId) q.set('terminalId', opts.terminalId)
  if (opts?.page != null) q.set('page', String(opts.page))
  if (opts?.pageSize != null) q.set('pageSize', String(opts.pageSize))
  const qs = q.toString()
  return qs ? `?${qs}` : ''
}

export const adminAlertsHttpAdapter: AdminAlertsServiceInterface = {
  listAlerts(opts) {
    return unwrap(request<{ data: AdminAlertsListResponse }>('GET', `/admin/alerts${buildQuery(opts)}`))
  },
  getAlert(id) {
    return unwrap(request<{ data: AdminAlertDetail }>('GET', `/admin/alerts/${encodeURIComponent(id)}`))
  },
  updateAlertStatus(id, status, note) {
    return unwrap(
      request<{ data: AdminAlertDetail }>('PATCH', `/admin/alerts/${encodeURIComponent(id)}/status`, { status, ...(note ? { note } : {}) }),
    )
  },
}

// ─── Mock adapter(无后端时本地演示,字段形状与后端一致)─────────────────────────

type MockAlert = AdminAlertDetail

function seedMockAlerts(): MockAlert[] {
  const mk = (
    n: number, type: string, severity: string, status: string, title: string,
    message: string, terminalId: string | null, deviceName: string | null,
    payloadJson: string | null, occurredAt: string, handledAt: string | null, handleNote: string | null,
  ): MockAlert => ({
    id: `ma-${n}`,
    alertNo: `ALT-20260609-${String(n).padStart(6, '0')}`,
    type, severity, status, title,
    terminalId, deviceName,
    handledBy: handledAt ? 'mock-admin' : null,
    handlerName: handledAt ? '运维(示例)' : null,
    handledAt,
    occurredAt,
    updatedAt: occurredAt,
    message,
    payloadJson,
    handleNote,
    createdAt: occurredAt,
  })
  return [
    mk(1, 'printer-fault', 'critical', 'new', '打印机卡纸故障', '卡纸故障，打印任务队列阻塞，需人工处理', 'KSK-008', 'Pantum-CM2820-008', '{"errorCode":"PAPER_JAM"}', '2026-06-09T01:45:00.000Z', null, null),
    mk(2, 'device-offline', 'critical', 'new', '终端心跳超时离线', '终端心跳超时，已离线超过 2 小时', 'KSK-007', 'KSK-007 主机', null, '2026-06-08T23:30:00.000Z', null, null),
    mk(3, 'toner-low', 'warning', 'processing', '碳粉余量低', '碳粉余量低于 10%（当前 8%）', 'KSK-003', 'Pantum-CM2820-003', '{"tonerPercent":8}', '2026-06-09T00:12:00.000Z', null, null),
    mk(4, 'paper-empty', 'warning', 'new', '纸盒已空', '纸盒已空，无法执行打印任务', 'KSK-005', 'Pantum-CM2820-005', null, '2026-06-09T00:05:00.000Z', null, null),
    mk(5, 'sync-fail', 'info', 'resolved', '岗位数据同步失败', '市人才网岗位数据同步失败，重试后成功', null, '数据同步服务', '{"httpStatus":503}', '2026-06-08T06:00:00.000Z', '2026-06-08T06:10:00.000Z', '系统自动重试后恢复'),
    mk(6, 'ai-call-fail', 'warning', 'ignored', 'AI 简历解析超时', 'AI 简历解析接口响应超时（>30s）', 'KSK-004', 'AI服务', null, '2026-06-08T07:58:00.000Z', '2026-06-08T08:05:00.000Z', '偶发超时，已忽略'),
  ]
}

let mockStore: MockAlert[] | null = null
function getStore(): MockAlert[] {
  if (!mockStore) mockStore = seedMockAlerts()
  return mockStore
}
const delay = (ms = 200) => new Promise<void>((r) => setTimeout(r, ms))
function toDetail(a: MockAlert): AdminAlertDetail {
  return { ...a }
}

export const adminAlertsMockAdapter: AdminAlertsServiceInterface = {
  async listAlerts(opts) {
    await delay()
    let rows = getStore()
    if (opts?.severity) rows = rows.filter((a) => a.severity === opts.severity)
    if (opts?.status) rows = rows.filter((a) => a.status === opts.status)
    if (opts?.type) rows = rows.filter((a) => a.type === opts.type)
    if (opts?.terminalId) rows = rows.filter((a) => a.terminalId === opts.terminalId)
    if (opts?.keyword && opts.keyword.trim()) {
      const s = opts.keyword.trim()
      rows = rows.filter((a) => a.title.includes(s) || (a.message ?? '').includes(s) || a.alertNo.includes(s))
    }
    const total = rows.length
    const page = opts?.page ?? 1
    const pageSize = opts?.pageSize ?? 20
    const items = rows.slice((page - 1) * pageSize, page * pageSize).map((a) => {
      const { message, payloadJson, handleNote, createdAt, ...rest } = a
      void message; void payloadJson; void handleNote; void createdAt
      return { ...rest }
    })
    return { items, total, page, pageSize }
  },
  async getAlert(id) {
    await delay()
    const a = getStore().find((x) => x.id === id)
    if (!a) throw new ApiHttpError('ALERT_NOT_FOUND', '告警不存在', 404)
    return toDetail(a)
  },
  async updateAlertStatus(id, status, note) {
    await delay()
    const a = getStore().find((x) => x.id === id)
    if (!a) throw new ApiHttpError('ALERT_NOT_FOUND', '告警不存在', 404)
    a.status = status
    a.handledBy = 'mock-admin'
    a.handlerName = '运维(示例)'
    a.handledAt = '2026-06-09T12:00:00.000Z'
    a.handleNote = note ?? null
    a.updatedAt = '2026-06-09T12:00:00.000Z'
    return toDetail(a)
  },
}

// ─── Selector ───────────────────────────────────────────────────────────────

const adapter: AdminAlertsServiceInterface =
  API_MODE === 'http' ? adminAlertsHttpAdapter : adminAlertsMockAdapter

export const listAlerts = (opts?: ListAlertsOptions) => adapter.listAlerts(opts)
export const getAlert = (id: string) => adapter.getAlert(id)
export const updateAlertStatus = (id: string, status: 'processing' | 'resolved' | 'ignored', note?: string) =>
  adapter.updateAlertStatus(id, status, note)
