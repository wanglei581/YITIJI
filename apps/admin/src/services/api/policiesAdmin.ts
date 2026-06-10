// ============================================================
// Admin 政策信息源 Service(阶段1D)
//
// API_MODE=http → 真实后端 /admin/policy-sources/*
// API_MODE=mock → 内存 mock(演示)
//
// 数据流:Partner 录入 → 本页审核/发布 → Kiosk 政策服务页展示。
// 合规:info-only;不承诺补贴到账、不代申请。
// ============================================================

import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'
import type { ReviewAction, PublishAction } from './review-types'

export interface AdminPolicyRecord {
  id: string
  kind: string // 'policy_guide' | 'notice'
  title: string
  summary?: string
  content?: string
  audience?: string
  category?: string
  externalUrl?: string
  publishedDate?: string
  sourceOrgId: string
  sourceName: string
  reviewStatus: string
  publishStatus: string
  rejectReason: string | null
  syncTime: string
  updatedAt: string
}

export interface PoliciesAdminServiceInterface {
  getPolicySources(): Promise<AdminPolicyRecord[]>
  reviewPolicy(id: string, action: ReviewAction, reason?: string): Promise<AdminPolicyRecord>
  publishPolicy(id: string, action: PublishAction): Promise<AdminPolicyRecord>
}

// ─── HTTP adapter ─────────────────────────────────────────────────────────────

function handleAuthFailure(status: number, code: string): void {
  if (status === 401) {
    redirectToLogin()
    throw new ApiHttpError(code || 'AUTH_REQUIRED', '登录已过期', status)
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeader() },
    credentials: 'include',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) {
    let code = `HTTP_${res.status}`
    let message = res.statusText
    try {
      const data = (await res.json()) as { error?: { code?: string; message?: string } }
      if (data.error?.code) code = data.error.code
      if (data.error?.message) message = data.error.message
    } catch { /* keep defaults */ }
    handleAuthFailure(res.status, code)
    throw new ApiHttpError(code, message, res.status)
  }
  return res.json() as Promise<T>
}

const httpAdapter: PoliciesAdminServiceInterface = {
  getPolicySources: () => req<AdminPolicyRecord[]>('GET', '/admin/policy-sources'),
  reviewPolicy: (id, action, reason) => req<AdminPolicyRecord>('PATCH', `/admin/policy-sources/${id}/review`, { action, reason }),
  publishPolicy: (id, action) => req<AdminPolicyRecord>('PATCH', `/admin/policy-sources/${id}/publish`, { action }),
}

// ─── Mock adapter ─────────────────────────────────────────────────────────────

const now = () => new Date().toISOString()
const mockPolicies: AdminPolicyRecord[] = [
  {
    id: 'pol-mock-1', kind: 'notice', title: '关于高校毕业生就业服务月活动的通知(演示)',
    summary: '演示数据', category: 'notice', externalUrl: 'https://example.org',
    publishedDate: '2026-06-01', sourceOrgId: 'org-mock-1', sourceName: '市人社局(演示)',
    reviewStatus: 'pending', publishStatus: 'draft', rejectReason: null, syncTime: now(), updatedAt: now(),
  },
  {
    id: 'pol-mock-2', kind: 'policy_guide', title: '创业担保贷款申请指引(演示)',
    summary: '演示数据,展示政策扶持条目', audience: 'startup',
    publishedDate: '2026-05-20', sourceOrgId: 'org-mock-1', sourceName: '市人社局(演示)',
    reviewStatus: 'approved', publishStatus: 'published', rejectReason: null, syncTime: now(), updatedAt: now(),
  },
]

const mockAdapter: PoliciesAdminServiceInterface = {
  async getPolicySources() { return [...mockPolicies] },
  async reviewPolicy(id, action, reason) {
    const hit = mockPolicies.find((p) => p.id === id)
    if (!hit) throw new ApiHttpError('POLICY_NOT_FOUND', '不存在', 404)
    if (action === 'approve') { hit.reviewStatus = 'approved'; hit.publishStatus = 'draft'; hit.rejectReason = null }
    else if (action === 'reject') { hit.reviewStatus = 'rejected'; hit.publishStatus = 'draft'; hit.rejectReason = reason ?? '' }
    else hit.reviewStatus = 'reviewing'
    hit.updatedAt = now()
    return { ...hit }
  },
  async publishPolicy(id, action) {
    const hit = mockPolicies.find((p) => p.id === id)
    if (!hit) throw new ApiHttpError('POLICY_NOT_FOUND', '不存在', 404)
    hit.publishStatus = action === 'publish' ? 'published' : 'unpublished'
    hit.updatedAt = now()
    return { ...hit }
  },
}

export const policiesAdminService: PoliciesAdminServiceInterface = API_MODE === 'http' ? httpAdapter : mockAdapter
