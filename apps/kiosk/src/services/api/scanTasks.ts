import type {
  ScanSessionCancelResponse,
  ScanSessionCreateRequest,
  ScanSessionCreateResponse,
  ScanSessionStatusResponse,
} from '@ai-job-print/shared'
import { API_BASE_URL } from './client'
import { getTerminalId } from './screensaver'
import { ApiHttpError } from './httpAdapter'
import { notifySessionIfInvalid } from './throwHttpError'
import { terminalProtectedFetch } from '../terminalAuth'

interface ResponseEnvelope<T> {
  success?: boolean
  data?: T
  error?: { code?: string; message?: string }
}

function makeUrl(path: string): string {
  return new URL(`${API_BASE_URL}${path}`, window.location.origin).toString()
}

async function requestJson<T>(
  path: string,
  init?: RequestInit & {
    token?: string | null
    controlToken?: string | null
    /**
     * 走终端身份闸门（`x-terminal-session-token` + 401 后单次换票重试）。
     *
     * 只有 `POST /scan/sessions` 需要：服务端在这个端点上挂了 `TerminalIdentityGuard`
     * （scan-tasks.controller.ts），只带 `X-Terminal-Id` 会被 401 TERMINAL_SESSION_INVALID
     * 顶回来。状态查询与取消没有这道闸门，也不能走它——终端会话未就绪时
     * terminalProtectedFetch 直接抛 401，会让「取消一个已创建的任务」永远发不出去。
     */
    terminalProtected?: boolean
  },
): Promise<T> {
  const token = init?.token
  const headers = new Headers(init?.headers)
  headers.set('Accept', 'application/json')
  if (init?.body) headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)
  // 与 uploadSessions.ts 的 X-Upload-Session-Control 同一惯例：controlToken 走 header，不进
  // query string/浏览器历史（见 scan-tasks.controller.ts 上的说明）。
  if (init?.controlToken) headers.set('X-Scan-Session-Control', init.controlToken)
  // 限流按台计数（后端 @TerminalScopedThrottle）：扫描会话状态会被定时轮询，
  // 不带这个头时同一大厅多台机器共用一个 IP 桶。取不到终端身份时不发。
  const terminalId = getTerminalId()
  if (terminalId) headers.set('X-Terminal-Id', terminalId)

  let res: Response
  const request: RequestInit = { ...init, headers, credentials: 'include' }
  try {
    res = init?.terminalProtected
      ? await terminalProtectedFetch(makeUrl(path), request)
      : await fetch(makeUrl(path), request)
  } catch (error) {
    // 终端身份闸门在会话未就绪时抛的是 ApiHttpError(TERMINAL_SESSION_INVALID, 401)，
    // 那是一个明确的「请求根本没发出去」结论，不能被压成 NETWORK_ERROR/status 0——
    // 后者在页面上表示「服务端可能已经收到，结果未知」，说反话会让用户不敢重试。
    if (error instanceof ApiHttpError) throw error
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
    notifySessionIfInvalid(res.status, code, token)
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
    terminalProtected: true,
    body: JSON.stringify(input),
  })
}

export function getScanSessionStatus(
  scanTaskId: string,
  controlToken: string,
  token?: string | null,
): Promise<ScanSessionStatusResponse> {
  return requestJson<ScanSessionStatusResponse>(`/scan/sessions/${encodeURIComponent(scanTaskId)}`, {
    controlToken,
    token,
  })
}

export function cancelScanSession(
  scanTaskId: string,
  controlToken: string,
  token?: string | null,
): Promise<ScanSessionCancelResponse> {
  return requestJson<ScanSessionCancelResponse>(`/scan/sessions/${encodeURIComponent(scanTaskId)}`, {
    method: 'DELETE',
    controlToken,
    token,
  })
}
