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

/**
 * 工单提交方类型。`anonymous_kiosk` 由一体机匿名反馈端点写入（PR #612），
 * 这类工单没有账号归属：不能回复、不能推通知，只能现场处置。
 */
export type FeedbackSubmitterType = 'member' | 'anonymous_kiosk'

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
  submitterType: FeedbackSubmitterType
  // 以下三项对匿名一体机工单均为 null —— 服务端不编造占位值
  // （services/api/src/member-feedback/member-feedback.service.ts:toAdminItem）。
  // 此前本地类型把它们写成不可空，类型撒谎导致渲染处不判空，匿名工单显示为空白。
  endUserId: string | null
  phoneMasked: string | null
  nickname: string | null
  relatedScanTaskId: string | null
  /** 打印完成页满意度三档；null = 未评价。 */
  satisfaction: 'good' | 'fair' | 'bad' | null
}

export interface AdminFeedbackTicketDetail extends AdminFeedbackTicketItem {
  replies: FeedbackReplyItem[]
}

export interface ListFeedbackParams {
  status?: FeedbackStatus | 'all'
  category?: FeedbackCategory | 'all'
  /** 按提交方筛选。匿名一体机工单只能现场处置，运营需要把它单独拉成一条队列。 */
  submitterType?: FeedbackSubmitterType | 'all'
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
  if (params.submitterType && params.submitterType !== 'all') query.set('submitterType', params.submitterType)
  const text = query.toString()
  return text ? `?${text}` : ''
}

const EMPTY = { items: [] as AdminFeedbackTicketItem[], total: 0 }

export const memberFeedbackAdminApi = {
  list(params: ListFeedbackParams = {}): Promise<{ items: AdminFeedbackTicketItem[]; total: number }> {
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
