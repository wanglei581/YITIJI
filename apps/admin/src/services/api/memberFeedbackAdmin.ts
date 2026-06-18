import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

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

export interface AdminFeedbackTicketItem {
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
  endUserId: string
  phoneMasked: string
  nickname: string | null
}

export interface AdminFeedbackTicketDetail extends AdminFeedbackTicketItem {
  replies: FeedbackReplyItem[]
}

export interface ListFeedbackParams {
  status?: FeedbackStatus | 'all'
  category?: FeedbackCategory | 'all'
}

interface Envelope<T> {
  data: T
}

interface ErrorEnvelope {
  error?: {
    code?: string
    message?: string
  }
}

async function request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      ...authHeader(),
      ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    credentials: 'include',
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  })
  if (!res.ok) {
    let code = `HTTP_${res.status}`
    let message = res.statusText || '请求失败'
    try {
      const body = (await res.json()) as ErrorEnvelope
      code = body.error?.code ?? code
      message = body.error?.message ?? message
    } catch { /* keep defaults */ }
    if (res.status === 401) redirectToLogin()
    throw new ApiHttpError(code, message, res.status)
  }
  const json = (await res.json()) as Envelope<T>
  return json.data
}

function feedbackQuery(params: ListFeedbackParams): string {
  const query = new URLSearchParams()
  if (params.status && params.status !== 'all') query.set('status', params.status)
  if (params.category && params.category !== 'all') query.set('category', params.category)
  const text = query.toString()
  return text ? `?${text}` : ''
}

const EMPTY = { items: [] as AdminFeedbackTicketItem[] }

export const memberFeedbackAdminApi = {
  list(params: ListFeedbackParams = {}): Promise<{ items: AdminFeedbackTicketItem[] }> {
    if (API_MODE !== 'http') return Promise.resolve(EMPTY)
    return request(`/admin/feedback${feedbackQuery(params)}`)
  },
  get(id: string): Promise<AdminFeedbackTicketDetail> {
    if (API_MODE !== 'http') return Promise.reject(new ApiHttpError('MOCK_DISABLED', 'mock 模式不支持查看反馈详情', 400))
    return request(`/admin/feedback/${encodeURIComponent(id)}`)
  },
  reply(id: string, content: string): Promise<AdminFeedbackTicketDetail> {
    if (API_MODE !== 'http') return Promise.reject(new ApiHttpError('MOCK_DISABLED', 'mock 模式不支持回复反馈', 400))
    return request(`/admin/feedback/${encodeURIComponent(id)}/replies`, { method: 'POST', body: { content } })
  },
  updateStatus(id: string, status: FeedbackStatus): Promise<AdminFeedbackTicketDetail> {
    if (API_MODE !== 'http') return Promise.reject(new ApiHttpError('MOCK_DISABLED', 'mock 模式不支持更新反馈状态', 400))
    return request(`/admin/feedback/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: { status } })
  },
}
