// ============================================================
// 浏览 / 外部跳转记录 API（P1 闭环）。
//
// 上报（recordBrowse / recordExternalJump）：fire-and-forget——
// - 仅登录会员上报（匿名不发请求：服务端本就不为匿名落库，省一次无效往返；
//   共享一体机上匿名浏览历史也绝不写本机存储，避免泄露给下一位使用者）。
// - 任何失败一律静默吞掉，绝不阻断页面访问 / 打开来源平台二维码。
//
// 查询 / 删除（/me/*）：与 memberAssets 同 envelope 与错误约定。
// 合规：只记录「打开来源平台入口」这一动作本身；投递/预约结果以来源平台为准，
// 本系统不记录也不参与投递/预约流程。
// ============================================================

import type {
  ActivityJumpAction,
  ActivityTargetType,
  MemberAssetPage,
  MemberBrowseLogItem,
  MemberJumpLogItem,
} from '@ai-job-print/shared'
import { API_BASE_URL, API_MODE } from './client'

interface Envelope<T> {
  success: boolean
  data: T
}

class ActivityApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ActivityApiError'
  }
}

async function call<T>(path: string, token: string, method: 'GET' | 'DELETE' = 'GET'): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      credentials: 'include',
    })
  } catch {
    throw new ActivityApiError('NETWORK_ERROR', '网络连接失败，请稍后重试')
  }
  if (!res.ok) {
    let code = 'UNKNOWN_ERROR'
    let message = `请求失败（${res.status}）`
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } }
      code = body.error?.code ?? code
      message = body.error?.message ?? message
    } catch { /* keep defaults */ }
    throw new ActivityApiError(code, message)
  }
  const json = (await res.json()) as Envelope<T>
  return json.data
}

/** fire-and-forget 上报：失败静默，绝不抛出、绝不阻断主流程。 */
function fireRecord(path: string, token: string, body: Record<string, string>): void {
  void fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    credentials: 'include',
    body: JSON.stringify(body),
  }).catch(() => {
    /* 记录失败不影响用户主流程（浏览 / 打开来源平台照常） */
  })
}

/** 记录一次浏览（详情成功加载后调用；匿名 / mock 模式静默跳过）。 */
export function recordBrowse(token: string | null | undefined, targetType: ActivityTargetType, targetId: string): void {
  if (API_MODE !== 'http' || !token) return
  fireRecord('/activity/browse', token, { targetType, targetId })
}

/** 记录一次「打开来源平台 / 官方入口」（点开二维码弹窗时调用；匿名 / mock 静默跳过）。 */
export function recordExternalJump(
  token: string | null | undefined,
  targetType: ActivityTargetType,
  targetId: string,
  action: ActivityJumpAction,
): void {
  if (API_MODE !== 'http' || !token) return
  fireRecord('/activity/external-jump', token, { targetType, targetId, action })
}

export interface ActivityPageOpts {
  cursor?: string | null
  pageSize?: number
  targetType?: ActivityTargetType
}

const EMPTY_PAGE = { items: [], nextCursor: null, total: 0 }

function pageQuery(opts?: ActivityPageOpts): string {
  const params = new URLSearchParams()
  if (opts?.cursor) params.set('cursor', opts.cursor)
  if (opts?.pageSize) params.set('pageSize', String(opts.pageSize))
  if (opts?.targetType) params.set('targetType', opts.targetType)
  const q = params.toString()
  return q ? `?${q}` : ''
}

/** 我的浏览记录（本人；未登录 / mock 模式返回空页）。 */
export function getMyBrowseLogs(
  token: string | null | undefined,
  opts?: ActivityPageOpts,
): Promise<MemberAssetPage<MemberBrowseLogItem>> {
  if (API_MODE !== 'http' || !token) return Promise.resolve(EMPTY_PAGE)
  return call<MemberAssetPage<MemberBrowseLogItem>>(`/me/browse-logs${pageQuery(opts)}`, token)
}

/** 我的外部跳转记录（本人；未登录 / mock 模式返回空页）。 */
export function getMyJumpLogs(
  token: string | null | undefined,
  opts?: ActivityPageOpts,
): Promise<MemberAssetPage<MemberJumpLogItem>> {
  if (API_MODE !== 'http' || !token) return Promise.resolve(EMPTY_PAGE)
  return call<MemberAssetPage<MemberJumpLogItem>>(`/me/external-jump-logs${pageQuery(opts)}`, token)
}

/** 删除本人一条浏览记录（服务端归属校验 + 审计；删他人/不存在统一 404）。 */
export function deleteMyBrowseLog(token: string, id: string): Promise<{ deleted: true }> {
  return call(`/me/browse-logs/${encodeURIComponent(id)}`, token, 'DELETE')
}

/** 删除本人一条外部跳转记录。 */
export function deleteMyJumpLog(token: string, id: string): Promise<{ deleted: true }> {
  return call(`/me/external-jump-logs/${encodeURIComponent(id)}`, token, 'DELETE')
}
