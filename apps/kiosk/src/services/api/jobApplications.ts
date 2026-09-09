// 本人自填求职进度（compliance-boundary.md §4.4A）。
// 只读列表：手填入口待建设，本客户端不发 POST / PATCH。
// 合法性由「谁写的」决定——服务端恒写 statusSource=self_reported。

import type { JobApplicationItem, MemberAssetPage } from '@ai-job-print/shared'
import { isMemberSessionInvalidError, notifyMemberSessionExpired } from '../auth/memberSessionEvents'
import { API_BASE_URL, API_MODE } from './client'

interface Envelope<T> {
  success: boolean
  data: T
}

export class JobApplicationsApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'JobApplicationsApiError'
  }
}

export function listMyJobApplications(
  token: string | null,
  opts?: { pageSize?: number; cursor?: string | null },
): Promise<MemberAssetPage<JobApplicationItem>> {
  if (API_MODE !== 'http' || !token) {
    return Promise.resolve({ items: [], nextCursor: null, total: 0 })
  }
  const query = new URLSearchParams()
  if (opts?.pageSize) query.set('pageSize', String(opts.pageSize))
  if (opts?.cursor) query.set('cursor', opts.cursor)
  const suffix = query.size > 0 ? `?${query.toString()}` : ''
  return fetchPage(`/me/job-applications${suffix}`, token)
}

async function fetchPage(path: string, token: string): Promise<MemberAssetPage<JobApplicationItem>> {
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      credentials: 'include',
    })
  } catch {
    throw new JobApplicationsApiError('NETWORK_ERROR', '网络连接失败，请稍后重试')
  }
  if (!res.ok) {
    let code = 'UNKNOWN_ERROR'
    let message = `请求失败（${res.status}）`
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } }
      code = body.error?.code ?? code
      message = body.error?.message ?? message
    } catch { /* keep defaults */ }
    if (isMemberSessionInvalidError(res.status, code, true)) notifyMemberSessionExpired(token)
    throw new JobApplicationsApiError(code, message)
  }
  const json = (await res.json()) as Envelope<MemberAssetPage<JobApplicationItem>>
  return json.data
}
