// ============================================================
// 会员意见反馈 API（本人）。
//
// 仅用于设备 / 打印 / 文件处理 / 一般建议反馈。mock 模式 / 游客态返回空页或 no-op，
// 不伪造工单与回复。
// ============================================================

import { API_BASE_URL, API_MODE } from './client'

export type FeedbackCategory = 'device' | 'print' | 'file_process' | 'general'
export type FeedbackStatus = 'pending' | 'processing' | 'replied' | 'closed'
export type FeedbackSenderType = 'user' | 'admin' | 'system'

export interface FeedbackReplyItem {
  id: string
  senderType: FeedbackSenderType
  actorId: string | null
  content: string
  createdAt: string
}

export interface MemberFeedbackTicketItem {
  id: string
  category: FeedbackCategory
  title: string | null
  content: string
  contactPhoneMasked: string | null
  terminalId: string | null
  relatedPrintTaskId: string | null
  status: FeedbackStatus
  createdAt: string
  updatedAt: string
}

export interface MemberFeedbackTicketDetail extends MemberFeedbackTicketItem {
  replies: FeedbackReplyItem[]
}

export interface MemberFeedbackPage {
  items: MemberFeedbackTicketItem[]
  nextCursor: string | null
  total: number
}

export class MemberFeedbackApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'MemberFeedbackApiError'
  }
}

interface Envelope<T> {
  success: boolean
  data: T
}

export interface CreateMemberFeedbackInput {
  category: FeedbackCategory
  title?: string
  content: string
  contactPhone?: string
  terminalId?: string
  relatedPrintTaskId?: string
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
    throw new MemberFeedbackApiError('NETWORK_ERROR', '网络连接失败，请稍后重试', 0)
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
    throw new MemberFeedbackApiError(code, message, res.status)
  }

  const json = (await res.json()) as Envelope<T>
  return json.data
}

function pageQuery(opts?: { cursor?: string | null; pageSize?: number }): string {
  const params = new URLSearchParams()
  if (opts?.cursor) params.set('cursor', opts.cursor)
  if (opts?.pageSize) params.set('pageSize', String(opts.pageSize))
  const q = params.toString()
  return q ? `?${q}` : ''
}

const EMPTY_PAGE: MemberFeedbackPage = { items: [], nextCursor: null, total: 0 }

export function getMyFeedback(
  token: string | null | undefined,
  opts?: { cursor?: string | null; pageSize?: number },
): Promise<MemberFeedbackPage> {
  if (API_MODE !== 'http' || !token) return Promise.resolve(EMPTY_PAGE)
  return request<MemberFeedbackPage>(`/me/feedback${pageQuery(opts)}`, token)
}

export function createMyFeedback(
  token: string | null | undefined,
  input: CreateMemberFeedbackInput,
): Promise<MemberFeedbackTicketDetail> {
  if (API_MODE !== 'http' || !token) {
    return Promise.reject(new MemberFeedbackApiError('NO_HTTP_SESSION', '请登录后提交反馈', 0))
  }
  return request<MemberFeedbackTicketDetail>('/me/feedback', token, { method: 'POST', body: input })
}

export function getMyFeedbackDetail(
  token: string | null | undefined,
  id: string,
): Promise<MemberFeedbackTicketDetail | null> {
  if (API_MODE !== 'http' || !token) return Promise.resolve(null)
  return request<MemberFeedbackTicketDetail>(`/me/feedback/${encodeURIComponent(id)}`, token)
}

export function addMyFeedbackReply(
  token: string | null | undefined,
  id: string,
  content: string,
): Promise<MemberFeedbackTicketDetail> {
  if (API_MODE !== 'http' || !token) {
    return Promise.reject(new MemberFeedbackApiError('NO_HTTP_SESSION', '请登录后补充描述', 0))
  }
  return request<MemberFeedbackTicketDetail>(`/me/feedback/${encodeURIComponent(id)}/replies`, token, {
    method: 'POST',
    body: { content },
  })
}

export function closeMyFeedback(
  token: string | null | undefined,
  id: string,
): Promise<MemberFeedbackTicketDetail> {
  if (API_MODE !== 'http' || !token) {
    return Promise.reject(new MemberFeedbackApiError('NO_HTTP_SESSION', '请登录后关闭反馈', 0))
  }
  return request<MemberFeedbackTicketDetail>(`/me/feedback/${encodeURIComponent(id)}/close`, token, {
    method: 'PATCH',
  })
}
