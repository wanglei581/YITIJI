import { isMemberSessionInvalidError, notifyMemberSessionExpired } from '../auth/memberSessionEvents'
import { terminalProtectedFetch } from '../terminalAuth'
import { API_BASE_URL, API_MODE } from './client'
import { ApiHttpError } from './httpAdapter'
import { parseRetryAfterMs } from './serviceOrders'

export type InvoiceOrderKind = 'print' | 'service'
export type KioskInvoicePollStatus = '等手机填写' | '已提交' | '已过期'

export interface KioskInvoiceSessionCreateResult {
  sessionId: string
  sceneToken: string
  codeUrl: string
  controlToken: string
  expiresAt: string
  status: '等手机填写'
}

export interface KioskInvoicePollResult {
  status: KioskInvoicePollStatus
}

export class InvoiceSessionHttpError extends ApiHttpError {
  constructor(
    code: string,
    message: string,
    status: number,
    public readonly retryAfterMs: number | null = null,
  ) {
    super(code, message, status)
    this.name = 'InvoiceSessionHttpError'
  }
}

export interface InvoiceSceneResolve {
  sessionId: string
  submitToken: string
  orderKind: 'print' | 'service'
  expiresAt: string
  status: string
}

export interface InvoiceSubmitResult {
  status: string
  message: string
  requestId: string
}

interface ResponseEnvelope<T> {
  success?: boolean
  data?: T
  error?: { code?: string; message?: string }
}

const SCENE_PATTERN = /^[A-Za-z0-9_-]{16,32}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isInvoiceSceneToken(value: unknown): value is string {
  return typeof value === 'string' && SCENE_PATTERN.test(value)
}

export function isInvoiceEmail(value: string): boolean {
  return value.length > 0 && value.length <= 120 && EMAIL_PATTERN.test(value)
}

export function readInvoicePhoneCreds(hash: string): { sessionId: string; submitToken: string } | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const sessionId = params.get('sessionId')?.trim() ?? ''
  const submitToken = params.get('submitToken')?.trim() ?? ''
  if (!sessionId || !submitToken) return null
  return { sessionId, submitToken }
}

export function buildPhoneInvoiceUrl(sessionId: string, submitToken: string): string {
  const url = new URL('/invoice/phone', window.location.origin)
  const fragment = new URLSearchParams()
  fragment.set('sessionId', sessionId)
  fragment.set('submitToken', submitToken)
  url.hash = fragment.toString()
  return url.toString()
}

function makeUrl(path: string): string {
  return new URL(`${API_BASE_URL}${path}`, window.location.origin).toString()
}

async function requestJson<T>(path: string, body: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(makeUrl(path), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    })
  } catch {
    throw new ApiHttpError('NETWORK_ERROR', '网络连接失败，请稍后重试', 0)
  }

  let payload: ResponseEnvelope<T> | null = null
  try {
    payload = (await res.json()) as ResponseEnvelope<T>
  } catch {
    payload = null
  }
  if (!res.ok) {
    throw new ApiHttpError(
      payload?.error?.code ?? 'UNKNOWN_ERROR',
      payload?.error?.message ?? '网络连接失败，请稍后重试',
      res.status,
    )
  }
  if (!payload || payload.data == null) {
    throw new ApiHttpError('INVOICE_EMPTY', '网络连接失败，请稍后重试', res.status)
  }
  return payload.data
}

const sceneResolvesInFlight = new Map<string, Promise<InvoiceSceneResolve>>()

export function resolveInvoiceScene(scene: string): Promise<InvoiceSceneResolve> {
  const existing = sceneResolvesInFlight.get(scene)
  if (existing) return existing
  const request = requestJson<InvoiceSceneResolve>('/kiosk/invoice-sessions/scene/resolve', { scene }).finally(() => {
    if (sceneResolvesInFlight.get(scene) === request) sceneResolvesInFlight.delete(scene)
  })
  sceneResolvesInFlight.set(scene, request)
  return request
}

export function submitInvoicePhone(input: {
  sessionId: string
  submitToken: string
  titleType: 'personal' | 'company'
  title: string
  email: string
  taxId?: string
}): Promise<InvoiceSubmitResult> {
  const { sessionId, ...body } = input
  return requestJson<InvoiceSubmitResult>(`/kiosk/invoice-sessions/${encodeURIComponent(sessionId)}/submit`, body)
}

/**
 * 一体机发起自助开票扫码会话（POST /api/v1/kiosk/invoice-sessions）。
 * 必须带会员 Bearer + 终端验签头；controlToken 仅留内存 ref，绝不写进任何存储或 URL。
 */
export async function createKioskInvoiceSession(
  token: string,
  input: { orderKind: InvoiceOrderKind; orderId: string },
): Promise<KioskInvoiceSessionCreateResult> {
  if (API_MODE !== 'http') {
    throw new InvoiceSessionHttpError('INVOICE_UNAVAILABLE', '当前演示模式暂不支持生成开票码。', 0)
  }
  let res: Response
  try {
    res = await terminalProtectedFetch(makeUrl('/kiosk/invoice-sessions'), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      credentials: 'include',
      body: JSON.stringify(input),
    })
  } catch (error) {
    if (error instanceof ApiHttpError) throw error
    throw new InvoiceSessionHttpError('NETWORK_ERROR', '网络连接失败，请稍后重试', 0)
  }

  let payload: ResponseEnvelope<KioskInvoiceSessionCreateResult> | null = null
  try {
    payload = (await res.json()) as ResponseEnvelope<KioskInvoiceSessionCreateResult>
  } catch {
    payload = null
  }
  if (!res.ok) {
    const code = payload?.error?.code ?? 'UNKNOWN_ERROR'
    const message = payload?.error?.message ?? '网络连接失败，请稍后重试'
    if (isMemberSessionInvalidError(res.status, code, true)) notifyMemberSessionExpired(token)
    throw new InvoiceSessionHttpError(code, message, res.status, parseRetryAfterMs(res.headers.get('Retry-After')))
  }
  if (!payload || payload.data == null) {
    throw new InvoiceSessionHttpError('INVOICE_EMPTY', '网络连接失败，请稍后重试', res.status)
  }
  return payload.data
}

/**
 * 一体机轮询开票填写状态（GET /api/v1/kiosk/invoice-sessions/:sessionId）。
 * 带终端验签头与内存中的 x-invoice-control，只返回三种状态，不含抬头/税号/邮箱。
 */
export async function pollKioskInvoiceSession(
  sessionId: string,
  controlToken: string,
): Promise<KioskInvoicePollResult> {
  let res: Response
  try {
    res = await terminalProtectedFetch(makeUrl(`/kiosk/invoice-sessions/${encodeURIComponent(sessionId)}`), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'x-invoice-control': controlToken,
      },
      credentials: 'include',
    })
  } catch (error) {
    if (error instanceof ApiHttpError) throw error
    throw new InvoiceSessionHttpError('NETWORK_ERROR', '网络连接失败，请稍后重试', 0)
  }

  let payload: ResponseEnvelope<KioskInvoicePollResult> | null = null
  try {
    payload = (await res.json()) as ResponseEnvelope<KioskInvoicePollResult>
  } catch {
    payload = null
  }
  if (!res.ok) {
    const code = payload?.error?.code ?? 'UNKNOWN_ERROR'
    const message = payload?.error?.message ?? '网络连接失败，请稍后重试'
    throw new InvoiceSessionHttpError(code, message, res.status, parseRetryAfterMs(res.headers.get('Retry-After')))
  }
  if (!payload || payload.data == null) {
    throw new InvoiceSessionHttpError('INVOICE_EMPTY', '网络连接失败，请稍后重试', res.status)
  }
  return payload.data
}
