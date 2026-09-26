// ============================================================
// 招聘内容托管开关 + 紧急下架 + 熔断（3.13）
//
// API_MODE=http → 真实后端：
//   GET  /admin/system/recruitment-hosting           { success, data: { recruitmentHosting } }
//   POST /admin/recruitment-emergency/takedown       裸对象
//   POST /admin/recruitment-emergency/circuit-break  裸对象
// API_MODE=mock → 演示数据。托管开关默认打开（保持既有演示与用例口径）；
//   浏览器里 localStorage['mock:recruitment-hosting'] = 'off' 时按关闭演示，= 'error' 时模拟
//   读取失败（页面应按关闭处理并说明读不到）；localStorage['mock:recruitment-emergency'] = 'fail'
//   时下架 / 熔断按服务端「已被紧急下架」拒绝，用来验证弹窗不自行假定成功。只在 mock 下读。
//
// 页面只能按服务端返回的结果说话：下架 / 熔断成功与否以响应为准，不自行假定。
// ============================================================

import type {
  AdminRecruitmentHostingStatus,
  RecruitmentCircuitBreakInput,
  RecruitmentCircuitBreakResult,
  RecruitmentEmergencyTakedownInput,
  RecruitmentEmergencyTakedownResult,
} from '@ai-job-print/shared'
import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'
import { publishFairSourceRecord, publishJobSourceRecord } from './sources'

export const MOCK_RECRUITMENT_HOSTING_KEY = 'mock:recruitment-hosting'
export const MOCK_RECRUITMENT_EMERGENCY_KEY = 'mock:recruitment-emergency'

export interface RecruitmentEmergencyServiceInterface {
  /** 部署级托管开关。true = 私有化部署（b）打开；false = 我们云上默认关闭。 */
  getHostingEnabled(): Promise<boolean>
  takedown(input: RecruitmentEmergencyTakedownInput): Promise<RecruitmentEmergencyTakedownResult>
  circuitBreak(input: RecruitmentCircuitBreakInput): Promise<RecruitmentCircuitBreakResult>
}

// ─── HTTP adapter ─────────────────────────────────────────────────────────────

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeader() },
      credentials: 'include',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
  } catch {
    throw new ApiHttpError('NETWORK_ERROR', '网络连接失败，请检查网络后重试', 0)
  }
  if (!res.ok) {
    let code = `HTTP_${res.status}`
    let message = `请求失败（${res.status}）`
    try {
      const data = (await res.json()) as { error?: { code?: string; message?: string } }
      if (data.error?.code) code = data.error.code
      if (data.error?.message) message = data.error.message
    } catch { /* 非 JSON，保留默认值 */ }
    if (res.status === 401) {
      redirectToLogin()
      throw new ApiHttpError(code || 'AUTH_REQUIRED', '登录已过期', 401)
    }
    throw new ApiHttpError(code, message, res.status)
  }
  return res.json() as Promise<T>
}

/** 紧急下架两个接口返回裸对象；万一后端改成 ApiResponse 信封，这里也接得住。 */
function unwrap<T extends object>(body: unknown, requiredKey: keyof T): T {
  if (body && typeof body === 'object') {
    if (requiredKey in body) return body as T
    const data = (body as { data?: unknown }).data
    if (data && typeof data === 'object' && requiredKey in data) return data as T
  }
  throw new ApiHttpError('UNEXPECTED_RESPONSE', '服务端返回的内容无法识别，请刷新列表核对处置是否生效', 200)
}

const httpAdapter: RecruitmentEmergencyServiceInterface = {
  async getHostingEnabled() {
    const body = await request<{ data?: AdminRecruitmentHostingStatus }>('GET', '/admin/system/recruitment-hosting')
    const flag = body.data?.recruitmentHosting
    if (!flag || typeof flag.enabled !== 'boolean') {
      throw new ApiHttpError('UNEXPECTED_RESPONSE', '服务端没有返回招聘内容托管状态', 200)
    }
    return flag.enabled
  },
  async takedown(input) {
    const body = await request<unknown>('POST', '/admin/recruitment-emergency/takedown', input)
    return unwrap<RecruitmentEmergencyTakedownResult>(body, 'publishStatus')
  },
  async circuitBreak(input) {
    const body = await request<unknown>('POST', '/admin/recruitment-emergency/circuit-break', input)
    return unwrap<RecruitmentCircuitBreakResult>(body, 'unpublished')
  },
}

// ─── Mock adapter ─────────────────────────────────────────────────────────────

function mockHostingEnabled(): boolean {
  let value: string | null = null
  try {
    value = window.localStorage.getItem(MOCK_RECRUITMENT_HOSTING_KEY)
  } catch { /* 读不到按默认演示 */ }
  if (value === 'error') throw new ApiHttpError('NETWORK_ERROR', '网络连接失败，请检查网络后重试', 0)
  return value !== 'off'
}

function assertMockReason(reasonCode: string, reasonText: string): void {
  if (!reasonCode || !reasonText.trim()) {
    throw new ApiHttpError('TAKEDOWN_REASON_REQUIRED', '紧急下架必须选择事由并填写说明', 403)
  }
  let mode: string | null = null
  try {
    mode = window.localStorage.getItem(MOCK_RECRUITMENT_EMERGENCY_KEY)
  } catch { /* 读不到按默认演示 */ }
  if (mode === 'fail') {
    throw new ApiHttpError('EMERGENCY_TAKEDOWN_IRREVERSIBLE', '该内容已紧急下架，不能恢复', 403)
  }
}

const mockAdapter: RecruitmentEmergencyServiceInterface = {
  async getHostingEnabled() {
    return mockHostingEnabled()
  },
  async takedown(input) {
    assertMockReason(input.reasonCode, input.reasonText)
    // 演示数据里岗位 / 招聘会来源行真的改成已下架，其余类型只回执。
    if (input.targetType === 'job') await publishJobSourceRecord(input.targetId, 'unpublish')
    if (input.targetType === 'job_fair') await publishFairSourceRecord(input.targetId, 'unpublish')
    return { targetType: input.targetType, targetId: input.targetId, publishStatus: 'unpublished', irreversible: true }
  },
  async circuitBreak(input) {
    assertMockReason(input.reasonCode, input.reasonText)
    // 演示模式没有真实内容可锁定，如实回 0 条。
    return { scope: input.scope, id: input.id, unpublished: 0, irreversible: true }
  },
}

export const recruitmentEmergencyService: RecruitmentEmergencyServiceInterface =
  API_MODE === 'http' ? httpAdapter : mockAdapter
