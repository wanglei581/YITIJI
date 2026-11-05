import { API_BASE_URL } from './client'
import { ApiHttpError } from './httpAdapter'
import { getTerminalId } from './screensaver'
import { terminalProtectedFetch } from '../terminalAuth'

// C3a 自有协议类型；以 39d48e662 的 CopyJob DTO 为准，不修改共享包。
export interface CopySettings {
  source: 'flatbed' | 'feeder'
  copies: number
  colorMode: 'black_white' | 'color'
  duplex: 'simplex' | 'duplex_long_edge' | 'duplex_short_edge'
}
export interface CreateCopyInput extends CopySettings {
  terminalId: string
  requestKey: string
}
export type CopyJobState = 'ready' | 'scanning' | 'page_ready' | 'scanned' | 'confirmed'
  | 'dispatching' | 'spooled' | 'handed' | 'unconfirmed' | 'cancelled' | 'expired' | 'failed'
export interface CopyJobReceipt {
  copyId: string
  terminalId: string
  state: CopyJobState
  generation: number
  authorizationVersion: number
  expiresAt: string
  controlToken?: string
}

async function copyRequest<T>(path: string, options: {
  method: 'GET' | 'POST'; body?: unknown; controlToken?: string; memberToken?: string | null; signal?: AbortSignal
}): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' })
  const terminalId = getTerminalId()
  if (!terminalId) throw new ApiHttpError('COPY_UNAUTHORIZED', '', 403)
  headers.set('X-Terminal-Id', terminalId)
  if (options.body) headers.set('Content-Type', 'application/json')
  if (options.memberToken) headers.set('Authorization', `Bearer ${options.memberToken}`)
  if (options.controlToken) headers.set('X-Copy-Control', options.controlToken)
  const controller = new AbortController()
  const abort = () => controller.abort()
  options.signal?.addEventListener('abort', abort)
  if (options.signal?.aborted) controller.abort()
  const timeout = window.setTimeout(abort, 12_000)
  try {
    const response = await terminalProtectedFetch(new URL(`${API_BASE_URL}/copy/jobs${path}`, window.location.origin), {
      method: options.method, headers, cache: 'no-store', credentials: 'include',
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal, staleSignal: controller.signal,
    })
    const payload = await response.json() as { success?: boolean; data?: T; error?: { code?: string } }
    if (!response.ok || payload.success !== true || !payload.data) {
      throw new ApiHttpError(payload.error?.code ?? 'COPY_UNKNOWN', '', response.status)
    }
    return payload.data
  } finally {
    window.clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abort)
  }
}

export function createCopyJob(input: CreateCopyInput, memberToken: string | null, signal: AbortSignal): Promise<CopyJobReceipt> {
  return copyRequest('', { method: 'POST', body: input, memberToken, signal })
}

/** C3b 查询同一单的接点。控制凭证只通过请求头传输。 */
export function getCopyJob(copyId: string, controlToken: string, memberToken: string | null, signal?: AbortSignal): Promise<CopyJobReceipt> {
  return copyRequest(`/${encodeURIComponent(copyId)}`, { method: 'GET', controlToken, memberToken, signal })
}
