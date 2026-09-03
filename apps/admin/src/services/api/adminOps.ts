// ============================================================
// Admin 运营视图 Service(阶段1E):打印任务流水 + 派生告警
//
// API_MODE=http → 真实后端 /admin/print-tasks、/admin/alerts
// API_MODE=mock → 内存演示数据
//
// 诚实约束:告警为实时派生;确认/静默/关闭只写处理态,不把仍在发生的故障说成已恢复。
// ============================================================

import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

export interface AdminPrintTaskItem {
  id: string
  status: string // 'pending' | 'claimed' | 'printing' | 'completed' | 'failed'
  terminalCode: string | null
  ownerType: 'member' | 'anonymous'
  fileName: string | null
  copies: number | null
  colorMode: 'black_white' | 'color' | null
  paperSize: string | null
  errorCode: string | null
  createdAt: string
  claimedAt: string | null
  completedAt: string | null
}

export interface AdminPrintTaskPage {
  data: AdminPrintTaskItem[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
}

export type AlertHandlingState = 'open' | 'acknowledged' | 'silenced' | 'closed'
export type AlertListView = 'open' | 'acknowledged' | 'suppressed' | 'all'

export interface AdminAlertItem {
  id: string
  subjectKey: string
  episodeToken: string
  type: 'terminal_offline' | 'printer_issue' | 'print_failed'
  severity: 'error' | 'warning'
  title: string
  detail: string
  terminalCode: string | null
  occurredAt: string
  conditionState: 'firing'
  handlingState: AlertHandlingState
  acknowledgedAt: string | null
  silencedUntil: string | null
  note: string | null
}

export type AlertAction = 'acknowledge' | 'silence' | 'close' | 'reopen'

export interface AdminAlertsResult {
  data: AdminAlertItem[]
  derivedAt: string
  /** 当前仍在发生的告警总数(精确计数,不受列表上限影响)。 */
  firingCount: number
  /** 本次实际列出的条数;小于 firingCount 即说明被截断。 */
  listedCount: number
  /** 非 null 表示列表不是全部,界面必须如实提示(CLAUDE.md §9)。 */
  truncation: { type: 'print_failed'; omitted: number; cap: number } | null
  /** 以下三个计数只覆盖已列出的部分。 */
  openCount: number
  acknowledgedCount: number
  suppressedCount: number
}

export interface AlertDispositionResult {
  subjectKey: string
  episodeToken: string
  action: 'acknowledged' | 'silenced' | 'closed' | 'reopened'
  conditionState: 'firing'
  handlingState: AlertHandlingState
  silencedUntil: string | null
  note: string | null
  idempotent: boolean
  at: string
}

export interface AdminOpsServiceInterface {
  listPrintTasks(params: { status?: string; page: number; pageSize: number }): Promise<AdminPrintTaskPage>
  listAlerts(view?: AlertListView): Promise<AdminAlertsResult>
  disposeAlert(input: {
    subjectKey: string
    episodeToken: string
    action: AlertAction
    duration?: '1h' | '4h' | '24h'
    note?: string
  }): Promise<AlertDispositionResult>
}

// ─── HTTP adapter ─────────────────────────────────────────────────────────────

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const qs = params
    ? `?${new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '')).toString()}`
    : ''
  const res = await fetch(`${API_BASE_URL}${path}${qs}`, {
    headers: { Accept: 'application/json', ...authHeader() },
    credentials: 'include',
  })
  if (!res.ok) {
    let code = `HTTP_${res.status}`
    let message = res.statusText
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } }
      if (body.error?.code) code = body.error.code
      if (body.error?.message) message = body.error.message
    } catch { /* keep defaults */ }
    if (res.status === 401) {
      redirectToLogin()
      throw new ApiHttpError(code || 'AUTH_REQUIRED', '登录已过期', res.status)
    }
    throw new ApiHttpError(code, message, res.status)
  }
  return res.json() as Promise<T>
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeader() },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let code = `HTTP_${res.status}`
    let message = res.statusText
    try {
      const parsed = (await res.json()) as { error?: { code?: string; message?: string } }
      if (parsed.error?.code) code = parsed.error.code
      if (parsed.error?.message) message = parsed.error.message
    } catch { /* keep defaults */ }
    if (res.status === 401) {
      redirectToLogin()
      throw new ApiHttpError(code || 'AUTH_REQUIRED', '登录已过期', res.status)
    }
    throw new ApiHttpError(code, message, res.status)
  }
  return res.json() as Promise<T>
}

const httpAdapter: AdminOpsServiceInterface = {
  listPrintTasks: ({ status, page, pageSize }) =>
    get<AdminPrintTaskPage>('/admin/print-tasks', {
      ...(status ? { status } : {}),
      page: String(page),
      pageSize: String(pageSize),
    }),
  listAlerts: (view = 'open') => get<AdminAlertsResult>('/admin/alerts', { view }),
  disposeAlert: (input) => postJson<AlertDispositionResult>('/admin/alerts/disposition', input),
}

// ─── Mock adapter ─────────────────────────────────────────────────────────────

const now = () => new Date().toISOString()

const MOCK_TASKS: AdminPrintTaskItem[] = [
  {
    id: 'pt-mock-1', status: 'completed', terminalCode: 'KSK-001', ownerType: 'anonymous',
    fileName: '简历_演示.pdf', copies: 2, colorMode: 'black_white', paperSize: 'A4',
    errorCode: null, createdAt: now(), claimedAt: now(), completedAt: now(),
  },
  {
    id: 'pt-mock-2', status: 'failed', terminalCode: 'KSK-001', ownerType: 'member',
    fileName: '求职材料_演示.pdf', copies: 1, colorMode: 'color', paperSize: 'A4',
    errorCode: 'PRINTER_OFFLINE', createdAt: now(), claimedAt: now(), completedAt: null,
  },
]

const MOCK_ALERTS: AdminAlertItem[] = [
  {
    id: 'terminal_offline:mock-ksk-002',
    subjectKey: 'terminal_offline:mock-ksk-002',
    episodeToken: now(),
    type: 'terminal_offline',
    severity: 'warning',
    title: '终端 KSK-002 离线(演示)',
    detail: '演示数据:接真实后端后展示实时派生告警',
    terminalCode: 'KSK-002',
    occurredAt: now(),
    conditionState: 'firing',
    handlingState: 'open',
    acknowledgedAt: null,
    silencedUntil: null,
    note: null,
  },
]

const mockAdapter: AdminOpsServiceInterface = {
  async listPrintTasks({ status, page, pageSize }) {
    const filtered = status ? MOCK_TASKS.filter((t) => t.status === status) : MOCK_TASKS
    return {
      data: filtered,
      pagination: { page, pageSize, total: filtered.length, totalPages: 1 },
    }
  },
  async listAlerts(view = 'open') {
    const data = MOCK_ALERTS.filter((alert) => {
      if (view === 'all') return true
      if (view === 'open') return alert.handlingState === 'open'
      if (view === 'acknowledged') return alert.handlingState === 'acknowledged'
      return alert.handlingState === 'silenced' || alert.handlingState === 'closed'
    })
    return {
      data,
      derivedAt: now(),
      firingCount: MOCK_ALERTS.length,
      listedCount: MOCK_ALERTS.length,
      truncation: null,
      openCount: MOCK_ALERTS.filter((a) => a.handlingState === 'open').length,
      acknowledgedCount: MOCK_ALERTS.filter((a) => a.handlingState === 'acknowledged').length,
      suppressedCount: MOCK_ALERTS.filter((a) => a.handlingState === 'silenced' || a.handlingState === 'closed').length,
    }
  },
  async disposeAlert(input) {
    const alert = MOCK_ALERTS.find((item) => item.subjectKey === input.subjectKey)
    const handlingState: AlertHandlingState =
      input.action === 'acknowledge' ? 'acknowledged'
        : input.action === 'silence' ? 'silenced'
          : input.action === 'reopen' ? 'open'
            : 'closed'
    if (alert) {
      alert.handlingState = handlingState
      alert.acknowledgedAt = handlingState === 'open' ? null : now()
      alert.silencedUntil = input.action === 'silence' ? now() : null
    }
    return {
      subjectKey: input.subjectKey,
      episodeToken: input.episodeToken,
      action:
        input.action === 'acknowledge' ? 'acknowledged'
          : input.action === 'silence' ? 'silenced'
            : input.action === 'reopen' ? 'reopened'
              : 'closed',
      conditionState: 'firing',
      handlingState,
      silencedUntil: input.action === 'silence' ? now() : null,
      note: input.note ?? null,
      idempotent: false,
      at: now(),
    }
  },
}

export const adminOpsService: AdminOpsServiceInterface = API_MODE === 'http' ? httpAdapter : mockAdapter
