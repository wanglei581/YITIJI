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

// ─── P21 申领条件(只读复核)──────────────────────────────────────────────────
//
// 条件由来源机构在合作机构后台录入(PUT /partner/policies/:id/eligibility-rules),
// 管理员这一侧**只读**:审核一条政策前要能看到它到底挂了哪些申领门槛。
//
// 类型逐字对齐服务端 services/api/src/policies/policy-eligibility.types.ts,
// 与 apps/partner/src/services/api/policies.ts 同一套口径 —— 两端叫法必须一致,
// 否则同一条规则机构看到一个说法、审核的人看到另一个说法,对不上账。
//
// 注意:规则里的 questionKey / satisfiedValues / conflictValues 都是**服务端标识**
// (如 household_social / local_household),不是中文。中文名称必须另取问项字典
// (GET /policies/eligibility-questions,公开端点),前端不得硬编码 ——
// 取值一旦漂移,硬编码的映射会静默错标。

export type PolicyRuleMatchMode = 'all' | 'any' | 'manual'

export interface PolicyEligibilityQuestionOption {
  value: string
  label: string
}

export interface PolicyEligibilityQuestion {
  key: string
  label: string
  sensitive: boolean
  options: PolicyEligibilityQuestionOption[]
}

export interface PolicyEligibilityQuestionSet {
  questionSetVersion: string
  questions: PolicyEligibilityQuestion[]
  privacyNotice: string
  disclaimer: string
}

export interface PolicyEligibilityClause {
  questionKey: string
  /** 命中即判「相符」的取值集合 */
  satisfiedValues: string[]
  /** 命中即判「不符」的取值集合,可空 */
  conflictValues: string[]
}

export interface PolicyEligibilityRuleRecord {
  id: string
  orderIndex: number
  label: string
  /** 政策原文摘录,一字不改 —— 判定唯一可追溯的依据 */
  sourceText: string
  matchMode: PolicyRuleMatchMode
  /** matchMode='manual' 时恒为空数组:人工核对条款不挂任何机械比对子句 */
  clauses: PolicyEligibilityClause[]
}

export interface PoliciesAdminServiceInterface {
  getPolicySources(): Promise<AdminPolicyRecord[]>
  reviewPolicy(id: string, action: ReviewAction, reason?: string): Promise<AdminPolicyRecord>
  publishPolicy(id: string, action: PublishAction): Promise<AdminPolicyRecord>
  /** 问项字典(公开端点,无角色守卫):把规则里的服务端标识翻成中文名称 */
  getEligibilityQuestions(): Promise<PolicyEligibilityQuestionSet>
  /** 只读复核某条政策已录入的申领条件;空数组 = 确实没录,与请求失败必须区分 */
  getEligibilityRules(policyId: string): Promise<PolicyEligibilityRuleRecord[]>
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
  getEligibilityQuestions: () => req<PolicyEligibilityQuestionSet>('GET', '/policies/eligibility-questions'),
  getEligibilityRules: (policyId) =>
    req<PolicyEligibilityRuleRecord[]>('GET', `/admin/policy-sources/${policyId}/eligibility-rules`),
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

  // ── 申领条件在演示模式下**不提供**,而不是给一份假的 ──────────────────────
  //
  // 与 Partner 录入面同口径(apps/partner/src/services/api/policies.ts):
  // 问项字典与已录条件都只在服务端。这里若 mock 一份「两条条件」,
  // 管理员会以为自己看到了这条政策的真实申领门槛 —— 那正是本页要防的事:
  // 在不知道申领条件的情况下把政策放行到一体机。
  // 所以如实抛错,由抽屉展示「没读到」而不是「没有条件」。
  async getEligibilityQuestions() { throw mockUnsupported() },
  async getEligibilityRules() { throw mockUnsupported() },
}

function mockUnsupported(): ApiHttpError {
  return new ApiHttpError(
    'ELIGIBILITY_REQUIRES_BACKEND',
    '演示模式(API_MODE=mock)不提供政策申领条件:条件与问项字典只在服务端。请连接真实后端后再复核。',
    501,
  )
}

export const policiesAdminService: PoliciesAdminServiceInterface = API_MODE === 'http' ? httpAdapter : mockAdapter
