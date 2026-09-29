// ============================================================
// AI 用量与额度（GET /admin/ai-usage/daily，对接 #1088）
//
// 后端真相源：services/api/src/ai/usage/（admin-ai-usage.controller.ts、
// ai-usage-summary.ts、ai-budget.service.ts）。按北京时间自然日汇总：
//   - day 省略 = 北京时间今天；格式错 400 AI_USAGE_DAY_INVALID。
//   - 只读、仅 admin；响应外壳 { success, data }；不含会员号，会员只给人数。
//
// 面板口径：这是运营看钱的页面，只展示服务端给的数，不自行推算任何未来或
// 缺失的数字；取不到的数据如实显示。mock 模式不造假数（不返回演示数字，
// 调用即拒绝），由面板展示诚实空态。
// ============================================================

import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

/** 与服务端 AiBudgetLimits 一一对应。 */
export interface AiUsageBudgetLimits {
  /** 全站每日上限（元）。 */
  globalCny: number
  /** 单台已验签终端每日上限（元）。 */
  terminalCny: number
  /** 单个会员每日上限（元）。 */
  memberCny: number
  /** 取不到用量的调用按每次多少元计入（保守计入，绝不当 0）。 */
  unmeasuredCallCostCny: number
}

/** 与服务端 AiUsageBucket 一一对应；key 为 null 表示「无已验签终端 / 无机构」。 */
export interface AiUsageBucket {
  key: string | null
  calls: number
  /** 取不到用量的调用数（金额按保守单价计入 chargedCostCny）。 */
  unmeasuredCalls: number
  /** 只含实测金额。 */
  measuredCostCny: number
  /** 计入额度的金额 = 实测 + 未计量 × 保守单价。 */
  chargedCostCny: number
}

/** 与服务端 AiUsageDailySummary 一一对应（字段白名单，不含会员号）。 */
export interface AiUsageDailySummary {
  day: string
  limits: AiUsageBudgetLimits
  totals: AiUsageBucket & { memberCount: number }
  reached: { global: boolean; terminalIds: string[]; memberCount: number }
  byFeature: AiUsageBucket[]
  byVendor: AiUsageBucket[]
  byTerminal: AiUsageBucket[]
  byOrg: AiUsageBucket[]
}

const AI_USAGE_DAILY_PATH = '/admin/ai-usage/daily'

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** mock 模式（admin E2E 跑这个）下页面要标明演示口径，且不连真实用量。 */
export const AI_USAGE_DAILY_DEMO: boolean = API_MODE !== 'http'

/** 北京时间今天 YYYY-MM-DD。与服务端 beijingDayKey 同口径：固定 +8，中国无夏令时。 */
export function beijingTodayKey(now: Date = new Date()): string {
  return new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10)
}

/** 与服务端控制器同判法：YYYY-MM-DD 且是真实存在的日期。 */
export function isAiUsageDayKey(value: string): boolean {
  if (!DAY_PATTERN.test(value)) return false
  return !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
}

// ─── 响应形状校验：形状不对不当成功，免得页面拿半截数据说话 ───────────────────

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isMoney(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isBucket(value: unknown): value is AiUsageBucket {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (v.key === null || typeof v.key === 'string')
    && isCount(v.calls) && isCount(v.unmeasuredCalls)
    && isMoney(v.measuredCostCny) && isMoney(v.chargedCostCny)
}

function isBucketArray(value: unknown): value is AiUsageBucket[] {
  return Array.isArray(value) && value.every(isBucket)
}

function malformed(status: number): ApiHttpError {
  return new ApiHttpError('UNEXPECTED_RESPONSE', '服务端返回的用量数据不完整，请点“刷新”重试', status)
}

/** 响应外壳 { success, data }；day / limits / totals / reached / 四个维度桶逐项校验。 */
export function aiUsageDailyFromResponse(body: unknown, status = 200): AiUsageDailySummary {
  const data = body && typeof body === 'object' ? (body as { data?: unknown }).data : undefined
  if (!data || typeof data !== 'object') throw malformed(status)
  const d = data as Record<string, unknown>
  const limits = d.limits as Record<string, unknown> | undefined
  const totals = d.totals as Record<string, unknown> | undefined
  const reached = d.reached as Record<string, unknown> | undefined
  if (typeof d.day !== 'string' || !isAiUsageDayKey(d.day)) throw malformed(status)
  if (!limits || !isMoney(limits.globalCny) || !isMoney(limits.terminalCny) || !isMoney(limits.memberCny) || !(isMoney(limits.unmeasuredCallCostCny) && limits.unmeasuredCallCostCny > 0)) throw malformed(status)
  if (!totals || !isBucket(totals) || !isCount(totals.memberCount)) throw malformed(status)
  if (!reached || typeof reached.global !== 'boolean' || !Array.isArray(reached.terminalIds) || !reached.terminalIds.every((id) => typeof id === 'string') || !isCount(reached.memberCount)) throw malformed(status)
  if (!isBucketArray(d.byFeature) || !isBucketArray(d.byVendor) || !isBucketArray(d.byTerminal) || !isBucketArray(d.byOrg)) throw malformed(status)
  return {
    day: d.day,
    limits: { globalCny: limits.globalCny, terminalCny: limits.terminalCny, memberCny: limits.memberCny, unmeasuredCallCostCny: limits.unmeasuredCallCostCny },
    totals: { ...(totals as unknown as AiUsageBucket), memberCount: totals.memberCount },
    reached: { global: reached.global, terminalIds: [...reached.terminalIds], memberCount: reached.memberCount },
    byFeature: [...(d.byFeature as AiUsageBucket[])],
    byVendor: [...(d.byVendor as AiUsageBucket[])],
    byTerminal: [...(d.byTerminal as AiUsageBucket[])],
    byOrg: [...(d.byOrg as AiUsageBucket[])],
  }
}

// ─── HTTP 适配（照 adminAiHttpAdapter 的口径：401 跳登录、错误码与 message 带回）─

async function fetchDaily(day?: string): Promise<AiUsageDailySummary> {
  // 与服务端同一判法：不合法日期根本不发请求（服务端也会 400 AI_USAGE_DAY_INVALID）。
  if (day !== undefined && !isAiUsageDayKey(day)) {
    throw new ApiHttpError('AI_USAGE_DAY_INVALID', '日期格式应为 YYYY-MM-DD', 400)
  }
  const query = day === undefined ? '' : `?day=${encodeURIComponent(day)}`
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${AI_USAGE_DAILY_PATH}${query}`, {
      method: 'GET',
      headers: { Accept: 'application/json', ...authHeader() },
      credentials: 'include',
    })
  } catch {
    throw new ApiHttpError('NETWORK_ERROR', '网络连接失败，请检查网络后重试', 0)
  }
  if (!res.ok) {
    let code = `HTTP_${res.status}`
    let message = `请求失败（${res.status}）`
    try {
      const body = await res.json() as { error?: { code?: string; message?: string } }
      if (body.error?.code) code = body.error.code
      if (body.error?.message) message = body.error.message
    } catch { /* 非 JSON，保留默认值 */ }
    if (res.status === 401) {
      redirectToLogin()
      throw new ApiHttpError(code || 'AUTH_REQUIRED', '登录已过期', 401)
    }
    throw new ApiHttpError(code, message, res.status)
  }
  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw new ApiHttpError('UNEXPECTED_RESPONSE', '服务端返回的用量数据无法识别，请点“刷新”重试', res.status)
  }
  return aiUsageDailyFromResponse(body, res.status)
}

/**
 * 读取某日的 AI 用量汇总（day 省略 = 北京时间今天）。
 * mock 模式不造假数：演示模式没有真实用量数据，直接拒绝，由面板展示诚实空态。
 */
export function getAiUsageDaily(day?: string): Promise<AiUsageDailySummary> {
  if (AI_USAGE_DAILY_DEMO) {
    return Promise.reject(new ApiHttpError('DEMO_MODE_NO_USAGE_DATA', '演示模式不连接真实用量数据', 501))
  }
  return fetchDaily(day)
}
