import type {
  ScanSessionCancelResponse,
  ScanSessionCreateRequest,
  ScanSessionCreateResponse,
  ScanSessionStatusResponse,
} from '@ai-job-print/shared'
import { API_BASE_URL } from './client'
import { ApiHttpError } from './httpAdapter'

interface ResponseEnvelope<T> {
  success?: boolean
  data?: T
  error?: { code?: string; message?: string }
}

function makeUrl(path: string): string {
  return new URL(`${API_BASE_URL}${path}`, window.location.origin).toString()
}

async function requestJson<T>(path: string, init?: RequestInit & { token?: string | null }): Promise<T> {
  const token = init?.token
  const headers = new Headers(init?.headers)
  headers.set('Accept', 'application/json')
  if (init?.body) headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)

  let res: Response
  try {
    res = await fetch(makeUrl(path), { ...init, headers, credentials: 'include' })
  } catch {
    throw new ApiHttpError('NETWORK_ERROR', '网络连接失败，请稍后重试', 0)
  }

  let payload: ResponseEnvelope<T> | T | null = null
  try {
    payload = (await res.json()) as ResponseEnvelope<T> | T
  } catch {
    payload = null
  }

  if (!res.ok) {
    const envelope = payload as ResponseEnvelope<T> | null
    const code = envelope?.error?.code ?? 'UNKNOWN_ERROR'
    const message = envelope?.error?.message ?? `请求失败（${res.status}）`
    throw new ApiHttpError(code, message, res.status)
  }

  const envelope = payload as ResponseEnvelope<T> | null
  if (envelope && typeof envelope === 'object' && 'data' in envelope) {
    if (envelope.data === undefined || envelope.data === null) {
      throw new ApiHttpError('SCAN_TASK_EMPTY', '扫描任务返回数据为空', res.status)
    }
    return envelope.data
  }
  if (payload === null) {
    throw new ApiHttpError('SCAN_TASK_EMPTY', '扫描任务返回数据为空', res.status)
  }
  return payload as T
}

export function createScanSession(
  input: ScanSessionCreateRequest,
  token?: string | null,
): Promise<ScanSessionCreateResponse> {
  return requestJson<ScanSessionCreateResponse>('/scan/sessions', {
    method: 'POST',
    token,
    body: JSON.stringify(input),
  })
}

export function getScanSessionStatus(scanTaskId: string, token?: string | null): Promise<ScanSessionStatusResponse> {
  return requestJson<ScanSessionStatusResponse>(`/scan/sessions/${encodeURIComponent(scanTaskId)}`, { token })
}

export function cancelScanSession(scanTaskId: string, token?: string | null): Promise<ScanSessionCancelResponse> {
  return requestJson<ScanSessionCancelResponse>(`/scan/sessions/${encodeURIComponent(scanTaskId)}`, {
    method: 'DELETE',
    token,
  })
}
