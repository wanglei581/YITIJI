// ============================================================
// Partner 自助域 service（审计修复）：工作台聚合 + 机构资料。
//
// http 模式走真实后端（/partner/dashboard、/partner/profile）；
// mock 模式返回带标记的演示数据（仅本地无后端调试用，绝不混入 http 链路）。
// ============================================================

import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

export interface PartnerDashboardData {
  jobs: { total: number; published: number; pending: number }
  fairs: { total: number; published: number; pending: number }
  policies: { total: number; published: number; pending: number }
  pendingTotal: number
  sources: { total: number; enabled: number }
  recentSyncs: Array<{
    id: string
    source: string
    dataType: string
    status: string
    addedCount: number
    updatedCount: number
    errorCount: number
    syncTime: string
  }>
}

export interface PartnerOrgProfile {
  id: string
  name: string
  type: string
  contact: string | null
  contactPhone: string | null
  sceneTemplate: string | null
  enabledModules: string[]
  enabled: boolean
  createdAt: string
  sourceCount: number
  accountCount: number
}

async function request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      ...authHeader(),
      ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    credentials: 'include',
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  })
  if (!res.ok) {
    let code = `HTTP_${res.status}`
    let message = res.statusText
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } }
      if (body.error?.code) code = body.error.code
      if (body.error?.message) message = body.error.message
    } catch {
      /* keep defaults */
    }
    if (res.status === 401) redirectToLogin()
    throw new ApiHttpError(code, message, res.status)
  }
  return res.json() as Promise<T>
}

const MOCK_DASHBOARD: PartnerDashboardData = {
  jobs: { total: 28, published: 24, pending: 2 },
  fairs: { total: 5, published: 4, pending: 1 },
  policies: { total: 6, published: 5, pending: 1 },
  pendingTotal: 4,
  sources: { total: 3, enabled: 2 },
  recentSyncs: [
    { id: 'mock-1', source: '市人才网 API（演示）', dataType: 'job', status: 'success', addedCount: 12, updatedCount: 3, errorCount: 0, syncTime: '2026-05-25 08:00' },
    { id: 'mock-2', source: '高校就业 Excel（演示）', dataType: 'job', status: 'partial', addedCount: 8, updatedCount: 0, errorCount: 2, syncTime: '2026-05-24 18:00' },
  ],
}

const MOCK_PROFILE: PartnerOrgProfile = {
  id: 'mock-org',
  name: '演示机构（mock 模式）',
  type: 'school',
  contact: '演示联系人',
  contactPhone: '0532-00000000',
  sceneTemplate: 'campus',
  enabledModules: ['jobs', 'fairs', 'policies'],
  enabled: true,
  createdAt: new Date('2026-01-01').toISOString(),
  sourceCount: 3,
  accountCount: 1,
}

/** 工作台聚合（本机构真实计数 + 最近 5 条同步）。 */
export function getPartnerDashboard(): Promise<PartnerDashboardData> {
  if (API_MODE !== 'http') return Promise.resolve(MOCK_DASHBOARD)
  return request<PartnerDashboardData>('/partner/dashboard')
}

/** 本机构档案。 */
export function getOrgProfile(): Promise<PartnerOrgProfile> {
  if (API_MODE !== 'http') return Promise.resolve(MOCK_PROFILE)
  return request<PartnerOrgProfile>('/partner/profile')
}

/** 更新机构联系人 / 联系电话（其余字段由管理员管理）。 */
export function updateOrgProfile(input: { contact?: string; contactPhone?: string }): Promise<PartnerOrgProfile> {
  if (API_MODE !== 'http') return Promise.resolve({ ...MOCK_PROFILE, ...input })
  return request<PartnerOrgProfile>('/partner/profile', { method: 'PUT', body: input })
}
