// ============================================================
// 平台处置通知（3.13）：管理员紧急下架或熔断本机构内容后，服务端给机构写一条通知。
//
// http：GET /partner/org-notices → 裸对象 { items, total, truncated }（服务端只回最新 50 条）。
// mock：演示两条；localStorage['mock:org-notices'] = 'empty' | 'truncated' 切换空态 / 截断态（只在 mock 下读）。
//
// truncated=true 时页面必须写出 total，不能把这一页当成全部。
// ============================================================

import type { PartnerOrgNotice, PartnerOrgNoticeList } from '@ai-job-print/shared'
import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

export type { PartnerOrgNotice, PartnerOrgNoticeList }

export const MOCK_ORG_NOTICES_KEY = 'mock:org-notices'

async function httpGetOrgNotices(): Promise<PartnerOrgNoticeList> {
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}/partner/org-notices`, {
      method: 'GET',
      headers: { Accept: 'application/json', ...authHeader() },
      credentials: 'include',
    })
  } catch {
    throw new ApiHttpError('NETWORK_ERROR', '网络连接失败，请检查网络后重试', 0)
  }
  if (!res.ok) {
    let code = `HTTP_${res.status}`
    let message = `请求失败（${res.status}）`
    try {
      const data = (await res.json()) as { error?: { code?: string; message?: string } }
      if (data.error?.code) code = data.error.code
      if (data.error?.message) message = data.error.message
    } catch { /* 非 JSON */ }
    if (res.status === 401) {
      redirectToLogin()
      throw new ApiHttpError(code || 'AUTH_REQUIRED', '登录已过期', 401)
    }
    throw new ApiHttpError(code, message, res.status)
  }
  const body = (await res.json()) as Partial<PartnerOrgNoticeList> & { data?: Partial<PartnerOrgNoticeList> }
  // 服务端现在回裸对象；万一改成 ApiResponse 信封也接得住。形状不对就如实报错，不当成「没有通知」。
  const list = Array.isArray(body.items) ? body : body.data
  if (!list || !Array.isArray(list.items) || typeof list.total !== 'number') {
    throw new ApiHttpError('UNEXPECTED_RESPONSE', '服务端返回的通知格式无法识别', 200)
  }
  return {
    items: list.items as PartnerOrgNotice[],
    total: list.total,
    truncated: list.truncated === true || list.total > list.items.length,
  }
}

function mockNotice(index: number, targetType: string, title: string, reason: string): PartnerOrgNotice {
  const createdAt = new Date(Date.UTC(2026, 8, 26, 2, 30 - index * 7)).toISOString()
  return {
    id: `notice-mock-${index}`,
    kind: 'recruitment_emergency_takedown',
    title,
    body: `「演示内容 ${index}」已由平台紧急下架。事由：${reason}。此下架不能由管理员恢复。`,
    payloadJson: JSON.stringify({ targetType, targetId: `mock-${index}`, reasonCode: 'rights_complaint', mode: 'single' }),
    readAt: null,
    createdAt,
  }
}

async function mockGetOrgNotices(): Promise<PartnerOrgNoticeList> {
  let variant: string | null = null
  try {
    variant = window.localStorage.getItem(MOCK_ORG_NOTICES_KEY)
  } catch { /* 读不到按默认演示 */ }
  if (variant === 'empty') return { items: [], total: 0, truncated: false }
  const items = [
    mockNotice(1, 'policy', '政策已紧急下架', '权利人投诉，材料清单引用了未授权的附件'),
    mockNotice(2, 'job', '岗位已紧急下架', '岗位描述含有性别限制表述'),
  ]
  if (variant === 'truncated') return { items, total: 57, truncated: true }
  return { items, total: items.length, truncated: false }
}

export function getOrgNotices(): Promise<PartnerOrgNoticeList> {
  return API_MODE === 'http' ? httpGetOrgNotices() : mockGetOrgNotices()
}
