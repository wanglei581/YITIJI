import { API_MODE, API_BASE_URL, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

// ─── Types(镜像后端 services/api/src/partner-dashboard/partner-dashboard.types.ts)──
//
// 合作机构数据运营概览。只含真实计数 + 最近列表;无假增长率/趋势/访问量。
// 所有数据只看当前 orgId(后端强制)。后端 ApiResponse<T> 包装,http adapter 拆 .data。

export interface PartnerDashboardStats {
  jobCount: number
  jobFairCount: number
  publishedJobCount: number
  publishedFairCount: number
  pendingReviewCount: number
  rejectedCount: number
  syncSourceCount: number
  lastSyncTime: string | null
}
export interface PartnerDashboardSyncLog {
  id: string
  sourceName: string | null
  dataType: string
  status: string
  successCount: number
  failCount: number
  createdAt: string
}
export interface PartnerDashboardJob {
  id: string
  title: string
  sourceName: string | null
  reviewStatus: string
  publishStatus: string
  syncTime: string | null
}
export interface PartnerDashboardJobFair {
  id: string
  title: string
  sourceName: string | null
  reviewStatus: string
  publishStatus: string
  startTime: string | null
}
export interface PartnerDashboard {
  org: { id: string; name: string }
  stats: PartnerDashboardStats
  recentSyncLogs: PartnerDashboardSyncLog[]
  recentJobs: PartnerDashboardJob[]
  recentJobFairs: PartnerDashboardJobFair[]
  updatedAt: string
}

export interface PartnerDashboardServiceInterface {
  /** GET /partner/dashboard — 本机构运营数据看板 */
  getDashboard(): Promise<PartnerDashboard>
}

// ─── HTTP adapter ─────────────────────────────────────────────────────────────

async function request<T>(method: string, path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: { Accept: 'application/json', ...authHeader() },
    credentials: 'include',
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
    if (res.status === 401) redirectToLogin()
    throw new ApiHttpError(code, message, res.status)
  }
  return res.json() as Promise<T>
}
async function unwrap<T>(p: Promise<{ data: T }>): Promise<T> {
  return (await p).data
}

export const partnerDashboardHttpAdapter: PartnerDashboardServiceInterface = {
  getDashboard() {
    return unwrap(request<{ data: PartnerDashboard }>('GET', '/partner/dashboard'))
  },
}

// ─── Mock adapter(无后端时本地演示;真实计数形状,无假趋势)──────────────────────

export const partnerDashboardMockAdapter: PartnerDashboardServiceInterface = {
  async getDashboard() {
    await new Promise<void>((r) => setTimeout(r, 200))
    return {
      org: { id: 'org-mock-1', name: '示例就业服务机构' },
      stats: {
        jobCount: 12,
        jobFairCount: 3,
        publishedJobCount: 9,
        publishedFairCount: 2,
        pendingReviewCount: 3,
        rejectedCount: 1,
        syncSourceCount: 2,
        lastSyncTime: '2026-06-09T00:00:00.000Z',
      },
      recentSyncLogs: [
        { id: 's1', sourceName: '市人才网 API', dataType: 'job', status: 'success', successCount: 12, failCount: 0, createdAt: '2026-06-09T00:00:00.000Z' },
        { id: 's2', sourceName: '高校就业 Excel', dataType: 'job', status: 'partial', successCount: 8, failCount: 2, createdAt: '2026-06-08T10:00:00.000Z' },
      ],
      recentJobs: [
        { id: 'j1', title: '前端开发工程师', sourceName: '市人才网 API', reviewStatus: 'approved', publishStatus: 'published', syncTime: '2026-06-09T00:00:00.000Z' },
        { id: 'j2', title: '行政专员', sourceName: '高校就业 Excel', reviewStatus: 'pending', publishStatus: 'draft', syncTime: '2026-06-08T10:00:00.000Z' },
      ],
      recentJobFairs: [
        { id: 'f1', title: '2026 春季综合招聘会', sourceName: '市人社局 Webhook', reviewStatus: 'approved', publishStatus: 'published', startTime: '2026-06-20T01:00:00.000Z' },
      ],
      updatedAt: '2026-06-09T12:00:00.000Z',
    }
  },
}

// ─── Selector ───────────────────────────────────────────────────────────────

const adapter: PartnerDashboardServiceInterface =
  API_MODE === 'http' ? partnerDashboardHttpAdapter : partnerDashboardMockAdapter

export const getPartnerDashboard = () => adapter.getDashboard()
