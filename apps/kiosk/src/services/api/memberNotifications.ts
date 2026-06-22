// ============================================================
// 会员消息通知 API（本人）。
//
// 调用真实后端 /api/v1/me/notifications*（需会员 token）。
// mock 模式 / 游客态直接返回空页或 no-op，不伪造消息。
// ============================================================

import { isMemberSessionInvalidError, notifyMemberSessionExpired } from '../auth/memberSessionEvents'
import { API_BASE_URL, API_MODE } from './client'

export type MemberNotificationCategory = 'system' | 'print' | 'ai' | 'feedback'
export type SystemBroadcastCategory = 'system' | 'maintenance' | 'notice'
export type NotificationKind = 'personal' | 'broadcast'

export type MemberNotificationRelatedType = 'feedback_ticket' | 'print_task' | 'ai_resume_result'

export interface MemberNotificationItem {
  id: string
  kind: NotificationKind
  title: string
  content: string
  category: MemberNotificationCategory | SystemBroadcastCategory
  relatedType: MemberNotificationRelatedType | null
  relatedId: string | null
  isRead: boolean
  createdAt: string
}

export interface MemberNotificationPage {
  items: MemberNotificationItem[]
  nextCursor: string | null
  total: number
  unreadCount: number
}

export class MemberNotificationsApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'MemberNotificationsApiError'
  }
}

interface Envelope<T> {
  success: boolean
  data: T
}

async function request<T>(
  path: string,
  token: string,
  init?: { method?: string },
): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: init?.method ?? 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      credentials: 'include',
    })
  } catch {
    throw new MemberNotificationsApiError('NETWORK_ERROR', '网络连接失败，请稍后重试', 0)
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
    throw new MemberNotificationsApiError(code, message, res.status)
  }

  const json = (await res.json()) as Envelope<T>
  return json.data
}

function pageQuery(opts?: { cursor?: string | null; pageSize?: number; unreadOnly?: boolean }): string {
  const params = new URLSearchParams()
  if (opts?.cursor) params.set('cursor', opts.cursor)
  if (opts?.pageSize) params.set('pageSize', String(opts.pageSize))
  if (opts?.unreadOnly) params.set('unreadOnly', 'true')
  const q = params.toString()
  return q ? `?${q}` : ''
}

const EMPTY_PAGE: MemberNotificationPage = {
  items: [],
  nextCursor: null,
  total: 0,
  unreadCount: 0,
}

export function getMyNotifications(
  token: string | null | undefined,
  opts?: { cursor?: string | null; pageSize?: number; unreadOnly?: boolean },
): Promise<MemberNotificationPage> {
  if (API_MODE !== 'http' || !token) return Promise.resolve(EMPTY_PAGE)
  return request<MemberNotificationPage>(`/me/notifications${pageQuery(opts)}`, token)
}

export function markAllMyNotificationsRead(
  token: string | null | undefined,
): Promise<{ updated: number }> {
  if (API_MODE !== 'http' || !token) return Promise.resolve({ updated: 0 })
  return request<{ updated: number }>('/me/notifications/read-all', token, { method: 'PATCH' })
}

export function markMyNotificationRead(
  token: string | null | undefined,
  kind: NotificationKind,
  id: string,
): Promise<MemberNotificationItem | null> {
  if (API_MODE !== 'http' || !token) return Promise.resolve(null)
  return request<MemberNotificationItem>(
    `/me/notifications/${encodeURIComponent(kind)}/${encodeURIComponent(id)}/read`,
    token,
    { method: 'PATCH' },
  )
}

export function deleteMyNotification(
  token: string | null | undefined,
  kind: NotificationKind,
  id: string,
): Promise<{ deleted: boolean }> {
  if (API_MODE !== 'http' || !token) return Promise.resolve({ deleted: false })
  return request<{ deleted: boolean }>(
    `/me/notifications/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`,
    token,
    { method: 'DELETE' },
  )
}
