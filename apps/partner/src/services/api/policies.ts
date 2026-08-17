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
export type PolicyAudience = 'graduate' | 'flexible' | 'migrant' | 'hardship' | 'startup' | 'general'
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

// ─── P21 申领条件（结构化，可机械比对）───────────────────────────────────────
//
// 条件不是富文本：一条条件 = 一段政策原文摘录 + 一组「问项 → 取值」判定子句。
// 问项与取值**由服务端下发**（GET /policies/eligibility-questions），
// 前端不得硬编码 —— 取值一旦漂移，库里已录入的条件会静默失配，
// 判定结果全变「无法判定」而没人发现。
//
// matchMode 是判定方式，不只是合取方式：
//   all    机械比对：全部子句都满足才算相符
//   any    机械比对：任一子句满足即算相符
//   manual **只能人工核对** —— 「经街道办核实的困难家庭」这类条款机器判不了，
//          照录原文、零子句，结论恒为「无法判定 · 需人工核对」。
//          没有这一档，运营就只能硬塞一个与政策原文不符的规则（＝编造政策口径）。

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
  satisfiedValues: string[]
  conflictValues: string[]
}

export interface PolicyEligibilityRuleInput {
  label: string
  /** 政策原文摘录，一字不改 —— 判定唯一可追溯的依据，必填 */
  sourceText: string
  matchMode: PolicyRuleMatchMode
  /** manual 必须为空数组 */
  clauses: PolicyEligibilityClause[]
}

export interface PolicyEligibilityRuleRecord extends PolicyEligibilityRuleInput {
  id: string
  orderIndex: number
}

/** 录入面里尚未提交的一条条件；draftKey 只用于 React key，不参与提交。 */
export interface PolicyEligibilityRuleDraft extends PolicyEligibilityRuleInput {
  draftKey: string
}

/**
 * 客户端预校验：只为让运营在点保存前就看到问题，**不是判据**。
 * 服务端 validatePolicyEligibilityRules 才是唯一判据（这里漏判一条不会放行错误数据，
 * 服务端会拒并把错误原样回显）。刻意只镜像服务端规则，不额外发明约束。
 */
export function policyRuleDraftError(
  rule: PolicyEligibilityRuleDraft,
  questions: PolicyEligibilityQuestion[] = [],
): string | null {
  if (!rule.label.trim()) return '缺少条件标题'
  if (!rule.sourceText.trim()) return '缺少政策原文摘录 —— 没有原文依据的条件不得用于核对'
  if (rule.matchMode === 'manual') {
    return rule.clauses.length > 0 ? '「只能人工核对」不得再挂比对项' : null
  }
  if (rule.clauses.length === 0) return '请至少选择一项用户信息，或改标为「只能人工核对」'
  const empty = rule.clauses.find((c) => c.satisfiedValues.length === 0)
  if (empty) {
    const label = questions.find((q) => q.key === empty.questionKey)?.label ?? empty.questionKey
    return `「${label}」还没有选出任何「算相符」的取值`
  }
  return null
}

export type PolicyConditionResult = 'matched' | 'conflict' | 'unknown'

export interface PolicyConditionBasis {
  questionKey: string
  questionLabel: string
  answerValue: string | null
  answerLabel: string | null
  clauseResult: PolicyConditionResult
}

export interface PolicyConditionCheck {
  ruleId: string
  orderIndex: number
  label: string
  result: PolicyConditionResult
  reasonCode: string
  reason: string
  sourceText: string
  basis: PolicyConditionBasis[]
}

export interface PolicyEligibilityCheckItem {
  policyId: string
  title: string
  conditionsRecorded: boolean
  conditions: PolicyConditionCheck[]
  summary: { matched: number; conflict: number; unknown: number; total: number }
  overall: string
  overallLabel: string
  manualReviewRequired: boolean
}

export interface PolicyEligibilityCheckResult {
  questionSetVersion: string
  checkedAt: string
  answeredCount: number
  ignoredQuestionKeys: string[]
  disclaimer: string
  method: string
  items: PolicyEligibilityCheckItem[]
}

export interface PartnerPoliciesServiceInterface {
  getPolicies(): Promise<PartnerPolicyRecord[]>
  createPolicy(input: SavePolicyInput): Promise<PartnerPolicyRecord>
  updatePolicy(id: string, input: Partial<SavePolicyInput>): Promise<PartnerPolicyRecord>
  unpublishPolicy(id: string): Promise<PartnerPolicyRecord>
  deletePolicy(id: string): Promise<void>
  /** 问项字典（服务端下发，前端不得硬编码） */
  getEligibilityQuestions(): Promise<PolicyEligibilityQuestionSet>
  getEligibilityRules(policyId: string): Promise<PolicyEligibilityRuleRecord[]>
  /** 整组替换；保存后该政策强制回「待审核 + 待发布」重审 */
  replaceEligibilityRules(policyId: string, rules: PolicyEligibilityRuleInput[]): Promise<PolicyEligibilityRuleRecord[]>
  /**
   * 试算：拿一组假想作答预览判定结果。
   * 结果由**服务端**算，与一体机上用户拿到的判定走同一条路径；
   * 前端绝不自己比对一遍 —— 否则录入面看到的绿灯和用户的实际结论可能不一致。
   */
  previewEligibility(policyId: string, answers: Record<string, string>): Promise<PolicyEligibilityCheckResult>
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
  getEligibilityQuestions: () => req<PolicyEligibilityQuestionSet>('GET', '/policies/eligibility-questions'),
  getEligibilityRules: (policyId) =>
    req<PolicyEligibilityRuleRecord[]>('GET', `/partner/policies/${policyId}/eligibility-rules`),
  replaceEligibilityRules: (policyId, rules) =>
    req<PolicyEligibilityRuleRecord[]>('PUT', `/partner/policies/${policyId}/eligibility-rules`, { rules }),
  previewEligibility: (policyId, answers) =>
    req<PolicyEligibilityCheckResult>('POST', `/partner/policies/${policyId}/eligibility-preview`, { answers }),
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

  // ── 申领条件在演示模式下**不提供**，而不是给一份假的 ────────────────────
  //
  // 三条都只能由服务端做，前端 mock 一份等于伪造能力（CLAUDE.md §9）：
  //   1. 问项字典是判定口径的一部分，mock 一份会和真库漂移；
  //   2. 保存必须真正落库并把政策打回待审核，mock 的「已保存」是假的；
  //   3. 判定必须与用户在一体机上拿到的结论**同一条服务端路径**，
  //      前端自己算一遍就成了第二套口径 —— 那比没有预览更糟。
  // 所以这里如实抛错，由录入面展示「演示模式不可用」，不给任何结果。
  async getEligibilityQuestions() { throw mockUnsupported() },
  async getEligibilityRules() { throw mockUnsupported() },
  async replaceEligibilityRules() { throw mockUnsupported() },
  async previewEligibility() { throw mockUnsupported() },
}

function mockUnsupported(): ApiHttpError {
  return new ApiHttpError(
    'ELIGIBILITY_REQUIRES_BACKEND',
    '演示模式(API_MODE=mock)不提供政策申领条件的录入与试算:问项字典、保存与判定都只在服务端进行。请连接真实后端后再录入。',
    501,
  )
}

export const partnerPoliciesService: PartnerPoliciesServiceInterface = API_MODE === 'http' ? httpAdapter : mockAdapter
