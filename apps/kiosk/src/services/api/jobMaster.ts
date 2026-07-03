// ============================================================
// 岗位大师（岗位决策分析台）service（Kiosk）。
//
// http 模式走真实 /api/v1/resume/job-master;mock 模式诚实拒绝（页面引导切 http）。
// 凭证：登录会员 Bearer;匿名 x-resume-access-token（同 AI 简历链路 C-2A）。
// 合规：适配度为参考等级(无百分比/录用承诺);薪资只透传来源方文本;投递只引导
// 「去来源平台投递」;打印走真实 PDF + 既有打印链路。
// ============================================================

import type { JobMasterRequest, JobMasterResponse, JobMasterPrintResponse } from '@ai-job-print/shared'
import { isMemberSessionInvalidError, notifyMemberSessionExpired } from '../auth/memberSessionEvents'
import { API_BASE_URL, API_MODE } from './client'

export class JobMasterApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'JobMasterApiError'
  }
}

export interface JobMasterAccess {
  token?: string | null
  accessToken?: string | null
}

async function call<T>(path: string, access: JobMasterAccess, init?: { method?: string; body?: unknown }): Promise<T> {
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
    throw new JobMasterApiError('NETWORK_ERROR', '网络连接失败，请稍后重试', 0)
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
    throw new JobMasterApiError(code, message, res.status)
  }
  return (await res.json()) as T
}

/** 发起岗位决策分析（系统内岗位或手填岗位）。 */
export function analyzeJobMaster(input: JobMasterRequest, access: JobMasterAccess): Promise<JobMasterResponse> {
  if (API_MODE !== 'http') {
    return Promise.reject(new JobMasterApiError('MOCK_MODE', '演示模式不提供岗位决策分析，请连接真实服务', 0))
  }
  return call<JobMasterResponse>('/resume/job-master', access, { method: 'POST', body: input })
}

/** 读回最近一次决策分析（刷新恢复）。 */
export function getLatestJobMaster(taskId: string, access: JobMasterAccess): Promise<JobMasterResponse> {
  if (API_MODE !== 'http') {
    return Promise.reject(new JobMasterApiError('MOCK_MODE', '演示模式不提供岗位决策分析', 0))
  }
  return call<JobMasterResponse>(`/resume/job-master/${encodeURIComponent(taskId)}`, access)
}

/** 决策报告 PDF（真实 PDF → 我的文档 → 打印链路）。 */
export function printJobMaster(taskId: string, access: JobMasterAccess): Promise<JobMasterPrintResponse> {
  if (API_MODE !== 'http') {
    return Promise.reject(new JobMasterApiError('MOCK_MODE', '演示模式不生成真实打印文件', 0))
  }
  return call<JobMasterPrintResponse>(`/resume/job-master/${encodeURIComponent(taskId)}/print`, access, { method: 'POST' })
}
