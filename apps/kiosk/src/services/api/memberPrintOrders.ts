// ============================================================
// 会员「我的打印订单」API（Phase C-2C 后续小步，只读）
//
// 调用真实后端 /api/v1/me/print-orders（受 EndUserAuthGuard 保护，需会员 token）。
// - token 由调用方显式传入（来自 AuthContext 内存态 getToken()），不从任何存储读取。
// - 后端响应 envelope：{ success, data }，request<T> 解包后返回 T。
// - 仅对登录会员有意义；mock 模式（无真实会员会话）直接返回空列表，避免无效请求。
//
// 合规（CLAUDE.md §10/§12）：只读安全元数据；不持有文件原文 / 签名链接 / 哈希 / 支付字段。
// ============================================================

import type { MemberPrintOrderItem } from '@ai-job-print/shared'
import { API_BASE_URL, API_MODE } from './client'

export class MemberPrintOrdersApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'MemberPrintOrdersApiError'
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
    throw new MemberPrintOrdersApiError('NETWORK_ERROR', '网络连接失败，请稍后重试', 0)
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
    throw new MemberPrintOrdersApiError(code, message, res.status)
  }
  const json = (await res.json()) as Envelope<T>
  return json.data
}

/** 我的打印订单（本人，只读；游标分页，pageSize 封顶 50）。未登录 / mock 模式返回空页。 */
export function getMyPrintOrders(
  token: string | null | undefined,
  opts?: { cursor?: string | null; pageSize?: number },
): Promise<{ items: MemberPrintOrderItem[]; nextCursor: string | null; total: number }> {
  if (API_MODE !== 'http' || !token) return Promise.resolve({ items: [], nextCursor: null, total: 0 })
  const params = new URLSearchParams()
  if (opts?.cursor) params.set('cursor', opts.cursor)
  if (opts?.pageSize) params.set('pageSize', String(opts.pageSize))
  const q = params.toString()
  return request<{ items: MemberPrintOrderItem[]; nextCursor: string | null; total: number }>(
    `/me/print-orders${q ? `?${q}` : ''}`,
    token,
  )
}
