// ============================================================
// 会员「AI/扫描服务单」列表 API（自助开票二期，只读，零 PII）
//
// 调用后端 GET /api/v1/me/service-orders（受 EndUserAuthGuard 保护）。
// - token 由调用方显式传入（来自 AuthContext 内存态 getToken()），不读任何存储。
// - mock / 未登录模式下安全回空页，不影响既有演示流。
// ============================================================

import type { MemberServiceOrderPage } from '@ai-job-print/shared'
import { isMemberSessionInvalidError, notifyMemberSessionExpired } from '../auth/memberSessionEvents'
import { API_BASE_URL, API_MODE } from './client'

export class MemberServiceOrdersApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'MemberServiceOrdersApiError'
  }
}

interface Envelope<T> {
  success: boolean
  data: T
}

async function request<T>(path: string, token: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      credentials: 'include',
    })
  } catch {
    throw new MemberServiceOrdersApiError('NETWORK_ERROR', '网络连接失败，请稍后重试', 0)
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
    throw new MemberServiceOrdersApiError(code, message, res.status)
  }
  const json = (await res.json()) as Envelope<T>
  return json.data
}

/** 我的 AI/扫描服务单（本人，只读；游标分页，pageSize 封顶 50）。未登录 / mock 模式安全回空页。 */
export function getMyServiceOrders(
  token: string | null | undefined,
  opts?: { cursor?: string | null; pageSize?: number },
): Promise<MemberServiceOrderPage> {
  if (API_MODE !== 'http' || !token) return Promise.resolve({ items: [], nextCursor: null, total: 0 })
  const params = new URLSearchParams()
  if (opts?.cursor) params.set('cursor', opts.cursor)
  if (opts?.pageSize) params.set('pageSize', String(opts.pageSize))
  const q = params.toString()
  return request<MemberServiceOrderPage>(`/me/service-orders${q ? `?${q}` : ''}`, token)
}
