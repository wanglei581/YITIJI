// ============================================================
// Admin 运营视图 Service(阶段1E):打印任务流水 + 派生告警
//
// API_MODE=http → 真实后端 /admin/print-tasks、/admin/alerts
// API_MODE=mock → 内存演示数据
//
// 诚实约束:无支付域 → 不展示金额/支付状态;告警为实时派生,无处理流转。
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

export interface AdminAlertItem {
  id: string
  type: 'terminal_offline' | 'printer_issue' | 'print_failed'
  severity: 'error' | 'warning'
  title: string
  detail: string
  terminalCode: string | null
  occurredAt: string
}

export interface AdminAlertsResult {
  data: AdminAlertItem[]
  derivedAt: string
}

export interface AdminOpsServiceInterface {
  listPrintTasks(params: { status?: string; page: number; pageSize: number }): Promise<AdminPrintTaskPage>
  listAlerts(): Promise<AdminAlertsResult>
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

const httpAdapter: AdminOpsServiceInterface = {
  listPrintTasks: ({ status, page, pageSize }) =>
    get<AdminPrintTaskPage>('/admin/print-tasks', {
      ...(status ? { status } : {}),
      page: String(page),
      pageSize: String(pageSize),
    }),
  listAlerts: () => get<AdminAlertsResult>('/admin/alerts'),
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

const mockAdapter: AdminOpsServiceInterface = {
  async listPrintTasks({ status, page, pageSize }) {
    const filtered = status ? MOCK_TASKS.filter((t) => t.status === status) : MOCK_TASKS
    return {
      data: filtered,
      pagination: { page, pageSize, total: filtered.length, totalPages: 1 },
    }
  },
  async listAlerts() {
    return {
      data: [
        {
          id: 'mock-alert-1', type: 'terminal_offline', severity: 'warning',
          title: '终端 KSK-002 离线(演示)', detail: '演示数据:接真实后端后展示实时派生告警',
          terminalCode: 'KSK-002', occurredAt: now(),
        },
      ],
      derivedAt: now(),
    }
  },
}

export const adminOpsService: AdminOpsServiceInterface = API_MODE === 'http' ? httpAdapter : mockAdapter
