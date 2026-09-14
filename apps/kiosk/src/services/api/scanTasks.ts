import type {
  ScanRescanAuthorization,
  ScanSessionAckResponse,
  ScanSessionCancelResponse,
  ScanSessionCreateRequest,
  ScanSessionCreateResponse,
  ScanSessionStatusResponse,
} from '@ai-job-print/shared'
import { SCAN_RETRY_CONTROL_HEADER } from '@ai-job-print/shared'
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

/**
 * 安全重扫的两半必须同生同死。
 *
 * 服务端把 body 的 `retryOfScanTaskId` 和 `X-Scan-Retry-Control` 头当一对看：
 * 只有头 → 400 `SCAN_RETRY_TASK_ID_MISSING`；只有 id → 403 `SCAN_RETRY_NOT_AUTHORIZED`。
 * 所以这里**不从调用方给的 body 里取** `retryOfScanTaskId` —— body 按白名单重建，
 * 两半都只从同一个 authorization 对象派生：
 *
 *   · 没给授权 → body 里不会有 id，头也不会出现（普通创建绝不会误带重扫头）；
 *   · 给了授权 → 两半必然同时出现，且指向同一场。
 *
 * 半对（只有 id 或只有 token）在这里当场拒，不降级成普通创建 —— 静默降级正是这次
 * 要修的缺陷本身：用户以为在做安全重扫，实际发出去的是一个会被同字节去重拒掉的新会话。
 */
function assertPairedRescan(
  rescan: ScanRescanAuthorization | null | undefined,
): ScanRescanAuthorization | null {
  if (!rescan) return null
  const retryOfScanTaskId = rescan.retryOfScanTaskId?.trim() ?? ''
  const priorControlToken = rescan.priorControlToken?.trim() ?? ''
  if (retryOfScanTaskId.length === 0 || priorControlToken.length === 0) {
    // status 必须非 0：本仓约定 status===0 表示「压根没拿到 HTTP 响应，结果未知」，
    // 而这里请求根本还没发出去，结论是确定的。
    throw new ApiHttpError(
      'SCAN_RESCAN_AUTHORITY_INCOMPLETE',
      '安全重扫凭证不完整，本次不会改用普通重扫',
      400,
    )
  }
  return { retryOfScanTaskId, priorControlToken }
}

export async function createScanSession(
  input: ScanSessionCreateRequest,
  token?: string | null,
  rescan?: ScanRescanAuthorization | null,
): Promise<ScanSessionCreateResponse> {
  const paired = assertPairedRescan(rescan)
  // body 按白名单重建：调用方传进来的 retryOfScanTaskId 一律不采信，
  // 它只能来自上面那份成对校验过的授权。
  const body: ScanSessionCreateRequest = { scanType: input.scanType, terminalId: input.terminalId }
  const headers: Record<string, string> = {}
  if (paired) {
    body.retryOfScanTaskId = paired.retryOfScanTaskId
    // 凭证只走 header：不进 body、不进 query string、不落任何浏览器存储、不进日志。
    headers[SCAN_RETRY_CONTROL_HEADER] = paired.priorControlToken
  }
  return requestJson<ScanSessionCreateResponse>('/scan/sessions', {
    method: 'POST',
    token,
    terminalProtected: true,
    headers,
    body: JSON.stringify(body),
  })
}

/** 本机凭据不全时抛的码。**不发请求**，所以 status 必须非 0（结论是确定的）。 */
export const SCAN_ACK_CREDENTIALS_INCOMPLETE = 'SCAN_ACK_CREDENTIALS_INCOMPLETE'

/**
 * 告诉服务端：这一场的控制凭据**已经稳稳落在本机了**，可以开始投递。
 *
 * ## 它守的是哪一个缺陷
 *
 * 创建成功的那一瞬间，服务端那条任务就已经是 waiting —— 在这个 ACK 出现之前，
 * Agent 的 current-lease 立刻就能看见它并把面板上扫出来的文件投过去。于是「响应在
 * 回来的路上丢了」这一类故障会留下一个**可投递却没有任何界面在看着**的收件箱：
 * 本机不知道它的 id，屏幕上什么都没有，下一位走到面板前按下扫描，文件就进去了。
 *
 * 服务端 2026-09-14 起把这条链路改成两段：新建会话一律 `deliveryAckedAt = null`，
 * current-lease 看不见它（60 秒没 ACK 就回收）；只有本机**明确确认自己握着这一场的
 * 控制凭据**之后，它才变得可投递。也就是说，这个 ACK 不是一次状态上报，
 * 它是「这台机器上现在有一个人正看着这一场」的唯一证据。
 *
 * ## 为什么是这四样凭据，一样都不能少
 *
 * 服务端在这个端点上同时校验：`TerminalIdentityGuard`（终端会话票）、
 * `X-Terminal-Id` 必须是任务所属终端、`X-Scan-Session-Control` 必须是这一场的
 * controlToken、会员身份必须是任务的 owner。所以这里必须 `terminalProtected: true`
 * （带上终端会话票，401 后换票重试一次），并把 controlToken 走
 * `X-Scan-Session-Control` 头（不进 query string / 浏览器历史）。
 *
 * 凭据不全时**一个请求都不发**：半对凭据发出去只会拿回 403，而那条 403 在页面上
 * 会被读成「服务端不认这一场」，把一个本机自己的错误说成服务端的结论。
 */
export function ackScanSession(
  scanTaskId: string,
  controlToken: string,
  token?: string | null,
): Promise<ScanSessionAckResponse> {
  // 判空按 trim 算，**发出去的仍是原串**：服务端按字节比对 hash，
  // 这里替它「整理」一下凭据就等于发了一份不同的凭据。
  const hasId = typeof scanTaskId === 'string' && scanTaskId.trim().length > 0
  const hasControl = typeof controlToken === 'string' && controlToken.trim().length > 0
  if (!hasId || !hasControl) {
    return Promise.reject(new ApiHttpError(
      SCAN_ACK_CREDENTIALS_INCOMPLETE,
      '扫描会话凭据不完整，本次不会确认投递',
      400,
    ))
  }
  return requestJson<ScanSessionAckResponse>(
    `/scan/sessions/${encodeURIComponent(scanTaskId)}/ack`,
    {
      method: 'POST',
      controlToken,
      token,
      terminalProtected: true,
    },
  )
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
