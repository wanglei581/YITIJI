// ============================================================
// 2D 岗位匹配参考 service（Kiosk）。
//
// http 模式走真实 /api/v1/resume/job-fit；mock 模式诚实拒绝（页面引导切 http）。
// 凭证：登录会员 Bearer；匿名 x-resume-access-token（同 AI 简历链路 C-2A）。
// 合规：结果为参考等级，无任何百分比/录用承诺；投递只引导「去来源平台投递」。
// ============================================================

import type { JobFitPrintResponse, JobFitRequest, JobFitResponse } from '@ai-job-print/shared'
import { isMemberSessionInvalidError, notifyMemberSessionExpired } from '../auth/memberSessionEvents'
import { API_BASE_URL, API_MODE } from './client'

export class JobFitApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'JobFitApiError'
  }
}

export interface JobFitAccess {
  token?: string | null
  accessToken?: string | null
}

export interface JobFitConsentStatus {
  taskId: string
  consentVersion: string | null
  grantedAt: string | null
  revokedAt: string | null
  active: boolean
}

async function call<T>(path: string, access: JobFitAccess, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(access.token ? { Authorization: `Bearer ${access.token}` } : {}),
        ...(!access.token && access.accessToken ? { 'x-resume-access-token': access.accessToken } : {}),
        ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      credentials: 'include',
      ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    })
  } catch {
    throw new JobFitApiError('NETWORK_ERROR', '网络连接失败，请稍后重试', 0)
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
    throw new JobFitApiError(code, message, res.status)
  }
  return (await res.json()) as T
}

/** 匿名 consent 端点绝不携带会员 Bearer，避免混淆两套授权语义。 */
function anonymousAccess(access: JobFitAccess): JobFitAccess {
  return { accessToken: access.accessToken }
}

/** 发起岗位匹配参考分析（系统内岗位或手填岗位）。 */
export function analyzeJobFit(input: JobFitRequest, access: JobFitAccess): Promise<JobFitResponse> {
  if (API_MODE !== 'http') {
    return Promise.reject(new JobFitApiError('MOCK_MODE', '演示模式不提供岗位匹配参考，请连接真实服务', 0))
  }
  return call<JobFitResponse>('/resume/job-fit', access, { method: 'POST', body: input })
}

/** 为当前匿名简历诊断任务明确授予岗位匹配分析授权。 */
export function grantJobFitConsent(taskId: string, access: JobFitAccess): Promise<JobFitConsentStatus> {
  if (API_MODE !== 'http') {
    return Promise.reject(new JobFitApiError('MOCK_MODE', '演示模式不提供岗位匹配授权', 0))
  }
  return call<JobFitConsentStatus>('/resume/job-fit/consent', anonymousAccess(access), { method: 'POST', body: { taskId } })
}

/** 读取当前匿名简历诊断任务的岗位匹配授权状态。 */
export function getJobFitConsentStatus(taskId: string, access: JobFitAccess): Promise<JobFitConsentStatus> {
  if (API_MODE !== 'http') {
    return Promise.reject(new JobFitApiError('MOCK_MODE', '演示模式不提供岗位匹配授权状态', 0))
  }
  return call<JobFitConsentStatus>(`/resume/job-fit/consent/${encodeURIComponent(taskId)}`, anonymousAccess(access))
}

/** 撤回当前匿名简历诊断任务的后续岗位匹配分析授权。 */
export function revokeJobFitConsent(taskId: string, access: JobFitAccess): Promise<JobFitConsentStatus> {
  if (API_MODE !== 'http') {
    return Promise.reject(new JobFitApiError('MOCK_MODE', '演示模式不提供岗位匹配授权撤回', 0))
  }
  return call<JobFitConsentStatus>(`/resume/job-fit/consent/${encodeURIComponent(taskId)}`, anonymousAccess(access), { method: 'DELETE' })
}

/** 读回最近一次分析（刷新恢复）。 */
export function getLatestJobFit(taskId: string, access: JobFitAccess): Promise<JobFitResponse> {
  if (API_MODE !== 'http') {
    return Promise.reject(new JobFitApiError('MOCK_MODE', '演示模式不提供岗位匹配参考', 0))
  }
  return call<JobFitResponse>(`/resume/job-fit/${encodeURIComponent(taskId)}`, access)
}

/** 岗位匹配决策报告：服务端生成 PDF，只交给既有打印确认链路。 */
export function printJobFit(taskId: string, access: JobFitAccess): Promise<JobFitPrintResponse> {
  if (API_MODE !== 'http') {
    return Promise.reject(new JobFitApiError('MOCK_MODE', '演示模式不生成真实打印文件', 0))
  }
  return call<JobFitPrintResponse>(`/resume/job-fit/${encodeURIComponent(taskId)}/print`, access, { method: 'POST' })
}
