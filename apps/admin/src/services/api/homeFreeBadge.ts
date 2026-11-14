// 管理员：某台机器首页是否允许显示「免费使用」。
// API_MODE=http 才写入服务器；演示模式直接失败，不报已保存。

import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

const DEMO_SAVE = '当前是演示数据，没有写入服务器'

function handleAuthFailure(status: number): void {
  if (status === 401 || status === 403) redirectToLogin()
}

async function toApiError(res: Response, fallback: string): Promise<ApiHttpError> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string }
    message?: unknown
  }
  const message = body.error?.message ?? (typeof body.message === 'string' ? body.message : undefined)
  return new ApiHttpError(body.error?.code ?? 'HOME_FREE_BADGE_ERROR', message ?? fallback, res.status)
}

export async function saveTerminalHomeFreeBadge(
  terminalId: string,
  enabled: boolean,
): Promise<{ enabled: boolean }> {
  if (API_MODE !== 'http') throw new ApiHttpError('DEMO_DATA', DEMO_SAVE, 0)
  const res = await fetch(
    `${API_BASE_URL}/admin/terminals/${encodeURIComponent(terminalId)}/home-free-badge`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ enabled }),
    },
  )
  handleAuthFailure(res.status)
  if (!res.ok) throw await toApiError(res, '首页「免费使用」开关保存失败')
  const { data } = (await res.json()) as { data?: { enabled?: unknown } }
  if (typeof data?.enabled !== 'boolean') {
    throw new ApiHttpError('HOME_FREE_BADGE_MISSING', '保存后没有读回开关', res.status)
  }
  return { enabled: data.enabled }
}
