// ============================================================
// 自我探索 · 倾向参考 service（Kiosk）。
//
// http 模式走真实 /api/v1/resume/self-assessment；mock 模式诚实拒绝。
// 凭证：登录会员 Bearer；匿名 x-resume-access-token（同 AI 简历链路 C-2A）。
// 合规：仅本人参考；不打通企业 / 合作机构 / 第三方；不可分享 / 不可重投递。
// ============================================================

import type {
  SelfAssessmentAnswerV1,
  SelfAssessmentPrintResponse,
  SelfAssessmentSubmitResponse,
} from '@ai-job-print/shared'
import { isMemberSessionInvalidError, notifyMemberSessionExpired } from '../auth/memberSessionEvents'
import { API_BASE_URL, API_MODE } from './client'

export class SelfAssessmentApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'SelfAssessmentApiError'
  }
}

export interface SelfAssessmentAccess {
  token?: string | null
  accessToken?: string | null
}

async function call<T>(path: string, access: SelfAssessmentAccess, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(access.token ? { Authorization: `Bearer ${access.token}` } : {}),
        ...(!access.token && access.accessToken ? { 'x-resume-access-token': access.accessToken } : {}),
      },
      credentials: 'include',
      body: init?.body ? JSON.stringify(init.body) : undefined,
    })
  } catch {
    throw new SelfAssessmentApiError('NETWORK_ERROR', '网络连接失败，请稍后重试', 0)
  }
  if (!res.ok) {
    let code = 'UNKNOWN_ERROR'
    let message = `请求失败（${res.status}）`
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } }
      code = body.error?.code ?? code
      message = body.error?.message ?? message
    } catch { /* keep defaults */ }
    if (isMemberSessionInvalidError(res.status, code, Boolean(access.token))) notifyMemberSessionExpired(access.token ?? undefined)
    throw new SelfAssessmentApiError(code, message, res.status)
  }
  return (await res.json()) as T
}

export function submitSelfAssessment(
  body: {
    answers: SelfAssessmentAnswerV1[]
    consent: { nonSensitive: boolean; sensitive: boolean }
  },
  access: SelfAssessmentAccess,
): Promise<SelfAssessmentSubmitResponse> {
  if (API_MODE !== 'http') return Promise.reject(new SelfAssessmentApiError('MOCK_MODE', '演示模式不提供自我探索，请连接真实服务', 0))
  return call<SelfAssessmentSubmitResponse>('/resume/self-assessment', access, { method: 'POST', body })
}

export function getLatestSelfAssessment(taskId: string, access: SelfAssessmentAccess): Promise<SelfAssessmentSubmitResponse> {
  if (API_MODE !== 'http') return Promise.reject(new SelfAssessmentApiError('MOCK_MODE', '演示模式不提供自我探索', 0))
  return call<SelfAssessmentSubmitResponse>(`/resume/self-assessment/${encodeURIComponent(taskId)}`, access)
}

export function printSelfAssessment(taskId: string, access: SelfAssessmentAccess): Promise<SelfAssessmentPrintResponse> {
  if (API_MODE !== 'http') return Promise.reject(new SelfAssessmentApiError('MOCK_MODE', '演示模式不生成真实打印文件', 0))
  return call<SelfAssessmentPrintResponse>(`/resume/self-assessment/${encodeURIComponent(taskId)}/print`, access, { method: 'POST' })
}

export function withdrawSelfAssessment(taskId: string, access: SelfAssessmentAccess): Promise<{ deleted: true }> {
  if (API_MODE !== 'http') return Promise.reject(new SelfAssessmentApiError('MOCK_MODE', '演示模式不提供撤回', 0))
  return call<{ deleted: true }>(`/resume/self-assessment/${encodeURIComponent(taskId)}`, access, { method: 'DELETE' })
}

/** 合并「自我探索 + 简历 PDF」生成新的可打印 PDF。 */
export function appendSelfAssessmentToResume(
  taskId: string,
  resumeFileId: string,
  access: SelfAssessmentAccess,
): Promise<SelfAssessmentPrintResponse> {
  if (API_MODE !== 'http') return Promise.reject(new SelfAssessmentApiError('MOCK_MODE', '演示模式不生成合并 PDF', 0))
  return call<SelfAssessmentPrintResponse>(
    `/resume/self-assessment/${encodeURIComponent(taskId)}/append`,
    access,
    { method: 'POST', body: { resumeFileId } },
  )
}
