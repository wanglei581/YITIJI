// ============================================================
// 招聘会 AI 参会准备单 service（Kiosk）。
//
// http 模式走真实 /api/v1/job-fairs/:fairId/visit-plan；mock 模式诚实拒绝。
// 凭证同 AI 简历链路：会员 Bearer，匿名 x-resume-access-token。
// ============================================================

import type { FairVisitPlanPrintResponse, FairVisitPlanResponse } from '@ai-job-print/shared'
import { isMemberSessionInvalidError, notifyMemberSessionExpired } from '../auth/memberSessionEvents'
import { API_BASE_URL, API_MODE } from './client'

export class FairVisitPlanApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'FairVisitPlanApiError'
  }
}

export interface FairVisitPlanAccess {
  token?: string | null
  accessToken?: string | null
}

async function call<T>(
  fairId: string,
  taskId: string,
  suffix: string,
  access: FairVisitPlanAccess,
  init?: { method?: string },
): Promise<T> {
  let res: Response
  try {
    res = await fetch(
      `${API_BASE_URL}/job-fairs/${encodeURIComponent(fairId)}/visit-plan/${encodeURIComponent(taskId)}${suffix}`,
      {
        method: init?.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          ...(access.token ? { Authorization: `Bearer ${access.token}` } : {}),
          ...(!access.token && access.accessToken ? { 'x-resume-access-token': access.accessToken } : {}),
        },
        credentials: 'include',
      },
    )
  } catch {
    throw new FairVisitPlanApiError('NETWORK_ERROR', '网络连接失败，请稍后重试', 0)
  }
  if (!res.ok) {
    let code = 'UNKNOWN_ERROR'
    let message = `请求失败（${res.status}）`
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } }
      code = body.error?.code ?? code
      message = body.error?.message ?? message
    } catch {
      // keep defaults
    }
    if (isMemberSessionInvalidError(res.status, code, Boolean(access.token))) notifyMemberSessionExpired(access.token ?? undefined)
    throw new FairVisitPlanApiError(code, message, res.status)
  }
  return (await res.json()) as T
}

export function generateFairVisitPlan(fairId: string, taskId: string, access: FairVisitPlanAccess): Promise<FairVisitPlanResponse> {
  if (API_MODE !== 'http') return Promise.reject(new FairVisitPlanApiError('MOCK_MODE', '演示模式不提供参会准备单，请连接真实服务', 0))
  return call<FairVisitPlanResponse>(fairId, taskId, '', access, { method: 'POST' })
}

export function getLatestFairVisitPlan(fairId: string, taskId: string, access: FairVisitPlanAccess): Promise<FairVisitPlanResponse> {
  if (API_MODE !== 'http') return Promise.reject(new FairVisitPlanApiError('MOCK_MODE', '演示模式不提供参会准备单', 0))
  return call<FairVisitPlanResponse>(fairId, taskId, '', access)
}

export function printFairVisitPlan(fairId: string, taskId: string, access: FairVisitPlanAccess): Promise<FairVisitPlanPrintResponse> {
  if (API_MODE !== 'http') return Promise.reject(new FairVisitPlanApiError('MOCK_MODE', '演示模式不生成真实打印文件', 0))
  return call<FairVisitPlanPrintResponse>(fairId, taskId, '/print', access, { method: 'POST' })
}
