// 管理员设置：已付款打印单排队多久还没被终端领走，就判失败。
// API_MODE=http 才读写服务器。演示模式直接失败，不假装已经保存。

import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

const DEMO_READ = '当前是演示数据，读不到服务器上的排队等待上限'
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
  return new ApiHttpError(body.error?.code ?? 'PRINT_QUEUE_TIMEOUT_ERROR', message ?? fallback, res.status)
}

export function parseQueueTimeoutMinutes(raw: string): number {
  const text = raw.trim()
  if (!/^\d+$/.test(text)) {
    throw new ApiHttpError('PRINT_QUEUE_TIMEOUT_INVALID', '排队等待上限须是 5 到 120 的整数分钟', 0)
  }
  const minutes = Number(text)
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 120) {
    throw new ApiHttpError('PRINT_QUEUE_TIMEOUT_INVALID', '排队等待上限须是 5 到 120 的整数分钟', 0)
  }
  return minutes
}

export async function loadQueueTimeoutMinutes(): Promise<number> {
  if (API_MODE !== 'http') throw new ApiHttpError('DEMO_DATA', DEMO_READ, 0)
  const res = await fetch(`${API_BASE_URL}/admin/print-queue-timeout`, { headers: authHeader() })
  handleAuthFailure(res.status)
  if (!res.ok) throw await toApiError(res, '排队等待上限加载失败')
  const { data } = (await res.json()) as { data: { minutes: number } }
  return data.minutes
}

export async function saveQueueTimeoutMinutes(raw: string): Promise<number> {
  const minutes = parseQueueTimeoutMinutes(raw)
  if (API_MODE !== 'http') throw new ApiHttpError('DEMO_DATA', DEMO_SAVE, 0)
  const res = await fetch(`${API_BASE_URL}/admin/print-queue-timeout`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ minutes }),
  })
  handleAuthFailure(res.status)
  if (!res.ok) throw await toApiError(res, '排队等待上限保存失败')
  const { data } = (await res.json()) as { data: { minutes: number } }
  return data.minutes
}
