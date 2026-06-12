// ============================================================
// 2D 岗位匹配参考 service（Kiosk）。
//
// http 模式走真实 /api/v1/resume/job-fit；mock 模式诚实拒绝（页面引导切 http）。
// 凭证：登录会员 Bearer；匿名 x-resume-access-token（同 AI 简历链路 C-2A）。
// 合规：结果为参考等级，无任何百分比/录用承诺；投递只引导「去来源平台投递」。
// ============================================================

import type { JobFitRequest, JobFitResponse } from '@ai-job-print/shared'
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
    throw new JobFitApiError(code, message, res.status)
  }
  return (await res.json()) as T
}

/** 发起岗位匹配参考分析（系统内岗位或手填岗位）。 */
export function analyzeJobFit(input: JobFitRequest, access: JobFitAccess): Promise<JobFitResponse> {
  if (API_MODE !== 'http') {
    return Promise.reject(new JobFitApiError('MOCK_MODE', '演示模式不提供岗位匹配参考，请连接真实服务', 0))
  }
  return call<JobFitResponse>('/resume/job-fit', access, { method: 'POST', body: input })
}

/** 读回最近一次分析（刷新恢复）。 */
export function getLatestJobFit(taskId: string, access: JobFitAccess): Promise<JobFitResponse> {
  if (API_MODE !== 'http') {
    return Promise.reject(new JobFitApiError('MOCK_MODE', '演示模式不提供岗位匹配参考', 0))
  }
  return call<JobFitResponse>(`/resume/job-fit/${encodeURIComponent(taskId)}`, access)
}
