// ============================================================
// 2E 职业规划 service（Kiosk）。
//
// http 模式走真实 /api/v1/resume/career-plan；mock 模式诚实拒绝。
// 凭证：登录会员 Bearer；匿名 x-resume-access-token（同 AI 简历链路 C-2A）。
// 合规：结果仅供本人参考，无任何薪资/录用承诺；打印走真实 PDF + 既有打印链路。
// ============================================================

import type { CareerPlanResponse, CareerPlanPrintResponse } from '@ai-job-print/shared'
import { API_BASE_URL, API_MODE } from './client'

export class CareerPlanApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'CareerPlanApiError'
  }
}

export interface CareerPlanAccess {
  token?: string | null
  accessToken?: string | null
}

async function call<T>(path: string, access: CareerPlanAccess, init?: { method?: string }): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(access.token ? { Authorization: `Bearer ${access.token}` } : {}),
        ...(!access.token && access.accessToken ? { 'x-resume-access-token': access.accessToken } : {}),
      },
      credentials: 'include',
    })
  } catch {
    throw new CareerPlanApiError('NETWORK_ERROR', '网络连接失败，请稍后重试', 0)
  }
  if (!res.ok) {
    let code = 'UNKNOWN_ERROR'
    let message = `请求失败（${res.status}）`
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } }
      code = body.error?.code ?? code
      message = body.error?.message ?? message
    } catch { /* keep defaults */ }
    throw new CareerPlanApiError(code, message, res.status)
  }
  return (await res.json()) as T
}

/** 生成职业规划建议（基于已诊断简历；自动聚合本人岗位匹配/面试摘要）。 */
export function generateCareerPlan(taskId: string, access: CareerPlanAccess): Promise<CareerPlanResponse> {
  if (API_MODE !== 'http') return Promise.reject(new CareerPlanApiError('MOCK_MODE', '演示模式不提供职业规划，请连接真实服务', 0))
  return call<CareerPlanResponse>(`/resume/career-plan/${encodeURIComponent(taskId)}`, access, { method: 'POST' })
}

/** 读回最近一次规划（刷新恢复）。 */
export function getLatestCareerPlan(taskId: string, access: CareerPlanAccess): Promise<CareerPlanResponse> {
  if (API_MODE !== 'http') return Promise.reject(new CareerPlanApiError('MOCK_MODE', '演示模式不提供职业规划', 0))
  return call<CareerPlanResponse>(`/resume/career-plan/${encodeURIComponent(taskId)}`, access)
}

/** 打印版建议单（真实 PDF → 我的文档 → 打印链路）。 */
export function printCareerPlan(taskId: string, access: CareerPlanAccess): Promise<CareerPlanPrintResponse> {
  if (API_MODE !== 'http') return Promise.reject(new CareerPlanApiError('MOCK_MODE', '演示模式不生成真实打印文件', 0))
  return call<CareerPlanPrintResponse>(`/resume/career-plan/${encodeURIComponent(taskId)}/print`, access, { method: 'POST' })
}
