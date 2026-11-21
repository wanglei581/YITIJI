import { API_BASE_URL } from './client'
import { ApiHttpError } from './httpAdapter'

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
