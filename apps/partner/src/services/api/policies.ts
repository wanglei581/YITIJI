// ============================================================
// Partner 政策公告 Service(阶段1D)
//
// API_MODE=http → 真实后端 /partner/policies/*
// API_MODE=mock → 内存 mock(演示)
//
// 数据流:本页录入/编辑(编辑强制回 pending 重审)→ Admin 审核/发布 → Kiosk 展示。
// 合规:info-only;只做政策说明 + 官方入口,不承诺补贴到账、不代申请。
// ============================================================

import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

export type PolicyKind = 'policy_guide' | 'notice'
export type PolicyAudience = 'graduate' | 'migrant' | 'hardship' | 'startup' | 'general'
export type PolicyCategory = 'policy' | 'announcement' | 'notice' | 'recruitment'

export interface PartnerPolicyRecord {
  id: string
  kind: PolicyKind | string
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

export interface SavePolicyInput {
  kind: PolicyKind
  title: string
  summary?: string
  content?: string
  audience?: PolicyAudience
  category?: PolicyCategory
  externalUrl?: string
  publishedDate?: string
}

export interface PartnerPoliciesServiceInterface {
  getPolicies(): Promise<PartnerPolicyRecord[]>
  createPolicy(input: SavePolicyInput): Promise<PartnerPolicyRecord>
  updatePolicy(id: string, input: Partial<SavePolicyInput>): Promise<PartnerPolicyRecord>
  unpublishPolicy(id: string): Promise<PartnerPolicyRecord>
  deletePolicy(id: string): Promise<void>
}

// ─── HTTP adapter ─────────────────────────────────────────────────────────────

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
      const data = (await res.json()) as { error?: { code?: string; message?: string }; message?: string | string[] }
      if (data.error?.code) code = data.error.code
      if (data.error?.message) message = data.error.message
      else if (Array.isArray(data.message) && data.message.length > 0) message = data.message.join('；')
    } catch { /* keep defaults */ }
    if (res.status === 401) {
      redirectToLogin()
      throw new ApiHttpError(code || 'AUTH_REQUIRED', '登录已过期', res.status)
    }
    throw new ApiHttpError(code, message, res.status)
  }
  return res.json() as Promise<T>
}

const httpAdapter: PartnerPoliciesServiceInterface = {
  getPolicies: () => req<PartnerPolicyRecord[]>('GET', '/partner/policies'),
  createPolicy: (input) => req<PartnerPolicyRecord>('POST', '/partner/policies', input),
  updatePolicy: (id, input) => req<PartnerPolicyRecord>('PATCH', `/partner/policies/${id}`, input),
  unpublishPolicy: (id) => req<PartnerPolicyRecord>('PATCH', `/partner/policies/${id}/publish`, { action: 'unpublish' }),
  deletePolicy: async (id) => {
    await req<{ success: boolean }>('DELETE', `/partner/policies/${id}`)
  },
}

// ─── Mock adapter ─────────────────────────────────────────────────────────────

const now = () => new Date().toISOString()
let seq = 100
const mockRows: PartnerPolicyRecord[] = [
  {
    id: 'pp-mock-1', kind: 'notice', title: '关于就业服务月活动的通知(演示)',
    summary: '演示数据', category: 'notice', publishedDate: '2026-06-01',
    sourceOrgId: 'mock-org', sourceName: '测试机构',
    reviewStatus: 'approved', publishStatus: 'published', rejectReason: null, syncTime: now(), updatedAt: now(),
  },
]

const mockAdapter: PartnerPoliciesServiceInterface = {
  async getPolicies() { return [...mockRows] },
  async createPolicy(input) {
    const created: PartnerPolicyRecord = {
      id: `pp-mock-${++seq}`,
      kind: input.kind, title: input.title, summary: input.summary, content: input.content,
      audience: input.audience, category: input.category, externalUrl: input.externalUrl,
      publishedDate: input.publishedDate,
      sourceOrgId: 'mock-org', sourceName: '测试机构',
      reviewStatus: 'pending', publishStatus: 'draft', rejectReason: null, syncTime: now(), updatedAt: now(),
    }
    mockRows.unshift(created)
    return created
  },
  async updatePolicy(id, input) {
    const hit = mockRows.find((r) => r.id === id)
    if (!hit) throw new ApiHttpError('POLICY_NOT_FOUND', '不存在', 404)
    Object.assign(hit, Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)))
    hit.reviewStatus = 'pending'
    hit.publishStatus = 'draft'
    hit.rejectReason = null
    hit.updatedAt = now()
    return { ...hit }
  },
  async unpublishPolicy(id) {
    const hit = mockRows.find((r) => r.id === id)
    if (!hit) throw new ApiHttpError('POLICY_NOT_FOUND', '不存在', 404)
    hit.publishStatus = 'unpublished'
    return { ...hit }
  },
  async deletePolicy(id) {
    const idx = mockRows.findIndex((r) => r.id === id)
    if (idx >= 0) mockRows.splice(idx, 1)
  },
}

export const partnerPoliciesService: PartnerPoliciesServiceInterface = API_MODE === 'http' ? httpAdapter : mockAdapter
