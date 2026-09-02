// ============================================================
// 我的求职进度 API（compliance-boundary.md §4.4A，2026-09-02 具名授权）
//
// 调用真实后端 /api/v1/me/job-applications/*（受 EndUserAuthGuard 保护，需会员 token）。
// - token 由调用方显式传入（来自 AuthContext 内存态 getToken()），不从任何存储读取。
// - 后端响应 envelope：{ success, data }，request<T> 解包后返回 T。
// - 只对登录会员有意义；mock 模式（无真实会员会话）返回空列表 / no-op，避免无效请求。
//
// 合规：这是用户**本人自填**的求职记事本；本终端不参与、不涉及平台内投递。本模块刻意不存在
// 任何「同步 / 拉取第三方状态」的方法 —— 没有回流入口，就没有招聘闭环。
// ============================================================

import type {
  CreateJobApplicationInput,
  JobApplicationItem,
  JobApplicationStatus,
  UpdateJobApplicationInput,
} from '@ai-job-print/shared'
import { isMemberSessionInvalidError, notifyMemberSessionExpired } from '../auth/memberSessionEvents'
import { API_BASE_URL, API_MODE } from './client'

export class JobApplicationApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'JobApplicationApiError'
  }
}

interface Envelope<T> {
  success: boolean
  data: T
}

async function request<T>(
  path: string,
  token: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      credentials: 'include',
      ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    })
  } catch {
    throw new JobApplicationApiError('NETWORK_ERROR', '网络连接失败，请稍后重试', 0)
  }
  if (!res.ok) {
    let code = 'UNKNOWN_ERROR'
    let message = `请求失败（${res.status}）`
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } }
      code = body.error?.code ?? code
      message = body.error?.message ?? message
    } catch {
      /* keep defaults */
    }
    if (isMemberSessionInvalidError(res.status, code, true)) notifyMemberSessionExpired(token)
    throw new JobApplicationApiError(code, message, res.status)
  }
  const json = (await res.json()) as Envelope<T>
  return json.data
}

type Page = { items: JobApplicationItem[]; nextCursor: string | null; total: number }

/** 我的求职进度（本人，可选按状态过滤；游标分页，pageSize 封顶 50）。 */
export function getMyJobApplications(
  token: string | null | undefined,
  status?: JobApplicationStatus,
  opts?: { cursor?: string | null; pageSize?: number },
): Promise<Page> {
  if (API_MODE !== 'http' || !token) return Promise.resolve({ items: [], nextCursor: null, total: 0 })
  const params = new URLSearchParams()
  if (status) params.set('status', status)
  if (opts?.cursor) params.set('cursor', opts.cursor)
  if (opts?.pageSize) params.set('pageSize', String(opts.pageSize))
  const q = params.toString()
  return request<Page>(`/me/job-applications${q ? `?${q}` : ''}`, token)
}

/**
 * 拉取全部条目（看板要按状态分列展示，需要完整集合）。
 * 逐页拉取（每页 50），硬上限 10 页 / 500 条防失控。
 */
export async function getAllMyJobApplications(
  token: string | null | undefined,
): Promise<JobApplicationItem[]> {
  if (API_MODE !== 'http' || !token) return []
  const all: JobApplicationItem[] = []
  let cursor: string | null = null
  for (let i = 0; i < 10; i += 1) {
    const page = await getMyJobApplications(token, undefined, { cursor, pageSize: 50 })
    all.push(...page.items)
    if (!page.nextCursor) break
    cursor = page.nextCursor
  }
  return all
}

/** 记录一次投递（新建一条本人求职进度）。未登录 / mock 模式 no-op（返回 null）。 */
export function createJobApplication(
  token: string | null | undefined,
  input: CreateJobApplicationInput,
): Promise<JobApplicationItem | null> {
  if (API_MODE !== 'http' || !token) return Promise.resolve(null)
  return request<JobApplicationItem>('/me/job-applications', token, { method: 'POST', body: input })
}

/** 更新本人的一条记录。 */
export function updateJobApplication(
  token: string | null | undefined,
  id: string,
  input: UpdateJobApplicationInput,
): Promise<JobApplicationItem | null> {
  if (API_MODE !== 'http' || !token) return Promise.resolve(null)
  return request<JobApplicationItem>(`/me/job-applications/${encodeURIComponent(id)}`, token, {
    method: 'PATCH',
    body: input,
  })
}

/** 删除本人的一条记录（幂等）。 */
export function deleteJobApplication(
  token: string | null | undefined,
  id: string,
): Promise<{ removed: boolean }> {
  if (API_MODE !== 'http' || !token) return Promise.resolve({ removed: false })
  return request<{ removed: boolean }>(`/me/job-applications/${encodeURIComponent(id)}`, token, {
    method: 'DELETE',
  })
}
